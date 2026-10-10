/**
 * Obsidians eigene Statusleiste: direktes Kind von .app-container (Obsidian 1.13.7). Ein nackter ".status-bar" trifft
 * auch fremde Elemente, Agentic OS hat eins in seiner View, und querySelector nimmt das erste.
 */
export const OBSIDIAN_STATUS_BAR = ".app-container > .status-bar";

export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * Wie viele Pixel von unten die Leiste in die Pane ragt (Obsidians Statusleiste schwebt unten rechts darüber).
 * 0 ohne Überdeckung, bei Leiste ohne Fläche (ausgeblendet) und bei Leiste neben der Pane.
 */
export function bottomOverlap(pane: Rect, bar: Rect): number {
  const all = [pane.left, pane.top, pane.right, pane.bottom, bar.left, bar.top, bar.right, bar.bottom];
  if (!all.every(Number.isFinite)) return 0;
  if (bar.right <= bar.left || bar.bottom <= bar.top) return 0;
  if (bar.right <= pane.left || bar.left >= pane.right) return 0;
  if (bar.bottom <= pane.top || bar.top >= pane.bottom) return 0;
  return pane.bottom - Math.max(bar.top, pane.top);
}
