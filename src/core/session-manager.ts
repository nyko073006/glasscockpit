import { KILL_ESCALATION_MS } from "./constants";
import { type KillHandle, type KillSignal, escalateKill } from "./kill-escalation";
import { RingBuffer } from "./ring-buffer";
import { ModeTracker } from "./terminal-modes";
import { canResize } from "./shell";
import type { TimerApi } from "./view-tracker";

export interface Disposable {
  dispose(): void;
}

/** Was der Manager von einer PTY braucht. node-pty liefert das über src/host/pty-factory.ts. */
export interface PtyLike {
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): Disposable;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  /** Prozess-ID (node-pty setzt sie; node-pty startet mit setsid, pid ist zugleich die Prozessgruppe). */
  readonly pid?: number;
}

export interface ManagerOptions {
  /** Timer für die SIGKILL-Frist. Muss den Entladen des Plugins überleben (Fenster-Timer, nicht registerInterval). */
  timers?: TimerApi;
  killGraceMs?: number;
  /** Signal an die ganze Prozessgruppe (-pid); ohne Angabe oder bei Fehler geht SIGKILL an die PTY. */
  signalGroup?: (pid: number, signal: KillSignal) => void;
}

/** Was die Views über eine Sitzung wissen müssen: Art (für „Session-ID kopieren“) und Tab-Titel. */
export interface SessionMeta {
  kind: "shell" | "claude";
  title: string;
}

export interface SessionSpec {
  id: string;
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  meta?: SessionMeta;
}

export type PtyFactory = (spec: SessionSpec) => PtyLike;

export type SpawnResult = { ok: true; created: boolean } | { ok: false; error: string };

export type DataCallback = (data: string) => void;
export type ExitCallback = (exitCode: number) => void;

export interface SessionHandle {
  /** Ruft cb sofort einmal mit dem ganzen Ring auf, danach live. Gibt die Abmeldung zurück. */
  attach(cb: DataCallback): () => void;
  /** Ist die Sitzung schon beendet, kommt cb sofort. Gibt die Abmeldung zurück. */
  onExit(cb: ExitCallback): () => void;
  replay(): string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

/** Messwerte für die Diagnose „leere Pane“. */
export interface SessionStats {
  running: boolean;
  exitCode: number | null;
  chunks: number;
  chars: number;
  ringChars: number;
  cols: number;
  rows: number;
  subscribers: number;
}

interface Session {
  pty: PtyLike;
  ring: RingBuffer;
  /** Modi, die der gekürzte Ring verlieren kann (Abend 19f). */
  modes: ModeTracker;
  dataSubs: Set<DataCallback>;
  exitSubs: Set<ExitCallback>;
  listeners: Disposable[];
  exitCode: number | null;
  cols: number;
  rows: number;
  chunks: number;
  chars: number;
  meta: SessionMeta | null;
}

function errorText(fehler: unknown): string {
  return fehler instanceof Error ? fehler.message : String(fehler);
}

/** Sitzungen leben hier, nicht in der View. Kein node-pty-Import: Die PTY kommt aus der Factory. */
export class SessionManager {
  private readonly factory: PtyFactory;
  private readonly ringMax: number | undefined;
  private readonly sessions = new Map<string, Session>();
  private readonly timers: TimerApi;
  private readonly killGraceMs: number;
  private readonly signalGroup: ManagerOptions["signalGroup"];
  private readonly changeSubs = new Set<() => void>();

