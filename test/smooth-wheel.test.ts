import { describe, expect, it } from "vitest";
import { SmoothWheel, cellAt, smoothScrollStart, takesOverWheel, wheelSequence, type WheelGate } from "../src/core/smooth-wheel";
import trackpad from "./fixtures/wheel-trackpad.json";
import maus from "./fixtures/wheel-maus.json";

const FRAME = 1000 / 60;
const T = { speed: 1, maxPerFrame: 3 };
// Gesten getrennt an Pausen ab 200 ms, je Geste ein frischer SmoothWheel. Ein Bild kommt FRAME ms nach dem Ereignis,
// nach dem add() true lieferte und keins anstand; nach take() ein weiteres nur bei due().
function replay(events: { t: number; dy: number; m: number }[], cell = 28.5, tuning = { speed: 1, maxPerFrame: 3 }): number[][] {
  const gestures: (typeof events)[] = [];
  for (const e of events) {
    const g = gestures.at(-1);
    if (g && e.t - g[g.length - 1].t < 200) g.push(e); else gestures.push([e]);
  }
  return gestures.map((g) => {
    const wheel = new SmoothWheel();
    const sent: number[] = [];
    let next: number | null = null;
    const frame = () => { const n = wheel.take(tuning.maxPerFrame); if (n !== 0) sent.push(n); next = wheel.due() ? next! + FRAME : null; };
    for (const e of g) {
      while (next !== null && next <= e.t) frame();
      if (wheel.add({ deltaY: e.dy, deltaMode: e.m, timeStamp: e.t }, cell, 40, tuning) && next === null) next = e.t + FRAME;
    }
    while (next !== null) frame();
    return sent;
  });
}
const ev = (deltaY: number, timeStamp: number, deltaMode = 0) => ({ deltaY, deltaMode, timeStamp });
const sum = (a: number[]) => a.reduce((s, x) => s + Math.abs(x), 0);
const peak = (a: number[]) => Math.max(...a.map(Math.abs));

