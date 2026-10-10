import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, listFilesRecursive, relativeToRoot } from "./helpers/files";

/**
 * Suchprädikat: Text enthält einen Bezug auf Daten oder Plugin-Ordner des Originals.
 * Groß- und Kleinschreibung zählt nicht, weil APFS sie nicht unterscheidet.
 * Das nackte Wort ohne Punkt davor und ohne plugins/ davor trifft bewusst nicht.
 */
function enthaeltOriginalBezug(text: string): boolean {
  return /\.agentic-os|plugins\/agentic-os/i.test(text);
}

describe("(b) Kein Bezug auf das Original unter src/ und scripts/", () => {
  describe("Suchprädikat", () => {
    it('trifft ".agentic-os"', () => {
      expect(enthaeltOriginalBezug("const dir = '~/.agentic-os/data';")).toBe(true);
      expect(enthaeltOriginalBezug(".agentic-os")).toBe(true);
    });

    it('trifft "plugins/agentic-os"', () => {
      expect(enthaeltOriginalBezug("/vault/.obsidian/plugins/agentic-os/main.js")).toBe(true);
      expect(enthaeltOriginalBezug("plugins/agentic-os")).toBe(true);
    });

    it("trifft auch andere Schreibweisen", () => {
      expect(enthaeltOriginalBezug(".Agentic-OS")).toBe(true);
      expect(enthaeltOriginalBezug("plugins/AGENTIC-OS")).toBe(true);
    });

    it('trifft nicht "glasscockpit"', () => {
      expect(enthaeltOriginalBezug("glasscockpit")).toBe(false);
      expect(enthaeltOriginalBezug("plugins/glasscockpit")).toBe(false);
    });

    it("trifft nicht das nackte agentic-os (die Zielprüfung braucht es als Suchwort)", () => {
      expect(enthaeltOriginalBezug("agentic-os")).toBe(false);
    });
  });

  it("keine Datei unter src/ und scripts/ enthält eines der beiden Muster", () => {
    const dateien = [
      ...listFilesRecursive(join(ROOT, "src")),
      ...listFilesRecursive(join(ROOT, "scripts")),
    ];
    // Ohne gelesene Dateien wäre der Test leer und trotzdem grün.
    expect(dateien.length).toBeGreaterThan(0);

    const treffer = dateien
      .filter((datei) => enthaeltOriginalBezug(readFileSync(datei, "utf8")))
      .map(relativeToRoot);
    expect(treffer).toEqual([]);
  });
});
