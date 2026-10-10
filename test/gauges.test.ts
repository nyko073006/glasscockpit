import { describe, expect, it } from "vitest";
import { contextLevel, ringFill, thresholdsFileText, tokensLevel } from "../src/core/gauges";

describe("contextLevel (wie die Statuszeile: >= warn gelb, >= handoff rot)", () => {
  it("genau an den Schwellen", () => {
    expect(contextLevel(149999, 150000, 175000)).toBe("green");
    expect(contextLevel(150000, 150000, 175000)).toBe("yellow");
    expect(contextLevel(174999, 150000, 175000)).toBe("yellow");
    expect(contextLevel(175000, 150000, 175000)).toBe("red");
    expect(contextLevel(0, 150000, 175000)).toBe("green");
  });
  it("benutzt die übergebenen Schwellen", () => {
    expect(contextLevel(100000, 100000, 120000)).toBe("yellow");
    expect(contextLevel(120000, 100000, 120000)).toBe("red");
  });
});

describe("tokensLevel (viel Output ist gut: unter Median gelb, ab Median grün, ab p90 Regenbogen, Grenzen inklusive)", () => {
  it("Grenzen: median-1, median, p90-1, p90", () => {
    expect(tokensLevel(339999, 340000, 870000)).toBe("yellow");
    expect(tokensLevel(340000, 340000, 870000)).toBe("green");
    expect(tokensLevel(869999, 340000, 870000)).toBe("green");
    expect(tokensLevel(870000, 340000, 870000)).toBe("rainbow");
    expect(tokensLevel(0, 340000, 870000)).toBe("yellow");
    expect(tokensLevel(5_000_000, 340000, 870000)).toBe("rainbow");
  });
  it("kaputte Werte: NaN und negativ gelten als unter Median (unterste Stufe, wie vorher unterste Stufe grün)", () => {
    expect(tokensLevel(Number.NaN, 340000, 870000)).toBe("yellow");
    expect(tokensLevel(-1, 340000, 870000)).toBe("yellow");
    expect(tokensLevel(-870000, 340000, 870000)).toBe("yellow");
    expect(tokensLevel(500000, Number.NaN, Number.NaN)).toBe("yellow");
  });
});

describe("ringFill", () => {
  it("Anteil, geklemmt auf 0 bis 1", () => {
    expect(ringFill(0, 175000)).toBe(0);
    expect(ringFill(87500, 175000)).toBe(0.5);
    expect(ringFill(175000, 175000)).toBe(1);
    expect(ringFill(900000, 175000)).toBe(1);
    expect(ringFill(-5, 175000)).toBe(0);
  });
  it("kaputte Eingaben ergeben 0, nie NaN", () => {
    expect(ringFill(NaN, 100)).toBe(0);
    expect(ringFill(50, 0)).toBe(0);
    expect(ringFill(50, -10)).toBe(0);
    expect(ringFill(50, NaN)).toBe(0);
    expect(ringFill(Infinity, 100)).toBe(1);
  });
});

describe("thresholdsFileText", () => {
  it("JSON mit context_warn und context_handoff, abschließender Umbruch", () => {
    const text = thresholdsFileText({ contextWarn: 100000, contextHandoff: 120000 });
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({ context_warn: 100000, context_handoff: 120000 });
  });
});