describe("SmoothWheel", () => {
  it("Trackpad-Folgen vom 29.10.: Weg 1:1, gebremst nur bei schnellen Wischen", () => {
    const g = replay(trackpad);
    expect(g.map(sum)).toEqual([13, 26, 21, 14, 91, 28, 47, 67, 20]);
    expect(g.map(peak)).toEqual([1, 2, 2, 2, 3, 3, 3, 3, 2]);
  });

  it("Maus-Folgen: jede langsame Raststufe eine Zeile, zügiges Drehen gebremst", () => {
    const g = replay(maus);
    expect(g.map(sum)).toEqual([1, 2, 8, 2, 1, 1, 2, 1, 2, 1, 3, 159]);
    expect(Math.max(...g.map(peak))).toBeLessThanOrEqual(3);
  });

  it("Raststufe nach Pause zählt eine Zeile, nach 30 ms nur ihren Weg", () => {
    const w = new SmoothWheel();
    expect(w.add(ev(-13, 0), 28.5, 40, T)).toBe(true);
    expect(w.take(3)).toBe(-1);
    expect(w.add(ev(-13, 30), 28.5, 40, T)).toBe(false);
    expect(w.add(ev(-13, 60), 28.5, 40, T)).toBe(false);
    expect(w.add(ev(-13, 90), 28.5, 40, T)).toBe(true);
    expect(w.take(3)).toBe(-1);
  });

  it("Trackpad-Anfang nach Pause zählt keine Mindestzeile", () => {
    const w = new SmoothWheel();
    expect(w.add(ev(-3, 0), 28.5, 40, T)).toBe(false);
    expect(w.take(3)).toBe(0);
  });

  it("Richtungswechsel verwirft den Bruchteil der alten Richtung", () => {
    const w = new SmoothWheel();
    w.add(ev(-1, 0), 28.5, 40, T);
    w.add(ev(-25, 10), 28.5, 40, T);
    w.add(ev(5, 20), 28.5, 40, T);
    w.add(ev(25, 30), 28.5, 40, T);
    expect(w.take(3)).toBe(1);
  });

  it("Bremse: Übermaß verfällt, Bruchteil bleibt", () => {
    const w = new SmoothWheel();
    w.add(ev(-300, 0), 28.5, 40, T);
    expect(w.take(3)).toBe(-3);
    expect(w.take(3)).toBe(0);
    const v = new SmoothWheel();
    v.add(ev(-71.25, 0), 28.5, 40, T);
    expect(v.take(3)).toBe(-2);
    v.add(ev(-14.25, 10), 28.5, 40, T);
    expect(v.take(3)).toBe(-1);
  });

  it("Tempo zählt, die Mindestzeile bleibt", () => {
    const a = new SmoothWheel();
    a.add(ev(-28.5, 0), 28.5, 40, { speed: 2, maxPerFrame: 3 });
    expect(a.take(3)).toBe(-2);
    const b = new SmoothWheel();
    b.add(ev(-13, 0), 28.5, 40, { speed: 0.5, maxPerFrame: 3 });
    expect(b.take(3)).toBe(-1);
  });

  it("Zeilen- und Seitenmodus, Windows-Raststufe", () => {
    const a = new SmoothWheel();
    a.add(ev(-3, 0, 1), 28.5, 40, T);
    expect(a.take(3)).toBe(-3);
    const b = new SmoothWheel();
    b.add(ev(1, 0, 2), 28.5, 40, T);
    expect(b.take(3)).toBe(3);
    const c = new SmoothWheel();
    c.add(ev(100, 0), 17, 40, T);
    expect(c.take(3)).toBe(3);
    expect(c.take(3)).toBe(0);
  });

  it("Zellhöhe 0 oder kein endlicher Weg zählt nicht", () => {
    for (const [dy, cell] of [[-10, 0], [Number.NaN, 28.5], [Number.POSITIVE_INFINITY, 28.5]]) {
      const w = new SmoothWheel();
      expect(w.add(ev(dy, 0), cell, 40, T)).toBe(false);
      expect(w.take(3)).toBe(0);
      expect(w.due()).toBe(false);
    }
  });

  it("Pause löscht den Bruchteil", () => {
    const w = new SmoothWheel();
    for (const t of [0, 10, 20, 30, 40]) w.add(ev(-5, t), 28.5, 40, T);
    w.add(ev(-5, 240), 28.5, 40, T);
    expect(w.take(3)).toBe(0);
  });
});

describe("wheelSequence", () => {
  it("SGR-Meldung je Zeile, hoch 64, runter 65", () => {
    expect(wheelSequence(-3, 10, 5)).toBe("\x1b[<64;10;5M".repeat(3));
    expect(wheelSequence(2, 1, 1)).toBe("\x1b[<65;1;1M".repeat(2));
    expect(wheelSequence(0, 1, 1)).toBe("");
  });
});

describe("cellAt", () => {
  const rect = { left: 100, top: 50, width: 800, height: 400 };
  it("Zelle ab 1, geklemmt", () => {
    expect(cellAt(100, 50, rect, 80, 20)).toEqual({ col: 1, row: 1 });
    expect(cellAt(899.9, 449.9, rect, 80, 20)).toEqual({ col: 80, row: 20 });
    expect(cellAt(-5, 1000, rect, 80, 20)).toEqual({ col: 1, row: 20 });
  });
});

describe("takesOverWheel", () => {
  const base: WheelGate = { enabled: true, tracking: true, sgr: true, deltaY: -3, cellHeight: 28.5, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
  it("nur im Grundfall ohne Taste", () => {
    expect(takesOverWheel(base)).toBe(true);
    const falsch: Partial<WheelGate>[] = [{ enabled: false }, { tracking: false }, { sgr: false }, { deltaY: 0 }, { cellHeight: 0 },
      { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }];
    for (const f of falsch) expect(takesOverWheel({ ...base, ...f }), JSON.stringify(f)).toBe(false);
  });
});

describe("smoothScrollStart", () => {
  it("an: Einstellung und Variable, aus: nichts", () => {
    expect(smoothScrollStart(true)).toEqual({ settings: { wheelScrollAccelerationEnabled: false }, env: { CLAUDE_CODE_SCROLL_SPEED: "1" } });
    expect(smoothScrollStart(false)).toEqual({ settings: {}, env: {} });
  });
});
