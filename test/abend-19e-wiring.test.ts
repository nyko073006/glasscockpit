import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const main = (): string => read("src/main.ts");
const at = (text: string, pattern: RegExp): number => {
  const i = text.search(pattern);
  expect(i, String(pattern)).toBeGreaterThanOrEqual(0);
  return i;
};
/** Rumpf einer Methode von ihrer Signatur bis zur schließenden Klammer in Spalte 2. */
const method = (text: string, signature: RegExp): string => {
  const start = at(text, signature);
  const end = text.indexOf("\n  }\n", start);
  expect(end, String(signature)).toBeGreaterThan(start);
  return text.slice(start, end);
};

// Abend 19e, Teil B: Die Cockpit-Ansicht kommt nach Aus und Ein zurück. Obsidian schließt beim Abschalten erst die Tabs des
// zuletzt registrierten Typs (Aufräumer laufen rückwärts); nur ein Aufräumer hinter dem letzten registerView sieht beide Typen noch.
describe("Abend 19e: Merkzettel der Cockpit-Ansicht", () => {
  it("Wächter: setDashboardAtUnload steht hinter dem letzten this.registerView(, im selben Aufräumer wie der Merkzettel der Sitzungen und flush", () => {
    const text = main();
    const views = [...text.matchAll(/this\.registerView\(/g)].map((m) => m.index ?? -1);
    expect(views.length).toBeGreaterThanOrEqual(2);
    const lastView = Math.max(...views);
    // Der letzte registerView ist der des Cockpits; kommt ein weiterer dazu, muss der Wächter bewusst nachgezogen werden.
    expect(text.slice(lastView, lastView + 60)).toMatch(/VIEW_TYPE_DASHBOARD/);
    const calls = [...text.matchAll(/\.setDashboardAtUnload\(this\.dashboardArea\(\)\)/g)].map((m) => m.index ?? -1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeGreaterThan(lastView);
    const blockStart = text.lastIndexOf("this.register(() => {", calls[0]);
    expect(blockStart).toBeGreaterThan(lastView);
    const block = text.slice(blockStart, blockStart + 1200);
    expect(block).toMatch(/store\.setOpenAtUnload\(this\.terminalLeafIds\(\)\)/);
    expect(block).toMatch(/void store\.flush\(\)/);
  });

  it("vor registerView(VIEW_TYPE_DASHBOARD) wird festgehalten, ob die Cockpit-Ansicht offen ist (plugin:reload: danach kurz weg)", () => {
    const text = main();
    const snapshot = at(text, /const dashboardBeforeRegister\s*=\s*this\.app\.workspace\.getLeavesOfType\(VIEW_TYPE_DASHBOARD\)\.length > 0/);
    expect(snapshot).toBeLessThan(at(text, /this\.registerView\(\s*VIEW_TYPE_DASHBOARD/));
  });

  it("beim Laden bekommt planAfterLoad Merkzettel und Lage (vorher oder jetzt offen), beide Merkzettel werden sofort geleert", () => {
    const text = main();
    expect(text).toMatch(/dashboardAtUnload:\s*store\.dashboardAtUnload\(\)/);
    expect(text).toMatch(/dashboardAtLoad:\s*dashboardBeforeRegister\s*\|\|\s*this\.app\.workspace\.getLeavesOfType\(VIEW_TYPE_DASHBOARD\)\.length > 0/);
    const clear = text.slice(at(text, /store\.setOpenAtUnload\(\[\]\)/), at(text, /void this\.reopenLayout\(/));
    expect(clear).toMatch(/store\.setDashboardAtUnload\(null\)/);
  });

  it("Bereich über leaf.getRoot(): leftSplit = left, rightSplit = right, alles andere = main", () => {
    const fn = method(main(), /private areaOfLeaf\(/);
    expect(fn).toMatch(/leaf\.getRoot\(\)/);
    expect(fn).toMatch(/root === this\.app\.workspace\.leftSplit\) return "left"/);
    expect(fn).toMatch(/root === this\.app\.workspace\.rightSplit\) return "right"/);
    expect(fn).toMatch(/return "main"/);
  });

  it("openDashboard legt die Cockpit-Ansicht im gemerkten Bereich an: Seitenleisten über getLeftLeaf(false)/getRightLeaf(false), sonst als Tab", () => {
    const fn = method(main(), /private async openDashboard\(/);
    expect(fn).toMatch(/getLeftLeaf\(false\)/);
    expect(fn).toMatch(/getRightLeaf\(false\)/);
    expect(fn).toMatch(/getLeaf\("tab"\)/);
    expect(fn).toMatch(/getLeavesOfType\(VIEW_TYPE_DASHBOARD\)\[0\]/);
  });

  it("reopenLayout öffnet erst die Cockpit-Ansicht, dann die Sitzungen, und meldet beides in einer Notice", () => {
    const fn = method(main(), /private async reopenLayout\(/);
    expect(fn.indexOf("await this.openDashboard(area)")).toBeGreaterThan(-1);
    expect(fn.indexOf("await this.openDashboard(area)")).toBeLessThan(fn.indexOf("await this.openSession("));
    expect(fn).toMatch(/new Notice\(reopenNotice\(ids\.length, area !== null\)\)/);
  });

  it("die Einstellung heißt „Tabs nach dem Abschalten wieder öffnen“, nennt die Cockpit-Ansicht, der Schlüssel bleibt", () => {
    const tab = read("src/host/settings-tab.ts");
    const i = at(tab, /"reopenAfterDisable"/);
    const field = tab.slice(i, i + 700);
    expect(field).toContain("Tabs nach dem Abschalten wieder öffnen");
    expect(field).toMatch(/Cockpit-Ansicht/);
    expect(tab).not.toContain("Sitzungen nach dem Abschalten wieder öffnen");
  });
});

describe("Abend 19e: Cockpit-Gruppe ohne Sitzungen", () => {
  it("openCockpitSplit reicht alle Sitzungen (sessionCandidates) an planCockpitSplit und zieht jede Umzugs-Sitzung um", () => {
    const fn = method(main(), /private async openCockpitSplit\(/);
    expect(fn).toMatch(/candidates:\s*candidates\.map\(/);
    expect(fn).toMatch(/for \(const id of moving\)/);
  });

  it("ein Cockpit in der Seitenleiste lässt neue Sitzungen im Hauptbereich entstehen, nicht als Split in der Seitenleiste", () => {
    const fn = method(main(), /private newSessionTarget\(/);
    expect(fn).toMatch(/this\.areaOfLeaf\(dashboard\) === "main"/);
    expect(fn).toMatch(/getMostRecentLeaf\(this\.app\.workspace\.rootSplit\)/);
  });
});
