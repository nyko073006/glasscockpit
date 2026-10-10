import { RECENT_SKILLS_MAX, SESSION_NAME_MAX } from "./constants";
import { DEFAULT_SETTINGS, parseSettings, type CockpitSettings } from "./settings";

export type SessionKind = "claude" | "agent" | "shell";
export interface SessionRecord {
  id: string; name: string; kind: SessionKind; agentName?: string; cwd: string; createdAt: string; // ISO
  /** UUID der Claude-Unterhaltung; fehlt sie (Bestand), gilt id. Siehe claudeIdOf. */
  claudeSessionId?: string;
}
export const SCHEMA_VERSION = 1;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/**
 * Die ID, die Claude Code kennt (Startargumente, Transkript, Kurz-ID im Titel). Fehlt claudeSessionId oder ist sie
 * keine UUID, gilt die Cockpit-id: So bleibt jeder Bestandseintrag fortsetzbar. Die Cockpit-id bleibt Schlüssel
 * für Leaf-State, SessionManager und Benachrichtigung.
 */
export function claudeIdOf(record: SessionRecord): string {
  return isUuid(record.claudeSessionId) ? record.claudeSessionId : record.id;
}
/** Bereich der Cockpit-Ansicht (Abend 19e): Hauptbereich (auch ein ausgelöstes Fenster), linke oder rechte Seitenleiste. */
export type DashboardArea = "main" | "left" | "right";
/** dashboardAtUnload (Abend 19e): null = beim Entladen war keine Cockpit-Ansicht offen. */
export type DashboardMemo = { area: DashboardArea } | null;
/**
 * openAtUnload (Abend 19c): Sitzungs-ids mit offenem Terminal-Tab beim letzten Entladen des Plugins, nach dem Laden wieder leer.
 * dashboardAtUnload (Abend 19e): dasselbe für die Cockpit-Ansicht, mit ihrem Bereich.
 */
export interface CockpitData { schemaVersion: 1; sessions: SessionRecord[]; settings: CockpitSettings; recentSkills: string[]; openAtUnload: string[]; dashboardAtUnload: DashboardMemo }

export function emptyData(): CockpitData {
  return { schemaVersion: 1, sessions: [], settings: { ...DEFAULT_SETTINGS }, recentSkills: [], openAtUnload: [], dashboardAtUnload: null };
}

export interface ParseResult { data: CockpitData; reason: string | null }

const KINDS: readonly string[] = ["claude", "agent", "shell"];

const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function validRecord(v: unknown): v is SessionRecord {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return isText(r.id) && isText(r.name) && typeof r.kind === "string" && KINDS.includes(r.kind)
    && isText(r.cwd) && typeof r.createdAt === "string"
    && (r.agentName === undefined || typeof r.agentName === "string");
}

/** Zuletzt benutzte Skills: kein Array ergibt [], Nicht-Strings und Dopplungen fallen raus, höchstens RECENT_SKILLS_MAX. Nie ein Grund für die Kaputt-Notice. */
function parseRecents(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const n of v) if (isText(n) && !out.includes(n)) out.push(n);
  return out.slice(0, RECENT_SKILLS_MAX);
}

/** Merkzettel offener Tabs: kein Array ergibt [], Nicht-Strings, Leeres und Dopplungen fallen raus. Nie ein Grund für die Kaputt-Notice. */
function parseIdList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const id of v) if (isText(id) && !out.includes(id)) out.push(id);
  return out;
}

const AREAS: readonly string[] = ["main", "left", "right"];

/** Merkzettel der Cockpit-Ansicht: alles außer { area: "main" | "left" | "right" } ergibt null. Nie ein Grund für die Kaputt-Notice. */
function parseDashboardMemo(v: unknown): DashboardMemo {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const area = (v as Record<string, unknown>).area;
  return typeof area === "string" && AREAS.includes(area) ? { area: area as DashboardArea } : null;
}

