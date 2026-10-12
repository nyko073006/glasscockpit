// Aufmerksamkeitssignal (Abend 7): Hooks von Claude Code geben per `terminalSequence` eine OSC-777-Sequenz
// in den PTY-Strom aus. Format gemessen am 04.10.2026 (claude 2.1.x, echte PTY).

import { isUuid } from "./session-model";
import type { ActivitySignal } from "./session-activity";

/** Signale, die Benachrichtigung auslösen (Markierung, Alarm, Telegram). busy gehört nicht dazu. */
export type AttentionSignal = "done" | "question";
export const ATTENTION_OSC = 777;

const TITLE = "Glasscockpit";
const PREFIX = "cockpit:";

export function attentionSequence(signal: ActivitySignal): string {
  return `\x1b]${ATTENTION_OSC};notify;${TITLE};${PREFIX}${signal}\x07`;
}

/** Shell-Befehl für einen Hook. Das JSON enthält kein `'`, das einfache Quoting hält. */
export function hookCommand(signal: ActivitySignal): string {
  return `printf '%s\\n' '${JSON.stringify({ terminalSequence: attentionSequence(signal) })}'`;
}

const UUID_SHELL = "[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}";

/**
 * Hook für SessionStart (clear, resume): liest das stdin-JSON, nimmt `session_id` und gibt
 * `cockpit:session:<uuid>` aus. Nur grep und head, kein jq. Fehlt eine gültige UUID, bleibt die Ausgabe leer.
 * Die UUID ist vorher auf Hex und Bindestriche geprüft, deshalb kommt nichts Fremdes in die Ausgabe. printf
 * bekommt Anfang und Ende als Argumente (`%s`), damit die Shell `\u001b` nicht selbst umwandelt.
 */
export function sessionHookCommand(): string {
  const [start, end] = JSON.stringify({ terminalSequence: `\x1b]${ATTENTION_OSC};notify;${TITLE};${PREFIX}session:@@ID@@\x07` }).split("@@ID@@");
  return (
    `id=$(grep -Eo '"session_id" *: *"${UUID_SHELL}"' | head -n 1 | grep -Eo '${UUID_SHELL}'); ` +
    `[ -n "$id" ] && printf '%s%s%s\\n' '${start}' "$id" '${end}'; true`
  );
}

/**
 * Wiederholte Frage: AskUserQuestion löst sofort PreToolUse aus und nach 6 s noch einen permission_prompt (gemessen am
 * 06.10.2026, claude 2.1.291; dessen stdin nennt kein Werkzeug, ein Filter im Hook kann nicht greifen). Wartet die Sitzung
 * schon auf eine Antwort, meldet die zweite Frage nichts. PostToolUse von AskUserQuestion setzt busy, die nächste Frage zählt.
 */
export function repeatsQuestion(prev: ActivitySignal | undefined, signal: AttentionSignal): boolean {
  return signal === "question" && prev === "question";
}

/** JSON für `claude --settings`: Stop → done; AskUserQuestion und Rechte-/Eingabefrage → question; UserPromptSubmit und beantwortete AskUserQuestion → busy; SessionStart (clear, resume) → Sitzungswechsel. */
export function hookSettings(): string {
  const hooks = (signal: ActivitySignal) => [{ type: "command", command: hookCommand(signal) }];
  return JSON.stringify({
    hooks: {
      Stop: [{ hooks: hooks("done") }],
      PreToolUse: [{ matcher: "AskUserQuestion", hooks: hooks("question") }],
      PostToolUse: [{ matcher: "AskUserQuestion", hooks: hooks("busy") }],
      Notification: [{ matcher: "permission_prompt|elicitation_dialog", hooks: hooks("question") }],
      UserPromptSubmit: [{ hooks: hooks("busy") }],
      SessionStart: [{ matcher: "clear|resume|fork", hooks: [{ type: "command", command: sessionHookCommand() }] }],
    },
  });
}

/** oscData ohne "777;", also "notify;…;cockpit:done". Fremde Sequenzen ergeben null. */
export function parseAttention(oscData: string): AttentionSignal | null {
  const last = oscData.split(";").pop();
  if (last === `${PREFIX}done`) return "done";
  if (last === `${PREFIX}question`) return "question";
  return null;
}

export type ParsedSignal = { kind: "activity"; signal: ActivitySignal } | { kind: "session"; id: string };

/** Alle cockpit:-Signale: done, question, busy und `session:<uuid>`. Fremdes und Ungültiges ergibt null. */
export function parseSignal(oscData: string): ParsedSignal | null {
  const last = oscData.split(";").pop() ?? "";
  if (last === `${PREFIX}done` || last === `${PREFIX}question` || last === `${PREFIX}busy`) {
    return { kind: "activity", signal: last.slice(PREFIX.length) as ActivitySignal };
  }
  const sessionPrefix = `${PREFIX}session:`;
  if (last.startsWith(sessionPrefix)) {
    const id = last.slice(sessionPrefix.length);
    return isUuid(id) ? { kind: "session", id } : null;
  }
  return null;
}

/** Neue Claude-ID aus einem Sitzungssignal: null bei gleicher oder ungültiger ID (dann nichts tun). Vergleich ohne Groß-/Kleinschreibung. */
export function claudeIdChange(current: string, signaled: string): string | null {
  if (!isUuid(signaled)) return null;
  return signaled.toLowerCase() === current.toLowerCase() ? null : signaled;
}

export interface ViewSight {
  active: boolean;
  shown: boolean;
  windowFocused: boolean;
}
export interface Reaction {
  mark: boolean;
  alert: boolean;
}

/** Markieren, solange der Nutzer nicht draufschaut; Alarm nur, wenn die View verdeckt oder das Fenster im Hintergrund ist. */
export function react(sight: ViewSight): Reaction {
  return {
    mark: !(sight.active && sight.shown && sight.windowFocused),
    alert: !sight.shown || !sight.windowFocused,
  };
}

/** Entprellung: höchstens ein Alarm je Sitzung in gapMs. */
export function alertDue(lastAt: number | null, now: number, gapMs: number): boolean {
  return lastAt === null || now - lastAt >= gapMs;
}

/**
 * Tab-Titel: eine Markierung (● fertig, ? Frage), dann bei offenen Hintergrundaufgaben „⏳ <Zahl> “ (Abend 28), dann der Titel.
 * Ohne dritten Parameter oder bei 0 und ungültigen Zahlen bleibt es beim bisherigen Titel.
 */
export function markedTitle(title: string, signal: AttentionSignal | null, open = 0): string {
  const mark = signal === "done" ? "● " : signal === "question" ? "? " : "";
  const tasks = open > 0 ? `⏳ ${open} ` : "";
  return `${mark}${tasks}${title}`;
}

/**
 * Stille Zwischenstände (Abend 28): Ein Antwortende (done), hinter dem noch Hintergrundaufgaben laufen, meldet nichts; gemeldet
 * wird erst das done, nach dem nichts mehr läuft. Eine Frage ist nie still, sie wartet auf den Nutzer. quietOn ist die Einstellung
 * quietWhileAgents. Eine ungültige Zahl (NaN, negativ) ist nicht still: im Zweifel melden.
 */
export function doneIsQuiet(signal: AttentionSignal, quietOn: boolean, open: number): boolean {
  return signal === "done" && quietOn && open > 0;
}

export function bannerText(name: string, signal: AttentionSignal): string {
  return signal === "done" ? `${name} ist fertig` : `${name} hat eine Frage`;
}
