import { type App, type ItemView, Notice } from "obsidian";
import { isInBriefingsDir } from "../core/briefings";
import { TASKS_RELOAD_DEBOUNCE_MS, TODAY_CLICK_GUARD_MS } from "../core/constants";
import { Observable } from "../core/observable";
import { createDebounce } from "../core/debounce";
import { type BriefingPoint, scanBriefing } from "../core/focus";
import { dueReminders, parseListNames } from "../core/reminders";
import type { ReminderDone } from "../core/session-model";
import type { CockpitSettings } from "../core/settings";
import { REASON_ALREADY_DONE, REASON_ALREADY_OPEN, TASKS_TEMPLATE, parentFolders, taskRows, textParts, toggleTask, type TaskRow } from "../core/tasks";
import { type TodayRow, type TodayView, insertTask, todayBriefingPath, todayView } from "../core/today";
import { localDayString } from "../core/usage";
import { handleInternalLinks } from "./internal-link";
import type { RemindersController } from "./reminders";

export interface TasksCardDeps {
  settings: () => CockpitSettings;
  onSettingsChange: (cb: (s: CockpitSettings) => void) => () => void;
  /** Uhr des Hosts; „heute“ ist immer localDayString(now()). */
  now: () => Date;
  /** Erledigt-Stand des Tages aus data.json (Store), schreiben meldet onTodayChange. */
  briefingDone: (today: string) => string[];
  setBriefingDone: (today: string, key: string, done: boolean) => void;
  remindersDone: (today: string) => ReminderDone[];
  setReminderDone: (today: string, item: ReminderDone, done: boolean) => void;
  onTodayChange: (cb: () => void) => () => void;
  /** Eine Instanz im Plugin; die Karte liest den Zustand und setzt über sie. */
  reminders: RemindersController;
  /** Bereich „Erledigt“ aufgeklappt (View-State des Dashboards). */
  doneOpen: () => boolean;
  setDoneOpen: (open: boolean) => void;
}

/** Wird in vault.process geworfen, wenn die Aufgabe nicht mehr zu finden ist: Obsidian schreibt dann nichts. */
class TaskChangedError extends Error {}

export type TasksView = { kind: "ok"; today: TodayView };

/** Einstellungen, bei deren Änderung die Karte neu lädt. */
function loadKey(s: CockpitSettings): string {
  return JSON.stringify([s.tasksFile, s.briefingsDir, s.focusHeading, s.todayBriefing, s.remindersEnabled, s.remindersLists, s.remindersOverdue]);
}

const messageOf = (fehler: unknown): string => (fehler instanceof Error ? fehler.message : String(fehler));

/**
 * Legt die Aufgabenliste an. Der einzige Ort, der die Datei erzeugt (Knopf „Anlegen“ und Command rufen ihn).
 * Existiert sie schon, passiert nichts außer einer Notice. Ergebnis: true, wenn die Datei danach da ist.
 */
export async function createTasksFile(app: App, path: string): Promise<boolean> {
  try {
    if (app.vault.getAbstractFileByPath(path) !== null) {
      new Notice(`Aufgabenliste ${path} gibt es schon`);
      return true;
    }
    for (const folder of parentFolders(path)) {
      if (app.vault.getAbstractFileByPath(folder) === null) await app.vault.createFolder(folder);
    }
    await app.vault.create(path, TASKS_TEMPLATE);
    new Notice(`Aufgabenliste ${path} angelegt`);
    return true;
  } catch (fehler) {
    new Notice(`Aufgabenliste nicht angelegt: ${messageOf(fehler)}`, 10000);
    return false;
  }
}

/**
 * Karte „Heute“ im Dashboard (Abend 44, vorher „Aufgaben“): Punkte des heutigen Briefings, fällige Erinnerungen und die
 * Aufgabenliste in einer Liste, darunter „Erledigt“. Die Aufgabenliste wird nur über vault.process geschrieben, ins Briefing
 * schreibt die Karte nie. Die Eingabezeile wird einmal angelegt und überlebt jedes Neuzeichnen (nur Kopf und Rumpf wechseln).
 */
