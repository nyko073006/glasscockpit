import { composeFeed, ownSessionFiles } from "../core/feed-compose";
import type { CockpitFeed } from "../core/cockpit-feed";
import type { OpenHandoff } from "../core/handoffs";
import type { RadarFileLamp } from "../core/radar-lamp";
import type { SessionFile } from "../core/session-file";
import { expandHome, type CockpitSettings } from "../core/settings";
import { RADAR_SLOTS } from "../core/constants";
import { isUnset } from "../core/unset";

/** Alles, was die Quelle nicht selbst weiß. Das Plugin verkabelt es mit Manager, Store, Zähler, Vault und Platte. */
export interface FeedSourceDeps {
  settings: () => CockpitSettings;
  now: () => number;
  /** Rohdaten des Sitzungsradars, bei jedem feed() frisch. */
  radarInputs: () => CockpitFeed["sessions"];
  /** Jüngste Sitzung aus RecentSessions (mit Claude-ID), null ohne offene Sitzung. */
  active: () => { id: string; name: string; claudeId: string } | null;
  /** Claude-IDs aller eigenen Sitzungen (nur deren Sitzungsdateien werden gelesen). */
  ownClaudeIds: () => string[];
  tokens: () => CockpitFeed["tokensToday"];
  repos: () => CockpitFeed["repos"];
  day: () => CockpitFeed["day"];
  readSessionFiles: (ownClaudeIds: string[], nowMs: number) => Promise<Map<string, SessionFile>>;
  readVault: (s: CockpitSettings, now: Date) => Promise<NonNullable<CockpitFeed["vault"]>>;
  readFocus: (s: CockpitSettings, now: Date) => Promise<string[]>;
  readHandoffs: (s: CockpitSettings) => Promise<OpenHandoff[]>;
  readRadar: (path: string, nowMs: number) => Promise<RadarFileLamp>;
  /** Home für `~` in den Radar-Pfaden. */
  home?: string;
  log: (message: string) => void;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Quelle des Cockpit-Feeds (Abend 18). Lebendes (Sitzungen, Tokens, Einstellungen, Repo-Stand) wird bei jedem feed() frisch
 * abgefragt; Gelesenes (Sitzungsdateien, Vault, Fokus, Radare) hält die Quelle vom letzten refresh() vor. refresh() läuft
 * nie parallel zu sich selbst, jeder Leser darf scheitern (Log, Rest bleibt), und meldet danach den Abonnenten.
 */
export class CockpitFeedSource {
  private readonly deps: FeedSourceDeps;
  private files = new Map<string, SessionFile>();
  private vault: CockpitFeed["vault"] = null;
  private focus: string[] = [];
  private handoffs: OpenHandoff[] = [];
  private radarLamps = new Map<string, RadarFileLamp>();
  private running: Promise<void> | null = null;
  private readonly subscribers = new Set<() => void>();

  constructor(deps: FeedSourceDeps) {
    this.deps = deps;
  }

  feed(): CockpitFeed {
    const d = this.deps;
    return composeFeed({
      sessions: d.radarInputs(),
      active: d.active(),
      sessionFiles: this.files,
      tokens: d.tokens(),
      focus: this.focus,
      vault: this.vault,
      handoffs: this.handoffs,
      repos: d.repos(),
      day: d.day(),
      radarLamps: this.radarLamps,
      settings: d.settings(),
    });
  }

  refresh(): Promise<void> {
    this.running ??= this.read().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Etwas Lebendes hat sich geändert (Signal, angesehen): Abonnenten zeichnen neu, ohne dass gelesen wird. */
  changed(): void {
    this.notify();
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private async read(): Promise<void> {
    const d = this.deps;
    const s = d.settings();
    const nowMs = d.now();
    const now = new Date(nowMs);
    const home = d.home ?? "";
    const safe = async <T>(label: string, job: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await job();
      } catch (fehler) {
        d.log(`Cockpit: ${label} nicht gelesen: ${errText(fehler)}`);
        return fallback;
      }
    };
    // Nur eingerichtete Radare lesen (leerer Pfad: nichts lesen, die Lampe heißt dann „unset“, siehe composeRadars).
    const radarFiles = s.radars.slice(0, RADAR_SLOTS).map((r) => r.stateFile).filter((f) => !isUnset(f));
    const [files, vault, focus, handoffs, lamps] = await Promise.all([
      safe("Sitzungsdateien", () => d.readSessionFiles(d.ownClaudeIds(), nowMs), new Map<string, SessionFile>()),
      safe("Vault-Lage", () => d.readVault(s, now), null),
      safe("Tagesfokus", () => d.readFocus(s, now), [] as string[]),
      safe("Handoffs", () => d.readHandoffs(s), this.handoffs),
      Promise.all(radarFiles.map((f) => safe(`Radar ${f}`, () => d.readRadar(expandHome(f, home), nowMs), "red" as RadarFileLamp))),
    ]);
    // Eigene IDs zur Sicherheit noch einmal filtern: Der Leser kennt sie, die Quelle verlässt sich nicht darauf.
    this.files = ownSessionFiles([...files.values()], d.ownClaudeIds());
    this.vault = vault;
    this.focus = focus;
    this.handoffs = handoffs;
    this.radarLamps = new Map(radarFiles.map((f, i) => [f, lamps[i]]));
    this.notify();
  }

  private notify(): void {
    for (const cb of [...this.subscribers]) {
      try {
        cb();
      } catch (fehler) {
        this.deps.log(`Cockpit: Abonnent des Feeds gescheitert: ${errText(fehler)}`);
      }
    }
  }
}
