import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

const main = (): string => readFileSync(join(ROOT, "src/main.ts"), "utf8");
/** Rumpf einer Methode von ihrer Signatur bis zur schließenden Klammer in Spalte 2. */
const method = (text: string, signature: RegExp): string => {
  const start = text.search(signature);
  expect(start, String(signature)).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n  }\n", start);
  expect(end, String(signature)).toBeGreaterThan(start);
  return text.slice(start, end);
};

// Abend 19g: Nach dem Obsidian-Start kannte `recent` nur das aktive Terminal, und Hintergrund-Tabs zählten nicht als Kandidaten.
// Eine neue Sitzung ging dann als Split in der Mitte auf statt als Tab neben den anderen.
describe("Abend 19g: neue Sitzung nach dem Start am richtigen Platz", () => {
  it("onLayoutReady nimmt alle Sitzungs-Tabs vom Start in recent auf, vor dem touchLeaf des aktiven", () => {
    const text = main();
    const start = text.indexOf("this.app.workspace.onLayoutReady(() => {");
    expect(start).toBeGreaterThanOrEqual(0);
    const block = text.slice(start, text.indexOf("\n    });\n", start));
    const seed = block.search(/this\.recent\.seed\(plan\.leavesAtLoad\)|this\.recent\.seed\(leavesAtLoad\)/);
    const touch = block.search(/this\.touchLeaf\(/);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(touch).toBeGreaterThan(seed);
  });

  it("sessionCandidates zählt Tabs ohne geladene View (Hintergrund-Tabs) über leafOfSession", () => {
    const body = method(main(), /private sessionCandidates\(\)/);
    expect(body).not.toMatch(/viewsOf\(/);
    expect(body).toMatch(/this\.recent\.open\(\(i\) => this\.leafOfSession\(i\) !== undefined\)/);
  });
});
