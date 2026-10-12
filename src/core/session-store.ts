import { asError } from "./as-error";
import { SAVE_DEBOUNCE_MS } from "./constants";
import {
  addSession, pruneUnused, removeSession, renameSession, setClaudeId,
  type Change, type CockpitData, type DashboardMemo, type SessionRecord,
} from "./session-model";
import { pushRecent } from "./recents";
import { applyDependencies, dependencyReason, normalizeSetting, validateSetting, type CockpitSettings } from "./settings";
import type { TimerApi } from "./view-tracker";

/** Hält Sitzungen und Einstellungen im Speicher und schreibt sie entprellt (nachlaufend) weg. */
export class SessionStore {
  private sessions: SessionRecord[];
  private current: CockpitSettings;
  private recents: string[];
  private openList: string[];
  private dashboardMemo: DashboardMemo;
  private readonly recentsListeners = new Set<() => void>();
  private readonly changeListeners = new Set<(id: string | null) => void>();
  private readonly settingsListeners = new Set<(s: CockpitSettings) => void>();
  private timer: unknown = null;
  private dirty = false;
  private inflight: Promise<void> = Promise.resolve();

  private readonly save: (data: CockpitData) => Promise<void>;
  private readonly timers: TimerApi;
  private readonly delayMs: number;
  private readonly onSaveError?: (fehler: unknown) => void;

  constructor(
    initial: CockpitData,
    save: (data: CockpitData) => Promise<void>,
    timers: TimerApi,
    delayMs: number = SAVE_DEBOUNCE_MS,
    onSaveError?: (fehler: unknown) => void,
  ) {
    this.save = save;
    this.timers = timers;
    this.delayMs = delayMs;
    this.onSaveError = onSaveError;
    this.sessions = [...initial.sessions];
    this.current = { ...initial.settings };
    this.recents = [...initial.recentSkills];
    this.openList = [...initial.openAtUnload];
    this.dashboardMemo = initial.dashboardAtUnload;
  }

  recentSkills(): string[] { return [...this.recents]; }
  /** Skill als zuletzt benutzt vermerken (nach vorn, ohne Dopplung), entprellt speichern, Listener melden. */
  useSkill(name: string): void {
    this.recents = pushRecent(this.recents, name);
    this.schedule();
    for (const cb of [...this.recentsListeners]) cb();
  }
  onRecentsChange(cb: () => void): () => void {
    this.recentsListeners.add(cb);
    return () => { this.recentsListeners.delete(cb); };
  }
  openAtUnload(): string[] { return [...this.openList]; }
  /** Merkzettel der offenen Tabs (Abend 19c). Gleiche Liste: kein Speichern. */
  setOpenAtUnload(ids: readonly string[]): void {
    if (ids.length === this.openList.length && ids.every((id, i) => id === this.openList[i])) return;
    this.openList = [...ids];
    this.schedule();
  }
  dashboardAtUnload(): DashboardMemo { return this.dashboardMemo === null ? null : { ...this.dashboardMemo }; }
  /** Merkzettel der Cockpit-Ansicht (Abend 19e). Gleicher Wert: kein Speichern. */
  setDashboardAtUnload(memo: DashboardMemo): void {
    if ((memo === null ? null : memo.area) === (this.dashboardMemo === null ? null : this.dashboardMemo.area)) return;
    this.dashboardMemo = memo === null ? null : { ...memo };
    this.schedule();
  }
  all(): readonly SessionRecord[] { return this.sessions; }
  get(id: string): SessionRecord | null { return this.sessions.find((s) => s.id === id) ?? null; }
  names(): string[] { return this.sessions.map((s) => s.name); }
  settings(): CockpitSettings { return { ...this.current }; }

  add(record: SessionRecord): Change { return this.apply(addSession(this.sessions, record), record.id); }
  rename(id: string, name: string): Change { return this.apply(renameSession(this.sessions, id, name), id); }

