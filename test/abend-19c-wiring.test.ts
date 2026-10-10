import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

const main = (): string => readFileSync(join(ROOT, "src/main.ts"), "utf8");
const at = (text: string, pattern: RegExp): number => {
  const i = text.search(pattern);
  expect(i, String(pattern)).toBeGreaterThanOrEqual(0);
  return i;
};

// Gemessen am 07.10.2026 mit einem Mess-Plugin in Obsidian 1.14.4: Direkt nach registerView und im onLayoutReady-Rückruf
// findet getLeavesOfType beim plugin:reload 0 Tabs, vor registerView noch alle. Beim Abschalten in den Einstellungen sieht
// nur ein Aufräumer, der nach registerView registriert ist, die Tabs; davor registrierte und onunload sehen keine.
describe("Abend 19c: Verdrahtung", () => {
  it("die offenen Tabs werden vor registerView(VIEW_TYPE_TERMINAL) festgehalten (Reload: danach sind sie kurz weg)", () => {
    const text = main();
    const snapshot = at(text, /const leavesBeforeRegister\s*=/);
    expect(snapshot).toBeLessThan(at(text, /this\.registerView\(\s*VIEW_TYPE_TERMINAL/));
  });

  it("der Merkzettel der Sitzungen entsteht im Aufräumer hinter dem letzten registerView und wird sofort geschrieben (seit 19e dort: beide Merkzettel in einem)", () => {
    const text = main();
    const register = at(text, /this\.registerView\(\s*VIEW_TYPE_TERMINAL/);
    const last = text.lastIndexOf("this.registerView(");
    expect(last).toBeGreaterThan(register);
    const cleanup = text.indexOf("this.register(() => {", last);
    expect(cleanup).toBeGreaterThan(last);
    // Kein anderes register… zwischen dem letzten registerView und dem Aufräumer.
    const between = text.slice(last + 1, cleanup);
    expect(between).not.toMatch(/this\.register(View|Event|Interval)?\(/);
    const body = text.slice(cleanup, cleanup + 900);
    expect(body).toMatch(/setOpenAtUnload\(/);
    expect(body).toMatch(/flush\(\)/);
  });

  it("beim Laden entscheidet planAfterLoad, mit den Tabs von vor und nach registerView", () => {
    const text = main();
    expect(text).toMatch(/planAfterLoad\(/);
    // Seit 19g eine Konstante, weil auch recent.seed sie braucht.
    expect(text).toMatch(/const leavesAtLoad = \[\.\.\.new Set\(\[\.\.\.leavesBeforeRegister, \.\.\.this\.terminalLeafIds\(\)\]\)\]/);
    expect(text).toMatch(/planAfterLoad\(\{[^}]*\bleavesAtLoad,/);
    expect(text).not.toMatch(/store\.prune\(ids\)/);
  });
});
