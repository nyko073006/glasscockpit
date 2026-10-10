export interface Dimensions {
  cols: number;
  rows: number;
}

export interface Box {
  width: number;
  height: number;
}

function isPositiveCount(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * fit-Wächter: Gibt die Maße zurück, wenn sie taugen, sonst null.
 * Versteckte Tabs messen 0 px. FitAddon 0.11.0 liefert dann NaN (Breite „auto“)
 * oder hebt auf das Minimum 2×1 an. Darum zählt auch die Größe des Containers.
 */
export function usableDimensions(proposed: Dimensions | undefined, box: Box): Dimensions | null {
  if (!proposed) return null;
  if (!(box.width > 0 && box.height > 0)) return null;
  if (!isPositiveCount(proposed.cols) || !isPositiveCount(proposed.rows)) return null;
  return { cols: proposed.cols, rows: proposed.rows };
}
