import { describe, expect, it } from "vitest";
import { radarLamp, radarStateValid } from "../src/core/radar-lamp";

describe("radarLamp (heute nach lokalem Datum)", () => {
  const now = new Date(2026, 9, 6, 12, 0);
  it("heute geschrieben: grün, auch kurz nach Mitternacht und kurz vor Mitternacht", () => {
    expect(radarLamp(new Date(2026, 9, 6, 0, 0, 0), true, now)).toBe("green");
    expect(radarLamp(new Date(2026, 9, 6, 23, 59, 59), true, now)).toBe("green");
    expect(radarLamp(now.getTime(), true, now.getTime())).toBe("green");
  });
  it("gestern und älter: grau, schon eine Sekunde davor", () => {
    expect(radarLamp(new Date(2026, 9, 5, 23, 59, 59), true, now)).toBe("gray");
    expect(radarLamp(new Date(2026, 8, 1), true, now)).toBe("gray");
  });
  it("zwölf Stunden alt, aber gestern: grau; zehn Minuten nach Mitternacht jetzt, Datei von 23 Uhr: grau", () => {
    expect(radarLamp(new Date(2026, 9, 5, 23, 0), true, new Date(2026, 9, 6, 0, 10))).toBe("gray");
  });
  it("Datei fehlt: grau (Abend 21, Abnahme 3)", () => {
    expect(radarLamp(null, true, now)).toBe("gray");
    expect(radarLamp(null, false, now)).toBe("gray");
  });
  it("kaputt: rot, auch wenn heute geschrieben", () => {
    expect(radarLamp(now, false, now)).toBe("red");
    expect(radarLamp(new Date(2026, 9, 1), false, now)).toBe("red");
  });
  it("Datei aus der Zukunft (Uhrabweichung): grün", () => {
    expect(radarLamp(new Date(2026, 9, 7, 1), true, now)).toBe("green");
  });
});

describe("radarStateValid (state.json lässt sich lesen)", () => {
  it("ein JSON-Objekt (auch leer) ist gültig", () => {
    expect(radarStateValid("{}")).toBe(true);
    expect(radarStateValid(' {"letzter_lauf": "2026-10-06"}\n')).toBe(true);
  });
  it("leer, kaputt, Liste, Zahl, null: ungültig", () => {
    for (const t of ["", "  ", "{ kaputt", "[1]", "42", "null", "\"x\"", "{\"a\":"]) expect(radarStateValid(t)).toBe(false);
  });
});
