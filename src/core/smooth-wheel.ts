// Weich scrollen (Nachtrag 43f): Zähler für Mausrad und Trackpad. xterm schickt im Maus-Modus je Ereignis eine Zeile; hier wird der
// Weg des Rads in Zeilen gesammelt und je Bild als SGR-Meldungen an Claude Code gesendet (Host: src/host/smooth-wheel.ts).
import { WHEEL_NOTCH_MIN_PX, WHEEL_NOTCH_PAUSE_MS } from "./constants";

export interface WheelTuning { speed: number; maxPerFrame: number }
export interface WheelSample { deltaY: number; deltaMode: number; timeStamp: number }

export class SmoothWheel {
  /** Zeilenstand, negativ = hoch. */
  private pending = 0;
  private last = Number.NEGATIVE_INFINITY;

  /** Zählt ein Ereignis; wahr, wenn mindestens eine ganze Zeile ansteht. */
  add(ev: WheelSample, cellHeight: number, rows: number, tuning: WheelTuning): boolean {
    let lines: number;
    if (ev.deltaMode === 1) lines = ev.deltaY * tuning.speed;
    else if (ev.deltaMode === 2) lines = ev.deltaY * rows * tuning.speed;
    else {
      if (!(cellHeight > 0)) return false;
      lines = (ev.deltaY / cellHeight) * tuning.speed;
    }
    if (!Number.isFinite(lines)) return false;

    const pause = ev.timeStamp - this.last;
    this.last = ev.timeStamp;
    const notch = pause >= WHEEL_NOTCH_PAUSE_MS;
    if (notch) this.pending = 0;
    if (this.pending !== 0 && lines !== 0 && Math.sign(this.pending) !== Math.sign(lines)) this.pending = 0;
    if (notch && (ev.deltaMode !== 0 || Math.abs(ev.deltaY) >= WHEEL_NOTCH_MIN_PX) && lines !== 0 && Math.abs(lines) < 1) {
      lines = Math.sign(lines);
    }
    this.pending += lines;
    return Math.abs(this.pending) >= 1;
  }

  /** Ganze Zeilen für ein Bild, auf ±max begrenzt; der Bruchteil bleibt, das Übermaß verfällt. */
  take(maxPerFrame: number): number {
    const whole = Math.trunc(this.pending);
    this.pending -= whole;
    const n = Math.max(-maxPerFrame, Math.min(maxPerFrame, whole));
    return n === 0 ? 0 : n;
  }

  due(): boolean {
    return Math.abs(this.pending) >= 1;
  }

  /** Verwirft den Zeilenstand; der Zeitstempel des letzten Ereignisses bleibt. */
  reset(): void {
    this.pending = 0;
  }
}

/** SGR-Wheel-Meldungen für `lines` Zeilen (negativ = hoch, 64; positiv = runter, 65) an Zelle col/row (ab 1). */
export function wheelSequence(lines: number, col: number, row: number): string {
  if (lines === 0) return "";
  return `\x1b[<${lines < 0 ? 64 : 65};${col};${row}M`.repeat(Math.abs(lines));
}

/** Zelle unter der Maus, ab 1 und in das Raster geklemmt. */
export function cellAt(
  x: number, y: number, rect: { left: number; top: number; width: number; height: number }, cols: number, rows: number,
): { col: number; row: number } {
  const col = Math.floor(((x - rect.left) / rect.width) * cols) + 1;
  const row = Math.floor(((y - rect.top) / rect.height) * rows) + 1;
  return { col: Math.max(1, Math.min(cols, col)), row: Math.max(1, Math.min(rows, row)) };
}

export interface WheelGate {
  enabled: boolean; tracking: boolean; sgr: boolean; deltaY: number; cellHeight: number;
  shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean;
}

/** Übernimmt das Cockpit das Ereignis (sonst läuft xterm wie bisher)? */
export function takesOverWheel(g: WheelGate): boolean {
  return g.enabled && g.tracking && g.sgr && g.deltaY !== 0 && g.cellHeight > 0 && !g.shiftKey && !g.ctrlKey && !g.altKey && !g.metaKey;
}

/** Startzusätze für Claude: Beschleunigung aus und Tempo 1, damit die Zeilen des Cockpits 1:1 ankommen. */
export function smoothScrollStart(on: boolean): { settings: Record<string, unknown>; env: Record<string, string> } {
  if (!on) return { settings: {}, env: {} };
  return { settings: { wheelScrollAccelerationEnabled: false }, env: { CLAUDE_CODE_SCROLL_SPEED: "1" } };
}
