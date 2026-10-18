import { describe, expect, it } from "vitest";
import { PressGuard, touchesRow } from "../src/core/link-guard";

const r = (sy: number, ey: number) => ({ start: { x: 1, y: sy }, end: { x: 5, y: ey } });

describe("touchesRow", () => {
  it("Link in Zeile y", () => expect(touchesRow(r(3, 3), 3)).toBe(true));
  it("Link ganz darüber oder darunter", () => {
    expect(touchesRow(r(2, 2), 3)).toBe(false);
    expect(touchesRow(r(4, 4), 3)).toBe(false);
  });
  it("Link über zwei Zeilen berührt beide und nur diese", () => {
    expect(touchesRow(r(2, 3), 2)).toBe(true);
    expect(touchesRow(r(2, 3), 3)).toBe(true);
    expect(touchesRow(r(2, 3), 4)).toBe(false);
    expect(touchesRow(r(2, 4), 3)).toBe(true);
  });
});

describe("PressGuard", () => {
  it("ohne Druck nicht aktiv", () => expect(new PressGuard().active()).toBe(false));
  it("Druck macht aktiv, Ende mit derselben ID beendet", () => {
    const g = new PressGuard();
    const id = g.press();
    expect(g.active()).toBe(true);
    g.end(id);
    expect(g.active()).toBe(false);
  });
  it("Ende eines alten Drucks beendet den neuen nicht (Doppelklick)", () => {
    const g = new PressGuard();
    const a = g.press();
    const b = g.press();
    expect(b).not.toBe(a);
    g.end(a);
    expect(g.active()).toBe(true);
    g.end(b);
    expect(g.active()).toBe(false);
  });
  it("doppeltes Ende ist harmlos", () => {
    const g = new PressGuard();
    const id = g.press();
    g.end(id);
    g.end(id);
    expect(g.active()).toBe(false);
  });
});
