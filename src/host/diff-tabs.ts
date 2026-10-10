import type { App, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_DIFF } from "../core/constants";
import type { DiffRequest } from "../core/diff-sessions";

// Diff-Ansicht (Abend 17): Tabs der Diffs im Workspace. Ein Tab je (Verbindung, tab_name): ein neuer Diff mit gleichem Schlüssel
// ersetzt den Inhalt im vorhandenen Tab. Neue Tabs öffnen im Hintergrund (active: false, kein Fokuswechsel, kein revealLeaf):
// Der Fokus bleibt beim Terminal, die Markierung der Sitzung weist auf den wartenden Diff hin.
// Der Zustand eines Tabs ist { id, tab, client }. Gelesen wird er nur über getViewState: Hintergrund-Tabs sind nach dem Laden
// noch DeferredView, `leaf.view` taugt dafür nicht.

export class DiffTabs {
  private readonly leaves = new Map<string, WorkspaceLeaf>();
  private readonly app: App;
  /** Der Tab schlägt fehl: Der Diff gilt als abgelehnt, damit Claude nicht wartet. */
  private readonly failed: (id: string) => void;

  constructor(app: App, failed: (id: string) => void) {
    this.app = app;
    this.failed = failed;
  }

  show(req: DiffRequest, id: string): void {
    const leaf = this.existing(req) ?? this.app.workspace.getLeaf("tab");
    for (const [old, l] of this.leaves) if (l === leaf) this.leaves.delete(old); // ersetzte Anfrage: nur die neue id zählt
    this.leaves.set(id, leaf);
    leaf.setViewState({ type: VIEW_TYPE_DIFF, state: { id, tab: req.tabName, client: req.clientId }, active: false }).catch((fehler: unknown) => {
      console.warn("Glasscockpit, Diff-Ansicht: Tab nicht geöffnet", fehler);
      // Kein halb gerenderter Tab stehen lassen.
      this.hide(id);
      this.failed(id);
    });
  }

  /** Der Nutzer hat den Tab geschlossen. */
  forget(id: string): void {
    this.leaves.delete(id);
  }

  hide(id: string): void {
    const leaf = this.leaves.get(id);
    this.leaves.delete(id);
    leaf?.detach();
  }

  /** Offener Tab zu diesem (Verbindung, tab_name), auch ein zurückgestellter. */
  private existing(req: DiffRequest): WorkspaceLeaf | null {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DIFF)) {
      const state = leaf.getViewState().state as { tab?: unknown; client?: unknown } | undefined;
      if (state?.tab === req.tabName && state.client === req.clientId) return leaf;
    }
    return null;
  }
}
