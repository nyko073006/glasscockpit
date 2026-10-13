import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KEYWORDS, LANGUAGE_IDS, languageForPath } from "../src/core/code-languages";
import { ROOT } from "./helpers/files";

// Abend 32: Sprache je Datei für den Datei-Viewer. Rein, ohne CodeMirror; die Wortlisten stammen aus den legacy-mode-Dateien.
describe("languageForPath", () => {
  const FAELLE: Array<[string, string]> = [
    ["/r/a.ts", "typescript"], ["/r/a.mts", "typescript"], ["/r/a.cts", "typescript"], ["/r/App.tsx", "typescript"],
    ["/r/a.js", "javascript"], ["/r/a.mjs", "javascript"], ["/r/a.cjs", "javascript"], ["/r/App.jsx", "javascript"],
    ["/r/package.json", "json"], ["/r/View.swift", "swift"], ["/r/styles.css", "css"], ["/r/tool.py", "python"],
    ["/r/ci.yml", "yaml"], ["/r/ci.yaml", "yaml"], ["/r/schema.sql", "sql"], ["/r/index.html", "html"], ["/r/index.htm", "html"],
    ["/r/run.sh", "shell"], ["/r/run.bash", "shell"], ["/r/run.zsh", "shell"],
  ];
  it.each(FAELLE)("%s → %s", (path, id) => expect(languageForPath(path)).toBe(id));

  it("Endung ohne Rücksicht auf Groß-/Kleinschreibung", () => {
    expect(languageForPath("/r/A.SWIFT")).toBe("swift");
    expect(languageForPath("/r/Main.Ts")).toBe("typescript");
  });

  it("unbekannt, ohne Endung, Punktdatei, leere Endung, Prototyp-Namen: null", () => {
    for (const p of ["/r/notes.md", "/r/Makefile", "Makefile", "/r/.gitignore", "/r/.env.local", "/r/.sh", "/r/.json", "/r/a.", "/r/a.constructor", "/r/a.toString", "/r/a.__proto__"]) {
      expect(languageForPath(p), p).toBeNull();
    }
  });

  it("nur der letzte Pfadteil zählt (Punkte in Ordnern, mehrere Punkte im Namen, Punktdatei mit Endung)", () => {
    expect(languageForPath("/x/.claude/settings.json")).toBe("json");
    expect(languageForPath("/a.b/Makefile")).toBeNull();
    expect(languageForPath("/r/foo.test.ts")).toBe("typescript");
    expect(languageForPath("/r/.eslintrc.json")).toBe("json");
  });
});

describe("KEYWORDS", () => {
  // Welche legacy-mode-Datei die Wörter jeder ID liefert.
  const DATEI: Record<string, string> = {
    typescript: "javascript", javascript: "javascript", json: "javascript", swift: "swift", css: "css",
    python: "python", yaml: "yaml", sql: "sql", html: "xml", shell: "shell",
  };

  it("genau die zehn IDs", () => {
    expect([...LANGUAGE_IDS].sort()).toEqual(Object.keys(DATEI).sort());
    expect(Object.keys(KEYWORDS).sort()).toEqual(Object.keys(DATEI).sort());
  });

  it.each([...LANGUAGE_IDS])("%s: nicht leer, ohne Doppelte, jedes Wort steht in der legacy-mode-Datei", (id) => {
    const words = KEYWORDS[id];
    expect(words.length).toBeGreaterThan(0);
    expect(new Set(words).size).toBe(words.length);
    const src = readFileSync(join(ROOT, "node_modules/@codemirror/legacy-modes/mode", `${DATEI[id]}.js`), "utf8");
    const fehlt = words.filter((w) => !new RegExp(`(?<![A-Za-z0-9_-])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-])`).test(src));
    expect(fehlt).toEqual([]);
  });

  it("Stichproben", () => {
    expect(KEYWORDS.swift).toContain("guard");
    expect(KEYWORDS.typescript).toContain("interface");
    expect(KEYWORDS.javascript).not.toContain("interface");
    expect(KEYWORDS.python).toContain("def");
    expect(KEYWORDS.json).toEqual(["true", "false", "null"]);
  });
});
