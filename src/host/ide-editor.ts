import { type App, MarkdownView } from "obsidian";
import { type IdeHandlers, type SelectionParams, type ToolResult, fileUrl, jsonResult, mentionLines, selectionParams, textResult } from "../core/ide-protocol";

// IDE-Brücke (Abend 16): Was Claude Code vom Editor sehen darf, aus der Obsidian-API. Gelesen wird immer frisch.
// Gemeint ist nur der Markdown-Editor im Quell- oder Live-Vorschau-Modus (`getMode() === "source"`); die Leseansicht hat keine Auswahl.

type Mention = { filePath: string; lineStart: number; lineEnd: number };

export class IdeEditor {
  private latest: SelectionParams | null = null;
  private lastKey = "";

  private readonly app: App;
  private readonly vaultBase: () => string | null;
  private readonly emit: (params: SelectionParams) => void;

  /** emit meldet eine geänderte Auswahl (selection_changed). */
  constructor(app: App, vaultBase: () => string | null, emit: (params: SelectionParams) => void) {
    this.app = app;
    this.vaultBase = vaultBase;
    this.emit = emit;
  }

  /** Auswahl der aktiven Markdown-Ansicht; null, wenn gerade keine aktiv ist (etwa das Terminal im Vordergrund). */
  current(): SelectionParams | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view ? this.selectionOf(view) : null;
  }

  latestSelection(): SelectionParams | null {
    return this.latest;
  }

  /** Auswahl prüfen und melden, wenn sie sich seit der letzten Meldung geändert hat. */
  check(): void {
    const selection = this.current();
    if (!selection) return;
    const key = JSON.stringify([selection.filePath, selection.selection, selection.text]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.latest = selection;
    this.emit(selection);
  }

  /** Ziel für „Auswahl erwähnen“: die aktive Auswahl, sonst die letzte bekannte. */
  mention(): Mention | null {
    const selection = this.current() ?? this.latest;
    return selection ? { filePath: selection.filePath, ...mentionLines(selection.selection) } : null;
  }

  handlers(): IdeHandlers {
    return {
      getCurrentSelection: () => selectionResult(this.current(), "No active editor found"),
      getLatestSelection: () => selectionResult(this.latest, "No selection available"),
      getOpenEditors: () => this.openEditors(),
      getWorkspaceFolders: () => this.workspaceFolders(),
      openFile: (file) => this.openFile(file.path),
      checkDocumentDirty: (file) => {
        const view = this.viewOf(file.path);
        // Obsidian speichert selbst nach kurzer Pause; einen „ungespeichert“-Zustand gibt es nicht.
        return view ? jsonResult({ success: true, filePath: file.absolute, isDirty: false, isUntitled: false }) : notOpen(file.absolute);
      },
      saveDocument: async (file) => {
        const view = this.viewOf(file.path);
        if (!view) return notOpen(file.absolute);
        await view.save();
        return jsonResult({ success: true, filePath: file.absolute, saved: true, message: "Document saved successfully" });
      },
    };
  }

  private selectionOf(view: MarkdownView): SelectionParams | null {
    const file = view.file;
    const base = this.vaultBase();
    if (!file || !base || view.getMode() !== "source") return null;
    const editor = view.editor;
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    return selectionParams({
      filePath: `${base.replace(/\/+$/, "")}/${file.path}`,
      text: editor.getSelection(),
      start: { line: from.line, character: from.ch },
      end: { line: to.line, character: to.ch },
    });
  }

  /** Alle geladenen Markdown-Ansichten (Hintergrund-Tabs sind noch DeferredView und fehlen hier). */
  private markdownViews(): MarkdownView[] {
    return this.app.workspace
      .getLeavesOfType("markdown")
      .map((leaf) => leaf.view)
      .filter((view): view is MarkdownView => view instanceof MarkdownView);
  }

  private viewOf(path: string): MarkdownView | undefined {
    return this.markdownViews().find((view) => view.file?.path === path);
  }

  private openEditors(): ToolResult {
    const base = this.vaultBase()?.replace(/\/+$/, "") ?? "";
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    const tabs = this.markdownViews()
      .filter((view) => view.file)
      .map((view) => ({
        uri: fileUrl(`${base}/${view.file?.path ?? ""}`),
        isActive: view === active,
        label: view.file?.name ?? "",
        languageId: "markdown",
        isDirty: false,
      }));
    return jsonResult({ tabs });
  }

  private workspaceFolders(): ToolResult {
    const base = this.vaultBase()?.replace(/\/+$/, "");
    if (!base) return jsonResult({ success: false, message: "Vault-Ordner unbekannt" });
    return jsonResult({ success: true, folders: [{ name: base.slice(base.lastIndexOf("/") + 1), uri: fileUrl(base), path: base }], rootPath: base });
  }

  /**
   * Notiz öffnen, ohne dem Terminal den Fokus zu nehmen: schon offen, dann nur nach vorn; sonst neuer Tab im Hintergrund,
   * dann nach vorn. (Nie das aktive Leaf ersetzen: Es könnte das Terminal sein.)
   */
  private async openFile(path: string): Promise<ToolResult> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) throw new Error(`Datei nicht im Vault: ${path}`);
    const leaf = this.viewOf(path)?.leaf ?? this.app.workspace.getLeaf("tab");
    if (leaf.view.getViewType() !== "markdown" || (leaf.view as MarkdownView).file?.path !== path) await leaf.openFile(file, { active: false });
    await this.app.workspace.revealLeaf(leaf);
    return textResult(`Opened file: ${path}`);
  }
}

function selectionResult(selection: SelectionParams | null, missing: string): ToolResult {
  if (!selection) return jsonResult({ success: false, message: missing });
  return jsonResult({ success: true, text: selection.text, filePath: selection.filePath, fileUrl: selection.fileUrl, selection: { start: selection.selection.start, end: selection.selection.end } });
}

const notOpen = (absolute: string): ToolResult => jsonResult({ success: false, message: `Document not open: ${absolute}` });