  /** Neue Claude-Unterhaltung für diesen Eintrag (Fortsetzen aus oder „frisch starten“); die Cockpit-id bleibt. */
  setClaudeSessionId(id: string, claudeId: string): Change { return this.apply(setClaudeId(this.sessions, id, claudeId), id); }

  remove(id: string): void {
    if (this.get(id) === null) return;
    this.apply({ ok: true, sessions: removeSession(this.sessions, id) }, id);
  }

  prune(referenced: Iterable<string>): number {
    const kept = pruneUnused(this.sessions, referenced);
    const removed = this.sessions.length - kept.length;
    if (removed > 0) this.apply({ ok: true, sessions: kept }, null);
    return removed;
  }

  updateSetting<K extends keyof CockpitSettings>(key: K, value: CockpitSettings[K]): { ok: true } | { ok: false; reason: string } {
    return this.updateSettings({ [key]: value } as Partial<CockpitSettings>);
  }

  /**
   * Mehrere Einstellungen in einem Zug (Kippschalter setzen zwei Felder): alles oder nichts, ein Speichern, ein Event.
   * Jedes Feld wird gegen den Zustand geprüft, in dem die übrigen Felder des Patches schon gelten; ist eines ungültig,
   * wird keines übernommen und nichts gemeldet. Ein leerer Patch ändert nichts und meldet nichts.
   */
  updateSettings(patch: Partial<CockpitSettings>): { ok: true } | { ok: false; reason: string } {
    const entries = Object.entries(patch) as Array<[keyof CockpitSettings, CockpitSettings[keyof CockpitSettings]]>;
    if (entries.length === 0) return { ok: true };
    for (const [key, value] of entries) {
      const reason = validateSetting(key, value);
      if (reason !== null) return { ok: false, reason };
    }
    const normalized = Object.fromEntries(entries.map(([key, value]) => [key, normalizeSetting(key, value)])) as Partial<CockpitSettings>;
    for (const [key, value] of entries) {
      const { [key]: _eigener, ...uebrige } = normalized;
      const reason = dependencyReason({ ...this.current, ...uebrige }, key, value);
      if (reason !== null) return { ok: false, reason };
    }
    this.current = applyDependencies({ ...this.current, ...normalized });
    this.schedule();
    for (const cb of [...this.settingsListeners]) cb(this.settings());
    return { ok: true };
  }

  onChange(cb: (id: string | null) => void): () => void {
    this.changeListeners.add(cb);
    return () => { this.changeListeners.delete(cb); };
  }

  onSettingsChange(cb: (s: CockpitSettings) => void): () => void {
    this.settingsListeners.add(cb);
    return () => { this.settingsListeners.delete(cb); };
  }

  /** Ausstehendes Speichern sofort; wartet auch auf ein bereits laufendes. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
    if (this.dirty) this.write();
    await this.inflight;
  }

  private apply(change: Change, id: string | null): Change {
    if (!change.ok) return change;
    this.sessions = change.sessions;
    this.schedule();
    for (const cb of [...this.changeListeners]) cb(id);
    return change;
  }

  private schedule(): void {
    this.dirty = true;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.write();
    }, this.delayMs);
  }

  private write(): void {
    this.dirty = false;
    const data: CockpitData = { schemaVersion: 1, sessions: [...this.sessions], settings: { ...this.current }, recentSkills: [...this.recents], openAtUnload: [...this.openList], dashboardAtUnload: this.dashboardMemo === null ? null : { ...this.dashboardMemo } };
    // Sofort aufrufen (nicht erst in einem Promise-Schritt); inflight sammelt nur, worauf flush wartet.
    let result: Promise<void>;
    try {
      result = this.save(data);
    } catch (fehler) {
      result = Promise.reject(asError(fehler));
    }
    const settled = result.catch((fehler: unknown) => { this.onSaveError?.(fehler); });
    this.inflight = Promise.all([this.inflight, settled]).then(() => undefined);
  }
}
