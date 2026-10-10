/**
 * Sitzungsdatei (Abend 18): `statusline/statusline-command.sh` schreibt je Claude-Sitzung
 * `~/.claude/cockpit/sessions/<session_id>.json`:
 * `{ session_id, written_at, context_tokens, used_percentage, model }`.
 * `written_at` sind ganze Unix-Sekunden, wie in usage.json und tokens-today.json.
 * Rein: kein Dateizugriff, kein obsidian/electron/node-pty.
 */

export interface SessionFile {
  sessionId: string;
  contextTokens: number;
  usedPercentage: number;
  model: string;
  /** Unix-Sekunden */
  writtenAt: number;
}

/** Aufräumgrenze: Dateien, die älter sind, löscht das Plugin (ms). */
export const SESSION_FILE_MAX_AGE_MS = 24 * 3600 * 1000;

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Tolerant gegenüber Leerzeichen, streng bei Feldern: kaputt oder fremd ergibt null. */
export function parseSessionFile(text: string): SessionFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.session_id !== "string" || !UUID.test(o.session_id)) return null;
  if (!finite(o.context_tokens) || o.context_tokens < 0) return null;
  if (!finite(o.used_percentage)) return null;
  if (typeof o.model !== "string") return null;
  if (!finite(o.written_at)) return null;
  return {
    sessionId: o.session_id,
    contextTokens: o.context_tokens,
    usedPercentage: o.used_percentage,
    model: o.model,
    writtenAt: o.written_at,
  };
}

/** Alter in ganzen Sekunden; `writtenAt` in Unix-Sekunden, `nowMs` in ms. Aus der Zukunft: 0. */
export function sessionFileAge(writtenAt: number, nowMs: number): number {
  return Math.max(0, Math.floor(nowMs / 1000 - writtenAt));
}

/** Veraltet, wenn älter als `maxMs` (genau die Grenze zählt noch nicht). */
export function isStale(writtenAt: number, nowMs: number, maxMs: number = SESSION_FILE_MAX_AGE_MS): boolean {
  return nowMs - writtenAt * 1000 > maxMs;
}
