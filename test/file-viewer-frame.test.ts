import { describe, expect, it } from "vitest";
import {
  clampRect, fitPct, fontPx, IMAGE_ZOOM_STEPS, imageSize, imageZoomStep, MIN_HEIGHT, MIN_WIDTH, moveRect, resizeRect, startRect, WHEEL_PX_PER_STEP, WHEEL_RESET_MS, wheelSteps, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, zoomStep, type Edge, type Rect,
} from "../src/core/file-viewer-frame";

// Nachtrag 41d, Task 1: reine Rechnung für Lage, Größe und Zoom des Datei-Viewers.

const VIEW = { width: 1000, height: 800 };

describe("Maße", () => {
  it("Mindestmaß und Zoomgrenzen", () => {
    expect([MIN_WIDTH, MIN_HEIGHT]).toEqual([400, 300]);
    expect([ZOOM_MIN, ZOOM_MAX, ZOOM_STEP]).toEqual([50, 200, 10]);
  });
});

describe("startRect", () => {
  it("90 % mittig", () => {
    expect(startRect(VIEW, 90, 90)).toEqual({ left: 50, top: 40, width: 900, height: 720 });
  });
  it("Breite und Höhe unabhängig", () => {
    expect(startRect(VIEW, 50, 75)).toEqual({ left: 250, top: 100, width: 500, height: 600 });
  });
  it("100 % füllt das Fenster", () => {
    expect(startRect(VIEW, 100, 100)).toEqual({ left: 0, top: 0, width: 1000, height: 800 });
  });
  it("rundet auf ganze px (auch Lage)", () => {
    const r = startRect({ width: 999, height: 777 }, 77, 77);
    expect(r).toEqual({ left: 115, top: 90, width: 769, height: 598 });
    for (const v of Object.values(r)) expect(Number.isInteger(v)).toBe(true);
  });
  it("unter dem Mindestmaß gilt das Mindestmaß", () => {
    expect(startRect({ width: 800, height: 600 }, 40, 40)).toEqual({ left: 200, top: 150, width: 400, height: 300 });
  });
  it("Fenster kleiner als das Mindestmaß: das Fenster gilt", () => {
    expect(startRect({ width: 350, height: 250 }, 90, 90)).toEqual({ left: 0, top: 0, width: 350, height: 250 });
  });
  it("Anteil über 100 wird nie größer als das Fenster", () => {
    expect(startRect(VIEW, 150, 150)).toEqual({ left: 0, top: 0, width: 1000, height: 800 });
  });
});

describe("clampRect", () => {
  it("liegt schon richtig: unverändert", () => {
    const r: Rect = { left: 10, top: 20, width: 500, height: 400 };
    expect(clampRect(r, VIEW)).toEqual(r);
  });
  it("zu klein: Mindestmaß", () => {
    expect(clampRect({ left: 10, top: 10, width: 100, height: 50 }, VIEW)).toEqual({ left: 10, top: 10, width: 400, height: 300 });
  });
  it("zu groß: Fenstermaß", () => {
    expect(clampRect({ left: 0, top: 0, width: 2000, height: 5000 }, VIEW)).toEqual({ left: 0, top: 0, width: 1000, height: 800 });
  });
  it("links oben hinaus: an den Rand geschoben", () => {
    expect(clampRect({ left: -50, top: -10, width: 500, height: 400 }, VIEW)).toEqual({ left: 0, top: 0, width: 500, height: 400 });
  });
  it("rechts unten hinaus: an den Rand geschoben", () => {
    expect(clampRect({ left: 900, top: 700, width: 500, height: 400 }, VIEW)).toEqual({ left: 500, top: 400, width: 500, height: 400 });
  });
  it("Größe zuerst, dann Lage (zu groß und verschoben)", () => {
    expect(clampRect({ left: 300, top: 300, width: 1500, height: 900 }, VIEW)).toEqual({ left: 0, top: 0, width: 1000, height: 800 });
  });
  it("Fenster kleiner als das Mindestmaß: das Fenster gilt", () => {
    expect(clampRect({ left: 10, top: 10, width: 100, height: 100 }, { width: 350, height: 250 })).toEqual({ left: 0, top: 0, width: 350, height: 250 });
  });
});

describe("moveRect", () => {
  const start: Rect = { left: 100, top: 100, width: 400, height: 300 };
  it("verschiebt, Größe bleibt", () => {
    expect(moveRect(start, 50, -30, VIEW)).toEqual({ left: 150, top: 70, width: 400, height: 300 });
  });
  it("über den rechten und unteren Rand: geklemmt", () => {
    expect(moveRect(start, 9999, 9999, VIEW)).toEqual({ left: 600, top: 500, width: 400, height: 300 });
  });
  it("über den linken und oberen Rand: geklemmt", () => {
    expect(moveRect(start, -9999, -9999, VIEW)).toEqual({ left: 0, top: 0, width: 400, height: 300 });
  });
  it("verändert den Startrahmen nicht", () => {
    moveRect(start, 5, 5, VIEW);
    expect(start).toEqual({ left: 100, top: 100, width: 400, height: 300 });
  });
});

