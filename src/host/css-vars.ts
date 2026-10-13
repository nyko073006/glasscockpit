import { type ReadVar, rgbaToCss } from "../core/xterm-theme";
import type { PopoutWindow } from "./popout-window";

/** Berechneter Wert einer CSS-Variable am Element, im Fenster des Elements. Leer, wenn nicht gesetzt. */
export function readCssVar(el: HTMLElement, name: string): string {
  const win = el.ownerDocument.defaultView;
  if (!win) return "";
  return win.getComputedStyle(el).getPropertyValue(name).trim();
}

/** Nimmt der Canvas den Wert als Farbe an? Zwei Startwerte, falls der Wert selbst einer davon ist. */
function canvasAccepts(ctx: CanvasRenderingContext2D, value: string): boolean {
  for (const start of ["#000000", "#ffffff"]) {
    ctx.fillStyle = start;
    ctx.fillStyle = value;
    if (ctx.fillStyle !== start) return true;
  }
  return false;
}

/**
 * Liest Farbvariablen und rechnet sie in #rrggbb oder rgba() um.
 * Grund: Obsidian setzt etwa --text-selection als color-mix(…) mit Transparenz.
 * Den Wert nimmt der Farb-Parser von xterm 6 nicht an, er fiele still auf seinen Standard zurück.
 */
export function createCssColorReader(el: HTMLElement): ReadVar {
  const canvas = (el.ownerDocument.win as PopoutWindow).createFragment().createEl("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  return (name) => {
    const raw = readCssVar(el, name);
    if (raw === "" || !ctx || !canvasAccepts(ctx, raw)) return "";
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return rgbaToCss(r, g, b, a);
  };
}
