import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Portal-Scorecard prüft styles.css gegen Obsidian 1.11.4 (13.10.2026): "Unexpected property all",
// "multicolumn" (column-gap) und "extended-system-fonts" (ui-monospace). Lokal deckt der Linter CSS nicht ab.
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("styles.css ohne Portal-CSS-Befunde", () => {
  it("kein all:", () => { expect(css.match(/(^|[;{\s])all\s*:/gm) ?? []).toEqual([]); });
  it("kein column-gap", () => { expect(css.match(/column-gap\s*:/g) ?? []).toEqual([]); });
  it("kein ui-monospace", () => { expect(css.match(/ui-monospace/g) ?? []).toEqual([]); });
});
