import { type App, type ItemView, Notice } from "obsidian";
import { TASKS_RELOAD_DEBOUNCE_MS } from "../core/constants";
import { Observable } from "../core/observable";
import { createDebounce } from "../core/debounce";
import type { CockpitSettings } from "../core/settings";
import { REASON_ALREADY_DONE, REASON_ALREADY_OPEN, TASKS_TEMPLATE, parentFolders, taskRows, textParts, toggleTask, type TaskRow } from "../core/tasks";

export interface TasksCardDeps {
  settings: () => CockpitSettings;
  onSettingsChange: (cb: (s: CockpitSettings) => void) => () => void;
}

/** Wird in vault.process geworfen, wenn die Aufgabe nicht mehr zu finden ist: Obsidian schreibt dann nichts. */
class TaskChangedError extends Error {}

export type TasksView = { kind: "missing" } | { kind: "ok"; rows: TaskRow[]; done: number; total: number };
const EMPTY_VIEW: TasksView = { kind: "ok", rows: [], done: 0, total: 0 };

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
    new Notice(`Aufgabenliste nicht angelegt: ${fehler instanceof Error ? fehler.message : String(fehler)}`, 10000);
    return false;
  }
}

/** Karte „Aufgaben“ im Dashboard: liest die Markdown-Liste, schaltet Checkboxen nur über vault.process. */
export class TasksCard {
  /** Stand der Liste (null: noch nicht gelesen); die Instrumente der Cockpit-Ansicht lesen ihn von hier. */
  readonly data = new Observable<TasksView | null>(null);
  private readonly owner: ItemView;
  private readonly el: HTMLElement;
  private readonly deps: TasksCardDeps;
  private get view(): TasksView { return this.data.get() ?? EMPTY_VIEW; }
  private loadedPath: string | null = null;
  private generation = 0;
  private reload: ReturnType<typeof createDebounce> | null = null;
  private running = false;

  constructor(owner: ItemView, el: HTMLElement, deps: TasksCardDeps) {
    this.owner = owner;
    this.el = el;
    this.deps = deps;
  }

  private get app(): App { return this.owner.app; }

  start(): void {
    this.running = true;
    this.reload = createDebounce(() => void this.loadTasks(), TASKS_RELOAD_DEBOUNCE_MS, {
      // Fenster des Containers, nicht des Hauptfensters (Pop-out).
      set: (cb, ms) => this.owner.containerEl.win.setTimeout(cb, ms),
      clear: (handle) => this.owner.containerEl.win.clearTimeout(handle as number),
    });
    const trigger = (path: string) => {
      if (path === this.deps.settings().tasksFile) this.reload?.();
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
      if (s.tasksFile !== this.loadedPath) this.reload?.();
    }));
    this.render();
    void this.loadTasks();
  }

  stop(): void {
    this.running = false;
    this.reload?.cancel();
    this.reload = null;
    this.generation++;
  }

  /** Liest nur (cachedRead plus Metadaten-Cache), legt nichts an. Nur das jüngste Ergebnis zählt. */
  private async loadTasks(): Promise<void> {
    if (!this.running) return;
    const gen = ++this.generation;
    const path = this.deps.settings().tasksFile;
    this.loadedPath = path;
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      this.data.set({ kind: "missing" });
      this.render();
      return;
    }
    let content: string;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch (fehler) {
      new Notice(`Aufgabenliste nicht lesbar: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
      return;
    }
    if (gen !== this.generation) return;
    // Frisch angelegt oder gerade geändert: der Cache kann leer oder älter sein, dann kommt „changed“ nach.
    const cache = this.app.metadataCache.getFileCache(file);
    const items = (cache?.listItems ?? []).map((i) => ({ line: i.position.start.line, task: i.task, parent: i.parent }));
    const headings = (cache?.headings ?? []).map((h) => ({ line: h.position.start.line, level: h.level, heading: h.heading }));
    this.data.set({ kind: "ok", ...taskRows(content, items, headings) });
    this.render();
  }

  /** Umschalten nur über vault.process: gelesen und geschrieben wird atomar, ein Fehlergrund wirft und schreibt nichts. */
  private async toggle(row: Extract<TaskRow, { kind: "task" }>): Promise<void> {
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
      } else new Notice(`Aufgabe nicht umgeschaltet: ${fehler instanceof Error ? fehler.message : String(fehler)}`, 10000);
    }
    // Keine optimistische Anzeige: die neue Darstellung kommt über das changed-Ereignis.
  }

  private render(): void {
    const el = this.el;
    el.empty();
    const path = this.deps.settings().tasksFile;
    const head = el.createDiv({ cls: "cockpit-card-head cockpit-tasks-head" });
    head.createSpan({ text: "Aufgaben", cls: "cockpit-card-title" });
    const v = this.view;
    if (v.kind === "missing") {
      head.createSpan({ text: `Aufgabenliste ${path} fehlt`, cls: "cockpit-card-date" });
      const make = head.createEl("button", { text: "Anlegen", cls: "cockpit-card-continue" });
      make.addEventListener("click", () => void createTasksFile(this.app, this.deps.settings().tasksFile));
      return;
    }
    head.createSpan({ text: `${v.done}/${v.total}`, cls: "cockpit-card-date" });
    const bar = head.createDiv({ cls: "cockpit-progress" });
    bar.createDiv({ cls: "cockpit-progress-fill" }).style.width = `${v.total === 0 ? 0 : Math.round((v.done / v.total) * 100)}%`;
    const body = el.createDiv({ cls: "cockpit-card-body" });
    if (v.total === 0) {
      body.createDiv({ text: `Keine Aufgaben in ${path}`, cls: "cockpit-hint" });
    }
    for (const row of v.rows) {
      if (row.kind === "heading") {
        body.createDiv({ text: row.text, cls: `cockpit-task-heading cockpit-task-heading-${Math.min(row.level, 3)}` });
        continue;
      }
      const line = body.createDiv({ cls: row.done ? "cockpit-task cockpit-task-done" : "cockpit-task" });
      line.style.paddingLeft = `${row.depth * 20}px`;
      line.createSpan({ text: row.done ? "☑" : "☐", cls: "cockpit-task-box" });
      const textEl = line.createSpan({ cls: "cockpit-task-text" });
      for (const part of textParts(row.text)) {
        if (part.kind === "text") {
          textEl.append(part.text);
          continue;
        }
        const a = textEl.createEl("a", { text: part.anzeige, cls: "internal-link", attr: { "data-href": part.ziel } });
        a.addEventListener("click", (e) => {
          // Der Link ist nicht Teil der Umschaltfläche: nicht in die Zeile weiterreichen. Neuer Tab, damit das Dashboard stehen bleibt.
          e.stopPropagation();
          e.preventDefault();
          void this.app.workspace.openLinkText(part.ziel, this.deps.settings().tasksFile, "tab");
        });
      }
      line.addEventListener("click", () => void this.toggle(row));
    }
  }
}
