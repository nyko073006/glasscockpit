import { type App, FileView, MarkdownView, type TFile, type WorkspaceLeaf } from "obsidian";

// Vault-Datei als Tab öffnen, gemeinsam für die IDE-Brücke (openFile, Abend 16) und Pfad-Links im Terminal (Abend 27).

/** Zeile und Spalte ab 1; Spalte null heißt Zeilenanfang. */
export interface VaultPos { line: number; col: number | null }

/** Was zur Laufzeit am App-Objekt hängt, aber nicht in obsidian.d.ts steht. */
type AppInternals = App & { viewRegistry?: { isExtensionRegistered?: (ext: string) => boolean } };

/** Kann Obsidian die Datei als Tab zeigen? Ohne die (interne) Registry nur Markdown. */
export function opensAsTab(app: App, file: TFile): boolean {
  const registered = (app as AppInternals).viewRegistry?.isExtensionRegistered?.(file.extension);
  return registered ?? file.extension === "md";
}

/**
 * Datei öffnen, ohne dem Terminal den Fokus zu nehmen: schon offen, dann nur nach vorn; sonst neuer Tab im Hintergrund,
 * dann nach vorn (nie das aktive Leaf ersetzen: Es könnte das Terminal sein). Mit pos springt der Editor an die Zeile.
 * null, wenn die Datei nicht im Vault liegt oder Obsidian sie nicht als Tab zeigen kann.
 */
export async function openVaultFile(app: App, path: string, pos: VaultPos | null = null): Promise<WorkspaceLeaf | null> {
  const file = app.vault.getFileByPath(path);
  if (!file || !opensAsTab(app, file)) return null;
  const open = app.workspace.getLeavesOfType(viewTypeOf(app, file)).find((leaf) => leaf.view instanceof FileView && leaf.view.file?.path === path);
  const leaf = open ?? app.workspace.getLeaf("tab");
  if (!open) await leaf.openFile(file, { active: false, eState: pos ? { line: pos.line - 1 } : undefined });
  await app.workspace.revealLeaf(leaf);
  if (pos) jumpTo(leaf, pos);
  return leaf;
}

/** View-Typ für die Endung (Markdown, falls die Registry fehlt). */
function viewTypeOf(app: App, file: TFile): string {
  const registry = (app as App & { viewRegistry?: { getTypeByExtension?: (ext: string) => string | undefined } }).viewRegistry;
  return registry?.getTypeByExtension?.(file.extension) ?? "markdown";
}

/** Cursor an Zeile/Spalte im Bearbeitungsmodus, sonst (Leseansicht) nur dorthin scrollen. */
function jumpTo(leaf: WorkspaceLeaf, pos: VaultPos): void {
  const view = leaf.view;
  if (!(view instanceof MarkdownView)) return;
  if (view.getMode() === "source") {
    const line = Math.min(Math.max(pos.line - 1, 0), view.editor.lastLine());
    const ch = Math.max((pos.col ?? 1) - 1, 0);
    view.editor.setCursor({ line, ch });
    view.editor.scrollIntoView({ from: { line, ch }, to: { line, ch } }, true);
  } else view.setEphemeralState({ line: pos.line - 1 });
}
