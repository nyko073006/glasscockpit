import { describe, expect, it } from "vitest";
import { OBSIDIAN_STATUS_BAR, bottomOverlap } from "../src/core/status-bar";

const pane = { left: 0, top: 100, right: 800, bottom: 700 };

describe("bottomOverlap", () => {
  it("Leiste unten rechts in der Pane: so viele Pixel, wie sie von unten hineinragt", () => {
    expect(bottomOverlap(pane, { left: 600, top: 680, right: 800, bottom: 700 })).toBe(20);
  });
  it("Leiste ragt über den Rand hinaus: nur der Teil in der Pane zählt", () => {
    expect(bottomOverlap(pane, { left: 600, top: 690, right: 800, bottom: 720 })).toBe(10);
  });
  it("Leiste unter der Pane oder genau am Rand: 0", () => {
    expect(bottomOverlap(pane, { left: 600, top: 700, right: 800, bottom: 720 })).toBe(0);
    expect(bottomOverlap(pane, { left: 600, top: 710, right: 800, bottom: 730 })).toBe(0);
  });
  it("Leiste horizontal neben der Pane: 0, auch wenn sie auf gleicher Höhe liegt", () => {
    expect(bottomOverlap(pane, { left: 800, top: 680, right: 1000, bottom: 700 })).toBe(0);
    expect(bottomOverlap(pane, { left: -300, top: 680, right: 0, bottom: 700 })).toBe(0);
    expect(bottomOverlap(pane, { left: 900, top: 680, right: 1100, bottom: 700 })).toBe(0);
  });
  it("Leiste teilweise horizontal in der Pane: zählt", () => {
    expect(bottomOverlap(pane, { left: 700, top: 680, right: 900, bottom: 700 })).toBe(20);
  });
  it("Leiste über der Pane: 0", () => {
    expect(bottomOverlap(pane, { left: 600, top: 0, right: 800, bottom: 100 })).toBe(0);
  });
  it("ausgeblendete Leiste (Fläche 0): 0", () => {
    expect(bottomOverlap(pane, { left: 0, top: 0, right: 0, bottom: 0 })).toBe(0);
    expect(bottomOverlap(pane, { left: 700, top: 690, right: 700, bottom: 700 })).toBe(0);
    expect(bottomOverlap(pane, { left: 700, top: 700, right: 800, bottom: 700 })).toBe(0);
  });
  it("nie mehr als die Höhe der Pane", () => {
    expect(bottomOverlap({ left: 0, top: 0, right: 100, bottom: 30 }, { left: 0, top: -50, right: 100, bottom: 400 })).toBe(30);
  });
  it("keine endliche Zahl (NaN) ergibt 0", () => {
    expect(bottomOverlap(pane, { left: NaN, top: 680, right: 800, bottom: 700 })).toBe(0);
  });
});

describe("OBSIDIAN_STATUS_BAR", () => {
  // Obsidian 1.13.7: this.statusBarEl = this.appContainerEl.createDiv("status-bar"). Agentic OS hat in seiner View
  // ein eigenes div.status-bar (Abnahme Abend 11, Schritt 8); ein nackter ".status-bar" fand dieses zuerst.
  it("trifft nur das direkte Kind von .app-container", () => {
    expect(OBSIDIAN_STATUS_BAR).toBe(".app-container > .status-bar");
  });
});