export class TasksCard {
  /** Stand der Karte (null: noch nicht gelesen); die Instrumente der Cockpit-Ansicht lesen ihn von hier. */
  readonly data = new Observable<TasksView | null>(null);
  private readonly owner: ItemView;
  private readonly el: HTMLElement;
  private readonly deps: TasksCardDeps;
  private loadedKey: string | null = null;
  private generation = 0;
  private reload: ReturnType<typeof createDebounce> | null = null;
  private running = false;
  /** Tag des zuletzt geladenen Stands; Klicks schreiben den Erledigt-Stand dieses Tags. */
  private today = "";
  /** Pfad des heutigen Briefings (Quelle für Wikilinks), null ohne Briefing-Lesen. */
  private briefingPath: string | null = null;
  /** Fehlertext der Erinnerungen beim letzten Laden. */
  private reminderError: string | null = null;
  /** Zuletzt gemeldeter Lesefehler der Aufgabenliste: dieselbe Meldung nur einmal. */
  private lastReadError: string | null = null;
  private adding = false;
  /** Zeitstempel des letzten angenommenen Mausklicks auf eine Zeile (Zeitsperre gegen den Doppelklick). */
  private lastRowClick = Number.NEGATIVE_INFINITY;
  private countEl: HTMLElement | null = null;
  private barEl: HTMLElement | null = null;
  private fillEl: HTMLElement | null = null;
  private refreshEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private missingEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;

  constructor(owner: ItemView, el: HTMLElement, deps: TasksCardDeps) {
    this.owner = owner;
    this.el = el;
    this.deps = deps;
  }

  private get app(): App { return this.owner.app; }

  start(): void {
    this.running = true;
    this.build();
    this.reload = createDebounce(() => void this.loadTasks(), TASKS_RELOAD_DEBOUNCE_MS, {
      // Fenster des Containers, nicht des Hauptfensters (Pop-out).
      set: (cb, ms) => this.owner.containerEl.win.setTimeout(cb, ms),
      clear: (handle) => this.owner.containerEl.win.clearTimeout(handle as number),
    });
    const trigger = (path: string) => {
      const s = this.deps.settings();
      if (path === s.tasksFile || isInBriefingsDir(path, s.briefingsDir)) this.reload?.();
    };
    const vault = this.app.vault;
    this.owner.registerEvent(vault.on("create", (f) => trigger(f.path)));
    this.owner.registerEvent(vault.on("modify", (f) => trigger(f.path)));
    this.owner.registerEvent(vault.on("delete", (f) => trigger(f.path)));
    this.owner.registerEvent(vault.on("rename", (f, oldPath) => {
      trigger(f.path);
      trigger(oldPath);
    }));
    this.owner.registerEvent(this.app.metadataCache.on("changed", (file) => trigger(file.path)));
    this.owner.register(this.deps.onSettingsChange((s) => {
      if (loadKey(s) !== this.loadedKey) this.reload?.();
    }));
    // Erledigt-Stand und Erinnerungen ändern sich ohne Vault-Ereignis: sofort neu laden.
    this.owner.register(this.deps.onTodayChange(() => void this.loadTasks()));
    this.owner.register(this.deps.reminders.state.subscribe(() => void this.loadTasks()));
    this.render();
    void this.loadTasks();
  }

  stop(): void {
    this.running = false;
    this.reload?.cancel();
    this.reload = null;
    this.generation++;
  }

  /** Zeichnet Kopf und Rumpf neu (das Dashboard ruft es nach einem neuen View-State). */
  redraw(): void {
    this.render();
  }

