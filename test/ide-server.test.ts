// Integrationstest der IDE-Brücke: echter ws-Client gegen den echten Server, Lockfile in einem Temp-Ordner (nie ~/.claude/ide).
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import WebSocket from "ws";
import { IDE_TOOLS, jsonResult, textResult, type IdeHandlers } from "../src/core/ide-protocol";
import { IdeServer, pidAlive } from "../src/host/ide-server";

const TOKEN = "0123456789abcdef0123456789abcdef";
const VAULT = "/Users/x/Vault";

let dir: string;
let server: IdeServer;
let warns: string[];
let sockets: WebSocket[];
let openFile: Mock<IdeHandlers["openFile"]>;

function handlers(): IdeHandlers {
  openFile = vi.fn(() => textResult("Opened file"));
  return {
    getCurrentSelection: () => jsonResult({ success: false, message: "No active editor found" }),
    getLatestSelection: () => jsonResult({ success: false, message: "No selection available" }),
    getOpenEditors: () => jsonResult({ tabs: [] }),
    getWorkspaceFolders: () => jsonResult({ success: true, folders: [{ name: "Vault", uri: `file://${VAULT}`, path: VAULT }], rootPath: VAULT }),
    openFile,
    checkDocumentDirty: () => jsonResult({ success: true, isDirty: false }),
    saveDocument: () => jsonResult({ success: true, saved: true }),
  };
}

function make(over: Partial<ConstructorParameters<typeof IdeServer>[0]> = {}): IdeServer {
  return new IdeServer({
    lockDir: dir,
    workspaceFolders: () => [VAULT],
    vaultBase: () => VAULT,
    handlers: handlers(),
    pid: process.pid,
    isPidAlive: pidAlive,
    newToken: () => TOKEN,
    warn: (m) => warns.push(m),
    ...over,
  });
}

/** Verbindet; Ergebnis: Socket oder der HTTP-Status der Ablehnung. */
function connect(port: number, headers: Record<string, string>, protocols?: string[]): Promise<{ ws: WebSocket } | { status: number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, protocols, { headers });
    sockets.push(ws);
    ws.once("open", () => resolve({ ws }));
    ws.once("unexpected-response", (_req, res) => resolve({ status: res.statusCode ?? 0 }));
    ws.once("error", (e) => (/Unexpected server response/.test(String(e)) ? undefined : reject(e)));
  });
}

async function open(port: number, protocols: string[] = ["mcp"]): Promise<WebSocket> {
  const r = await connect(port, { "x-claude-code-ide-authorization": TOKEN }, protocols);
  if (!("ws" in r)) throw new Error(`abgelehnt: ${r.status}`);
  return r.ws;
}

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => ws.once("message", (d) => resolve(JSON.parse(d.toString()))));
}

