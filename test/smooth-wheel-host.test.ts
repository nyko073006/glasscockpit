// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { WheelTuning } from "../src/core/smooth-wheel";
import { WheelTakeover, type WheelTerm } from "../src/host/smooth-wheel";

const TUNING: WheelTuning = { speed: 1, maxPerFrame: 3 };

function setup(over: { height?: number; noScreen?: boolean } = {}) {
  let handler: ((e: WheelEvent) => boolean) | null = null;
  const term = {
    cols: 80, rows: 20, modes: { mouseTrackingMode: "any" },
    attachCustomWheelEventHandler: (h: (e: WheelEvent) => boolean) => { handler = h; },
  } as WheelTerm & { modes: { mouseTrackingMode: string } };
  const screen = document.createElement("div");
  screen.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: over.height ?? 570 } as DOMRect);
  const state = { sgr: true, enabled: true };
  const frames: Array<() => void> = [];
  const cancelled: number[] = [];
  const writes: string[] = [];
  const deps = {
    term, screen: () => (over.noScreen ? null : screen), sgr: () => state.sgr,
    source: { enabled: () => state.enabled, tuning: () => TUNING },
    write: (d: string) => { writes.push(d); },
    schedule: (cb: () => void) => { frames.push(cb); return frames.length; },
    cancel: (h: number) => { cancelled.push(h); },
  };
  const takeover = new WheelTakeover(deps);
  const wheel = (init: WheelEventInit, stamp: number): WheelEvent => {
    const ev = new WheelEvent("wheel", { cancelable: true, ...init });
    Object.defineProperty(ev, "timeStamp", { value: stamp });
    // happy-dom baut WheelEvent auf UIEvent: Mausposition und Tasten aus dem Init gehen verloren, hier von Hand gesetzt.
    for (const key of ["clientX", "clientY", "shiftKey", "ctrlKey", "altKey", "metaKey"] as const) {
      const value = init[key] ?? (key.endsWith("Key") ? false : 0);
      Object.defineProperty(ev, key, { value });
    }
    return ev;
  };
  const send = (init: WheelEventInit, stamp: number) => {
    const ev = wheel(init, stamp);
    return { ev, result: handler!(ev) };
  };
  /** Das nächste angeforderte Bild ablaufen lassen. */
  const runFrame = () => frames.shift()!();
  return { term, state, frames, cancelled, writes, takeover, send, runFrame, hasHandler: () => handler !== null };
}

describe("WheelTakeover", () => {
  it("meldet den Handler am xterm an", () => {
    expect(setup().hasHandler()).toBe(true);
  });

  it("übernimmt im Vollbild und schickt im Bild die Zelle unter der Maus", () => {
    const t = setup();
    const { ev, result } = t.send({ deltaY: -28.5, clientX: 95, clientY: 100 }, 1000);
    expect(result).toBe(false);
    expect(ev.defaultPrevented).toBe(true);
    expect(t.frames).toHaveLength(1);
    t.runFrame();
    expect(t.writes).toEqual(["\x1b[<64;10;4M"]);
  });

  it.each(["shiftKey", "ctrlKey", "altKey", "metaKey"])("%s: xterm wie heute", (key) => {
    const t = setup();
    const { ev, result } = t.send({ deltaY: -60, [key]: true }, 1000);
    expect(result).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
    expect(t.frames).toHaveLength(0);
  });

  it("Vollbild verlassen verwirft den Bruchteil", () => {
    for (const leave of [
      (t: ReturnType<typeof setup>) => { t.term.modes.mouseTrackingMode = "none"; },
      (t: ReturnType<typeof setup>) => { t.state.sgr = false; },
    ]) {
      const t = setup();
      expect(t.send({ deltaY: -3 }, 1000).result).toBe(false);
      expect(t.frames).toHaveLength(0);
      leave(t);
      expect(t.send({ deltaY: -3 }, 1004).result).toBe(true);
      t.term.modes.mouseTrackingMode = "any";
      t.state.sgr = true;
      expect(t.send({ deltaY: -26 }, 1008).result).toBe(false);
      expect(t.frames).toHaveLength(0);
    }
  });

  it("ohne .xterm-screen oder mit Höhe 0: keine Übernahme", () => {
    for (const t of [setup({ noScreen: true }), setup({ height: 0 })]) {
      const { ev, result } = t.send({ deltaY: -60 }, 1000);
      expect(result).toBe(true);
      expect(ev.defaultPrevented).toBe(false);
      expect(t.frames).toHaveLength(0);
    }
  });

  it("Schalter aus: true und unberührt; aus mitten im Wisch verwirft den Bruchteil", () => {
    const off = setup();
    off.state.enabled = false;
    const first = off.send({ deltaY: -60 }, 1000);
    expect(first.result).toBe(true);
    expect(first.ev.defaultPrevented).toBe(false);
    expect(off.frames).toHaveLength(0);

    const t = setup();
    expect(t.send({ deltaY: -3 }, 1000).result).toBe(false);
    t.state.enabled = false;
    expect(t.send({ deltaY: -3 }, 1004).result).toBe(true);
    t.state.enabled = true;
    expect(t.send({ deltaY: -26 }, 1008).result).toBe(false);
    expect(t.frames).toHaveLength(0);
  });

  it("Bremse: drei Meldungen in einem Schreibvorgang", () => {
    const t = setup();
    t.send({ deltaY: -300, clientX: 95, clientY: 100 }, 1000);
    t.runFrame();
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0].split("\x1b[<64;")).toHaveLength(4);
    // Das Übermaß über der Bremse verfällt (Kern), also kein weiteres Bild.
    expect(t.frames).toHaveLength(0);
  });

  it("dispose bricht das offene Bild ab", () => {
    const t = setup();
    t.send({ deltaY: -60 }, 1000);
    expect(t.frames).toHaveLength(1);
    t.takeover.dispose();
    expect(t.cancelled).toEqual([1]);
    const { ev, result } = t.send({ deltaY: -60 }, 1100);
    expect(result).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("Vollbild endet vor dem Bild: nichts wird gesendet", () => {
    const leaves: Array<[string, (t: ReturnType<typeof setup>) => void, (t: ReturnType<typeof setup>) => void]> = [
      ["Maus-Modus aus", (t) => { t.term.modes.mouseTrackingMode = "none"; }, (t) => { t.term.modes.mouseTrackingMode = "any"; }],
      ["SGR aus", (t) => { t.state.sgr = false; }, (t) => { t.state.sgr = true; }],
      ["Schalter aus", (t) => { t.state.enabled = false; }, (t) => { t.state.enabled = true; }],
    ];
    for (const [, leave, restore] of leaves) {
      const t = setup();
      expect(t.send({ deltaY: -28.5 }, 1000).result).toBe(false);
      expect(t.frames).toHaveLength(1);
      leave(t);
      t.runFrame();
      expect(t.writes).toHaveLength(0);
      expect(t.frames).toHaveLength(0);
      restore(t);
      expect(t.send({ deltaY: -3 }, 1004).result).toBe(false);
      expect(t.frames).toHaveLength(0); // der Rest vor dem Bild ist verworfen
    }
  });
});