describe("resizeRect", () => {
  const start: Rect = { left: 200, top: 150, width: 600, height: 400 }; // rechts 800, unten 550
  const r = (edge: Edge, dx: number, dy: number) => resizeRect(start, edge, dx, dy, VIEW);

  it("e: Breite wächst und schrumpft, linke Kante bleibt", () => {
    expect(r("e", 100, 77)).toEqual({ left: 200, top: 150, width: 700, height: 400 });
    expect(r("e", -100, 77)).toEqual({ left: 200, top: 150, width: 500, height: 400 });
  });
  it("e: am Mindestmaß Schluss, am Fensterrand Schluss", () => {
    expect(r("e", -9999, 0)).toEqual({ left: 200, top: 150, width: MIN_WIDTH, height: 400 });
    expect(r("e", 9999, 0)).toEqual({ left: 200, top: 150, width: 800, height: 400 });
  });
  it("w: rechte Kante bleibt stehen", () => {
    expect(r("w", 50, 77)).toEqual({ left: 250, top: 150, width: 550, height: 400 });
    expect(r("w", -50, 77)).toEqual({ left: 150, top: 150, width: 650, height: 400 });
  });
  it("w: am Mindestmaß bleibt die rechte Kante stehen (Fenster wandert nicht mit)", () => {
    expect(r("w", 9999, 0)).toEqual({ left: 400, top: 150, width: MIN_WIDTH, height: 400 });
  });
  it("w: über den linken Rand: Kante am Rand, rechte Kante bleibt", () => {
    expect(r("w", -9999, 0)).toEqual({ left: 0, top: 150, width: 800, height: 400 });
  });
  it("s: Höhe, obere Kante bleibt; Mindestmaß und Fensterrand", () => {
    expect(r("s", 77, 100)).toEqual({ left: 200, top: 150, width: 600, height: 500 });
    expect(r("s", 0, -9999)).toEqual({ left: 200, top: 150, width: 600, height: MIN_HEIGHT });
    expect(r("s", 0, 9999)).toEqual({ left: 200, top: 150, width: 600, height: 650 });
  });
  it("n: untere Kante bleibt; Mindestmaß und Fensterrand", () => {
    expect(r("n", 77, 50)).toEqual({ left: 200, top: 200, width: 600, height: 350 });
    expect(r("n", 0, 9999)).toEqual({ left: 200, top: 250, width: 600, height: MIN_HEIGHT });
    expect(r("n", 0, -9999)).toEqual({ left: 200, top: 0, width: 600, height: 550 });
  });
  it("nw unter das Mindestmaß: untere rechte Ecke bleibt stehen", () => {
    expect(r("nw", 9999, 9999)).toEqual({ left: 400, top: 250, width: MIN_WIDTH, height: MIN_HEIGHT });
  });
  it("ne, se, sw: je die Gegenecke bleibt", () => {
    expect(r("ne", 100, -50)).toEqual({ left: 200, top: 100, width: 700, height: 450 });
    expect(r("se", -9999, -9999)).toEqual({ left: 200, top: 150, width: MIN_WIDTH, height: MIN_HEIGHT });
    expect(r("sw", 50, 100)).toEqual({ left: 250, top: 150, width: 550, height: 500 });
  });
  it("Ziehen weit über alle Ränder: geklemmt auf das Fenster", () => {
    expect(r("se", 9999, 9999)).toEqual({ left: 200, top: 150, width: 800, height: 650 });
    expect(r("nw", -9999, -9999)).toEqual({ left: 0, top: 0, width: 800, height: 550 });
  });
  it("Fenster kleiner als das Mindestmaß: das Fenster gilt", () => {
    const klein = { width: 350, height: 250 };
    expect(resizeRect({ left: 0, top: 0, width: 350, height: 250 }, "se", -100, -100, klein)).toEqual({ left: 0, top: 0, width: 350, height: 250 });
    expect(resizeRect({ left: 0, top: 0, width: 350, height: 250 }, "nw", 100, 100, klein)).toEqual({ left: 0, top: 0, width: 350, height: 250 });
  });
  it("verändert den Startrahmen nicht", () => {
    r("nw", 10, 10);
    expect(start).toEqual({ left: 200, top: 150, width: 600, height: 400 });
  });
});