async function rpc(ws: WebSocket, msg: object): Promise<any> {
  const answer = nextMessage(ws);
  ws.send(JSON.stringify({ jsonrpc: "2.0", ...msg }));
  return answer;
}

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("Bedingung nicht erreicht");
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ide-test-"));
  warns = [];
  sockets = [];
  server = make();
});
afterEach(async () => {
  for (const s of sockets) s.terminate();
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("Start und Lockfile", () => {
  it("bindet einen Port und schreibt <port>.lock mit den fünf Feldern", async () => {
    const port = await server.start();
    expect(port).toBeGreaterThan(0);
    expect(server.port).toBe(port);
    const file = join(dir, `${port}.lock`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      pid: process.pid, workspaceFolders: [VAULT], ideName: "Glasscockpit", transport: "ws", authToken: TOKEN,
    });
  });
  it("Lockfile hat Modus 0600, und es bleibt keine temporäre Datei zurück", async () => {
    const port = await server.start();
    expect(statSync(join(dir, `${port}.lock`)).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual([`${port}.lock`]);
  });
  it("legt den Lockfile-Ordner an, wenn er fehlt", async () => {
    const tief = join(dir, "a", "b");
    const s = make({ lockDir: tief });
    const port = await s.start();
    expect(existsSync(join(tief, `${port}.lock`))).toBe(true);
    await s.stop();
  });
  it("neuer Lockfile-Ordner bekommt Modus 0700, ein vorhandener behält seine Rechte", async () => {
    const neu = join(dir, "neu");
    const s = make({ lockDir: neu });
    await s.start();
    expect(statSync(neu).mode & 0o777).toBe(0o700);
    await s.stop();
    const alt = join(dir, "alt");
    mkdirSync(alt, { mode: 0o755 });
    chmodSync(alt, 0o755);
    const t = make({ lockDir: alt });
    await t.start();
    expect(statSync(alt).mode & 0o777).toBe(0o755);
    await t.stop();
  });
  it("zweiter start liefert denselben Port, kein zweiter Server", async () => {
    const a = await server.start();
    expect(await server.start()).toBe(a);
    expect(readdirSync(dir)).toHaveLength(1);
  });
  it("Lockfile-Ordner nicht anlegbar: start liefert null, warnt, wirft nicht, kein Server bleibt", async () => {
    const datei = join(dir, "datei");
    writeFileSync(datei, "x");
    const s = make({ lockDir: join(datei, "ide") });
    expect(await s.start()).toBeNull();
    expect(s.port).toBeNull();
    expect(warns.length).toBeGreaterThan(0);
    await s.stop();
  });
  it("kein Log enthält den Token", async () => {
    const datei = join(dir, "datei");
    writeFileSync(datei, "x");
    const s = make({ lockDir: join(datei, "ide") });
    await s.start();
    const port = await server.start();
    await connect(port!, { "x-claude-code-ide-authorization": "falsch" });
    expect(warns.join("\n")).not.toContain(TOKEN);
  });
});

describe("Anmeldung", () => {
  it("falscher Token: 401", async () => {
    const port = await server.start();
    expect(await connect(port!, { "x-claude-code-ide-authorization": "falsch" }, ["mcp"])).toEqual({ status: 401 });
  });
  it("fehlender Header: 401", async () => {
    const port = await server.start();
    expect(await connect(port!, {}, ["mcp"])).toEqual({ status: 401 });
  });
  it("Token mit anderer Länge (Präfix des echten): 401", async () => {
    const port = await server.start();
    expect(await connect(port!, { "x-claude-code-ide-authorization": TOKEN.slice(0, -1) })).toEqual({ status: 401 });
    expect(await connect(port!, { "x-claude-code-ide-authorization": `${TOKEN}0` })).toEqual({ status: 401 });
  });
  it("richtiger Token mit Subprotokoll mcp: verbunden, Subprotokoll mcp zurückgegeben", async () => {
    const port = await server.start();
    const ws = await open(port!);
    expect(ws.protocol).toBe("mcp");
  });
  it("richtiger Token ohne Subprotokoll: verbunden (der Token schützt), ohne Subprotokoll in der Antwort", async () => {
    const port = await server.start();
    const ws = await open(port!, []);
    expect(ws.protocol).toBe("");
  });
  it("mehrere Clients gleichzeitig", async () => {
    const port = await server.start();
    await open(port!);
    await open(port!);
    await until(() => server.clients().length === 2);
    const ids = server.clients().map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("Nachrichten", () => {
  it("initialize: Antwort mit der Version des Clients, serverInfo Glasscockpit", async () => {
    const port = await server.start();
    const ws = await open(port!);
    const r = await rpc(ws, { id: 0, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "claude-code" } } });
    expect(r).toMatchObject({ jsonrpc: "2.0", id: 0, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "Glasscockpit" } } });
  });
  it("tools/list: die sieben Tools", async () => {
    const port = await server.start();
    const ws = await open(port!);
    const r = await rpc(ws, { id: 1, method: "tools/list" });
    expect(r.result.tools).toEqual(IDE_TOOLS);
  });
  it("tools/call getWorkspaceFolders: Vault-Ordner im Ergebnis", async () => {
    const port = await server.start();
    const ws = await open(port!);
    const r = await rpc(ws, { id: 2, method: "tools/call", params: { name: "getWorkspaceFolders", arguments: {} } });
    expect(JSON.parse(r.result.content[0].text).rootPath).toBe(VAULT);
  });
  it("tools/call openFile im Vault erreicht den Handler mit vault-relativem Pfad", async () => {
    const port = await server.start();
    const ws = await open(port!);
    await rpc(ws, { id: 3, method: "tools/call", params: { name: "openFile", arguments: { filePath: `${VAULT}/Notizen/a.md` } } });
    expect(openFile).toHaveBeenCalledWith({ path: "Notizen/a.md", absolute: `${VAULT}/Notizen/a.md` });
  });
  it("tools/call openFile außerhalb des Vaults und mit ..: isError, Handler nie gerufen", async () => {
    const port = await server.start();
    const ws = await open(port!);
    for (const filePath of ["/etc/passwd", `${VAULT}/../geheim.md`, "../x.md"]) {
      const r = await rpc(ws, { id: 4, method: "tools/call", params: { name: "openFile", arguments: { filePath } } });
      expect(r.result.isError).toBe(true);
    }
    expect(openFile).not.toHaveBeenCalled();
  });
  it("tools/call openDiff: Fehler (nicht angeboten)", async () => {
    const port = await server.start();
    const ws = await open(port!);
    const r = await rpc(ws, { id: 5, method: "tools/call", params: { name: "openDiff", arguments: {} } });
    expect(r.error.code).toBe(-32602);
  });
  it("kaputtes JSON: Parse-Fehler als Antwort, die Verbindung bleibt", async () => {
    const port = await server.start();
    const ws = await open(port!);
    const antwort = nextMessage(ws);
    ws.send("{kaputt");
    expect((await antwort).error.code).toBe(-32700);
    const r = await rpc(ws, { id: 6, method: "ping" });
    expect(r.result).toEqual({});
  });
  it("Benachrichtigung notifications/initialized bekommt keine Antwort", async () => {
    const port = await server.start();
    const ws = await open(port!);
    const got: unknown[] = [];
    ws.on("message", (d) => got.push(JSON.parse(d.toString())));
    ws.send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    const r = await rpc(ws, { id: 7, method: "ping" });
    expect(r.id).toBe(7);
    expect(got.every((m: any) => m.id === 7)).toBe(true);
  });
  it("ide_connected ordnet dem Client seine pid zu, Änderung wird gemeldet", async () => {
    const changes = vi.fn();
    const s = make({ onClientsChange: changes });
    const port = await s.start();
    const ws = await open(port!);
    await until(() => s.clients().length === 1);
    expect(s.clients()[0].pid).toBeNull();
    ws.send(JSON.stringify({ jsonrpc: "2.0", method: "ide_connected", params: { pid: 4242 } }));
    await until(() => s.clients()[0].pid === 4242);
    expect(changes).toHaveBeenCalled();
    await s.stop();
  });
  it("ide_connected mit ungültiger pid ändert nichts", async () => {
    const port = await server.start();
    const ws = await open(port!);
    await until(() => server.clients().length === 1);
    ws.send(JSON.stringify({ jsonrpc: "2.0", method: "ide_connected", params: { pid: "x" } }));
    await rpc(ws, { id: 1, method: "ping" });
    expect(server.clients()[0].pid).toBeNull();
  });
});

describe("trace (Mitschnitt für die Probe)", () => {
  it("meldet eingehende und ausgehende Nachrichten, nie den Token", async () => {
    const lines: string[] = [];
    const s = make({ trace: (richtung, text) => lines.push(`${richtung} ${text}`) });
    const port = await s.start();
    const ws = await open(port!);
    await rpc(ws, { id: 1, method: "ping" });
    expect(lines).toEqual([expect.stringMatching(/^in .*"ping"/), 'out {"jsonrpc":"2.0","id":1,"result":{}}']);
    expect(lines.join("\n")).not.toContain(TOKEN);
    await s.stop();
  });
});

describe("selection_changed und at_mentioned", () => {
  it("broadcast geht an alle Clients, Zahl der Empfänger kommt zurück", async () => {
    const port = await server.start();
    const a = await open(port!);
    const b = await open(port!);
    await until(() => server.clients().length === 2);
    const ma = nextMessage(a);
    const mb = nextMessage(b);
    const params = { text: "hallo", filePath: "/x.md", fileUrl: "file:///x.md", selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 }, isEmpty: false } };
    expect(server.broadcast("selection_changed", params)).toBe(2);
    expect(await ma).toEqual({ jsonrpc: "2.0", method: "selection_changed", params });
    expect(await mb).toEqual({ jsonrpc: "2.0", method: "selection_changed", params });
  });
  it("broadcast ohne Clients: 0, kein Fehler", async () => {
    await server.start();
    expect(server.broadcast("selection_changed", {})).toBe(0);
  });
  it("send geht nur an den einen Client; unbekannte id: false", async () => {
    const port = await server.start();
    const a = await open(port!);
    const b = await open(port!);
    await until(() => server.clients().length === 2);
    const got: string[] = [];
    b.on("message", (d) => got.push(d.toString()));
    const ma = nextMessage(a);
    const [ca] = server.clients();
    const ia = (await Promise.all([ma, Promise.resolve(server.send(ca.id, "at_mentioned", { filePath: "/x.md", lineStart: 1, lineEnd: 2 }))]))[0];
    expect(ia).toMatchObject({ method: "at_mentioned", params: { filePath: "/x.md", lineStart: 1, lineEnd: 2 } });
    await rpc(b, { id: 1, method: "ping" });
    expect(got.filter((m) => m.includes("at_mentioned"))).toEqual([]);
    expect(server.send(999, "at_mentioned", {})).toBe(false);
  });
});

