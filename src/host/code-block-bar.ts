import { Notice } from "obsidian";
import { CSS_PREFIX } from "../core/constants";
import type { CodeBlock } from "../core/transcript-code";
import { barItems } from "../core/transcript-poll";
import { writeClipboard } from "./clipboard";

/** Kopiert den Quelltext eines Blocks exakt und meldet kurz Erfolg oder Fehler. */
export async function copyCodeBlock(win: Window, block: CodeBlock): Promise<void> {
  try {
    await writeClipboard(win, block.code);
    new Notice("Codeblock kopiert");
  } catch (fehler) {
    console.error("Glasscockpit: Zwischenablage nicht beschrieben", fehler);
    new Notice("Glasscockpit: Zwischenablage nicht beschrieben", 10000);
  }
}

/**
 * Streifen über der Pane (flex-Spalte der View, über dem Terminal): vorn der feste Knopf „Handoff kopieren“, wenn die
 * Sitzung einen Handoff-Block hat, danach ein Knopf je Codeblock der letzten Antwort. Ohne Knöpfe versteckt.
 */
export class CodeBlockBar {
  private readonly el: HTMLElement;
  private blocks: CodeBlock[] = [];
  private readonly win: () => Window;

  /** win: immer frisch vom Container, damit die Leiste im Pop-out das richtige Fenster nimmt. */
  constructor(parent: HTMLElement, win: () => Window) {
    this.win = win;
    this.el = parent.createDiv({ cls: `${CSS_PREFIX}code-bar` });
    this.el.hide();
  }

  /**
   * blocks: Codeblöcke der letzten Antwort. handoff: Handoff-Block der Cockpit-Sitzung; steht fest vorn und ersetzt den
   * Knopf eines Blocks der Antwort mit demselben Text (Auswahl und Reihenfolge in barItems).
   */
  set(blocks: CodeBlock[], handoff: string | null = null): void {
    this.blocks = blocks;
    this.el.empty();
    const items = barItems(blocks, handoff);
    if (items.length === 0) {
      this.el.hide();
      return;
    }
    for (const item of items) {
      const cls = [`${CSS_PREFIX}code-button`];
      if (item.kind === "handoff") cls.push(`${CSS_PREFIX}code-button-handoff`);
      if (item.last) cls.push(`${CSS_PREFIX}code-button-last`);
      // Je Element nur ein Tooltip, und zwar Obsidians (aria-label): Ein title daneben ergäbe zwei übereinander, und der
      // native title erscheint in Obsidian nicht verlässlich (101ba13, 01d67bd).
      const button = this.el.createEl("button", { cls: cls.join(" "), text: item.label, attr: { "aria-label": item.tooltip } });
      button.addEventListener("click", () => void copyCodeBlock(this.win(), item.block));
    }
    this.el.show();
  }

  clear(): void {
    this.set([]);
  }

  remove(): void {
    this.blocks = [];
    this.el.remove();
  }
}
