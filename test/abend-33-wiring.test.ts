import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Quelltext-Wächter für Abend 33 (wie abend-32-wiring): Stellen, die kein Verhaltenstest erreicht.
const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

describe("Abend 33: Verkabelung", () => {
  it("main: Ausschluss je Start berechnet und an den Launcher gegeben, Filter für die Brücke gemerkt", () => {
    const main = read("src/main.ts");
    expect(main).toMatch(/exclusion: await this\.exclusionFor\(store\.settings\(\)\)/);
    expect(main).toMatch(/this\.exclusionFilters = plan\.filters/);
    expect(main).toMatch(/store\.onSettingsChange\(\(\) => void this\.exclusionFor\(store\.settings\(\)\)\)/);
    expect(main).toMatch(/readExclusion\(this\.app\.vault, this\.vaultPath\(\), s\)/);
    expect(read("src/host/launcher.ts")).toContain("hookSettings(start.exclusion?.settings)");
  });
  it("IDE-Brücke: Editor bekommt den Ausschluss, main prüft Einstellung und Filter bei jeder Meldung", () => {
    expect(read("src/host/ide-bridge.ts")).toMatch(/new IdeEditor\([^;]*deps\.excluded/);
    expect(read("src/main.ts")).toMatch(/excluded: \(p\) => store\.settings\(\)\.claudeExclusion && isExcluded\(this\.exclusionFilters, p\)/);
  });
});
