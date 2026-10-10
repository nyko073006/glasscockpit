import { homedir } from "node:os";
import type { ItemView } from "obsidian";
import { USAGE_SNAPSHOT_FILE } from "../core/constants";
import { Observable } from "../core/observable";
import { expandHome } from "../core/settings";
import { parseUsageSnapshot, type TokenCounter, type UsageSnapshot, usageView } from "../core/usage";
import { readSnapshotFile, type SnapshotRead } from "./usage-fs";

export interface UsageCardDeps {
  /** Der Zähler gehört dem Plugin; die Karte zeigt nur seinen Stand. */
  counter: TokenCounter;
}

export const NO_SNAPSHOT_TEXT = "Noch kein Stand. Die Statuszeile schreibt ihn nach der ersten Antwort.";

const de = (n: number) => n.toLocaleString("de-DE");

/**
 * Karte „Usage“: Limits aus dem Schnappschuss der Statuszeile, Output-Tokens von heute vom Zähler des Plugins.
 * Die Karte rechnet und taktet nicht selbst: Sie meldet sich beim Zähler an, liest bei jeder Meldung den
 * Schnappschuss neu und stößt beim Öffnen einen Lauf an (der Zähler entscheidet, ob der letzte alt genug ist).
 * Kein Kindprozess, kein Netz, nur node:fs/promises.
 * `data` ist der gelesene Schnappschuss (null: kein lesbarer Stand); die Instrumente der Cockpit-Ansicht lesen ihn von hier.
 */
export class UsageCard {
  readonly data = new Observable<UsageSnapshot | null>(null);
  private readonly el: HTMLElement;
  private readonly deps: UsageCardDeps;
  private readonly snapshotPath: string;
  private snapshot: SnapshotRead | null = null;
  private unsubscribe: (() => void) | null = null;
  private generation = 0;

  constructor(_owner: ItemView, el: HTMLElement, deps: UsageCardDeps) {
    this.el = el;
    this.deps = deps;
    this.snapshotPath = expandHome(USAGE_SNAPSHOT_FILE, homedir());
  }

  start(): void {
    this.render();
    this.unsubscribe = this.deps.counter.subscribe(() => void this.refresh());
    void this.refresh();
    void this.deps.counter.requestRun();
  }

  stop(): void {
    this.generation++;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async refresh(): Promise<void> {
    const gen = this.generation;
    const snapshot = await readSnapshotFile(this.snapshotPath);
    if (gen !== this.generation) return;
    this.snapshot = snapshot;
    this.data.set(snapshot.kind === "ok" ? parseUsageSnapshot(snapshot.text) : null);
    this.render();
  }

  private render(): void {
    const el = this.el;
    el.empty();
    const head = el.createDiv({ cls: "cockpit-card-head cockpit-usage-head" });
    head.createSpan({ text: "Usage", cls: "cockpit-card-title" });
    const date = head.createSpan({ cls: "cockpit-card-date" });
    const body = el.createDiv({ cls: "cockpit-card-body cockpit-usage" });

    const snap = this.snapshot;
    if (snap === null) {
      body.createDiv({ text: "Wird gelesen ...", cls: "cockpit-hint" });
    } else if (snap.kind === "missing") {
      body.createDiv({ text: NO_SNAPSHOT_TEXT, cls: "cockpit-hint" });
    } else if (snap.kind === "error") {
      body.createDiv({ text: `Schnappschuss nicht lesbar: ${snap.message}`, cls: "cockpit-hint cockpit-usage-error" });
    } else {
      const parsed = parseUsageSnapshot(snap.text);
      if (parsed === null) {
        body.createDiv({ text: "Schnappschuss nicht lesbar: kein gültiges JSON", cls: "cockpit-hint cockpit-usage-error" });
      } else {
        const view = usageView(parsed, Date.now());
        date.setText(`Stand ${view.ageText}`);
        if (view.rows.length === 0) body.createDiv({ text: "Keine Limits im Schnappschuss.", cls: "cockpit-hint" });
        for (const row of view.rows) {
          const line = body.createDiv({ cls: "cockpit-usage-row" });
          line.createSpan({ text: row.label, cls: "cockpit-usage-label" });
          const bar = line.createDiv({ cls: "cockpit-usage-bar" });
          const fill = bar.createDiv({ cls: "cockpit-usage-fill" });
          fill.style.width = `${row.percent ?? 0}%`;
          fill.toggleClass("cockpit-usage-high", (row.percent ?? 0) >= 90);
          line.createSpan({ text: row.text, cls: row.expired ? "cockpit-usage-text cockpit-hint" : "cockpit-usage-text" });
        }
      }
    }

    const t = this.deps.counter.state();
    const tokenLine = body.createDiv({ cls: "cockpit-usage-tokens" });
    if (t.kind === "loading") tokenLine.setText("Output-Tokens heute: werden gelesen ...");
    else if (t.kind === "error") tokenLine.setText(`Output-Tokens heute: Transkripte nicht lesbar (${t.message})`);
    else {
      tokenLine.setText(`Output-Tokens heute: ${de(t.count.tokens)}`);
      body.createDiv({ text: `Übersprungene Zeilen: ${de(t.count.skipped)} von ${de(t.count.lines)}`, cls: "cockpit-hint cockpit-usage-skipped" });
    }
  }
}
