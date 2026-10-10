import type { CockpitFeed, RadarFeedEntry } from "./cockpit-feed";
import type { OpenHandoff } from "./handoffs";
import type { RadarFileLamp } from "./radar-lamp";
import { RADAR_SLOTS } from "./constants";
import { isUnset } from "./unset";
import type { CockpitSettings } from "./settings";
import { isStale, type SessionFile } from "./session-file";
import type { CounterState } from "./usage";

/**
 * Feed der Cockpit-Flächen (Abend 18), rein: Die Verkabelung liest (Sitzungen, Dateien, Vault, Git) und gibt die
 * fertigen Teile hierher; zusammengesetzt wird der Vertrag `CockpitFeed` nur an dieser Stelle.
 */
export interface FeedParts {
  handoffs: OpenHandoff[];
  sessions: CockpitFeed["sessions"];
  /** Jüngste Sitzung aus RecentSessions mit ihrer Claude-ID (Schlüssel der Sitzungsdatei). */
  active: { id: string; name: string; claudeId: string } | null;
  /** Sitzungsdateien eigener Sitzungen, nach Claude-ID (klein geschrieben). */
  sessionFiles: ReadonlyMap<string, SessionFile>;
  tokens: CockpitFeed["tokensToday"];
  focus: string[];
  vault: CockpitFeed["vault"];
  repos: CockpitFeed["repos"];
  day: CockpitFeed["day"];
  /** Gelesene Lampen nach stateFile (so, wie er in den Einstellungen steht); fehlt einer, gilt er als noch nicht gelesen. */
  radarLamps: ReadonlyMap<string, RadarFileLamp>;
  settings: Pick<CockpitSettings, "radars" | "projectsRoot" | "briefingsDir" | "inboxDir" | "indexFile" | "dailyDir" | "nextEffort" | "telegramOnDone" | "telegramOnQuestion" | "alertSound" | "alertBanner">;
}

export function composeFeed(p: FeedParts): CockpitFeed {
  return {
    sessions: p.sessions,
    active: p.active ? { id: p.active.id, name: p.active.name, file: p.sessionFiles.get(p.active.claudeId.toLowerCase()) ?? null } : null,
    tokensToday: p.tokens,
    focus: p.focus,
    vault: p.vault,
    repos: p.repos,
    day: p.day,
    radars: composeRadars(p.settings.radars, p.radarLamps),
    unset: {
      projects: isUnset(p.settings.projectsRoot), briefings: isUnset(p.settings.briefingsDir),
      inbox: isUnset(p.settings.inboxDir), index: isUnset(p.settings.indexFile), daily: isUnset(p.settings.dailyDir),
    },
    effort: p.settings.nextEffort,
    telegramOn: telegramOn(p.settings),
    soundOn: soundOn(p.settings),
    handoffs: p.handoffs,
  };
}

/** Kippschalter Telegram: an, sobald eine der beiden Arten an ist. */
export function telegramOn(s: Pick<CockpitSettings, "telegramOnDone" | "telegramOnQuestion">): boolean {
  return s.telegramOnDone || s.telegramOnQuestion;
}

/** Neuer Wert für beide Arten: ist eine an, werden beide aus, sonst beide an. */
export function toggledTelegram(s: Pick<CockpitSettings, "telegramOnDone" | "telegramOnQuestion">): boolean {
  return !telegramOn(s);
}

/** Kippschalter Ton: an, sobald Ton oder macOS-Banner an ist. */
export function soundOn(s: Pick<CockpitSettings, "alertSound" | "alertBanner">): boolean {
  return s.alertSound || s.alertBanner;
}

/** Neuer Wert für beide: ist eines an, werden beide aus, sonst beide an. */
export function toggledSound(s: Pick<CockpitSettings, "alertSound" | "alertBanner">): boolean {
  return !soundOn(s);
}

/** Output-Tokens heute aus dem Stand des vorhandenen Zählers; null, solange er nichts Gültiges hat. */
export function tokensToday(state: CounterState, asOf: number | null): { tokens: number; asOf: number } | null {
  if (state.kind !== "ok" || asOf === null) return null;
  return { tokens: state.count.tokens, asOf };
}

/** Nur Dateien eigener Sitzungen (Claude-ID, Groß- und Kleinschreibung egal), Schlüssel klein geschrieben. */
export function ownSessionFiles(files: readonly SessionFile[], ownClaudeIds: Iterable<string>): Map<string, SessionFile> {
  const own = new Set([...ownClaudeIds].map((id) => id.toLowerCase()));
  const out = new Map<string, SessionFile>();
  for (const f of files) {
    const key = f.sessionId.toLowerCase();
    if (own.has(key)) out.set(key, f);
  }
  return out;
}

/**
 * Aufräumen: Dateinamen (nur *.json), die weg dürfen. Lesbare Dateien zählen nach `written_at` (Unix-Sekunden, wie die
 * Statuszeile es schreibt), unlesbare nach der Dateizeit. Die Grenze selbst bleibt (`isStale`).
 */
export function sessionFilesToDelete(entries: ReadonlyArray<{ name: string; writtenAt: number | null; mtimeMs: number }>, nowMs: number): string[] {
  return entries
    .filter((e) => e.name.endsWith(".json") && !e.name.startsWith("."))
    .filter((e) => (e.writtenAt !== null ? isStale(e.writtenAt, nowMs) : isStale(e.mtimeMs / 1000, nowMs)))
    .map((e) => e.name);
}


/** Namen für Radare ohne Namen. */
const radarName = (name: string, index: number): string => (name.trim() === "" ? `Radar ${index + 1}` : name);

/** Sichtbare Radare (höchstens RADAR_SLOTS): leerer Pfad ist „unset“, ein noch nicht gelesener grau, sonst die gelesene Lampe. */
export function composeRadars(radars: ReadonlyArray<{ name: string; stateFile: string }>, read: ReadonlyMap<string, RadarFileLamp>): RadarFeedEntry[] {
  return radars.slice(0, RADAR_SLOTS).map((r, i) => ({
    name: radarName(r.name, i),
    lamp: isUnset(r.stateFile) ? "unset" : (read.get(r.stateFile) ?? "gray"),
  }));
}
