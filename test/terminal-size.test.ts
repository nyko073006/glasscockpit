import { describe, expect, it } from "vitest";
import { usableDimensions } from "../src/core/terminal-size";

const BOX = { width: 800, height: 600 };

describe("fit-Wächter usableDimensions", () => {
  it("gültige Werte in sichtbarer Box werden durchgereicht", () => {
    expect(usableDimensions({ cols: 100, rows: 30 }, BOX)).toEqual({ cols: 100, rows: 30 });
  });

  it("proposeDimensions liefert nichts: kein fit", () => {
    expect(usableDimensions(undefined, BOX)).toBeNull();
  });

  it.each([
    ["cols 0", { cols: 0, rows: 30 }],
    ["rows 0", { cols: 100, rows: 0 }],
    ["cols NaN (versteckter Tab, Breite auto)", { cols: Number.NaN, rows: 30 }],
    ["rows NaN", { cols: 100, rows: Number.NaN }],
    ["cols unendlich", { cols: Number.POSITIVE_INFINITY, rows: 30 }],
    ["cols negativ", { cols: -3, rows: 30 }],
  ])("%s: kein fit", (_name, dims) => {
    expect(usableDimensions(dims, BOX)).toBeNull();
  });

  // FitAddon 0.11.0 hebt 0 px auf das Minimum 2×1 an. Das sähe gültig aus,
  // würde ein verdecktes Terminal aber auf zwei Spalten schrumpfen.
  it.each([
    ["Breite 0", { width: 0, height: 600 }],
    ["Höhe 0", { width: 800, height: 0 }],
  ])("Container mit %s: kein fit, auch bei 2×1", (_name, box) => {
    expect(usableDimensions({ cols: 2, rows: 1 }, box)).toBeNull();
  });
});
