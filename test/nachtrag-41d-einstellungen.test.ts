import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "../src/core/settings";
import { ROOT } from "./helpers/files";

// Nachtrag 41d, Task 1: Startgröße und Startschrift des Datei-Viewers als Einstellungen.

const tab = readFileSync(join(ROOT, "src/host/settings-tab.ts"), "utf8");
const SPECS = [
  { key: "fileViewerWidthPct", vorgabe: 90, min: 40, max: 100 },
  { key: "fileViewerHeightPct", vorgabe: 90, min: 40, max: 100 },
  { key: "fileViewerFontSize", vorgabe: 14, min: 8, max: 32 },
] as const;

describe("Einstellungen des Datei-Viewers (Größe, Schrift)", () => {
  for (const { key, vorgabe, min, max } of SPECS) {
    describe(key, () => {
      it(`Vorgabe ${vorgabe}`, () => {
        expect(DEFAULT_SETTINGS[key]).toBe(vorgabe);
      });
      it(`gültige Werte bleiben (${min} bis ${max})`, () => {
        expect(parseSettings({ [key]: min }).settings[key]).toBe(min);
        expect(parseSettings({ [key]: max }).settings[key]).toBe(max);
        expect([...parseSettings({ [key]: max }).invalid]).toEqual([]);
      });
      it("zu hoch (999) wird die Obergrenze, zu tief (0) die Untergrenze", () => {
        expect(parseSettings({ [key]: 999 }).settings[key]).toBe(max);
        expect(parseSettings({ [key]: 0 }).settings[key]).toBe(min);
      });
      it("Text, Dezimalzahl und null sind ungültig, die Vorgabe bleibt", () => {
        for (const v of ["90", 1.5, null, NaN]) {
          const r = parseSettings({ [key]: v });
          expect([...r.invalid], String(v)).toEqual([key]);
          expect(r.settings[key]).toBe(vorgabe);
        }
      });
    });
  }

  it("Einstellungsseite: Felder in Reihenfolge zwischen Höchstgröße und Vorschlägen", () => {
    const at = (field: string): number => {
      const i = tab.indexOf(field);
      expect(i, `${field} fehlt`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const max = at('"fileViewerMaxMb", "Datei-Viewer: Höchstgröße (MB)"');
    const breite = at('"fileViewerWidthPct", "Datei-Viewer: Startbreite (%)"');
    const hoehe = at('"fileViewerHeightPct", "Datei-Viewer: Starthöhe (%)"');
    const schrift = at('"fileViewerFontSize", "Datei-Viewer: Schriftgröße (px)"');
    const vorschlaege = at('"fileViewerAutocomplete", "Datei-Viewer: Vorschläge beim Tippen"');
    expect(max).toBeLessThan(breite);
    expect(breite).toBeLessThan(hoehe);
    expect(hoehe).toBeLessThan(schrift);
    expect(schrift).toBeLessThan(vorschlaege);
    expect(vorschlaege).toBeLessThan(at('this.group("Benachrichtigung", ['));
  });

  it("Hilfetexte: Wirkung beim nächsten Öffnen, Mod-Taste über modKeyName statt fest Cmd", () => {
    const feld = (name: string): string => {
      const i = tab.indexOf(name);
      expect(i, `${name} fehlt`).toBeGreaterThanOrEqual(0);
      return tab.slice(i, tab.indexOf("),", i));
    };
    expect(feld('"fileViewerWidthPct"')).toContain("Anteil an der Breite des Obsidian-Fensters beim Öffnen");
    expect(feld('"fileViewerWidthPct"')).toContain("Wirkt beim nächsten Öffnen");
    expect(feld('"fileViewerHeightPct"')).toContain("Anteil an der Höhe des Obsidian-Fensters beim Öffnen");
    const schrift = feld('"fileViewerFontSize"');
    expect(schrift).toContain("${mod}+Plus, ${mod}+Minus, ${mod}+0 und ${mod}+Mausrad");
    expect(schrift).not.toContain("Cmd");
  });
});
