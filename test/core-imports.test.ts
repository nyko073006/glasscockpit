import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, listFilesRecursive, relativeToRoot } from "./helpers/files";

const VERBOTENE_MODULE = ["obsidian", "electron", "node-pty"];

/** Modulnamen aller import-, export-from-, dynamic-import- und require-Stellen im Text. */
function importierteModule(text: string): string[] {
  const muster = /\b(?:from|import|require)\s*\(?\s*["']([^"'\n]+)["']/g;
  return Array.from(text.matchAll(muster), (treffer) => treffer[1]);
}

/** Die verbotenen Module, die der Text importiert, auch mit Unterpfad wie "electron/main". */
function verbotenImportiert(text: string): string[] {
  return importierteModule(text).filter((name) =>
    VERBOTENE_MODULE.some((verboten) => name === verboten || name.startsWith(`${verboten}/`)),
  );
}

describe("(d) Zusatz: src/core importiert nichts Host-Spezifisches", () => {
  describe("Prädikat, Beispielzeilen mit Treffer", () => {
    it.each([
      ['import { Plugin } from "obsidian";', ["obsidian"]],
      ["import type { App } from 'obsidian';", ["obsidian"]],
      ['import "electron";', ["electron"]],
      ['export { shell } from "electron";', ["electron"]],
      ['const pty = require("node-pty");', ["node-pty"]],
      ['const pty = await import("node-pty");', ["node-pty"]],
      ['import { app } from "electron/main";', ["electron/main"]],
      ['import pty = require("node-pty");', ["node-pty"]],
    ])("%s", (zeile, erwartet) => {
      expect(verbotenImportiert(zeile)).toEqual(erwartet);
    });

    it("mehrzeiliger Import: die from-Zeile zählt", () => {
      const text = ["import {", "  Plugin,", "  Notice,", '} from "obsidian";'].join("\n");
      expect(verbotenImportiert(text)).toEqual(["obsidian"]);
    });
  });

  describe("Prädikat, Beispielzeilen ohne Treffer", () => {
    it.each([
      'import { PLUGIN_ID } from "./constants";',
      'import { x } from "./obsidian-adapter";',
      'import { y } from "obsidian-foo";',
      'import { readFileSync } from "node:fs";',
      'const name = "obsidian";',
      "// kein Bezug zu electron oder node-pty",
    ])("%s", (zeile) => {
      expect(verbotenImportiert(zeile)).toEqual([]);
    });
  });

  it("keine Datei unter src/core importiert obsidian, electron oder node-pty", () => {
    const dateien = listFilesRecursive(join(ROOT, "src", "core"));
    // Ohne geprüfte Dateien wäre der Test leer und trotzdem grün.
    expect(dateien.length).toBeGreaterThan(0);

    const treffer = dateien
      .filter((datei) => verbotenImportiert(readFileSync(datei, "utf8")).length > 0)
      .map(relativeToRoot);
    expect(treffer).toEqual([]);
  });
});
