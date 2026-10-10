import { homedir } from "node:os";
import { type ItemView, Notice } from "obsidian";
import { RESEARCH_CACHE_FILE, RESEARCH_TICK_MS } from "../core/constants";
import { Observable } from "../core/observable";
import {
  dueSearches, emptyResearchCache, isFirstRun, markSeen, mergeSection, newIds, parseSearches, pruneSections,
  type RepoItem, type ResearchCache, type ResearchSearch, type ResearchSection, safeRepoUrl, searchKey, serializeResearchCache,
} from "../core/research";
import { type CockpitSettings, expandHome } from "../core/settings";
import { formatAge } from "../core/usage";
import { fetchSearch } from "./research-fetch";
import { readResearchCache, updateResearchCache } from "./research-fs";

export interface ResearchCardDeps {
  settings: () => CockpitSettings;
  onSettingsChange: (cb: (s: CockpitSettings) => void) => () => void;
  /** Öffnet eine geprüfte https://github.com/-Adresse im Browser (Prüfung mit safeRepoUrl macht die Karte). */
  openUrl: (url: string) => void;
}

// Sperre auf Modulebene: Auch zwei Dashboards (zwei Karten) fragen GitHub nie gleichzeitig ab.
let runLock = false;
// Zeitpunkt der letzten Abfrage bei GitHub, gleich welcher Karte; bremst nur das Wiederholen fehlerhafter Abschnitte.
let lastAttemptAt: number | null = null;

const hasError = (c: ResearchCache, s: ResearchSearch): boolean =>
  c.sections.some((x) => searchKey(x) === searchKey(s) && x.error !== undefined);

const de = (n: number) => n.toLocaleString("de-DE");
const clock = (ms: number): string => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const ageOf = (ms: number): string => formatAge(Math.max(0, (Date.now() - ms) / 1000));

/**
 * Karte „Research“: GitHub-Repos aus den Suchen der Einstellungen, Stand im Zwischenspeicher
 * (~/.claude/cockpit/research.json). Fragt beim Öffnen und alle 30 Minuten nur das ab, was fällig ist, und nur bei
 * sichtbarem Dashboard; „Neu laden“ fragt immer. Suchen laufen nacheinander. Kein Kindprozess; der Abruf liegt in research-fetch.ts.
 */
export class ResearchCard {
  /** Der Stand aus dem Zwischenspeicher (null: noch nicht gelesen); die Instrumente der Cockpit-Ansicht lesen ihn von hier. */
  readonly data = new Observable<ResearchCache | null>(null);
  private readonly owner: ItemView;
  private readonly el: HTMLElement;
  private readonly deps: ResearchCardDeps;
  private readonly path: string;
  private cache: ResearchCache = emptyResearchCache();
  private loaded = false;
  private stopped = true;
  private busy = false;
  private timer: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastKey = "";

  constructor(owner: ItemView, el: HTMLElement, deps: ResearchCardDeps) {
    this.owner = owner;
    this.el = el;
    this.deps = deps;
    this.path = expandHome(RESEARCH_CACHE_FILE, homedir());
  }

