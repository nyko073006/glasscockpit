import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, type KeyBinding, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { type App, Modal, Notice } from "obsidian";
import { CSS_PREFIX } from "../core/constants";
import { lineSeparatorOf } from "../core/file-links";
import type { LinkTarget } from "./file-links";
import { type LoadResult, loadFile, saveFile } from "./file-viewer-fs";

// Datei-Viewer (Abend 27): Fenster über Obsidian mit Rohtext-Editor (CodeMirror 6 aus Obsidian). Cmd+S speichert atomar,
// Esc oder X schließt. Geschrieben wird nur genau der geöffnete Pfad.

export interface FileViewerOptions {
  maxMb: number;
  home: string;
  /** Nach dem Schließen: Fokus zurück ins Terminal. */
  onClosed: () => void;
}

/**
 * Undo, Standard-Tasten und Tab-Einrückung aus @codemirror/commands, das Obsidian zur Laufzeit mitbringt (im Build extern,
 * aber nicht in node_modules). Fehlt es, bleibt der Editor ohne diese Tasten benutzbar.
 */
function commandExtensions(): Extension[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cmd = require("@codemirror/commands") as {
      history: () => Extension; defaultKeymap: readonly KeyBinding[]; historyKeymap: readonly KeyBinding[]; indentWithTab: KeyBinding;
    };
    return [cmd.history(), keymap.of([...cmd.defaultKeymap, ...cmd.historyKeymap, cmd.indentWithTab])];
  } catch {
    return [];
  }
}

/** Monospace und Farben aus dem Obsidian-Theme (eigene Klassen statt .cm-* im CSS: Präfix-Regel, fremde Plugins). */
const EDITOR_THEME = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--background-primary)", color: "var(--text-normal)", fontSize: "var(--font-text-size)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-monospace)", lineHeight: "1.5" },
  ".cm-gutters": { backgroundColor: "var(--background-secondary)", color: "var(--text-faint)", borderRight: "1px solid var(--background-modifier-border)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--background-modifier-hover)" },
  ".cm-activeLineGutter": { color: "var(--text-muted)" },
  ".cm-cursor": { borderLeftColor: "var(--text-normal)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--text-selection)" },
});

const shortPath = (path: string, home: string): string => (path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);
const mb = (bytes: number): string => (bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 });

/** Rückfrage mit eigenen Knöpfen; der erste ist der hervorgehobene. */
class ChoiceModal extends Modal {
  private readonly message: string;
  private readonly choices: Array<{ label: string; warning?: boolean; action: () => void }>;

