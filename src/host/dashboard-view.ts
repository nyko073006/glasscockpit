import { Component, ItemView, MarkdownRenderer, TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import cockpitBackground from "../../assets/cockpit-bg.jpg";
import { fillPrompt, isInBriefingsDir, listBriefings, pickSelection } from "../core/briefings";
import type { CockpitFeed, CockpitFeedActions } from "../core/cockpit-feed";
import { type BriefingInput, type CockpitInputs, type TasksInput, researchForPanel } from "../core/cockpit-panels";
import { BRIEFING_RELOAD_DEBOUNCE_MS, VIEW_TYPE_DASHBOARD } from "../core/constants";
import { createDebounce } from "../core/debounce";
import { markBriefing, scanBriefing } from "../core/focus";
import { briefingLoadKey, todayBriefingPath } from "../core/today";
import { Observable } from "../core/observable";
import { formatPullStatus, type PullSnapshot } from "../core/pull-state";
import type { ReminderDone } from "../core/session-model";
import type { CockpitSettings } from "../core/settings";
import { OPEN_SETTINGS_TEXT, UNSET_TEXT, isUnset, unsetHint } from "../core/unset";
import { type TokenCounter, localDayString } from "../core/usage";
import type { LaunchEntry } from "../core/discovery";
import { type RenderedBriefing, renderBriefingWithChecks } from "./briefing-checks";
import { DashboardLayoutController } from "./dashboard-layout-controller";
import type { PullController } from "./git-pull";
import { handleInternalLinks } from "./internal-link";
import type { RemindersController } from "./reminders";
import { ResearchCard } from "./research-card";
import { SkillsCard } from "./skills-card";
import { TasksCard } from "./tasks-card";
import { UsageCard } from "./usage-card";

/** Was die View vom Plugin bekommt. Pull-Zustand und Senden gehören dem Plugin. */
export interface DashboardDeps {
  settings: () => CockpitSettings;
  onSettingsChange: (cb: (s: CockpitSettings) => void) => () => void;
  pull: PullController;
  /** Zähler der Output-Tokens, gehört dem Plugin (läuft auch ohne Dashboard). */
  counter: TokenCounter;
  /** Text samt Enter an die zuletzt aktive Claude-Sitzung (Prüfung und Notice macht das Plugin). */
  send: (text: string) => void;
  /** Skills frisch von der Platte (Quelle wie der Launcher, Projekt = Ordner der aktiven Sitzung). */
  discoverSkills: () => Promise<LaunchEntry[]>;
  recentSkills: () => string[];
  onRecentsChange: (cb: () => void) => () => void;
  /** `/name` plus Enter senden und nach Erfolg als zuletzt benutzt vermerken (beides im Plugin). */
  runSkill: (name: string) => void;
  /** Öffnet eine geprüfte https-Adresse im Standardbrowser (Prüfung auf github.com macht die Research-Karte). */
  openUrl: (url: string) => void;
  /** Abo auf Änderungen der Sitzungen (Start, Ende, Entfernen): Das Sitzungsradar der Cockpit-Ansicht zeichnet neu. */
  onSessionsChange: (cb: () => void) => () => void;
  /** Feed der neuen Flächen (Abend 18), bei jedem Zeichnen frisch zusammengesetzt; gehört dem Plugin. */
  feed: () => CockpitFeed;
  /** Klicks und Tasten der neuen Flächen; der Aufrufer (Plugin) führt aus. */
  actions: CockpitFeedActions;
  /** Meldet, wenn sich am Feed etwas geändert hat (Lesen fertig, Signal, angesehen); der Rückgabewert meldet ab. */
  onFeedChange: (cb: () => void) => () => void;
  /** Das Dashboard ging auf: Plugin liest die Dateien der neuen Flächen einmal frisch. */
  feedOpened: () => void;
  /** Karte „Heute“ (Abend 44): Erledigt-Stand des Tages im Store, Abo auf seine Änderungen. */
  briefingDone: (today: string) => string[];
  setBriefingDone: (today: string, key: string, done: boolean) => void;
  remindersDone: (today: string) => ReminderDone[];
  setReminderDone: (today: string, item: ReminderDone, done: boolean) => void;
  onTodayChange: (cb: () => void) => () => void;
  /** Erinnerungen-Zustand und Takt, gehört dem Plugin (eine Instanz für alle Dashboards). */
  reminders: RemindersController;
}

type Listing = { kind: "ok"; days: string[] } | { kind: "missing" } | { kind: "unset" };

const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

/**
 * Dashboard: Kopf mit Pull-Status, darunter die Karten. Je nach Einstellung `dashboardLayout` als Liste (Karten
 * untereinander) oder als Cockpit (Bild mit Instrumenten, die vollen Karten im Zoom, Ausschnitt nach `cockpitCrop`); die Karten sind in beiden
 * Fällen dieselben Objekte und laufen immer, nur ihr Platz im DOM wechselt. Reines DOM, Farben aus Obsidian-Variablen.
 */
export class DashboardView extends ItemView {
  private readonly deps: DashboardDeps;
  private expanded = false;
  /** Bereich „Erledigt“ der Karte „Heute“ aufgeklappt; steht im View-State. */
  private doneOpen = false;
  /** dashboardOpened beim Erinnerungen-Controller ist gemeldet; onClose meldet das Schließen genau dann. */
  private remindersCounted = false;
  private listing: Listing = { kind: "ok", days: [] };
  private selected: string | null = null;
  /** Einstellungen, mit denen die Briefing-Karte zuletzt geladen hat (briefingLoadKey); eine Änderung lädt neu. */
  private loadedKey: string | null = null;
  /** Hinweis über dem Briefing-Text, wenn das Abhaken nicht zugeordnet werden konnte (null: keiner). */
  private briefingHint: string | null = null;
  private generation = 0;
  /** Baut das zuletzt gezeigte Render-Ergebnis ab (seine Kind-Component), null: keins. */
  private renderDispose: (() => void) | null = null;
  private reload: ReturnType<typeof createDebounce> | null = null;
  private statusEl: HTMLElement | null = null;
  private pullButton: HTMLButtonElement | null = null;
  private pullSettingsButton: HTMLButtonElement | null = null;
  private cardEl: HTMLElement | null = null;
  private opened = false;
  private tasks: TasksCard | null = null;
  private skillsCard: SkillsCard | null = null;
  private usage: UsageCard | null = null;
  private research: ResearchCard | null = null;
  /** Stand der Briefing-Karte für das Instrument (null: lädt noch). Gespeist von loadBriefings, dem einzigen Lader. */
  private readonly briefing = new Observable<BriefingInput | null>(null);
  private layoutCtl: DashboardLayoutController | null = null;
  private headEl: HTMLElement | null = null;
  private cardEls: HTMLElement[] = [];

  constructor(leaf: WorkspaceLeaf, deps: DashboardDeps) {
    super(leaf);
    this.deps = deps;
  }

  getViewType(): string {
    return VIEW_TYPE_DASHBOARD;
  }

  getDisplayText(): string {
    return "Cockpit-Dashboard";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), expanded: this.expanded, doneOpen: this.doneOpen };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const doneOpen = (state as { doneOpen?: unknown } | null)?.doneOpen === true;
    if (doneOpen !== this.doneOpen) {
      this.doneOpen = doneOpen;
      this.tasks?.redraw();
    }
    const expanded = (state as { expanded?: unknown } | null)?.expanded === true;
    if (expanded === this.expanded) return;
    this.expanded = expanded;
    if (this.opened) void this.loadBriefings();
  }

  async onOpen(): Promise<void> {
    this.opened = true;
    const root = this.contentEl;
    root.empty();
    root.addClass("cockpit-dashboard");

    // Kopf oben: unten rechts liegt Obsidians Statusleiste.
    const head = root.createDiv({ cls: "cockpit-dashboard-head" });
    this.headEl = head;
    head.createEl("h4", { text: "Cockpit-Dashboard", cls: "cockpit-dashboard-title" });
    this.statusEl = head.createSpan({ cls: "cockpit-pull-status" });
    this.pullButton = head.createEl("button", { text: "Jetzt pullen", cls: "cockpit-pull-button" });
    this.pullButton.addEventListener("click", () => void this.deps.pull.pullNow());
    // Nur bei „nicht eingerichtet“ sichtbar: Sprung in die Einstellungen wie auf den anderen Karten.
    this.pullSettingsButton = head.createEl("button", { text: OPEN_SETTINGS_TEXT, cls: "cockpit-unset-open" });
    this.pullSettingsButton.hidden = true;
    this.pullSettingsButton.addEventListener("click", () => this.deps.actions.openSettings());
    this.cardEl = root.createDiv({ cls: "cockpit-card" });
    // Unter der Briefing-Karte: Usage, Heute, Skills, zuletzt Research.
    this.usage = new UsageCard(this, root.createDiv({ cls: "cockpit-card" }), { counter: this.deps.counter });
    this.tasks = new TasksCard(this, root.createDiv({ cls: "cockpit-card" }), {
      settings: this.deps.settings,
      onSettingsChange: this.deps.onSettingsChange,
      now: () => new Date(),
      briefingDone: this.deps.briefingDone,
      setBriefingDone: this.deps.setBriefingDone,
      remindersDone: this.deps.remindersDone,
      setReminderDone: this.deps.setReminderDone,
      onTodayChange: this.deps.onTodayChange,
      reminders: this.deps.reminders,
      doneOpen: () => this.doneOpen,
      setDoneOpen: (open) => {
        this.doneOpen = open;
        this.app.workspace.requestSaveLayout();
      },
    });
    this.skillsCard = new SkillsCard(this, root.createDiv({ cls: "cockpit-card" }), {
      settings: this.deps.settings,
      onSettingsChange: this.deps.onSettingsChange,
      discover: this.deps.discoverSkills,
      recentSkills: this.deps.recentSkills,
      onRecentsChange: this.deps.onRecentsChange,
      run: this.deps.runSkill,
    });
    this.research = new ResearchCard(this, root.createDiv({ cls: "cockpit-card" }), {
      settings: this.deps.settings,
      onSettingsChange: this.deps.onSettingsChange,
      openUrl: this.deps.openUrl,
    });
    // Die fünf Karten in der Reihenfolge der Liste; die Cockpit-Ansicht nimmt sie ins Regal und zeigt sie im Zoom.
    this.cardEls = Array.from(root.querySelectorAll<HTMLElement>(":scope > .cockpit-card"));

    this.reload = createDebounce(() => void this.loadBriefings(), BRIEFING_RELOAD_DEBOUNCE_MS, {
      // Fenster des Containers, nicht des Hauptfensters (Pop-out).
      set: (cb, ms) => this.containerEl.win.setTimeout(cb, ms),
      clear: (handle) => this.containerEl.win.clearTimeout(handle as number),
    });
    const trigger = (path: string) => {
      if (isInBriefingsDir(path, this.deps.settings().briefingsDir)) this.reload?.();
    };
    const vault = this.app.vault;
    this.registerEvent(vault.on("create", (f) => trigger(f.path)));
    this.registerEvent(vault.on("modify", (f) => trigger(f.path)));
    this.registerEvent(vault.on("delete", (f) => trigger(f.path)));
    this.registerEvent(vault.on("rename", (f, oldPath) => {
      trigger(f.path);
      trigger(oldPath);
    }));
    // Anderer Briefing-Ordner, Schalter der Briefing-Punkte oder Überschrift: neu laden, ohne auf ein Vault-Ereignis zu warten.
    this.register(this.deps.onSettingsChange((s) => {
      if (briefingLoadKey(s) !== this.loadedKey) this.reload?.();
    }));
    // Erledigt-Stand des Tages geändert (feuert nur bei setBriefingDone und setReminderDone, nicht beim Tageswechsel): Haken
    // neu zeichnen, entprellt. Der eigene Klick lädt sofort (onToggle). Der Tausch des gerenderten Elements läuft synchron;
    // die Scrollposition soll dabei erhalten bleiben, in Obsidian noch nicht gemessen.
    this.register(this.deps.onTodayChange(() => {
      if (this.expanded) this.reload?.();
    }));

    const off = this.deps.pull.state.subscribe((s) => this.showPull(s));
    this.register(off);
    this.showPull(this.deps.pull.state.snapshot());

    this.renderCard();
    this.usage.start();
    this.tasks.start();
    this.skillsCard.start();
    this.research.start();
    // Die Cockpit-Ansicht (Bühne, Ausschnitt, Wechsel, Zoom) lebt im Controller; die Instrumente lesen dieselben Stände wie die
    // Karten (data der Karten, Briefing, Pull-Zustand, Sitzungen, Feed), jede Änderung zeichnet neu.
    const usage = this.usage;
    const tasks = this.tasks;
    const research = this.research;
    this.layoutCtl = new DashboardLayoutController({
      root,
      doc: root.doc,
      head,
      cards: this.cardEls,
      backgroundUrl: cockpitBackground,
      layout: () => this.deps.settings().dashboardLayout,
      crop: () => this.deps.settings().cockpitCrop,
      onSettingsChange: this.deps.onSettingsChange,
      // Nur, was ein Instrument noch liest. Tokens heute zeigt der OUT-Ring, ihn zeichnet der Feed (der Zähler stößt dort den Abruf an).
      sources: [
        (cb) => usage.data.subscribe(cb),
        (cb) => tasks.data.subscribe(cb),
        (cb) => research.data.subscribe(cb),
        (cb) => this.briefing.subscribe(cb),
        (cb) => this.deps.pull.state.subscribe(cb),
        (cb) => this.deps.onSessionsChange(cb),
        (cb) => this.deps.onFeedChange(cb),
      ],
      inputs: () => this.cockpitInputs(),
      feed: () => this.deps.feed(),
      actions: this.deps.actions,
      settings: this.deps.settings,
      clock,
      isExpanded: () => this.expanded,
      // Nur für den Zoom: nicht speichern (kein requestSaveLayout), die Liste behält ihren Zustand.
      setExpanded: (expanded) => {
        this.expanded = expanded;
        void this.loadBriefings();
      },
    });
    this.layoutCtl.start();
    this.deps.pull.dashboardOpened();
    this.deps.reminders.dashboardOpened();
    this.remindersCounted = true;
    this.deps.feedOpened();
    await this.loadBriefings();
  }

  async onClose(): Promise<void> {
    try {
      this.opened = false;
      this.reload?.cancel();
      this.reload = null;
      this.usage?.stop();
      this.tasks?.stop();
      this.skillsCard?.stop();
      this.research?.stop();
      // Die Cockpit-Bühne schließt einen offenen Zoom und gibt die Karten zurück, ehe sie weg ist.
      this.layoutCtl?.destroy();
      this.layoutCtl = null;
      this.usage = null;
      this.tasks = null;
      this.skillsCard = null;
      this.research = null;
      this.generation++;
      this.unloadRender();
      this.deps.pull.dashboardClosed();
    } finally {
      // Paarig zu dashboardOpened, auch wenn oben etwas wirft; nie ohne vorheriges Öffnen (onOpen kann davor gescheitert sein).
      if (this.remindersCounted) {
        this.remindersCounted = false;
        this.deps.reminders.dashboardClosed();
      }
    }
  }

  /** Kanzel-Klick (Action openBriefing): Zoom auf die Briefing-Karte, in der Liste die Karte aufklappen. */
  showBriefing(): void {
    if (this.layoutCtl?.zoomPanel("briefing")) return;
    if (this.expanded) return;
    this.expanded = true;
    this.app.workspace.requestSaveLayout();
    void this.loadBriefings();
  }

  /** Alles, was die Instrumente brauchen, aus den Ständen der Karten (kein eigener Lader). */
  private cockpitInputs(): CockpitInputs {
    const tasks = this.tasks?.data.get() ?? null;
    const tasksInput: TasksInput | null =
      tasks === null ? null : { open: tasks.today.openTexts, total: tasks.today.total, tasksMissing: tasks.today.tasksMissing };
    return {
      now: Date.now(),
      briefing: this.briefing.get(),
      usage: { snapshot: this.usage?.data.get() ?? null },
      tasks: tasksInput,
      research: researchForPanel(this.research?.data.get() ?? null, this.deps.settings().researchSearches),
      pull: this.deps.pull.state.snapshot(),
    };
  }

  private showPull(s: PullSnapshot): void {
    const { text, error } = formatPullStatus(s, clock);
    this.statusEl?.setText(text);
    this.statusEl?.toggleClass("cockpit-pull-error", error);
    if (this.pullButton) this.pullButton.disabled = s.status === "running";
    if (this.pullSettingsButton) this.pullSettingsButton.hidden = s.status !== "unset";
  }

  private unloadRender(): void {
    this.renderDispose?.();
    this.renderDispose = null;
  }

  /** Liste frisch aus dem Vault; gelesen und gerendert wird nur aufgeklappt. Nur das jüngste Ergebnis zählt. */
  private async loadBriefings(): Promise<void> {
    if (!this.opened) return;
    const gen = ++this.generation;
    const dir = this.deps.settings().briefingsDir;
    this.loadedKey = briefingLoadKey(this.deps.settings());
    // Leerer Pfad nie lesen: getFolderByPath("") ist die Vault-Wurzel.
    const unset = isUnset(dir);
    const folder = unset ? null : this.app.vault.getFolderByPath(dir);
    if (!folder) {
      this.listing = unset ? { kind: "unset" } : { kind: "missing" };
      this.selected = null;
      this.unloadRender();
      this.renderCard();
      this.briefing.set({ kind: unset ? "unset" : "missing" });
      return;
    }
    const days = listBriefings(folder.children.filter((c): c is TFile => c instanceof TFile).map((c) => c.name));
    // War die bisherige Auswahl die neueste (oder leer), folgt sie der neuesten.
    const wasNewest = this.listing.kind !== "ok" || this.selected === null || this.selected === this.listing.days[0];
    this.listing = { kind: "ok", days };
    this.selected = pickSelection(days, this.selected, wasNewest);

    let shown: (RenderedBriefing & { hint?: string | null }) | null = null;
    // Gelesen und gerendert wird nur aufgeklappt. Das Instrument der Cockpit-Ansicht zeigt nur das Datum (seit 19b ohne Überschrift) und liest nie.
    if (this.expanded && this.selected !== null) {
      const file = this.app.vault.getFileByPath(`${dir}/${this.selected}.md`);
      if (file) {
        let text: string;
        try {
          text = await this.app.vault.cachedRead(file);
        } catch (fehler) {
          text = `Datei nicht lesbar: ${fehler instanceof Error ? fehler.message : String(fehler)}`;
        }
        if (gen !== this.generation) return;
        const s = this.deps.settings();
        const today = localDayString(new Date());
        const todayPath = todayBriefingPath(s, today);
        const render = (markdown: string) => this.renderMarkdown(markdown, file.path);
        // Abend 44: Nur das Briefing von heute bekommt Checkboxen mit dem Erledigt-Stand aus dem Store (data.json); die Datei
        // bleibt unverändert, markBriefing ändert nur den Text, der gerendert wird. Ältere Tage bleiben, wie sie sind.
        if (todayPath === file.path) {
          const doneKeys = new Set(this.deps.briefingDone(today));
          const scan = scanBriefing(text, s.focusHeading);
          shown = await renderBriefingWithChecks({
            text,
            marked: markBriefing(text, scan, doneKeys),
            boxes: scan.boxes,
            done: doneKeys,
            render,
            // Der Setzer meldet synchron onTodayChange und stößt die Entprellung an: verwerfen und sofort laden.
            onToggle: (key, done) => {
              this.deps.setBriefingDone(today, key, done);
              this.reload?.cancel();
              void this.loadBriefings();
            },
            stale: () => gen !== this.generation,
          });
        } else shown = await render(text);
        if (gen !== this.generation) {
          shown.dispose();
          return;
        }
      }
    }
    this.unloadRender();
    this.renderDispose = shown?.dispose ?? null;
    this.briefingHint = shown?.hint ?? null;
    this.renderCard(shown?.el ?? null);
    this.briefing.set({ kind: "ok", date: this.selected });
  }

  /** Rendert in ein eigenes Element mit eigener Kind-Component; getauscht wird erst, wenn das Ergebnis noch das jüngste ist. */
  private async renderMarkdown(text: string, path: string): Promise<RenderedBriefing> {
    const rendered = createDiv({ cls: "cockpit-briefing-text markdown-rendered" });
    const component = new Component();
    this.addChild(component);
    await MarkdownRenderer.render(this.app, text, rendered, path, component);
    // Obsidians Renderer setzt a.internal-link mit data-href, hängt aber keinen Klick-Handler an: geöffnet wird hier (Klick und Mittelklick), in einem neuen Tab.
    handleInternalLinks(this.app, rendered, {
      ziel: (e) => (e.target as HTMLElement | null)?.closest("a.internal-link")?.getAttribute("data-href") || null,
      quelle: () => path,
    });
    return { el: rendered, dispose: () => this.removeChild(component) };
  }

  private renderCard(content: HTMLElement | null = null): void {
    const card = this.cardEl;
    if (!card) return;
    card.empty();
    const dir = this.deps.settings().briefingsDir;
    const head = card.createDiv({ cls: "cockpit-card-head" });
    head.createSpan({ text: this.expanded ? "▾" : "▸", cls: "cockpit-card-chevron" });
    head.createSpan({ text: "Briefing", cls: "cockpit-card-title" });
    let label: string;
    if (this.listing.kind === "unset") label = UNSET_TEXT;
    else if (this.listing.kind === "missing") label = `Ordner ${dir}/ fehlt`;
    else label = this.selected ?? `Keine Briefings in ${dir}/`;
    head.createSpan({ text: label, cls: "cockpit-card-date" });
    head.addEventListener("click", () => {
      this.expanded = !this.expanded;
      this.app.workspace.requestSaveLayout();
      void this.loadBriefings();
    });
    if (this.selected !== null) {
      const cont = head.createEl("button", { text: "Hiermit weiterarbeiten", cls: "cockpit-card-continue" });
      cont.addEventListener("click", (e) => {
        e.stopPropagation();
        const s = this.deps.settings();
        // Ziel ist die zuletzt aktive Claude-Sitzung (RecentSessions im Plugin), nicht das aktive Leaf: das ist hier das Dashboard.
        this.deps.send(fillPrompt(s.continuePrompt, s.briefingsDir));
      });
    }
    if (this.listing.kind === "unset") {
      // Nicht eingerichtet: immer sichtbar (auch zugeklappt), mit Sprung in die Einstellungen; „Weiter“ gibt es ohne Ordner nicht.
      const hint = card.createDiv({ cls: "cockpit-card-body cockpit-unset-hint" });
      hint.createSpan({ text: unsetHint("briefingsDir") });
      const open = hint.createEl("button", { text: OPEN_SETTINGS_TEXT, cls: "cockpit-unset-open" });
      open.addEventListener("click", () => this.deps.actions.openSettings());
      return;
    }
    if (!this.expanded || this.listing.kind !== "ok" || this.listing.days.length === 0) return;
    const body = card.createDiv({ cls: "cockpit-card-body" });
    const select = body.createEl("select", { cls: "cockpit-briefing-select dropdown" });
    for (const day of this.listing.days) select.createEl("option", { text: day, value: day });
    if (this.selected !== null) select.value = this.selected;
    select.addEventListener("change", () => {
      this.selected = select.value;
      void this.loadBriefings();
    });
    if (content && this.briefingHint) body.createDiv({ cls: "cockpit-hint", text: this.briefingHint });
    if (content) body.append(content);
  }
}