describe("zoomStep", () => {
  it("Raster von 10", () => {
    expect(zoomStep(100, 1)).toBe(110);
    expect(zoomStep(100, -1)).toBe(90);
  });
  it("krummer Wert schnappt: 115 → 120 bzw. 110", () => {
    expect(zoomStep(115, 1)).toBe(120);
    expect(zoomStep(115, -1)).toBe(110);
  });
  it("beide Grenzen", () => {
    expect(zoomStep(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(zoomStep(195, 1)).toBe(ZOOM_MAX);
    expect(zoomStep(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(zoomStep(55, -1)).toBe(ZOOM_MIN);
  });
  it("Werte außerhalb kommen in den Bereich", () => {
    expect(zoomStep(45, 1)).toBe(ZOOM_MIN);
    expect(zoomStep(45, -1)).toBe(ZOOM_MIN);
    expect(zoomStep(250, -1)).toBe(ZOOM_MAX);
    expect(zoomStep(250, 1)).toBe(ZOOM_MAX);
  });
});

describe("fontPx", () => {
  it("100 % ist die Grundschrift", () => {
    expect(fontPx(14, 100)).toBe(14);
  });
  it("auf 0,5 px gerundet", () => {
    expect(fontPx(14, 110)).toBe(15.5); // 15,4
    expect(fontPx(14, 90)).toBe(12.5); // 12,6
    expect(fontPx(13, 105)).toBe(13.5); // 13,65
    expect(fontPx(13, 107)).toBe(14); // 13,91
    expect(fontPx(14, 115)).toBe(16); // 16,1
  });
  it("Grenzen des Zooms", () => {
    expect(fontPx(13, 50)).toBe(6.5);
    expect(fontPx(14, 200)).toBe(28);
  });
});

describe("wheelSteps (Nachtrag 41d, Fix 1)", () => {
  it("Schwelle und Zurücksetzzeit", () => {
    expect([WHEEL_PX_PER_STEP, WHEEL_RESET_MS]).toEqual([50, 300]);
  });
  it("49 px sind noch kein Schritt, 50 einer, 120 zwei mit Rest 20 (Rad nach oben = größer)", () => {
    expect(wheelSteps(0, -49, 0)).toEqual({ steps: 0, acc: -49 });
    expect(wheelSteps(0, -50, 0)).toEqual({ steps: 1, acc: 0 });
    expect(wheelSteps(0, -120, 0)).toEqual({ steps: 2, acc: -20 });
    expect(wheelSteps(0, 120, 0)).toEqual({ steps: -2, acc: 20 });
  });
  it("viele kleine Ereignisse summieren sich, der Rest bleibt stehen", () => {
    let acc = 0;
    let total = 0;
    for (let i = 0; i < 12; i++) {
      const r = wheelSteps(acc, -9, 0);
      acc = r.acc;
      total += r.steps;
    }
    expect(total).toBe(2); // 108 px
    expect(acc).toBe(-8);
  });
  it("Richtungswechsel verwirft die alte Summe", () => {
    expect(wheelSteps(-40, 20, 0)).toEqual({ steps: 0, acc: 20 });
    expect(wheelSteps(40, -20, 0)).toEqual({ steps: 0, acc: -20 });
    // Ohne Wechsel zählt der Rest mit.
    expect(wheelSteps(-40, -20, 0)).toEqual({ steps: 1, acc: -10 });
  });
  it("Zeilen- und Seitenmodus: ein Schritt je Ereignis, egal wie groß delta ist, Summe zurückgesetzt", () => {
    expect(wheelSteps(-30, -1, 1)).toEqual({ steps: 1, acc: 0 });
    expect(wheelSteps(0, 3, 1)).toEqual({ steps: -1, acc: 0 });
    expect(wheelSteps(0, -100, 2)).toEqual({ steps: 1, acc: 0 });
  });
  it("deltaY 0 ändert nichts", () => {
    expect(wheelSteps(-30, 0, 0)).toEqual({ steps: 0, acc: -30 });
    expect(wheelSteps(-30, 0, 1)).toEqual({ steps: 0, acc: -30 });
  });
});

describe("Bildzoom (Nachtrag 43c)", () => {
  it("Leiter", () => {
    expect([...IMAGE_ZOOM_STEPS]).toEqual([10, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400, 800]);
  });
  it("fitPct", () => {
    const box = { width: 800, height: 600 };
    expect(fitPct({ width: 375, height: 812 }, box)).toBe(73);
    expect(fitPct({ width: 16, height: 16 }, box)).toBe(100);
    expect(fitPct({ width: 6000, height: 4000 }, box)).toBe(13);
    expect(fitPct({ width: 60000, height: 40000 }, box)).toBe(1);
    expect(fitPct({ width: 0, height: 0 }, box)).toBe(100);
    expect(fitPct({ width: 0, height: 1000 }, box)).toBe(100);
    expect(fitPct({ width: 1000, height: 0 }, box)).toBe(100);
  });
  it("imageZoomStep", () => {
    const cases: [number, 1 | -1, number][] = [[73, 1, 75], [73, -1, 67], [100, 1, 125], [800, 1, 800], [10, -1, 10], [5, -1, 5], [5, 1, 10], [13, 1, 25], [100, -1, 75], [25, -1, 10], [850, -1, 800], [850, 1, 800]];
    for (const [pct, dir, want] of cases) expect(imageZoomStep(pct, dir), `${pct}/${dir}`).toBe(want);
  });
  it("imageSize", () => {
    expect(imageSize({ width: 375, height: 812 }, 50)).toEqual({ width: 188, height: 406 });
    expect(imageSize({ width: 1, height: 1 }, 10)).toEqual({ width: 1, height: 1 });
  });
});
