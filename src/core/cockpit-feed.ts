import type { EffortStep } from "./effort";
import type { DayTotals } from "./day-stats";
import type { GitStatus } from "./git-status";
import type { RadarFileLamp } from "./radar-lamp";
import type { SessionFile } from "./session-file";
import type { OpenHandoff } from "./handoffs";
import type { RadarInput } from "./session-radar";

/** Ein sichtbares Radar: Name aus den Einstellungen, Lampe oder „unset“ (leerer Pfad = nicht eingerichtet, kein Fehler). */
export interface RadarFeedEntry { name: string; lamp: RadarFileLamp | "unset" }

/**
 * Welche Quellen nicht eingerichtet sind (leere Einstellung, auch nur Leerzeichen). Abgeleitet aus den Einstellungen in
 * composeFeed, nicht gelesen: Für diese Quellen darf der Host nichts lesen (leerer Ordnerpfad = Vault-Wurzel!).
 * projects: projectsRoot (Repos, LOC, Commits), briefings: briefingsDir (Fokus), inbox/index/daily: Vault-Lage.
 */
export interface FeedUnset { projects: boolean; briefings: boolean; inbox: boolean; index: boolean; daily: boolean }

/**
 * Rohdaten der neuen Cockpit-Flächen (Abend 18). Die Verkabelung (main.ts, Leser in src/host) füllt sie,
 * die Darstellung (cockpit-panels, cockpit-layout) macht daraus Instrumente. Geladen wird hier nichts.
 * null heißt jeweils „noch nicht gelesen oder nicht lesbar“; die Fläche zeigt dann grau statt eines Werts.
 */
export interface CockpitFeed {
  /** Je laufende Cockpit-Sitzung, Rohdaten fürs Sitzungsradar. */
  sessions: RadarInput[];
  /** Jüngste Sitzung aus RecentSessions mit ihrer Sitzungsdatei (null: keine Datei für ihre Claude-ID). */
  active: { id: string; name: string; file: SessionFile | null } | null;
  /** Output-Tokens heute aus dem vorhandenen Tageszähler; asOf in ms. */
  tokensToday: { tokens: number; asOf: number } | null;
  /** Ergebnis von parseFocus; [] lässt die Kanzel leer. */
  focus: string[];
  vault: {
    /** Inbox-Notizen, Pfade relativ zum Vault. */
    inbox: string[];
    /** generated_at aus der Index-Datei in ms; null bei fehlender Datei oder kaputtem Frontmatter. */
    indexGeneratedAt: number | null;
    dailyToday: boolean;
  } | null;
  /** Je Git-Repo unter projectsRoot; status null = Abfrage gescheitert. null = im Pull-Takt noch nie gelaufen. */
  repos: { name: string; status: GitStatus | null }[] | null;
  /** LOC und Commits heute über alle Repos unter projectsRoot; null = im Pull-Takt noch nie gelaufen. */
  day: DayTotals | null;
  /** Höchstens RADAR_SLOTS Radare aus den Einstellungen, in deren Reihenfolge; [] = keines eingerichtet. */
  radars: RadarFeedEntry[];
  /** Nicht eingerichtete Quellen; die zugehörigen Felder (vault, focus, repos, day) tragen dann nichts Gelesenes. */
  unset: FeedUnset;
  effort: EffortStep;
  /** telegramOnDone oder telegramOnQuestion an. */
  telegramOn: boolean;
  /** alertSound oder alertBanner an. */
  soundOn: boolean;
  /** Offene Handoffs je Projekt, neueste zuerst (Abend 19h). */
  handoffs: OpenHandoff[];
}

/** Klicks und Tasten der neuen Flächen; der Aufrufer führt aus. */
export interface CockpitFeedActions {
  /** Radarzeile: Tab dieser Cockpit-Sitzung nach vorn. */
  focusSession(id: string): void;
  /** Kanzel: Briefing-Karte öffnen. */
  openBriefing(): void;
  /** Inbox-Notiz im Zoom der Vault-Lage. */
  openNote(path: string): void;
  /** Taste „Lint starten“: settings.lintCommand in die aktive Sitzung (leer: Taste gibt es nicht). */
  startLint(): void;
  /** Hinweis „nicht eingerichtet“: Einstellungsdialog auf dem Tab dieses Plugins. */
  openSettings(): void;
  /** Eine andere Stufe der Effort-Liste angeklickt (der Bildschirm links); nur bei geänderter Stufe aufgerufen. */
  setEffort(step: EffortStep): void;
  /** Kippschalter Telegram. */
  toggleTelegram(): void;
  /** Kippschalter Ton: Ton und macOS-Banner zusammen. */
  toggleSound(): void;
  /** Plus auf dem Effort-Griff: derselbe Dialog wie der Command „Neue Sitzung“. */
  newSession(): void;
}
