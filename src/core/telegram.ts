// Telegram als vierter Benachrichtigungskanal (Abend 11). Reine Logik, kein Dateizugriff, kein Netz.
// Das Token steht nie in einer Einstellung; es kommt bei jedem Versand frisch aus der .env-Datei.
import type { AttentionSignal } from "./attention";
import { shortPath } from "./claude-launch";

export type Resolved = { ok: true; token: string; chatId: string } | { ok: false; reason: string };
export type SendResult = { ok: true } | { ok: false; reason: string };
export interface SendDecisionInput {
  /** Schalter der Art (telegramOnDone bzw. telegramOnQuestion). */
  enabled: boolean;
  /** Mindest-Leerlauf in Minuten, 0 = immer. */
  idleMin: number;
  /** Sekunden ohne Eingabe am Mac, null = Messung gescheitert. */
  idleSec: number | null;
  /** Zeitpunkt der letzten Telegram-Nachricht dieser Sitzung. */
  lastAt: number | null;
  now: number;
  gapMs: number;
}

export const TEST_TEXT = "🧪 Glasscockpit: Testnachricht";
export const TOKEN_KEY = "TELEGRAM_BOT_TOKEN";
const CHAT_ID_RE = /^-?\d+$/;

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) return t.slice(1, -1).trim();
  return t;
}

/** Wert von TELEGRAM_BOT_TOKEN aus dem Text einer .env-Datei; null, wenn fehlt oder leer. */
export function parseToken(envText: string): string | null {
  for (const line of envText.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?TELEGRAM_BOT_TOKEN\s*=(.*)$/.exec(line);
    if (!m) continue;
    const value = unquote(m[1]);
    return value === "" ? null : value;
  }
  return null;
}

/** allowFrom[0] aus dem Text von access.json als String; null, wenn nicht ermittelbar. */
export function parseChatId(accessText: string | null): string | null {
  if (accessText === null) return null;
  let data: unknown;
  try { data = JSON.parse(accessText); } catch { return null; }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const list = (data as Record<string, unknown>).allowFrom;
  if (!Array.isArray(list) || list.length === 0) return null;
  const first = list[0];
  const id = typeof first === "number" && Number.isInteger(first) ? String(first) : first;
  return typeof id === "string" && CHAT_ID_RE.test(id) ? id : null;
}

/** Token und Chat-ID zusammenführen. Die Einstellung hat Vorrang vor access.json. Die Gründe nennen nie das Token. */
export function resolveCredentials(envText: string | null, accessText: string | null, chatSetting: string): Resolved {
  if (envText === null) return { ok: false, reason: "Datei mit dem Token fehlt" };
  const token = parseToken(envText);
  if (token === null) return { ok: false, reason: `kein ${TOKEN_KEY} in der Datei` };
  const own = chatSetting.trim();
  const chatId = own !== "" ? own : parseChatId(accessText);
  if (chatId === null) return { ok: false, reason: "keine Chat-ID (Einstellung leer, access.json ohne allowFrom)" };
  return { ok: true, token, chatId };
}

/** Nur Klartext, kein Inhalt aus der Unterhaltung: Sitzungsname und Ordner. */
export function telegramText(signal: AttentionSignal, name: string, cwd: string, home: string): string {
  const head = signal === "done" ? `✅ ${name} ist fertig` : `❓ ${name} hat eine Frage`;
  return cwd === "" ? head : `${head}\n${shortPath(cwd, home)}`;
}

/** Senden, wenn die Art an ist, der Mac lange genug ruht (unbekannt zählt nur bei 0) und der Abstand je Sitzung gilt. */
export function shouldSend(i: SendDecisionInput): boolean {
  if (!i.enabled) return false;
  if (i.lastAt !== null && i.now - i.lastAt < i.gapMs) return false;
  if (i.idleMin === 0) return true;
  return i.idleSec !== null && i.idleSec >= i.idleMin * 60;
}

/** Sekunden aus `ioreg -c IOHIDSystem` (Feld HIDIdleTime in Nanosekunden). Mehrere Treffer: der kleinste. */
export function parseIdleSeconds(ioregText: string): number | null {
  let min: number | null = null;
  for (const m of ioregText.matchAll(/"HIDIdleTime"\s*=\s*(\d+)/g)) {
    const sec = Number(m[1]) / 1e9;
    if (min === null || sec < min) min = sec;
  }
  return min;
}

/** Token aus einem Text schneiden (Netzfehler enthalten oft die URL mit Token). Auch ohne bekanntes Token die Form nnn:xxx. */
export function redactToken(text: string, token: string | null): string {
  let out = text;
  if (token) out = out.split(token).join("***");
  return out.replace(/\d{5,}:[A-Za-z0-9_-]{20,}/g, "***");
}

/** Antwort von sendMessage: ok nur bei HTTP 2xx und ok:true; sonst Status mit Telegram-description. */
export function describeResponse(status: number, bodyText: string): SendResult {
  type Body = { ok?: unknown; description?: unknown };
  let body: Body | null = null;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed === "object" && parsed !== null) body = parsed as Body;
  } catch { /* kein JSON */ }
  if (status >= 200 && status < 300 && body?.ok === true) return { ok: true };
  const desc = typeof body?.description === "string" && body.description !== "" ? `: ${body.description}` : "";
  return { ok: false, reason: `HTTP ${status}${desc}` };
}
