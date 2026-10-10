import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, listFilesRecursive, relativeToRoot } from "./helpers/files";

// Die Suchbegriffe werden zusammengesetzt, damit dieser Test sich nicht selbst findet.
const ALT = "claude";
const NEU = "cockpit";
const MUSTER = new RegExp(`${ALT}[-_ ]?${NEU}`, "i");

/** Suchprädikat: Text enthält den Altnamen in Bindestrich- oder Leerzeichen-Schreibweise, Groß/klein egal. */
function enthaeltAltnamen(text: string): boolean {
  return MUSTER.test(text);
}

describe("Kein Altname in src/ und test/", () => {
  describe("Suchprädikat", () => {
    it("trifft die Bindestrich-Schreibweise", () => {
      expect(enthaeltAltnamen(`${ALT}-${NEU}`)).toBe(true);
      expect(enthaeltAltnamen(`plugins/${ALT}-${NEU}-terminal`)).toBe(true);
    });

    it("trifft Schreibweisen ohne Trenner und mit Unterstrich", () => {
      expect(enthaeltAltnamen(`${ALT}${NEU}Plugin`)).toBe(true);
      expect(enthaeltAltnamen(`Claude${NEU}Plugin`.replace("cockpit", "Cockpit"))).toBe(true);
      expect(enthaeltAltnamen(`${ALT}_${NEU}`)).toBe(true);
    });

    it("trifft die Leerzeichen-Schreibweise, Groß/klein egal", () => {
      expect(enthaeltAltnamen(`${ALT} ${NEU}`)).toBe(true);
      expect(enthaeltAltnamen(`${ALT} ${NEU}`.toUpperCase())).toBe(true);
      expect(enthaeltAltnamen(`Claude-${NEU}`)).toBe(true);
    });

    it("trifft nicht den Ordner ~/.claude/cockpit und nicht den neuen Namen", () => {
      expect(enthaeltAltnamen("~/.claude/cockpit/usage.json")).toBe(false);
      expect(enthaeltAltnamen("Glasscockpit")).toBe(false);
      expect(enthaeltAltnamen("glasscockpit-terminal")).toBe(false);
      expect(enthaeltAltnamen("glasscockpit")).toBe(false);
      expect(enthaeltAltnamen("cockpit-foo")).toBe(false);
      expect(enthaeltAltnamen("~/.claude/cockpit")).toBe(false);
    });
  });

  it("keine Datei unter src/ und test/ enthält den Altnamen", () => {
    const dateien = [...listFilesRecursive(join(ROOT, "src")), ...listFilesRecursive(join(ROOT, "test"))];
    // Ohne gelesene Dateien wäre der Test leer und trotzdem grün.
    expect(dateien.length).toBeGreaterThan(0);

    const treffer = dateien
      .filter((datei) => enthaeltAltnamen(readFileSync(datei, "utf8")))
      .map(relativeToRoot);
    expect(treffer).toEqual([]);
  });
});