  constructor(factory: PtyFactory, ringMax?: number, options: ManagerOptions = {}) {
    this.factory = factory;
    this.ringMax = ringMax;
    this.timers = options.timers ?? {
      set: (callback, ms) => setTimeout(callback, ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.killGraceMs = options.killGraceMs ?? KILL_ESCALATION_MS;
    this.signalGroup = options.signalGroup;
  }

  /** Idempotent: Eine laufende Sitzung bleibt, eine beendete wird ersetzt. */
  spawn(spec: SessionSpec): SpawnResult {
    const existing = this.sessions.get(spec.id);
    if (existing && existing.exitCode === null) return { ok: true, created: false };
    if (existing) this.remove(spec.id);

    let pty: PtyLike;
    try {
      pty = this.factory(spec);
    } catch (fehler) {
      return { ok: false, error: errorText(fehler) };
    }

    const session: Session = {
      pty,
      ring: new RingBuffer(this.ringMax),
      modes: new ModeTracker(),
      dataSubs: new Set(),
      exitSubs: new Set(),
      listeners: [],
      exitCode: null,
      cols: spec.cols,
      rows: spec.rows,
      chunks: 0,
      chars: 0,
      meta: spec.meta ?? null,
    };
    session.listeners.push(
      pty.onData((data) => {
        session.chunks++;
        session.chars += data.length;
        session.ring.append(data);
        session.modes.feed(data);
        for (const cb of [...session.dataSubs]) cb(data);
      }),
      pty.onExit(({ exitCode }) => {
        session.exitCode = exitCode;
        for (const cb of [...session.exitSubs]) cb(exitCode);
        this.notifyChange();
      }),
    );
    this.sessions.set(spec.id, session);
    this.notifyChange();
    return { ok: true, created: true };
  }

  /** Meldet jede Änderung der Sitzungen (Start, Ende, Entfernen), etwa damit das Sitzungsradar der Cockpit-Ansicht neu zeichnet. */
  onChange(cb: () => void): () => void {
    this.changeSubs.add(cb);
    return () => { this.changeSubs.delete(cb); };
  }

  private notifyChange(): void {
    for (const cb of [...this.changeSubs]) {
      try {
        cb();
      } catch (fehler) {
        console.error("Glasscockpit: Abonnent der Sitzungsänderung gescheitert", fehler);
      }
    }
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  isRunning(id: string): boolean {
    const session = this.sessions.get(id);
    return session !== undefined && session.exitCode === null;
  }

  /** pid der laufenden PTY (IDE-Brücke: Zuordnung Verbindung zu Sitzung); sonst undefined. */
  pidOf(id: string): number | undefined {
    const session = this.sessions.get(id);
    return session !== undefined && session.exitCode === null ? session.pty.pid : undefined;
  }

  /** Griff auf die Sitzung, wie sie jetzt ist. Eine später ersetzte Sitzung braucht einen neuen Griff. */
  handle(id: string): SessionHandle | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return {
      attach: (cb) => {
        cb(replayOf(session));
        session.dataSubs.add(cb);
        return () => session.dataSubs.delete(cb);
      },
      onExit: (cb) => {
        if (session.exitCode !== null) cb(session.exitCode);
        else session.exitSubs.add(cb);
        return () => session.exitSubs.delete(cb);
      },
      replay: () => replayOf(session),
      write: (data) => {
        if (session.exitCode === null) session.pty.write(data);
      },
      resize: (cols, rows) => {
        if (session.exitCode !== null || !canResize(cols, rows)) return;
        session.cols = cols;
        session.rows = rows;
        session.pty.resize(cols, rows);
      },
    };
  }

  stats(id: string): SessionStats | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return {
      running: session.exitCode === null,
      exitCode: session.exitCode,
      chunks: session.chunks,
      chars: session.chars,
      ringChars: session.ring.length,
      cols: session.cols,
      rows: session.rows,
      subscribers: session.dataSubs.size,
    };
  }

  meta(id: string): SessionMeta | null {
    return this.sessions.get(id)?.meta ?? null;
  }

  ids(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Beendet die PTY (falls sie läuft) und vergisst die Sitzung. Unbekannte id: nichts. SIGHUP sofort, lebt der
   * Prozess nach der Frist noch, SIGKILL an die Prozessgruppe (Kinder bleiben sonst als Waisen zurück, gemessen
   * am 05.10.2026). Das Versprechen löst auf, sobald der Prozess weg oder SIGKILL gesendet ist.
   */
  kill(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return Promise.resolve();
    this.remove(id);
    if (session.exitCode !== null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let alive = true;
      let handle: KillHandle | null = null;
      // Die Abonnenten sind weg, den Exit hört nur noch dieser Wächter; er räumt sich beim Exit selbst ab.
      const watch = session.pty.onExit(() => {
        alive = false;
        watch.dispose();
        handle?.processExited();
      });
      handle = escalateKill(
        {
          send: (signal) => this.send(id, session, signal),
          isAlive: () => alive,
          set: (callback, ms) => this.timers.set(callback, ms),
          clear: (timer) => this.timers.clear(timer),
        },
        this.killGraceMs,
        resolve,
      );
      if (!alive) handle.processExited();
    });
  }

  killAll(): Promise<void> {
    return Promise.all(this.ids().map((id) => this.kill(id))).then(() => undefined);
  }

  private send(id: string, session: Session, signal: KillSignal): void {
    try {
      const pid = session.pty.pid;
      if (signal === "SIGKILL" && pid !== undefined && this.signalGroup) {
        try {
          this.signalGroup(pid, signal);
          return;
        } catch {
          // Gruppe nicht erreichbar: unten die PTY selbst.
        }
      }
      session.pty.kill(signal);
    } catch (fehler) {
      console.error(`Glasscockpit: Sitzung ${id} ließ sich nicht beenden (${signal})`, fehler);
    }
  }

  private remove(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    for (const listener of session.listeners) listener.dispose();
    session.dataSubs.clear();
    session.exitSubs.clear();
    this.notifyChange();
  }
}

/** Wiedergabe für eine neue View: Vorspann mit den eingeschalteten Modi, dann der Ring. */
function replayOf(session: Session): string {
  return session.modes.prelude() + session.ring.toString();
}
