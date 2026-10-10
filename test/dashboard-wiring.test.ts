import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

// Klick ins Dashboard macht das Dashboard zum aktiven Leaf. Wer die Sitzung dort mit getActiveViewOfType sucht,
// findet nie ein Terminal. Sendeziel ist die jüngste Terminal-Sitzung (RecentSessions), über das eine Sende-Primitiv.
describe("Dashboard sendet an die zuletzt aktive Sitzung", () => {
  const view = readFileSync(join(ROOT, "src/host/dashboard-view.ts"), "utf8");
  const main = readFileSync(join(ROOT, "src/main.ts"), "utf8");

  it("die View benutzt nicht getActiveViewOfType und baut keinen eigenen Sendeweg", () => {
    expect(view).not.toMatch(/getActiveViewOfType|getActiveFile|activeLeaf/);
    expect(view).not.toMatch(/manager|\.write\(|buildSend|checkTarget/);
    expect(view).toMatch(/deps\.send\(/);
  });

  it("main.ts verdrahtet send über sendToActive, und das nutzt sendTarget (RecentSessions)", () => {
    expect(main).toMatch(/send:\s*\(text\)\s*=>\s*this\.sendToActive\(buildSend\(text\)\)/);
    expect(main).toMatch(/private sendToActive\([^)]*\)[^{]*\{[^}]*this\.sendTarget\(\)/);
    expect(main).toMatch(/private activeSessionId\(\)[^{]*\{[^}]*this\.recent\.current\(/);
  });

  it("Launcher und Dashboard teilen sendToActive", () => {
    expect(main.match(/this\.sendToActive\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

// Das Dashboard ist eine Flex-Spalte mit fester Höhe, die Karten schneiden mit overflow: hidden ab. Dürften sie
// schrumpfen, stauchte langer Inhalt alle Karten auf Fensterhöhe und schnitt ihr Ende ab, statt die Seite scrollen zu lassen.
describe("Dashboard-Karten schrumpfen nicht", () => {
  const css = readFileSync(join(ROOT, "src/styles.css"), "utf8");
  const block = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/\./g, "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";

  it(".cockpit-card hat flex-shrink 0", () => {
    expect(block(".cockpit-card")).toMatch(/overflow:\s*hidden/);
    expect(block(".cockpit-card")).toMatch(/flex-shrink:\s*0|flex:\s*none/);
  });
});