/** Liest data.json. Nie werfen: kaputt heißt Vorgaben plus Grund. */
export function parseData(raw: unknown): ParseResult {
  if (raw === undefined || raw === null) return { data: emptyData(), reason: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { data: emptyData(), reason: "data.json ist kein Objekt" };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== SCHEMA_VERSION) {
    return { data: emptyData(), reason: `unbekannte schemaVersion ${String(obj.schemaVersion)}` };
  }
  const reasons: string[] = [];
  const sessions: SessionRecord[] = [];
  if (!Array.isArray(obj.sessions)) {
    reasons.push("sessions fehlt oder ist keine Liste");
  } else {
    const seen = new Set<string>();
    let dropped = 0;
    for (const entry of obj.sessions) {
      if (!validRecord(entry) || seen.has(entry.id)) { dropped++; continue; }
      seen.add(entry.id);
      // Ungültige claudeSessionId fällt weg (die Cockpit-id gilt), nie ein Grund für die Kaputt-Notice.
      const { claudeSessionId, ...rest } = entry;
      sessions.push(isUuid(claudeSessionId) ? entry : rest);
    }
    if (dropped > 0) reasons.push(`${dropped} ungültige Einträge verworfen`);
  }
  const { settings, invalid } = parseSettings(obj.settings);
  if (invalid.length > 0) reasons.push(`Einstellungen auf Vorgabe zurückgesetzt: ${invalid.join(", ")}`);
  return {
    data: { schemaVersion: 1, sessions, settings, recentSkills: parseRecents(obj.recentSkills), openAtUnload: parseIdList(obj.openAtUnload), dashboardAtUnload: parseDashboardMemo(obj.dashboardAtUnload) },
    reason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

export type Change = { ok: true; sessions: SessionRecord[] } | { ok: false; reason: string };

export function addSession(sessions: readonly SessionRecord[], record: SessionRecord): Change {
  if (sessions.some((s) => s.id === record.id)) return { ok: false, reason: "Sitzung gibt es schon" };
  return { ok: true, sessions: [...sessions, record] };
}

export function renameSession(sessions: readonly SessionRecord[], id: string, name: string): Change {
  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, reason: "Name ist leer" };
  if ([...trimmed].length > SESSION_NAME_MAX) {
    return { ok: false, reason: `Name ist länger als ${SESSION_NAME_MAX} Zeichen` };
  }
  if (!sessions.some((s) => s.id === id)) return { ok: false, reason: "Sitzung unbekannt" };
  return { ok: true, sessions: sessions.map((s) => (s.id === id ? { ...s, name: trimmed } : s)) };
}

export function setClaudeId(sessions: readonly SessionRecord[], id: string, claudeId: string): Change {
  if (!isUuid(claudeId)) return { ok: false, reason: "Claude-ID ist keine UUID" };
  if (!sessions.some((s) => s.id === id)) return { ok: false, reason: "Sitzung unbekannt" };
  return { ok: true, sessions: sessions.map((s) => (s.id === id ? { ...s, claudeSessionId: claudeId } : s)) };
}

export function removeSession(sessions: readonly SessionRecord[], id: string): SessionRecord[] {
  return sessions.filter((s) => s.id !== id);
}

export function pruneUnused(sessions: readonly SessionRecord[], referenced: Iterable<string>): SessionRecord[] {
  const keep = new Set(referenced);
  return sessions.filter((s) => keep.has(s.id));
}

export interface LoadInput {
  openAtUnload: readonly string[]; leavesAtLoad: readonly string[]; records: readonly string[]; reopenSetting: boolean;
  /** Merkzettel der Cockpit-Ansicht (Abend 19e). */
  dashboardAtUnload: DashboardMemo;
  /** War beim Laden (vor registerView) schon eine Cockpit-Ansicht offen? Dann ist es ein plugin:reload. */
  dashboardAtLoad: boolean;
}
export interface LoadPlan { reopen: string[]; prune: string[]; dashboard: DashboardArea | null }

/**
 * Was beim Laden mit den gespeicherten Einträgen passiert (Abend 19c, Cockpit-Ansicht seit 19e). Fehlen beim Laden alle Tabs, obwohl beim Entladen
 * welche offen waren, hat Obsidian sie geschlossen (Abschalten in den Einstellungen): diese wieder öffnen, in der Reihenfolge
 * des Merkzettels. Sonst wie bisher: Einträge ohne Tab löschen.
 */
export function planAfterLoad(input: LoadInput): LoadPlan {
  const known = new Set(input.records);
  const reopen = input.reopenSetting && input.leavesAtLoad.length === 0
    ? [...new Set(input.openAtUnload)].filter((id) => known.has(id))
    : [];
  const keep = new Set([...input.leavesAtLoad, ...reopen]);
  // Cockpit-Ansicht (Abend 19e): nur öffnen, wenn sie beim Laden fehlt (sonst plugin:reload) und die Einstellung an ist.
  const dashboard = input.reopenSetting && !input.dashboardAtLoad && input.dashboardAtUnload !== null ? input.dashboardAtUnload.area : null;
  return { reopen, prune: input.records.filter((id) => !keep.has(id)), dashboard };
}

/** Hinweis nach dem Wiederöffnen (Abend 19e): Sitzungen und/oder Cockpit-Ansicht. */
export function reopenNotice(sessions: number, dashboard: boolean): string {
  const sitzungen = `${sessions} ${sessions === 1 ? "Sitzung" : "Sitzungen"}`;
  if (dashboard) return sessions > 0 ? `Glasscockpit: ${sitzungen} und die Cockpit-Ansicht wieder geöffnet` : "Glasscockpit: Cockpit-Ansicht wieder geöffnet";
  return `Glasscockpit: ${sitzungen} wieder geöffnet`;
}

/** "claude", sonst "claude 2", "claude 3" ...; Vergleich ohne Groß/Klein, Ausgabe klein. */
export function uniqueName(base: string, taken: readonly string[]): string {
  const name = base.trim() === "" ? "claude" : base.trim();
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Liest den Rohtext der data.json, null heißt: Datei fehlt.
 * Eigener Parse, weil Obsidians loadData kaputtes JSON nur loggt und undefined liefert (wie fehlend).
 */
export function parseDataText(text: string | null): ParseResult {
  if (text === null) return parseData(undefined);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (fehler) {
    return { data: emptyData(), reason: `data.json nicht lesbar: ${fehler instanceof Error ? fehler.message : String(fehler)}` };
  }
  return parseData(raw);
}

export function limitReached(running: number, max: number): boolean {
  return running >= max;
}

/** Stempel für die Sicherung einer kaputten data.json (lokale Zeit). */
export function backupSuffix(now: Date): string {
  const z = (n: number) => String(n).padStart(2, "0");
  return `kaputt-${now.getFullYear()}-${z(now.getMonth() + 1)}-${z(now.getDate())}-${z(now.getHours())}${z(now.getMinutes())}${z(now.getSeconds())}`;
}