  /**
   * Liest nur (cachedRead plus Metadaten-Cache), legt nichts an. Bestimmt bei jedem Laden den Tag neu. Nur das jüngste
   * Ergebnis zählt.
   */
  private async loadTasks(): Promise<void> {
    if (!this.running) return;
    const gen = ++this.generation;
    const s = this.deps.settings();
    this.loadedKey = loadKey(s);
    const today = localDayString(this.deps.now());
    const tasks = await this.readTasks(s.tasksFile);
    if (gen !== this.generation || tasks === "failed") return;
    const briefing = await this.readBriefing(s, today);
    if (gen !== this.generation) return;
    const state = this.deps.reminders.state.get();
    const items = state.kind === "ok" || state.kind === "error" ? state.items : [];
    const due = dueReminders(items, today, { lists: parseListNames(s.remindersLists), overdue: s.remindersOverdue });
    const view = todayView({
      briefing: briefing.points,
      briefingDone: this.deps.briefingDone(today),
      reminders: due,
      remindersDone: this.deps.remindersDone(today),
      tasks,
    });
    this.today = today;
    this.briefingPath = briefing.path;
    this.reminderError = state.kind === "error" ? state.message : null;
    this.data.set({ kind: "ok", today: view });
    this.render();
  }

  /** Zeilen der Aufgabenliste; null: Datei fehlt; "failed": nicht lesbar (Stand bleibt, eine Notice je neuer Meldung). */
  private async readTasks(path: string): Promise<TaskRow[] | null | "failed"> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    let content: string;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch (fehler) {
      const text = `Aufgabenliste nicht lesbar: ${messageOf(fehler)}`;
      // Die Karte lädt auch im Takt der Erinnerungen neu: dieselbe Meldung nicht jedes Mal.
      if (text !== this.lastReadError) new Notice(text);
      this.lastReadError = text;
      return "failed";
    }
    this.lastReadError = null;
    // Frisch angelegt oder gerade geändert: der Cache kann leer oder älter sein, dann kommt „changed“ nach.
    const cache = this.app.metadataCache.getFileCache(file);
    const items = (cache?.listItems ?? []).map((i) => ({ line: i.position.start.line, task: i.task, parent: i.parent }));
    const headings = (cache?.headings ?? []).map((h) => ({ line: h.position.start.line, level: h.level, heading: h.heading }));
    return taskRows(content, items, headings).rows;
  }

  /** Punkte aus `<briefingsDir>/<heute>.md`, nur bei eingeschaltetem Schalter und gesetztem Ordner; fehlt die Datei: keine. */
  private async readBriefing(s: CockpitSettings, today: string): Promise<{ path: string | null; points: BriefingPoint[] }> {
    const path = todayBriefingPath(s, today);
    if (path === null) return { path: null, points: [] };
    const file = this.app.vault.getFileByPath(path);
    if (!file) return { path, points: [] };
    try {
      return { path, points: scanBriefing(await this.app.vault.cachedRead(file), s.focusHeading).points };
    } catch (fehler) {
      console.warn(`Glasscockpit: Briefing ${path} nicht lesbar: ${messageOf(fehler)}`);
      return { path, points: [] };
    }
  }

  /** Umschalten nur über vault.process: gelesen und geschrieben wird atomar, ein Fehlergrund wirft und schreibt nichts. */
  private async toggle(row: Extract<TodayRow, { kind: "task" }>): Promise<void> {
    const file = this.app.vault.getFileByPath(this.deps.settings().tasksFile);
    if (!file) {
      new Notice("Aufgabenliste fehlt");
      return;
    }
    try {
      await this.app.vault.process(file, (data) => {
        const result = toggleTask(data, row.line, row.text, row.done);
        if (!result.ok) throw new TaskChangedError(result.reason);
        return result.content;
      });
    } catch (fehler) {
      if (fehler instanceof TaskChangedError) {
        // Schon im gewünschten Zustand (zweiter Klick eines Doppelklicks) ist kein fremder Eingriff: nur der Grund, ohne „Datei geändert“.
        const schonErreicht = fehler.message === REASON_ALREADY_DONE || fehler.message === REASON_ALREADY_OPEN;
        new Notice(schonErreicht ? fehler.message : `Die Datei hat sich geändert: ${fehler.message}`);
      } else new Notice(`Aufgabe nicht umgeschaltet: ${messageOf(fehler)}`, 10000);
    }
    // Keine optimistische Anzeige: die neue Darstellung kommt über das changed-Ereignis.
  }

  /** Neue Aufgabe aus der Eingabezeile, nur über vault.process; das Feld wird erst nach Erfolg geleert. */
  private async addTask(): Promise<void> {
    const input = this.inputEl;
    if (!input || this.adding) return;
    const text = input.value;
    if (text.trim() === "") return;
    const file = this.app.vault.getFileByPath(this.deps.settings().tasksFile);
    if (!file) return;
    this.adding = true;
    try {
      await this.app.vault.process(file, (data) => insertTask(data, this.deps.settings().tasksAddHeading, text) ?? data);
      // Inzwischen weitergetippt: den neuen Text stehen lassen.
      if (input.value === text) input.value = "";
    } catch (fehler) {
      new Notice(`Aufgabe nicht eingefügt: ${messageOf(fehler)}`, 10000);
    } finally {
      this.adding = false;
    }
  }

  /**
   * Setzt erst in Erinnerungen, den Tagesstand nur nach Erfolg. Zeichnet sofort neu, damit die Zeile gesperrt erscheint.
   * Der Tag ist der des Klicks (nach Mitternacht ohne Neuladen nicht der gemerkte); nach dem Stoppen wird nicht mehr gezeichnet.
   */
  private async toggleReminder(row: Extract<TodayRow, { kind: "reminder" }>): Promise<void> {
    const today = localDayString(this.deps.now());
    const target = !row.done;
    const pending = this.deps.reminders.setCompleted(row.id, target);
    this.render();
    const ok = await pending;
    if (ok) this.deps.setReminderDone(today, { id: row.id, name: row.text }, target);
    if (!this.running) return;
    this.render();
  }

  /** Gerüst einmal: Kopf, Eingabezeile mit Hinweis „fehlt“, Rumpf. */
  private build(): void {
    const el = this.el;
    el.empty();
    // Kopfteile einmal: beim Zeichnen wechseln nur Text, Balkenbreite und hidden, der Fokus auf „↻“ bleibt.
    const head = el.createDiv({ cls: "cockpit-card-head cockpit-tasks-head" });
    head.createSpan({ text: "Heute", cls: "cockpit-card-title" });
    this.countEl = head.createSpan({ cls: "cockpit-card-date" });
    this.barEl = head.createDiv({ cls: "cockpit-progress" });
    this.fillEl = this.barEl.createDiv({ cls: "cockpit-progress-fill" });
    const refresh = head.createEl("button", { text: "↻", cls: "cockpit-today-refresh", attr: { "aria-label": "Erinnerungen neu lesen" } });
    refresh.addEventListener("click", () => void this.deps.reminders.refresh());
    this.refreshEl = refresh;
    const add = el.createDiv({ cls: "cockpit-today-add" });
    const input = add.createEl("input", {
      cls: "cockpit-today-input",
      attr: { type: "text", placeholder: "Aufgabe für heute …", "aria-label": "Neue Aufgabe" },
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      void this.addTask();
    });
    this.inputEl = input;
    this.missingEl = add.createDiv({ cls: "cockpit-today-missing" });
    this.missingEl.hidden = true;
    this.bodyEl = el.createDiv({ cls: "cockpit-card-body" });
  }

  private render(): void {
    const body = this.bodyEl;
    const input = this.inputEl;
    const missing = this.missingEl;
    const count = this.countEl;
    const bar = this.barEl;
    const fill = this.fillEl;
    const refresh = this.refreshEl;
    if (!body || !input || !missing || !count || !bar || !fill || !refresh) return;
    const s = this.deps.settings();
    const v = this.data.get()?.today ?? null;

    count.hidden = v === null;
    bar.hidden = v === null;
    if (v) {
      count.textContent = `${v.doneCount}/${v.total}`;
      fill.style.width = `${v.total === 0 ? 0 : Math.round((v.doneCount / v.total) * 100)}%`;
    }
    // Eine Stelle für „Erinnerungen aktiv“: Der Controller meldet `off` bei ausgeschaltetem Schalter und auf jeder Plattform außer macOS.
    refresh.hidden = this.deps.reminders.state.get().kind === "off";

    const tasksMissing = v?.tasksMissing ?? false;
    input.disabled = tasksMissing;
    missing.empty();
    missing.hidden = !tasksMissing;
    if (tasksMissing) {
      missing.createSpan({ text: `Aufgabenliste ${s.tasksFile} fehlt`, cls: "cockpit-hint" });
      const make = missing.createEl("button", { text: "Anlegen", cls: "cockpit-card-continue" });
      make.addEventListener("click", () => void createTasksFile(this.app, this.deps.settings().tasksFile));
    }

    // Neuzeichnen leert den Rumpf: Nur ein Tastaturfokus (`:focus-visible`) wandert mit, auf „Erledigt“ oder die Zeile an
    // derselben Stelle, per preventScroll ohne Mitscrollen der Ansicht; ein Fokus nach Mausklick fällt weg.
    const focus = this.focusInBody(body);
    body.empty();
    if (!v) return;
    const error = this.reminderError;
    let errorShown = false;
    const showError = (withSource: boolean) => {
      if (error === null || errorShown) return;
      if (withSource) body.createDiv({ text: "Erinnerungen", cls: "cockpit-today-source" });
      body.createDiv({ text: error, cls: "cockpit-hint cockpit-today-error" });
      errorShown = true;
    };
    for (const row of v.open) {
      // Fehler ohne fällige Erinnerungen: eigene Quelle an der Stelle der Erinnerungen (vor der Aufgabenliste).
      if (row.kind === "heading" || row.kind === "task") showError(true);
      this.renderRow(body, row);
      if (row.kind === "source" && row.text === "Erinnerungen") showError(false);
    }
    showError(true);
    if (v.open.length === 0) body.createDiv({ text: "Nichts offen", cls: "cockpit-hint" });

    if (v.done.length > 0) {
      const open = this.deps.doneOpen();
      const toggle = body.createEl("button", {
        text: `Erledigt (${v.done.length})`,
        cls: "cockpit-today-done-toggle",
        attr: { "aria-expanded": String(open) },
      });
      toggle.addEventListener("click", () => {
        this.deps.setDoneOpen(!this.deps.doneOpen());
        // Der Knopf ist danach ein neuer Knoten; render nimmt den Fokus mit.
        this.render();
      });
      if (open) {
        const list = body.createDiv({ cls: "cockpit-today-done" });
        for (const row of v.done) this.renderRow(list, row);
      }
    }
    this.restoreFocus(body, focus);
  }

  /** Bedienbare Zeilen des Rumpfs in Reihenfolge (offen, dann aufgeklapptes „Erledigt“). */
  private focusRows(body: HTMLElement): HTMLElement[] {
    return Array.from(body.querySelectorAll<HTMLElement>(".cockpit-task[tabindex]"));
  }

  /**
   * Wo im Rumpf ein Tastaturfokus liegt: auf „Erledigt“, auf der i-ten Zeile (auch über einen Link in ihr), sonst null.
   * Nur `:focus-visible` zählt: Ein Fokus nach Mausklick fällt beim Neuzeichnen weg, statt unsichtbar auf die nachgerückte
   * Zeile zu wandern. Kennt die Umgebung den Selektor nicht, keine Mitnahme.
   */
  private focusInBody(body: HTMLElement): "toggle" | number | null {
    const active = body.ownerDocument.activeElement;
    if (!active || !body.contains(active)) return null;
    let visible = false;
    try {
      visible = active.matches(":focus-visible");
    } catch {
      visible = false;
    }
    if (!visible) return null;
    if (active.classList.contains("cockpit-today-done-toggle")) return "toggle";
    const row = active.closest<HTMLElement>(".cockpit-task");
    const i = row ? this.focusRows(body).indexOf(row) : -1;
    return i >= 0 ? i : null;
  }

  /** Fokus zurück: „Erledigt“, sonst die Zeile an derselben Stelle, gibt es sie nicht mehr, die letzte davor. */
  private restoreFocus(body: HTMLElement, focus: "toggle" | number | null): void {
    if (focus === null) return;
    const toggle = body.querySelector<HTMLElement>(".cockpit-today-done-toggle");
    const rows = this.focusRows(body);
    const target = focus === "toggle" ? toggle : rows[focus] ?? rows[rows.length - 1] ?? toggle;
    // Ohne preventScroll scrollte der Browser die Ansicht zur Zeile (gemessen: Sprung an den Anfang).
    target?.focus({ preventScroll: true });
  }

  private renderRow(parent: HTMLElement, row: TodayRow): void {
    if (row.kind === "source") {
      parent.createDiv({ text: row.text, cls: "cockpit-today-source" });
      return;
    }
    if (row.kind === "heading") {
      parent.createDiv({ text: row.text, cls: `cockpit-task-heading cockpit-task-heading-${Math.min(row.level, 3)}` });
      return;
    }
    const cls = ["cockpit-task", `cockpit-today-${row.kind}`];
    if (row.done) cls.push("cockpit-task-done");
    const busy = row.kind === "reminder" && this.deps.reminders.isBusy(row.id);
    if (busy) cls.push("cockpit-task-busy");
    // Gesperrt: im Briefing abgehakt, oder abgehakte Erinnerung, während Erinnerungen aus sind (Setzen ginge ins Leere).
    const locked = (row.kind === "briefing" && row.locked) || (row.kind === "reminder" && row.done && this.deps.reminders.state.get().kind === "off");
    if (locked) cls.push("cockpit-task-locked");
    const line = parent.createDiv({ cls: cls.join(" "), attr: { role: "checkbox", "aria-checked": String(row.done) } });
    if (row.kind === "task") line.style.paddingLeft = `${row.depth * 20}px`;
    line.createSpan({ text: row.done ? "☑" : "☐", cls: "cockpit-task-box" });
    const textEl = line.createSpan({ cls: "cockpit-task-text" });
    if (row.kind === "reminder") {
      // Namen aus Erinnerungen sind keine Vault-Links.
      textEl.append(row.text);
      if (row.since !== null) line.createSpan({ text: `seit ${row.since}`, cls: "cockpit-today-since" });
    } else {
      const quelle = row.kind === "briefing" ? () => this.briefingPath ?? "" : () => this.deps.settings().tasksFile;
      for (const part of textParts(row.text)) {
        if (part.kind === "text") {
          textEl.append(part.text);
          continue;
        }
        const a = textEl.createEl("a", { text: part.anzeige, cls: "internal-link", attr: { "data-href": part.ziel, tabindex: "0" } });
        // Der Link ist nicht Teil der Umschaltfläche: Klick und Mittelklick gehen nicht in die Zeile weiter.
        handleInternalLinks(this.app, a, { ziel: () => part.ziel, quelle, stopPropagation: true });
        // Eigener Tabstopp: Enter öffnet wie ein Klick (ohne href löst der Browser keinen Klick aus).
        a.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          e.stopPropagation();
          a.click();
        });
      }
    }
    if (locked) {
      line.setAttribute("aria-disabled", "true");
      return;
    }
    line.setAttribute("tabindex", "0");
    if (busy) line.setAttribute("aria-disabled", "true");
    const act = () => {
      if (row.kind === "briefing") this.deps.setBriefingDone(this.today, row.key, !row.done);
      else if (row.kind === "reminder") {
        if (!this.deps.reminders.isBusy(row.id)) void this.toggleReminder(row);
      } else void this.toggle(row);
    };
    line.addEventListener("click", (e) => {
      // Zeitsperre je Karte: Die Zeile ist nach dem ersten Klick schon gewandert, der zweite eines Doppelklicks träfe den
      // Nachbarn. Zügiges Abhaken nacheinander (über der Sperre) bleibt möglich, der Klickzähler spielt keine Rolle.
      const t = e.timeStamp > 0 ? e.timeStamp : performance.now();
      const dt = t - this.lastRowClick;
      // Negativer Abstand heißt andere Uhr, also anderes Fenster (Pop-out zählt ab seinem eigenen Start): nicht sperren.
      if (dt >= 0 && dt < TODAY_CLICK_GUARD_MS) return;
      this.lastRowClick = t;
      act();
    });
    line.addEventListener("keydown", (e) => {
      if (e.target !== line || (e.key !== " " && e.key !== "Enter")) return;
      // Leertaste ohne Scrollen; gehaltene Taste schaltet nicht hin und her.
      e.preventDefault();
      if (e.repeat) return;
      act();
    });
  }
}
