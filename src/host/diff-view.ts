import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { buildDiffView, diffTabTitle, displayPath, hunkHeader } from "../core/diff-view-model";
import type { DiffRequest } from "../core/diff-sessions";
import { CSS_PREFIX, VIEW_TYPE_DIFF } from "../core/constants";
import type { Decision } from "../core/ide-diff";

// Diff-Ansicht (Abend 17): ein Tab je Diff mit Kopf (Pfad, Zusammenfassung, Annehmen/Ablehnen) und farbigem, zeilenweisem
// Diff. Alle Rechnung liegt in core (line-diff, diff-view-model); hier nur DOM. Die Ansicht schreibt nie eine Datei.

export interface DiffViewDeps {
  /** Offene Anfrage zur Tab-id; null, wenn der Diff schon beendet ist (etwa ein nach dem Neustart wiederhergestellter Tab). */
  lookup: (id: string) => DiffRequest | null;
  decide: (id: string, decision: Decision) => void;
  /** Der Tab wurde geschlossen (auch durch uns nach einer Entscheidung: dann ist die id schon veraltet und es passiert nichts). */
  closed: (id: string) => void;
  vaultBase: () => string | null;
}

const c = (name: string): string => `${CSS_PREFIX}${name}`;

export class DiffView extends ItemView {
  private id: string | null = null;
  private req: DiffRequest | null = null;
  private readonly deps: DiffViewDeps;

  constructor(leaf: WorkspaceLeaf, deps: DiffViewDeps) {
    super(leaf);
    this.deps = deps;
    this.navigation = false;
  }

  getViewType(): string {
    return VIEW_TYPE_DIFF;
  }

  getDisplayText(): string {
    return this.req ? diffTabTitle(this.req.newFilePath) : "Diff";
  }

  getIcon(): string {
    return "git-compare";
  }

  getState(): Record<string, unknown> {
    return { id: this.id, tab: this.req?.tabName, client: this.req?.clientId };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const id = typeof (state as { id?: unknown } | null)?.id === "string" ? (state as { id: string }).id : null;
    this.id = id;
    this.req = id === null ? null : this.deps.lookup(id);
    // Tab-Titel neu lesen; updateHeader ist nicht in der öffentlichen obsidian.d.ts, die Methode gibt es seit Jahren.
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
    if (this.req && id !== null) {
      this.render(this.req, id);
    } else {
      // Tab aus einer früheren Sitzung: Der Diff, auf den Claude wartete, gibt es nicht mehr.
      this.contentEl.empty();
      this.contentEl.createDiv({ cls: c("diff-gone"), text: "Dieser Diff ist nicht mehr offen." });
      window.setTimeout(() => this.leaf.detach(), 0);
    }
  }

  async onClose(): Promise<void> {
    // Schließen ohne Entscheidung heißt Ablehnen; nach einer Entscheidung ist die id schon veraltet.
    if (this.id !== null) this.deps.closed(this.id);
  }

  private render(req: DiffRequest, id: string): void {
    const root = this.contentEl;
    root.empty();
    root.addClass(c("diff"));
    const model = buildDiffView(req.oldContents, req.newFileContents);

    const head = root.createDiv({ cls: c("diff-head") });
    head.createDiv({ cls: c("diff-path"), text: displayPath(req.newFilePath, this.deps.vaultBase()) });
    head.createDiv({ cls: c("diff-summary"), text: model.summary });
    const buttons = head.createDiv({ cls: c("diff-buttons") });
    buttons.createEl("button", { text: "Ablehnen", cls: c("diff-reject") }).addEventListener("click", () => this.deps.decide(id, "rejected"));
    buttons.createEl("button", { text: "Annehmen", cls: `mod-cta ${c("diff-accept")}` }).addEventListener("click", () => this.deps.decide(id, "accepted"));
    if (req.oldFilePath !== req.newFilePath) head.createDiv({ cls: c("diff-notes"), text: `Alte Fassung aus ${displayPath(req.oldFilePath, this.deps.vaultBase())}` });
    for (const note of model.notes) head.createDiv({ cls: c("diff-notes"), text: note });

    const body = root.createDiv({ cls: c("diff-body") });
    if (model.hunks.length === 0) body.createDiv({ cls: c("diff-empty"), text: model.summary });
    for (const hunk of model.hunks) {
      body.createDiv({ cls: c("diff-hunk"), text: hunkHeader(hunk) });
      for (const line of hunk.lines) {
        const row = body.createDiv({ cls: `${c("diff-row")} ${c(`diff-${line.op}`)}` });
        row.createSpan({ cls: c("diff-no"), text: line.oldNo === null ? "" : String(line.oldNo) });
        row.createSpan({ cls: c("diff-no"), text: line.newNo === null ? "" : String(line.newNo) });
        row.createSpan({ cls: c("diff-sign"), text: line.op === "add" ? "+" : line.op === "del" ? "−" : " " });
        row.createSpan({ cls: c("diff-text"), text: line.text });
        if (line.noEol) body.createDiv({ cls: `${c("diff-row")} ${c("diff-noeol")}`, text: "\\ Kein Zeilenumbruch am Dateiende" });
      }
    }
  }
}
