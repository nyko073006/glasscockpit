import { type ItemView, Notice } from "obsidian";
import type { LaunchEntry } from "../core/discovery";
import { filterSkills, rankSkills } from "../core/recents";
import type { CockpitSettings } from "../core/settings";

export interface SkillsCardDeps {
  settings: () => CockpitSettings;
  onSettingsChange: (cb: (s: CockpitSettings) => void) => () => void;
  /** Skills frisch von der Platte (Quelle wie der Launcher). */
  discover: () => Promise<LaunchEntry[]>;
  recentSkills: () => string[];
  onRecentsChange: (cb: () => void) => () => void;
  /** `/name` plus Enter an die zuletzt aktive Claude-Sitzung; Prüfung, Notice und „zuletzt benutzt“ macht das Plugin. */
  run: (name: string) => void;
}

/** Karte „Skills“: Knöpfe der zuletzt benutzten und übrigen Skills, darüber eine Suche. */
export class SkillsCard {
  private readonly owner: ItemView;
  private readonly el: HTMLElement;
  private readonly deps: SkillsCardDeps;
  private skills: LaunchEntry[] = [];
  private loaded = false;
  private query = "";
  private generation = 0;
  private resultsEl: HTMLElement | null = null;
  private running = false;

  constructor(owner: ItemView, el: HTMLElement, deps: SkillsCardDeps) {
    this.owner = owner;
    this.el = el;
    this.deps = deps;
  }

  start(): void {
    this.running = true;
    const el = this.el;
    el.empty();
    const head = el.createDiv({ cls: "cockpit-card-head cockpit-skills-head" });
    head.createSpan({ text: "Skills", cls: "cockpit-card-title" });
    const search = head.createEl("input", { type: "search", placeholder: "Suchen", cls: "cockpit-skill-search" });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderResults();
    });
    search.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        search.value = "";
        this.query = "";
        this.renderResults();
      } else if (e.key === "Enter") {
        const first = filterSkills(rankSkills(this.skills, this.deps.recentSkills()), this.query)[0];
        if (first && this.query.trim() !== "") this.deps.run(first.name);
      }
    });
    const refresh = head.createEl("button", { text: "↻", cls: "cockpit-skill-refresh" });
    refresh.setAttribute("aria-label", "Skills neu lesen");
    refresh.addEventListener("click", () => void this.load());
    this.resultsEl = el.createDiv({ cls: "cockpit-card-body cockpit-skill-results" });
    // Neue Reihenfolge nach Benutzung und andere Knopfzahl: nur neu ordnen, nicht neu lesen.
    this.owner.register(this.deps.onRecentsChange(() => this.renderResults()));
    this.owner.register(this.deps.onSettingsChange(() => this.renderResults()));
    this.renderResults();
    void this.load();
  }

  stop(): void {
    this.running = false;
    this.generation++;
  }

  private async load(): Promise<void> {
    if (!this.running) return;
    const gen = ++this.generation;
    try {
      const found = await this.deps.discover();
      if (gen !== this.generation) return;
      this.skills = found;
      this.loaded = true;
    } catch (fehler) {
      if (gen !== this.generation) return;
      new Notice(`Skills nicht lesbar: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
    }
    this.renderResults();
  }

  private renderResults(): void {
    const box = this.resultsEl;
    if (!box) return;
    box.empty();
    if (!this.loaded) {
      box.createDiv({ text: "Skills werden gelesen ...", cls: "cockpit-hint" });
      return;
    }
    const ranked = rankSkills(this.skills, this.deps.recentSkills());
    const searching = this.query.trim() !== "";
    const shown = searching ? filterSkills(ranked, this.query) : ranked.slice(0, this.deps.settings().skillButtons);
    if (shown.length === 0) {
      box.createDiv({ text: searching ? "Kein Treffer" : "Keine Skills gefunden", cls: "cockpit-hint" });
      return;
    }
    const list = box.createDiv({ cls: searching ? "cockpit-skill-list cockpit-skill-scroll" : "cockpit-skill-list" });
    for (const skill of shown) {
      const button = list.createEl("button", { text: skill.name, cls: "cockpit-skill-button" });
      if (skill.description !== "") button.setAttribute("title", skill.description);
      button.addEventListener("click", () => this.deps.run(skill.name));
    }
  }
}