describe("Stoppen und Aufräumen", () => {
  it("stop löscht das Lockfile, schließt Clients und gibt den Port frei", async () => {
    const port = await server.start();
    const ws = await open(port!);
    const closed = new Promise<void>((r) => ws.once("close", () => r()));
    await server.stop();
    await closed;
    expect(existsSync(join(dir, `${port}.lock`))).toBe(false);
    expect(server.port).toBeNull();
    await expect(connect(port!, { "x-claude-code-ide-authorization": TOKEN })).rejects.toBeDefined();
  });
  it("stop ohne start und doppeltes stop sind harmlos", async () => {
    await server.stop();
    await server.start();
    await server.stop();
    await server.stop();
  });
  it("stop löscht das Lockfile schon synchron (auch wenn niemand wartet)", async () => {
    const port = await server.start();
    void server.stop();
    expect(existsSync(join(dir, `${port}.lock`))).toBe(false);
  });
  it("beim Start: eigene verwaiste Lockfiles (ideName Glasscockpit, pid tot) weg, alles andere bleibt", async () => {
    mkdirSync(dir, { recursive: true });
    const lock = (name: string, o: object) => writeFileSync(join(dir, name), JSON.stringify(o));
    lock("11111.lock", { pid: 111, ideName: "Glasscockpit", transport: "ws" }); // verwaist
    lock("22222.lock", { pid: 222, ideName: "Glasscockpit", transport: "ws" }); // Prozess lebt
    lock("33333.lock", { pid: 111, ideName: "VS Code", transport: "ws" }); // fremd, pid tot
    writeFileSync(join(dir, "44444.lock"), "{kaputt");
    writeFileSync(join(dir, "notiz.txt"), "x");
    const s = make({ isPidAlive: (pid) => pid === 222 || pid === process.pid });
    const port = await s.start();
    expect(readdirSync(dir).sort()).toEqual(["22222.lock", "33333.lock", "44444.lock", `${port}.lock`, "notiz.txt"].sort());
    await s.stop();
  });
  it("beim Start: eigene verwaiste Temp-Dateien (pid tot) weg, die einer lebenden pid und fremde bleiben", async () => {
    writeFileSync(join(dir, "11111.lock.111.1700000000000.tmp"), "{}");
    writeFileSync(join(dir, "22222.lock.222.1700000000000.tmp"), "{}");
    writeFileSync(join(dir, "fremd.tmp"), "x");
    const s = make({ isPidAlive: (pid) => pid === 222 || pid === process.pid });
    const port = await s.start();
    expect(readdirSync(dir).sort()).toEqual(["22222.lock.222.1700000000000.tmp", "fremd.tmp", `${port}.lock`].sort());
    await s.stop();
  });
  it("pidAlive: eigener Prozess lebt, eine nicht vergebene pid nicht", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2 ** 22 + 12345)).toBe(false);
  });
});