  constructor(app: App, title: string, message: string, choices: Array<{ label: string; warning?: boolean; action: () => void }>) {
    super(app);
    this.setTitle(title);
    this.message = message;
    this.choices = choices;
  }

  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    this.choices.forEach((choice, i) => {
      const button = row.createEl("button", { text: choice.label, cls: choice.warning ? "mod-warning" : i === 0 ? "mod-cta" : "" });
      button.addEventListener("click", () => {
        this.close();
        choice.action();
      });
      if (i === 0) button.focus();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class FileViewerModal extends Modal {
  private readonly target: LinkTarget;
  private readonly options: FileViewerOptions;
  private view: EditorView | null = null;
  private mtimeMs = 0;
  private dirty = false;
  private saving = false;
  /** Läuft gerade eine Rückfrage? Dann kein zweites Fenster darüber (Esc kann mehrfach kommen). */
  private asking = false;
  private discard = false;

  constructor(app: App, target: LinkTarget, options: FileViewerOptions) {
    super(app);
    this.target = target;
    this.options = options;
  }

  onOpen(): void {
    this.modalEl.addClass(`${CSS_PREFIX}file-viewer`);
    this.titleEl.addClass(`${CSS_PREFIX}file-viewer-title`);
    this.contentEl.addClass(`${CSS_PREFIX}file-viewer-content`);
    this.updateTitle();
    // Cmd+S am Fenster; Esc und X rufen close() (unten), das bei ungespeicherten Änderungen erst fragt.
    this.scope.register(["Mod"], "s", () => {
      void this.save(false);
      return false;
    });
    void loadFile(this.target.path, this.options.maxMb).then((result) => this.render(result));
  }

  close(): void {
    if (this.asking) return;
    if (!this.dirty || this.discard) {
      super.close();
      return;
    }
    this.ask("Ungespeicherte Änderungen", "Die Datei hat ungespeicherte Änderungen.", [
      { label: "Speichern", action: () => void this.save(false).then((saved) => saved && this.close()) },
      { label: "Verwerfen", warning: true, action: () => { this.discard = true; this.close(); } },
      { label: "Weiter bearbeiten", action: () => this.view?.focus() },
    ]);
  }

  onClose(): void {
    this.view?.destroy();
    this.view = null;
    this.contentEl.empty();
    this.options.onClosed();
  }

  private render(result: LoadResult): void {
    // Schon wieder zu (schnelles Esc): nichts mehr aufbauen.
    if (!this.containerEl.isConnected) return;
    this.contentEl.empty();
    if (result.kind !== "text") {
      this.contentEl.createDiv({ cls: `${CSS_PREFIX}file-viewer-hint`, text: hintFor(result, this.options.maxMb) });
      return;
    }
    this.mtimeMs = result.mtimeMs;
    const host = this.contentEl.createDiv({ cls: `${CSS_PREFIX}file-viewer-editor` });
    this.view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: result.text,
        extensions: [
          EditorState.lineSeparator.of(lineSeparatorOf(result.text)),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          EDITOR_THEME,
          ...commandExtensions(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.dirty) {
              this.dirty = true;
              this.updateTitle();
            }
          }),
        ],
      }),
    });
    this.jump();
  }

  /** Cursor an :zeile[:spalte], mittig in den Blick; ohne Zeile an den Anfang. */
  private jump(): void {
    const view = this.view;
    if (!view) return;
    const doc = view.state.doc;
    const line = doc.line(Math.min(Math.max(this.target.line ?? 1, 1), doc.lines));
    const pos = line.from + Math.min(Math.max((this.target.col ?? 1) - 1, 0), line.length);
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    view.focus();
  }

  /** true, wenn gespeichert wurde. Bei fremder Änderung seit dem Öffnen erst Rückfrage, dann mit force. */
  private async save(force: boolean): Promise<boolean> {
    const view = this.view;
    if (!view || this.saving) return false;
    this.saving = true;
    try {
      // sliceDoc nimmt den Zeilentrenner der Datei (lineSeparator), toString immer \n.
      const result = await saveFile(this.target.path, view.state.sliceDoc(), this.mtimeMs, force);
      if (result.status === "changed") {
        this.ask("Datei wurde geändert", "Die Datei hat sich seit dem Öffnen geändert, etwa weil Claude sie bearbeitet hat. Deine Fassung überschreibt diese Änderung.", [
          { label: "Abbrechen", action: () => this.view?.focus() },
          { label: "Überschreiben", warning: true, action: () => void this.save(true) },
        ]);
        return false;
      }
      this.mtimeMs = result.mtimeMs;
      this.dirty = false;
      this.updateTitle();
      new Notice("Gespeichert");
      return true;
    } catch (e) {
      new Notice(`Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      this.saving = false;
    }
  }

  private ask(title: string, message: string, choices: Array<{ label: string; warning?: boolean; action: () => void }>): void {
    this.asking = true;
    const modal = new ChoiceModal(this.app, title, message, choices.map((c) => ({ ...c, action: () => { this.asking = false; c.action(); } })));
    const closeChoice = modal.onClose.bind(modal);
    // Mit Esc weggeklickt: keine Wahl, zurück in den Editor.
    modal.onClose = () => {
      closeChoice();
      if (this.asking) {
        this.asking = false;
        this.view?.focus();
      }
    };
    modal.open();
  }

  private updateTitle(): void {
    this.setTitle(`${this.dirty ? "● " : ""}${shortPath(this.target.path, this.options.home)}`);
  }
}

function hintFor(result: Exclude<LoadResult, { kind: "text" }>, maxMb: number): string {
  switch (result.kind) {
    case "tooLarge":
      return `Die Datei ist ${mb(result.size)} MB groß, die Höchstgröße liegt bei ${maxMb} MB (Einstellung „Datei-Viewer: Höchstgröße (MB)“).`;
    case "binary":
      return "Binärdatei, keine Anzeige.";
    case "notUtf8":
      return "Kein gültiges UTF-8, keine Anzeige: Speichern würde die Datei verändern.";
    case "error":
      return `Datei nicht lesbar: ${result.message}`;
  }
}
