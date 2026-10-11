import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { join } from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { type IdeClientInfo, parseIdeConnected } from "../core/ide-clients";
import { rawDataToString } from "../core/raw-data-text";
import {
  IDE_AUTH_HEADER, IDE_NAME, IDE_SUBPROTOCOL, type IdeHandlers, authorized, dispatchRequest, lockContent, notification, parseLock,
  parseMessage, rpcError,
} from "../core/ide-protocol";

// IDE-Brücke (Abend 16): WebSocket-Server auf 127.0.0.1, den Claude Code über das Lockfile findet. Fehler gehen nur an
// `warn`, nie als Ausnahme nach außen: Die Brücke ist abschaltbar gekapselt und darf das Plugin nie stören.
// Der Token steht nur im Lockfile und im Speicher, nie in einer Meldung.

export interface IdeServerDeps {
  /** Ordner der Lockfiles (~/.claude/ide). In Tests ein Temp-Ordner. */
  lockDir: string;
  workspaceFolders: () => string[];
  vaultBase: () => string | null;
  handlers: IdeHandlers;
  /** pid, die ins Lockfile kommt (die des Cockpits). */
  pid: number;
  isPidAlive: (pid: number) => boolean;
  /** 32 Hex-Zeichen aus einem kryptografischen Zufallsgenerator. */
  newToken: () => string;
  warn: (message: string) => void;
  /** Eine Verbindung kam, ging oder hat ihre pid gemeldet. */
  onClientsChange?: () => void;
  /** Einstellung ideDiff, bei jeder Anfrage frisch gelesen: nur dann gibt es openDiff, close_tab und closeAllDiffTabs. */
  diffEnabled?: () => boolean;
  /** Eine Verbindung ist weg (auch beim Stopp): Diffs, auf die sie wartet, sind hinfällig. */
  onClientClose?: (clientId: number) => void;
  /** Mitschnitt aller Textnachrichten (nur für die Probe; die Nachrichten enthalten nie den Token). */
  trace?: (direction: "in" | "out", text: string) => void;
}