describe("Diff-Tools über den echten Server (Abend 17)", () => {
  const args = { old_file_path: "/r/a.txt", new_file_path: "/r/a.txt", new_file_contents: "neu\n", tab_name: "t1" };
  const names = (r: any) => r.result.tools.map((t: { name: string }) => t.name);
  let an: boolean;
  let closed: number[];
  let openDiff: Mock<NonNullable<IdeHandlers["diff"]>["openDiff"]>;
  let release: (text: string) => void;

  function withDiff(): IdeServer {
    openDiff = vi.fn(() => new Promise((resolve) => { release = (text) => resolve(textResult(text)); }));
    const h = handlers();
    h.diff = { openDiff, closeTab: () => textResult("TAB_CLOSED"), closeAllDiffTabs: () => textResult("CLOSED_0_DIFF_TABS") };
    return make({ handlers: h, diffEnabled: () => an, onClientClose: (id) => closed.push(id) });
  }
  beforeEach(async () => {
    an = false;
    closed = [];
    await server.stop();
    server = withDiff();
  });

  it("aus: tools/list ohne Diff-Tools, tools/call openDiff ergibt -32602", async () => {
    const ws = await open((await server.start())!);
    expect(names(await rpc(ws, { id: 1, method: "tools/list" }))).toEqual(IDE_TOOLS.map((t) => t.name));
    const r = await rpc(ws, { id: 2, method: "tools/call", params: { name: "openDiff", arguments: args } });
    expect(r.error.code).toBe(-32602);
    expect(openDiff).not.toHaveBeenCalled();
  });
  it("Umschalten wirkt ohne Neustart des Servers, auf derselben Verbindung", async () => {
    const ws = await open((await server.start())!);
    expect(names(await rpc(ws, { id: 1, method: "tools/list" }))).not.toContain("openDiff");
    an = true;
    expect(names(await rpc(ws, { id: 2, method: "tools/list" }))).toContain("openDiff");
  });
  it("an: openDiff antwortet erst nach der Entscheidung und kennt die Verbindung; währenddessen laufen andere Anfragen", async () => {
    an = true;
    const ws = await open((await server.start())!);
    const pending = new Promise<any>((resolve) => {
      const onMsg = (d: WebSocket.RawData) => { const m = JSON.parse(d.toString()); if (m.id === 5) { ws.off("message", onMsg); resolve(m); } };
      ws.on("message", onMsg);
    });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "openDiff", arguments: args } }));
    await until(() => openDiff.mock.calls.length === 1);
    expect(openDiff.mock.calls[0][0]).toEqual({ oldFilePath: "/r/a.txt", newFilePath: "/r/a.txt", newFileContents: "neu\n", tabName: "t1" });
    expect(openDiff.mock.calls[0][1]).toBe(server.clients()[0].id);
    const ping = await rpc(ws, { id: 6, method: "ping" });
    expect(ping.result).toEqual({});
    release("FILE_SAVED");
    expect((await pending).result.content[0].text).toBe("FILE_SAVED");
  });
  it("Verbindung weg: onClientClose meldet die id; ein Aufruf nach dem Stopp meldet auch", async () => {
    an = true;
    const ws = await open((await server.start())!);
    const id = server.clients()[0].id;
    ws.close();
    await until(() => closed.length === 1);
    expect(closed).toEqual([id]);
  });
  it("stop meldet offene Verbindungen ebenfalls (damit offene Diffs aufgelöst werden)", async () => {
    an = true;
    const ws = await open((await server.start())!);
    const id = server.clients()[0].id;
    expect(ws.readyState).toBe(WebSocket.OPEN);
    await server.stop();
    expect(closed).toEqual([id]);
  });
});
