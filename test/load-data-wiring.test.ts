import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

// Obsidians loadData fängt kaputtes JSON selbst ab (console.error „failed to read JSON“) und liefert
// undefined wie bei fehlender Datei. Gemessen am 04.10.2026 mit Obsidian 1.13.7 (readJson im App-Code).
// Wer data.json über loadData liest, sieht die kaputte Datei nie: keine Notice, keine Sicherung.
describe("data.json wird selbst gelesen", () => {
  it("main.ts ruft loadData nicht auf und nutzt parseDataText", () => {
    const main = readFileSync(join(ROOT, "src/main.ts"), "utf8");
    expect(main).not.toMatch(/\bloadData\s*\(/);
    expect(main).toMatch(/\bparseDataText\s*\(/);
  });
});
