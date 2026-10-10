import { SEND_ENTER_DELAY_MS } from "./constants";
import { preparePaste } from "./paste";
import type { SessionKind } from "./session-model";

export interface SendStep {
  data: string;
  delayMs: number;
}

export type TargetCheck = "ok" | "no-session" | "exited" | "not-claude";

/** Text samt Enter an Claude Code. Mehrzeiler als Paste, das Enter folgt nach SEND_ENTER_DELAY_MS. */
export function buildSend(text: string): SendStep[] {
  if (text === "") return [];
  if (/[\r\n]/.test(text)) {
    return [
      { data: preparePaste(text), delayMs: 0 },
      { data: "\r", delayMs: SEND_ENTER_DELAY_MS },
    ];
  }
  return [{ data: `${text}\r`, delayMs: 0 }];
}

/** Text ohne Enter einfügen (etwa „/name “ zum Weitertippen). */
export function buildInsert(text: string): SendStep[] {
  if (text === "") return [];
  return [{ data: preparePaste(text), delayMs: 0 }];
}

/** Darf hier blind gesendet werden? Eine Shell bekäme „/skill“ als Befehl, das wäre Raten. */
export function checkTarget(t: { sessionId: string | null; kind: SessionKind | null; running: boolean }): TargetCheck {
  if (t.sessionId === null) return "no-session";
  if (!t.running) return "exited";
  if (t.kind !== "claude" && t.kind !== "agent") return "not-claude";
  return "ok";
}
