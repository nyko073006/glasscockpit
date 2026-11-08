// Datei-Viewer lesbar (Nachtrag 41d): reine Rechnung für Lage, Größe und Zoom des Fensters, ohne DOM. Alle Maße in CSS-px;
// `view` ist der Sichtbereich (Breite und Höhe des Obsidian-Fensters), in dem das Fenster ganz liegen muss.

export type Rect = { left: number; top: number; width: number; height: number };
export type View = { width: number; height: number };
export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const MIN_WIDTH = 400;
export const MIN_HEIGHT = 300;

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Mindestmaß, aber nie größer als der Sichtbereich: ist das Fenster kleiner als das Mindestmaß, gilt das Fenster. */
const minWidth = (view: View): number => Math.min(MIN_WIDTH, view.width);
const minHeight = (view: View): number => Math.min(MIN_HEIGHT, view.height);

/** Startrahmen: Anteil des Sichtbereichs, mittig, auf ganze px gerundet, nicht unter dem Mindestmaß und nicht über dem Sichtbereich. */
export function startRect(view: View, widthPct: number, heightPct: number): Rect {
  const width = clamp(Math.round((view.width * widthPct) / 100), minWidth(view), view.width);
  const height = clamp(Math.round((view.height * heightPct) / 100), minHeight(view), view.height);
  return { left: Math.round((view.width - width) / 2), top: Math.round((view.height - height) / 2), width, height };
}

/** Größe auf [Mindestmaß, Sichtbereich] begrenzen, dann die Lage so schieben, dass das Fenster ganz im Sichtbereich liegt. */
export function clampRect(rect: Rect, view: View): Rect {
  const width = clamp(rect.width, minWidth(view), view.width);
  const height = clamp(rect.height, minHeight(view), view.height);
  return {
    left: clamp(rect.left, 0, view.width - width),
    top: clamp(rect.top, 0, view.height - height),
    width,
    height,
  };
}

/** Verschieben um dx, dy gegenüber dem Rahmen beim Anfassen; am Rand des Sichtbereichs ist Schluss. */
export function moveRect(start: Rect, dx: number, dy: number, view: View): Rect {
  return clampRect({ ...start, left: start.left + dx, top: start.top + dy }, view);
}

/**
 * Größe ändern an einer Kante oder Ecke. Die gegenüberliegende Kante bleibt stehen, auch wenn die gezogene Kante das Mindestmaß
 * erreicht (das Fenster wandert dann nicht mit) oder den Rand des Sichtbereichs.
 */
export function resizeRect(start: Rect, edge: Edge, dx: number, dy: number, view: View): Rect {
  const s = clampRect(start, view);
  let left = s.left;
  let top = s.top;
  let right = s.left + s.width;
  let bottom = s.top + s.height;
  if (edge.includes("e")) right = clamp(right + dx, left + minWidth(view), view.width);
  if (edge.includes("w")) left = clamp(left + dx, 0, right - minWidth(view));
  if (edge.includes("s")) bottom = clamp(bottom + dy, top + minHeight(view), view.height);
  if (edge.includes("n")) top = clamp(top + dy, 0, bottom - minHeight(view));
  return clampRect({ left, top, width: right - left, height: bottom - top }, view);
}

/** Ein Zoomschritt auf das Raster von 10 (115 → 120 bzw. 110), geklemmt auf [ZOOM_MIN, ZOOM_MAX]. */
export function zoomStep(pct: number, dir: 1 | -1): number {
  const next = dir === 1 ? Math.floor(pct / ZOOM_STEP) * ZOOM_STEP + ZOOM_STEP : Math.ceil(pct / ZOOM_STEP) * ZOOM_STEP - ZOOM_STEP;
  return clamp(next, ZOOM_MIN, ZOOM_MAX);
}

/** Schrift in px bei Zoom pct (Prozent der Grundschrift), auf 0,5 px gerundet. */
export function fontPx(basePx: number, pct: number): number {
  return Math.round((basePx * pct) / 100 * 2) / 2;
}

/** Pixel Mausrad-Weg je Zoomschritt (deltaMode 0): Trackpad-Pinch und Trägheit liefern viele kleine Ereignisse, ein Ereignis soll nicht einen Schritt kosten. */
export const WHEEL_PX_PER_STEP = 50;
/** Nach so vielen ms ohne Rad-Ereignis beginnt die Summe wieder bei 0. */
export const WHEEL_RESET_MS = 300;

/**
 * Mausrad in Zoomschritte. `acc` ist der aufsummierte deltaY-Rest (Pixelmodus), `steps` die fälligen Schritte mit dem Vorzeichen der
 * Zoomrichtung (positiv = größer, Rad nach oben = deltaY < 0). Pixelmodus: je volle WHEEL_PX_PER_STEP ein Schritt, der Rest bleibt
 * in `acc`, ein Richtungswechsel verwirft die alte Summe. Zeilen- und Seitenmodus (deltaMode 1, 2): ein Schritt je Ereignis.
 * Das Zurücksetzen nach WHEEL_RESET_MS Stille macht der Aufrufer (Zeitstempel), hier gibt es keine Uhr.
 */
export function wheelSteps(acc: number, deltaY: number, deltaMode: number): { steps: number; acc: number } {
  if (deltaY === 0) return { steps: 0, acc };
  if (deltaMode !== 0) return { steps: deltaY < 0 ? 1 : -1, acc: 0 };
  const base = acc !== 0 && Math.sign(acc) !== Math.sign(deltaY) ? 0 : acc;
  const sum = base + deltaY;
  const whole = Math.trunc(sum / WHEEL_PX_PER_STEP);
  return { steps: 0 - whole, acc: sum - whole * WHEEL_PX_PER_STEP };
}

/** Zoomleiter für Bilder in Prozent der natürlichen Größe (Nachtrag 43c). */
export const IMAGE_ZOOM_STEPS = [10, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400, 800] as const;

/** Zoom in Prozent, bei dem das Bild ganz in den Kasten passt, höchstens 100, mindestens 1. Natürliche Seite 0: 100. */
export function fitPct(natural: View, box: View): number {
  if (natural.width <= 0 || natural.height <= 0) return 100;
  const pct = Math.floor(Math.min(box.width / natural.width, box.height / natural.height) * 100);
  return Math.max(1, Math.min(100, pct));
}

/** Nächster Leiterwert echt über (dir 1) bzw. unter (dir -1) `pct`; am Rand bleibt es dort (über 800: 800, unter 10: pct). */
export function imageZoomStep(pct: number, dir: 1 | -1): number {
  if (dir === 1) return IMAGE_ZOOM_STEPS.find((s) => s > pct) ?? IMAGE_ZOOM_STEPS[IMAGE_ZOOM_STEPS.length - 1];
  return [...IMAGE_ZOOM_STEPS].reverse().find((s) => s < pct) ?? pct;
}

/** Bildmaß bei `pct` Prozent, je Seite gerundet und mindestens 1. */
export function imageSize(natural: View, pct: number): View {
  return { width: Math.max(1, Math.round((natural.width * pct) / 100)), height: Math.max(1, Math.round((natural.height * pct) / 100)) };
}
