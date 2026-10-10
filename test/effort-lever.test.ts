import { describe, expect, it } from "vitest";
import { EFFORT_STEPS } from "../src/core/constants";
import { leverKeyStep, leverMarks, leverValueText, pointerPosition, positionStep, snapPosition, stepPosition } from "../src/core/effort-lever";

// Effort-Hebel (Abend 18b), reine Logik: Position am Hebelweg (0 = oben = max, 1 = unten = aus), Einrasten, Klemmen.

describe("stepPosition: Stufe zur Position", () => {
  it("max oben (0), aus unten (1), dazwischen gleichmäßig", () => {
    expect(stepPosition("max")).toBe(0);
    expect(stepPosition("xhigh")).toBeCloseTo(0.2, 10);
    expect(stepPosition("high")).toBeCloseTo(0.4, 10);
    expect(stepPosition("medium")).toBeCloseTo(0.6, 10);
    expect(stepPosition("low")).toBeCloseTo(0.8, 10);
    expect(stepPosition("aus")).toBe(1);
  });
});

describe("positionStep: Position zur nächsten Stufe", () => {
  it("jede Stufe liegt auf ihrer eigenen Position (Hin und zurück)", () => {
    for (const s of EFFORT_STEPS) expect(positionStep(stepPosition(s))).toBe(s);
  });
  it("rastet auf die nächste Stufe, knapp vor der Mitte noch auf die alte", () => {
    expect(positionStep(0.09)).toBe("max");
    expect(positionStep(0.11)).toBe("xhigh");
    expect(positionStep(0.29)).toBe("xhigh");
    expect(positionStep(0.31)).toBe("high");
    expect(positionStep(0.89)).toBe("low");
    expect(positionStep(0.91)).toBe("aus");
  });
  it("klemmt über die Enden hinaus", () => {
    expect(positionStep(-3)).toBe("max");
    expect(positionStep(2)).toBe("aus");
    expect(positionStep(Number.NEGATIVE_INFINITY)).toBe("max");
    expect(positionStep(Number.POSITIVE_INFINITY)).toBe("aus");
  });
  it("genau auf der Mitte zwischen zwei Stufen gewinnt die höhere", () => {
    expect(positionStep(0.5)).toBe("high");
    expect(positionStep(0.1)).toBe("max");
  });
});

describe("snapPosition", () => {
  it("liefert die Position der nächsten Stufe", () => {
    expect(snapPosition(0.43)).toBeCloseTo(0.4, 10);
    expect(snapPosition(0.97)).toBe(1);
    expect(snapPosition(-1)).toBe(0);
  });
  it("ist stabil: nochmal einrasten ändert nichts", () => {
    for (const p of [0, 0.07, 0.33, 0.58, 0.77, 0.99, 1]) expect(snapPosition(snapPosition(p))).toBe(snapPosition(p));
  });
});

describe("pointerPosition: Zeigerhöhe zur Position", () => {
  it("rechnet aus Zeigerhöhe, Oberkante und Höhe des Wegs", () => {
    expect(pointerPosition(100, 100, 200)).toBe(0);
    expect(pointerPosition(200, 100, 200)).toBe(0.5);
    expect(pointerPosition(300, 100, 200)).toBe(1);
  });
  it("klemmt oberhalb und unterhalb des Wegs", () => {
    expect(pointerPosition(40, 100, 200)).toBe(0);
    expect(pointerPosition(900, 100, 200)).toBe(1);
  });
  it("zieht den Griffversatz ab, damit der Griff beim Anfassen nicht springt", () => {
    // Griffmitte bei 150, Zeiger fasst bei 160 an (Versatz +10): Zeiger bei 170 heißt Griffmitte 160
    expect(pointerPosition(170, 100, 200, 10)).toBeCloseTo(0.3, 10);
    expect(pointerPosition(160, 100, 200, 10)).toBeCloseTo(0.25, 10);
  });
  it("ohne Weg (Höhe 0, negativ, nicht endlich) gibt es keine Position", () => {
    expect(pointerPosition(100, 100, 0)).toBeNull();
    expect(pointerPosition(100, 100, -5)).toBeNull();
    expect(pointerPosition(100, 100, Number.NaN)).toBeNull();
    expect(pointerPosition(Number.NaN, 100, 200)).toBeNull();
  });
});

describe("leverMarks", () => {
  it("sechs Marken von oben (max) nach unten (aus) mit ihrer Position", () => {
    const m = leverMarks();
    expect(m.map((x) => x.step)).toEqual(["max", "xhigh", "high", "medium", "low", "aus"]);
    expect(m[0].position).toBe(0);
    expect(m[5].position).toBe(1);
    for (const x of m) expect(x.position).toBe(stepPosition(x.step));
  });
});

describe("leverKeyStep: Tastatur am Hebel", () => {
  it("Pfeil hoch, rechts und Bild hoch: eine Stufe höher; runter, links, Bild runter: eine niedriger", () => {
    for (const k of ["ArrowUp", "ArrowRight", "PageUp"]) expect(leverKeyStep("high", k)).toBe("xhigh");
    for (const k of ["ArrowDown", "ArrowLeft", "PageDown"]) expect(leverKeyStep("high", k)).toBe("medium");
  });
  it("Pos1 springt auf aus (Anfang des Wertebereichs), Ende auf max", () => {
    expect(leverKeyStep("high", "Home")).toBe("aus");
    expect(leverKeyStep("high", "End")).toBe("max");
  });
  it("an den Enden bleibt der Hebel stehen", () => {
    expect(leverKeyStep("max", "ArrowUp")).toBe("max");
    expect(leverKeyStep("aus", "ArrowDown")).toBe("aus");
  });
  it("andere Tasten gehören dem Hebel nicht", () => {
    for (const k of ["Enter", " ", "a", "Tab", "Escape"]) expect(leverKeyStep("high", k)).toBeNull();
  });
});

describe("leverValueText", () => {
  it("nennt Stufe und Platz im Weg", () => {
    expect(leverValueText("aus")).toBe("aus, Stufe 1 von 6");
    expect(leverValueText("high")).toBe("high, Stufe 4 von 6");
    expect(leverValueText("max")).toBe("max, Stufe 6 von 6");
  });
});

describe("Griff im Zug (Abend 19e)", () => {
  it("Zeiger genau auf der Stufenmitte ergibt die Stufe, ein Zug über den ganzen Weg läuft von max bis aus", () => {
    const stufen = [0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => positionStep(pointerPosition(100 + p * 150, 100, 150) ?? Number.NaN));
    expect(stufen).toEqual(["max", "xhigh", "high", "medium", "low", "aus"]);
  });
  it("ein Weg mit Höhe 0 ändert nichts: keine Position, also keine Stufe, die gesetzt werden könnte", () => {
    expect(pointerPosition(130, 100, 0, 5)).toBeNull();
  });
  it("Taste an einer Stufe in der Mitte: eine Stufe weiter, nie über die Enden", () => {
    for (const s of EFFORT_STEPS) {
      const hoch = leverKeyStep(s, "ArrowUp");
      const runter = leverKeyStep(s, "ArrowDown");
      expect(EFFORT_STEPS.indexOf(hoch!)).toBe(Math.min(EFFORT_STEPS.indexOf(s) + 1, EFFORT_STEPS.length - 1));
      expect(EFFORT_STEPS.indexOf(runter!)).toBe(Math.max(EFFORT_STEPS.indexOf(s) - 1, 0));
    }
  });
});
