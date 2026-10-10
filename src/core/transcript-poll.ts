// Entscheidungen rund ums Transkript-Polling und die Codeblock-Leiste. Reine Logik, Dateizugriff liegt in src/host.

import { CODE_LABEL_MAX, CODE_TOOLTIP_LINES, CODE_TOOLTIP_LINE_LEN, HANDOFF_BUTTON_LABEL } from "./constants";
import { type CodeBlock, codeBlockLabel } from "./transcript-code";

export interface FileStamp {
  size: number;
  mtimeMs: number;
}

/** Neu lesen? Ja beim ersten Mal und wenn Größe oder mtime abweichen. */
export function statChanged(prev: FileStamp | null, next: FileStamp): boolean {
  return prev === null || prev.size !== next.size || prev.mtimeMs !== next.mtimeMs;
}

/** Ab diesem Byte lesen: höchstens tailBytes vom Ende. */
export function tailStart(size: number, tailBytes: number): number {
  return Math.max(0, size - tailBytes);
}

/** Darf die Ordnerliste wieder gelesen werden? Beim ersten Mal ja, sonst nach minMs. */
export function mayRescan(lastAt: number | null, now: number, minMs: number): boolean {
  return lastAt === null || now - lastAt >= minMs;
}

/** Tooltip: die ersten maxLines Zeilen des Blocks, lange Zeilen gekürzt, „…“ wenn mehr folgt. */
export function codeTooltip(code: string, maxLines: number, maxLineLen: number): string {
  const zeilen = code.split("\n");
  const kurz = zeilen
    .slice(0, maxLines)
    .map((z) => (z.length > maxLineLen ? z.slice(0, Math.max(0, maxLineLen - 1)) + "…" : z));
  if (zeilen.length > maxLines) kurz.push("…");
  return kurz.join("\n");
}

/** Ein Knopf der Leiste. */
export interface BarItem {
  kind: "handoff" | "block";
  label: string;
  /** Der Anfang des Blocks (codeTooltip). */
  tooltip: string;
  /** Der Block, dessen Text der Knopf kopiert. */
  block: CodeBlock;
  /** Steht für den letzten Block der letzten Antwort (Akzentfarbe). */
  last: boolean;
}

/**
 * Knöpfe der Leiste: vorn der feste Handoff-Knopf (nur wenn es einen Handoff gibt), danach ein Knopf je Block der letzten
 * Antwort. Ein Block mit genau dem Text des Handoffs bekommt keinen eigenen Knopf, der feste kopiert denselben Text.
 * Die Akzentfarbe (last) gehört dem Knopf, der für den letzten Block der Antwort steht.
 */
export function barItems(blocks: readonly CodeBlock[], handoff: string | null): BarItem[] {
  const items: BarItem[] = [];
  const letzter = blocks.length - 1;
  if (handoff !== null) {
    items.push({
      kind: "handoff",
      label: HANDOFF_BUTTON_LABEL,
      tooltip: codeTooltip(handoff, CODE_TOOLTIP_LINES, CODE_TOOLTIP_LINE_LEN),
      block: { lang: "", code: handoff },
      last: letzter >= 0 && blocks[letzter].code === handoff,
    });
  }
  blocks.forEach((block, i) => {
    if (handoff !== null && block.code === handoff) return;
    items.push({
      kind: "block",
      label: codeBlockLabel(block, CODE_LABEL_MAX),
      tooltip: codeTooltip(block.code, CODE_TOOLTIP_LINES, CODE_TOOLTIP_LINE_LEN),
      block,
      last: i === letzter,
    });
  });
  return items;
}

/**
 * Letzter Handoff-Block je Cockpit-Sitzung, im Speicher. Der Schlüssel ist die Cockpit-id, nicht die Claude-ID: Ein
 * Sitzungswechsel (/clear, /resume, /branch) ändert nur die Claude-ID, der Knopf soll stehen bleiben.
 */
export class HandoffKeeper {
  private readonly blocks = new Map<string, string>();

  /** Der gemerkte Block; null, wenn es noch nie einen gab. */
  get(sessionId: string): string | null {
    return this.blocks.get(sessionId) ?? null;
  }

  /**
   * found kommt aus lastHandoffBlock auf dem frisch gelesenen Transkript: Ein Block ersetzt den alten, null (das neue
   * Transkript hat keinen) lässt ihn stehen. Gibt den danach geltenden Wert zurück.
   */
  keep(sessionId: string, found: string | null): string | null {
    if (found !== null) this.blocks.set(sessionId, found);
    return this.get(sessionId);
  }
}