  start(): void {
    this.stopped = false;
    // Schließt die View, ohne stop() zu rufen, räumt Obsidian trotzdem auf.
    this.owner.register(() => this.stop());
    this.lastKey = this.settingsKey();
    this.render();
    this.unsubscribe = this.deps.onSettingsChange(() => {
      const key = this.settingsKey();
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.render();
      void this.tick();
    });
    // Fenster des Containers, nicht des Hauptfensters (Pop-out): Timer-IDs gelten pro Fenster.
    this.timer = this.el.win.setInterval(() => void this.tick(), RESEARCH_TICK_MS);
    // Lag das Dashboard beim Öffnen im Hintergrund (Neustart mit wiederhergestelltem Tab), holt die Karte nach,
    // sobald es sichtbar wird, statt bis zum nächsten Takt zu warten. Prüft nur, abgefragt wird nur Fälliges.
    this.owner.registerEvent(this.owner.app.workspace.on("active-leaf-change", () => void this.tick()));
    void this.load();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.el.win.clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Der eine Ort, der den Stand ersetzt: Karte und Instrument sehen immer denselben. */
  private setCache(cache: ResearchCache): void {
    this.cache = cache;
    this.data.set(cache);
  }

  private settingsKey(): string {
    const s = this.deps.settings();
    return `${s.researchMaxAgeMin}\n${s.researchSearches}`;
  }

  private async load(): Promise<void> {
    const cache = await readResearchCache(this.path);
    if (this.stopped) return;
    this.setCache(cache);
    this.loaded = true;
    this.render();
    await this.tick();
  }

  /** Nur bei sichtbarem Dashboard; fragt ab, was fällig ist. */
  private async tick(): Promise<void> {
    if (this.stopped || !this.el.isShown()) return;
    await this.run(false);
  }

  private async run(force: boolean): Promise<void> {
    if (this.stopped || runLock) return;
    runLock = true;
    try {
      const settings = this.deps.settings();
      const searches = parseSearches(settings.researchSearches).searches;
      // Frisch lesen: andere Karte oder Abhaken kann die Datei seit dem letzten Lesen geändert haben.
      let cache = await readResearchCache(this.path);
      this.setCache(cache);
      // Einmal vor dem Lauf: Beim ersten Lauf gelten alle Treffer als gesehen, sonst wäre alles „neu“.
      const firstRun = isFirstRun(cache);
      const now = Date.now();
      // Fehlerhafte Abschnitte gelten als fällig. Ohne Knopf fragen sie höchstens im Abstand des Prüftakts erneut,
      // sonst träfe jeder Tab-Wechsel GitHub, auch wenn das Limit erreicht ist (GitHub droht dann mit Sperre).
      const retryErrors = force || lastAttemptAt === null || now - lastAttemptAt >= RESEARCH_TICK_MS;
      const due = dueSearches(cache, searches, now, settings.researchMaxAgeMin, force)
        .filter((s) => retryErrors || !hasError(cache, s));
      // „Lädt …“ nur, wenn wirklich abgefragt wird: Der Takt und jeder Tab-Wechsel prüfen, meist ist nichts fällig.
      if (due.length > 0) {
        this.busy = true;
        this.render();
      }
      for (const s of due) {
        lastAttemptAt = Date.now();
        const outcome = await fetchSearch(s);
        cache = await updateResearchCache(this.path, (c) => mergeSection(c, s, outcome, Date.now(), firstRun));
        if (this.stopped) return;
        this.setCache(cache);
        this.render();
      }
      // Abschnitte entfernter Suchen fallen erst hier aus der Datei; nur schreiben, wenn sich etwas ändert.
      if (serializeResearchCache(pruneSections(cache, searches)) !== serializeResearchCache(cache)) {
        cache = await updateResearchCache(this.path, (c) => pruneSections(c, searches));
        this.setCache(cache);
      }
    } catch (fehler) {
      new Notice(`Research nicht aktualisiert: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
    } finally {
      runLock = false;
      this.busy = false;
      if (!this.stopped) this.render();
    }
  }

  private render(): void {
    if (this.stopped) return;
    const el = this.el;
    el.empty();
    const settings = this.deps.settings();
    const parsed = parseSearches(settings.researchSearches);
    const cache = pruneSections(this.cache, parsed.searches);

    const head = el.createDiv({ cls: "cockpit-card-head cockpit-research-head" });
    head.createSpan({ text: "Research", cls: "cockpit-card-title" });
    const stand = cache.fetched_at === null ? "Noch nie geladen" : `Stand ${ageOf(cache.fetched_at)}`;
    head.createSpan({ text: this.loaded ? stand : "Wird gelesen ...", cls: "cockpit-card-date" });
    const button = head.createEl("button", { text: this.busy ? "Lädt …" : "Neu laden", cls: "cockpit-research-reload" });
    button.disabled = this.busy;
    button.addEventListener("click", () => void this.run(true));

    const body = el.createDiv({ cls: "cockpit-card-body cockpit-research" });
    for (const e of parsed.errors) {
      body.createDiv({ text: `Suche in Zeile ${e.line} ungültig: ${e.reason} (Einstellungen → Research)`, cls: "cockpit-hint cockpit-research-error" });
    }
    if (this.loaded && cache.sections.length === 0) {
      body.createDiv({ text: "Noch kein Stand. Neu laden fragt GitHub ab.", cls: "cockpit-hint" });
      return;
    }
    const fresh = newIds(cache);
    for (const section of cache.sections) this.renderSection(body, section, fresh);
  }

  private renderSection(body: HTMLElement, section: ResearchSection, fresh: Set<number>): void {
    const box = body.createDiv({ cls: "cockpit-research-section" });
    const label = section.sort === "updated" ? "zuletzt aktualisiert" : "Sterne";
    box.createDiv({ text: `${section.query} (${label})`, cls: "cockpit-research-heading" });
    if (section.error !== undefined) {
      const stand = section.fetched_at === null ? "Noch kein Stand" : `Stand von ${clock(section.fetched_at)}`;
      box.createDiv({ text: `⚠ ${section.error}. ${stand}`, cls: "cockpit-research-error" });
    }
    for (const item of section.items) this.renderItem(box, item, fresh.has(item.id));
  }

  private renderItem(box: HTMLElement, item: RepoItem, isNew: boolean): void {
    const row = box.createDiv({ cls: "cockpit-research-item" });
    if (isNew) {
      const check = row.createEl("input", { type: "checkbox", cls: "cockpit-research-check" });
      check.setAttribute("aria-label", "Als gesehen abhaken");
      check.addEventListener("change", () => void this.markSeen(item.id));
      row.createSpan({ text: "neu", cls: "cockpit-research-new" });
    }
    // Kein Anker-Element: Die Adresse stammt von außen, geöffnet wird nur, was safeRepoUrl durchlässt.
    const name = row.createSpan({ text: item.full_name, cls: "cockpit-research-name" });
    name.setAttribute("role", "link");
    name.setAttribute("tabindex", "0");
    const open = () => {
      const u = safeRepoUrl(item.html_url);
      if (u) this.deps.openUrl(u);
    };
    name.addEventListener("click", open);
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") open();
    });
    row.createSpan({ text: `★ ${de(item.stargazers_count)}`, cls: "cockpit-research-stars" });
    // Beschreibung stammt von außen: nur als Text setzen, nie als HTML.
    const desc = row.createSpan({ text: item.description, cls: "cockpit-research-desc" });
    if (item.description !== "") desc.setAttribute("title", item.description);
    const pushed = Date.parse(item.pushed_at);
    row.createSpan({ text: Number.isNaN(pushed) ? "" : ageOf(pushed), cls: "cockpit-research-age" });
  }

  private async markSeen(id: number): Promise<void> {
    try {
      const cache = await updateResearchCache(this.path, (c) => markSeen(c, id));
      this.setCache(cache);
      this.render();
    } catch (fehler) {
      new Notice(`Research: Abhaken nicht gespeichert: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
    }
  }
}
