import { GIT_PULL_TIMEOUT_MS } from "./constants";
import { UNSET_TEXT, UNSET_SETTING_LABEL } from "./unset";

export type PullResult =
  | { ok: true }
  | { ok: false; stderr: string; code?: number | null; timedOut?: boolean; notFound?: boolean };

export type PullStatus = "idle" | "running" | "ok" | "error" | "no-repo" | "unset";

export interface PullSnapshot {
  status: PullStatus;
  /** Zeitpunkt der letzten Änderung des Zustands (ms), null solange nichts passiert ist. */
  at: number | null;
  /** Fehlertext, nur bei status "error". */
  error: string | null;
}

/** Kurztext eines Fehlschlags: git fehlt, Zeitüberschreitung, erste nicht-leere stderr-Zeile, sonst der Exit-Code. */
export function errorText(result: PullResult): string {
  if (result.ok) return "";
  if (result.notFound) return "git nicht gefunden";
  if (result.timedOut) return `Zeitüberschreitung nach ${GIT_PULL_TIMEOUT_MS / 1000} s`;
  const lines = result.stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  // `--ff-only` bei auseinandergelaufenen Ständen schickt erst mehrere hint:-Zeilen, der Grund steht danach.
  const line = lines.find((l) => !l.startsWith("hint:")) ?? lines[0];
  if (line !== undefined) return line;
  return `git endete mit Code ${result.code ?? "unbekannt"}`;
}

export class PullState {
  private snap: PullSnapshot = { status: "idle", at: null, error: null };
  private readonly listeners = new Set<(s: PullSnapshot) => void>();

  snapshot(): PullSnapshot {
    return this.snap;
  }

  /** false, wenn schon ein Pull läuft; sonst Zustand "running". */
  tryStart(now: number): boolean {
    if (this.snap.status === "running") return false;
    this.set({ status: "running", at: now, error: null });
    return true;
  }

  /** Ergebnis ersetzt den Zustand ganz: ein Fehler löscht das frühere ok, ein ok den Fehler. */
  finish(result: PullResult, now: number): void {
    this.set(result.ok ? { status: "ok", at: now, error: null } : { status: "error", at: now, error: errorText(result) });
  }

  setNoRepo(now: number): void {
    this.set({ status: "no-repo", at: now, error: null });
  }

  /** Briefing-Ordner nicht eingerichtet: kein Pull. */
  setUnset(now: number): void {
    this.set({ status: "unset", at: now, error: null });
  }

  subscribe(cb: (s: PullSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private set(s: PullSnapshot): void {
    this.snap = s;
    for (const cb of [...this.listeners]) cb(s);
  }
}

export function formatPullStatus(s: PullSnapshot, formatTime: (ms: number) => string): { text: string; error: boolean } {
  const t = s.at === null ? "" : formatTime(s.at);
  switch (s.status) {
    case "idle": return { text: "noch nicht gepullt", error: false };
    case "running": return { text: "pullt …", error: false };
    case "ok": return { text: `zuletzt gepullt ${t}, ok`, error: false };
    case "error": return { text: `Pull ${t} fehlgeschlagen: ${s.error ?? "unbekannter Fehler"}`, error: true };
    case "no-repo": return { text: "kein Git-Repo", error: false };
    case "unset": return { text: `${UNSET_TEXT}: Einstellung „${UNSET_SETTING_LABEL.briefingsDir}“`, error: false };
  }
}

/** Fehlerobjekt von child_process.execFile, nur die Felder, die wir lesen. */
export interface ExecErrorLike {
  code?: unknown;
  killed?: boolean;
  signal?: string | null;
}

/** Ergebnis von execFile: kein Fehler = ok; ENOENT = git fehlt; killed/signal = Zeitüberschreitung. */
export function pullResultFromExec(err: ExecErrorLike | null, stderr: string): PullResult {
  if (err === null) return { ok: true };
  if (err.code === "ENOENT") return { ok: false, stderr, notFound: true };
  if (err.killed === true || (typeof err.signal === "string" && err.signal !== "")) return { ok: false, stderr, timedOut: true };
  return { ok: false, stderr, ...(typeof err.code === "number" ? { code: err.code } : {}) };
}

/** Ist der automatische Pull fällig? 0 Minuten = aus; noch nie versucht = fällig. */
export function pullDue(lastAttempt: number | null, now: number, intervalMin: number): boolean {
  if (intervalMin <= 0) return false;
  return lastAttempt === null || now - lastAttempt >= intervalMin * 60000;
}