/** Lebt der Prozess? EPERM heißt: lebt, gehört aber jemand anderem. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (fehler) {
    return (fehler as NodeJS.ErrnoException).code === "EPERM";
  }
}

interface Client {
  id: number;
  ws: WebSocket;
  pid: number | null;
}

const MAX_PAYLOAD = 4 * 1024 * 1024;

export class IdeServer {
  private readonly deps: IdeServerDeps;
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private lockPath: string | null = null;
  private token = "";
  private listenPort: number | null = null;
  private readonly connections = new Map<number, Client>();
  private nextId = 1;

  constructor(deps: IdeServerDeps) {
    this.deps = deps;
  }

  get port(): number | null {
    return this.listenPort;
  }

  /** Port, auf dem der Server lauscht, oder null (Grund in warn). Ein zweiter Aufruf ändert nichts. */
  async start(): Promise<number | null> {
    if (this.listenPort !== null) return this.listenPort;
    try {
      this.token = this.deps.newToken();
      this.removeStaleLocks();
      const http = createServer((_req, res) => {
        res.writeHead(404, { Connection: "close" });
        res.end();
      });
      const wss = new WebSocketServer({
        noServer: true,
        maxPayload: MAX_PAYLOAD,
        // Claude Code bietet mcp an und erwartet es zurück. Ohne Angebot kein Subprotokoll; der Token schützt.
        handleProtocols: (protocols) => (protocols.has(IDE_SUBPROTOCOL) ? IDE_SUBPROTOCOL : false),
      });
      http.on("upgrade", (req, socket, head) => this.upgrade(wss, req, socket, head));
      http.on("error", (fehler) => this.deps.warn(`Glasscockpit, IDE-Brücke: Serverfehler: ${fehler.message}`));
      wss.on("error", (fehler) => this.deps.warn(`Glasscockpit, IDE-Brücke: WebSocket-Fehler: ${fehler.message}`));
      wss.on("connection", (ws) => this.accept(ws));
      await new Promise<void>((resolve, reject) => {
        http.once("error", reject);
        http.listen({ host: "127.0.0.1", port: 0 }, () => {
          http.off("error", reject);
          resolve();
        });
      });
      this.http = http;
      this.wss = wss;
      this.listenPort = (http.address() as AddressInfo).port;
      this.writeLock(this.listenPort);
      return this.listenPort;
    } catch (fehler) {
      this.deps.warn(`Glasscockpit, IDE-Brücke: Start fehlgeschlagen: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
      await this.stop();
      return null;
    }
  }

  /** Lockfile sofort (synchron) löschen, dann Verbindungen und Server schließen. Mehrfach aufrufbar. */
  async stop(): Promise<void> {
    if (this.lockPath !== null) {
      try {
        unlinkSync(this.lockPath);
      } catch (fehler) {
        if ((fehler as NodeJS.ErrnoException).code !== "ENOENT") this.deps.warn("Glasscockpit, IDE-Brücke: Lockfile nicht gelöscht");
      }
      this.lockPath = null;
    }
    const http = this.http;
    const wss = this.wss;
    this.http = null;
    this.wss = null;
    this.listenPort = null;
    this.token = "";
    const gone = [...this.connections.keys()];
    for (const client of this.connections.values()) client.ws.terminate();
    this.connections.clear();
    if (gone.length > 0) this.deps.onClientsChange?.();
    for (const id of gone) this.clientClosed(id);
    wss?.close();
    if (http) {
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    }
  }

  clients(): IdeClientInfo[] {
    return [...this.connections.values()].map((c) => ({ id: c.id, pid: c.pid }));
  }

  /** Benachrichtigung an alle Clients. Rückgabe: Zahl der Empfänger. */
  broadcast(method: string, params: unknown): number {
    let sent = 0;
    for (const client of this.connections.values()) if (this.sendTo(client, notification(method, params))) sent++;
    return sent;
  }

  /** Benachrichtigung an einen Client. false: unbekannt oder nicht offen. */
  send(clientId: number, method: string, params: unknown): boolean {
    const client = this.connections.get(clientId);
    return client ? this.sendTo(client, notification(method, params)) : false;
  }

  private sendTo(client: Client, message: object): boolean {
    if (client.ws.readyState !== WebSocket.OPEN) return false;
    const text = JSON.stringify(message);
    this.deps.trace?.("out", text);
    client.ws.send(text, (fehler) => {
      if (fehler) this.deps.warn(`Glasscockpit, IDE-Brücke: Senden fehlgeschlagen: ${fehler.message}`);
    });
    return true;
  }

  private upgrade(wss: WebSocketServer, req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!authorized(req.headers[IDE_AUTH_HEADER], this.token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  }

  private accept(ws: WebSocket): void {
    const client: Client = { id: this.nextId++, ws, pid: null };
    this.connections.set(client.id, client);
    this.deps.onClientsChange?.();
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      void this.handle(client, rawDataToString(data)).catch((fehler: unknown) =>
        this.deps.warn(`Glasscockpit, IDE-Brücke: Nachricht nicht verarbeitet: ${fehler instanceof Error ? fehler.message : String(fehler)}`));
    });
    ws.on("close", () => {
      if (this.connections.delete(client.id)) {
        this.deps.onClientsChange?.();
        this.clientClosed(client.id);
      }
    });
    ws.on("error", (fehler) => this.deps.warn(`Glasscockpit, IDE-Brücke: Verbindungsfehler: ${fehler.message}`));
  }

  /** Fehler des Beobachters stören den Server nicht. */
  private clientClosed(clientId: number): void {
    try {
      this.deps.onClientClose?.(clientId);
    } catch (fehler) {
      this.deps.warn(`Glasscockpit, IDE-Brücke: Verbindung ${clientId} nicht aufgeräumt: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
    }
  }

  private async handle(client: Client, text: string): Promise<void> {
    this.deps.trace?.("in", text);
    const msg = parseMessage(text);
    if (msg.kind === "invalid") {
      this.sendTo(client, rpcError(msg.id, msg.code, msg.reason));
    } else if (msg.kind === "notification") {
      if (msg.method === "ide_connected") {
        const pid = parseIdeConnected(msg.params);
        if (pid !== null) {
          client.pid = pid;
          this.deps.onClientsChange?.();
        }
      }
    } else if (msg.kind === "request") {
      const answer = await dispatchRequest(msg, {
        handlers: this.deps.handlers,
        vaultBase: this.deps.vaultBase,
        diffEnabled: this.deps.diffEnabled,
        clientId: client.id,
      });
      if (answer) this.sendTo(client, answer);
    }
  }

  /** Lockfile atomar: temporäre Datei mit 0600 im selben Ordner, dann rename. */
  private writeLock(port: number): void {
    // Neu angelegt nur für den Besitzer; ein vorhandener Ordner behält seine Rechte (mode wirkt nur auf neue Ordner).
    mkdirSync(this.deps.lockDir, { recursive: true, mode: 0o700 });
    const target = join(this.deps.lockDir, `${port}.lock`);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeSync(fd, lockContent({ pid: this.deps.pid, workspaceFolders: this.deps.workspaceFolders(), authToken: this.token }));
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(temp, target);
    } catch (fehler) {
      try {
        unlinkSync(temp);
      } catch {
        // Nichts mehr zu retten.
      }
      throw fehler;
    }
    this.lockPath = target;
  }

  /** Eigene Reste früherer Läufe: ideName Glasscockpit und Prozess tot. Fremde und unlesbare Dateien bleiben. */
  private removeStaleLocks(): void {
    let names: string[];
    try {
      names = readdirSync(this.deps.lockDir);
    } catch {
      return; // Ordner fehlt noch: nichts aufzuräumen.
    }
    // Temporäre Dateien eines abgestürzten Schreibers: <port>.lock.<pid>.<zeit>.tmp, pid tot.
    for (const name of names) {
      const tmp = /^\d+\.lock\.(\d+)\.\d+\.tmp$/.exec(name);
      if (!tmp || this.deps.isPidAlive(Number(tmp[1]))) continue;
      try {
        unlinkSync(join(this.deps.lockDir, name));
      } catch {
        // Schon weg.
      }
    }
    for (const name of names.filter((n) => n.endsWith(".lock"))) {
      try {
        const lock = parseLock(readFileSync(join(this.deps.lockDir, name), "utf8"));
        if (lock && lock.ideName === IDE_NAME && !this.deps.isPidAlive(lock.pid)) unlinkSync(join(this.deps.lockDir, name));
      } catch {
        // Unlesbar oder schon weg: stehen lassen.
      }
    }
  }
}
