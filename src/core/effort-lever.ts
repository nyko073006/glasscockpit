import { EFFORT_STEPS } from "./constants";
import type { EffortStep } from "./effort";

/**
 * Effort-Schieber auf dem Bildschirm (Abend 19e, Teil A; Grundlage der Hebel aus 18b), reine Logik ohne DOM. Der Schieber läuft
 * senkrecht: oben `max`, unten `aus`. Eine Position ist der Anteil am Weg von oben, 0 (ganz oben, max) bis 1 (ganz unten, aus);
 * die sechs Stufen liegen gleichmäßig verteilt auf dem Weg, der Griff rastet beim Loslassen auf die nächste ein.
 */

const LAST = EFFORT_STEPS.length - 1;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Eine Stufe höher (`up`) oder niedriger; an den Enden bleibt es stehen. `EFFORT_STEPS` steigt von `aus` bis `max`. */
function stepBy(step: EffortStep, dir: "up" | "down"): EffortStep {
  const i = EFFORT_STEPS.indexOf(step) + (dir === "up" ? 1 : -1);
  return EFFORT_STEPS[Math.min(LAST, Math.max(0, i))];
}

/** Position einer Stufe am Weg: max = 0, aus = 1. */
export function stepPosition(step: EffortStep): number {
  return 1 - EFFORT_STEPS.indexOf(step) / LAST;
}

/**
 * Nächste Stufe zu einer Position; außerhalb des Wegs wird geklemmt. Genau zwischen zwei Stufen gewinnt die höhere.
 * `NaN` gibt es nicht als Zeigerhöhe (`pointerPosition` liefert dann null) und fällt hier auf `aus`.
 */
export function positionStep(pos: number): EffortStep {
  if (Number.isNaN(pos)) return EFFORT_STEPS[0];
  return EFFORT_STEPS[Math.round((1 - clamp01(pos)) * LAST)];
}

/** Position der Stufe, auf die `pos` einrastet. */
export function snapPosition(pos: number): number {
  return stepPosition(positionStep(pos));
}

/**
 * Zeigerhöhe in eine Position am Weg (`trackTop` und `trackHeight` in denselben Einheiten wie `clientY`). `grabOffset` ist
 * der Abstand zwischen Zeiger und Griffmitte beim Anfassen, damit der Griff nicht unter den Zeiger springt. Ohne nutzbaren
 * Weg (Höhe nicht größer als 0, nicht endlich) gibt es keine Position: Der Aufrufer ändert dann nichts.
 */
export function pointerPosition(clientY: number, trackTop: number, trackHeight: number, grabOffset = 0): number | null {
  if (![clientY, trackTop, trackHeight, grabOffset].every(Number.isFinite) || trackHeight <= 0) return null;
  return clamp01((clientY - grabOffset - trackTop) / trackHeight);
}

/** Die sechs Marken für die Beschriftung, von oben (max) nach unten (aus). */
export function leverMarks(): Array<{ step: EffortStep; position: number }> {
  return [...EFFORT_STEPS].reverse().map((step) => ({ step, position: stepPosition(step) }));
}

/** Zielstufe einer Taste am Schieber (Pfeile, Bild auf und ab, Pos1 = aus, Ende = max); null: Die Taste gehört dem Schieber nicht. */
export function leverKeyStep(step: EffortStep, key: string): EffortStep | null {
  switch (key) {
    case "ArrowUp": case "ArrowRight": case "PageUp": return stepBy(step, "up");
    case "ArrowDown": case "ArrowLeft": case "PageDown": return stepBy(step, "down");
    case "Home": return EFFORT_STEPS[0];
    case "End": return EFFORT_STEPS[LAST];
    default: return null;
  }
}

/** `aria-valuetext` des Schiebers: Name der Stufe und Platz im Weg („high, Stufe 4 von 6“). */
export function leverValueText(step: EffortStep): string {
  return `${step}, Stufe ${EFFORT_STEPS.indexOf(step) + 1} von ${EFFORT_STEPS.length}`;
}
