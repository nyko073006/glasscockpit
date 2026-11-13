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

// Nachtrag 43j: Die Übergabe-Lampe rechnet bei Tab-Wechsel und Claude-ID-Wechsel sofort neu, nicht erst im 60-s-Takt.
describe("Nachtrag 43j: Lampe nach Tab- und ID-Wechsel", () => {
  it("touchLeaf stößt nach dem Merken der Sitzung feedRefresh an", () => {
    const body = method(main(), /private touchLeaf\(/);
    const touch = body.search(/this\.recent\.touch\(id\)/);
    const refresh = body.search(/this\.feedRefresh\?\.\(\)/);
    expect(touch).toBeGreaterThanOrEqual(0);
    expect(refresh).toBeGreaterThan(touch);
  });
  it("store.onChange (Claude-ID-Wechsel) stößt feedRefresh an, aufgeräumt per register", () => {
    expect(main()).toMatch(/this\.register\(store\.onChange\(\(\) => this\.feedRefresh\?\.\(\)\)\)/);
  });
  it("feedRefresh ruft feedSource.refresh (entprellt dort über running) und ist kein neuer Timer", () => {
    const text = main();
    expect(text).toMatch(/this\.feedRefresh = \(\) => void feedSource\.refresh\(\)/);
    expect(text).not.toMatch(/feedRefresh[^\n]*setInterval|setInterval[^\n]*feedRefresh/);
  });
});
