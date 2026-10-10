import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fieldValues } from "../src/core/cockpit-panels";
import type { CockpitFeed } from "../src/core/cockpit-feed";
import { PullState, formatPullStatus } from "../src/core/pull-state";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { radarShort, radarShorts } from "../src/core/unset";
import { personalTerms } from "./helpers/denylist";
import { PullController } from "../src/host/git-pull";

// Abend 21.2: sichtbare Seite von „nicht eingerichtet“. Logik hier, Zeichnen in cockpit-fields-layout.test.ts.

const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

describe("radarShorts: Kürzel sind innerhalb der sichtbaren Radare eindeutig", () => {
  it("verschiedene Namen behalten das Kürzel wie bisher", () => {
    expect(radarShorts(["Projekt-Monitor", "AV-Lager"])).toEqual(["PR", "AV"]);
    expect(radarShorts(["Test"])).toEqual([radarShort("Test")]);
  });
  it("Radar 1 und Radar 2 sind unterscheidbar", () => {
    const [a, b] = radarShorts(["Radar 1", "Radar 2"]);
    expect(a).not.toBe(b);
    expect([a, b]).toEqual(["R1", "R2"]);
  });
  it("gleiche Namen und leere Namen bleiben unterscheidbar", () => {
    const [a, b] = radarShorts(["Test", "Test"]);
    expect(a).not.toBe(b);
    const [c, d] = radarShorts(["", ""]);
    expect(c).not.toBe(d);
  });
});

describe("fieldValues: Lint-Taste nur mit lintCommand", () => {
  const fs = { contextWarn: 150_000, contextHandoff: 175_000, tokensDayMedian: 340_000, tokensDayP90: 870_000, lintAfterDays: 7 };
  const feed: CockpitFeed = {
    sessions: [], active: null, handoffs: [], tokensToday: null, focus: [], vault: null, repos: null, day: null,
    unset: { projects: false, briefings: false, inbox: false, index: false, daily: false },
    radars: [], effort: "high", telegramOn: false, soundOn: false,
  };
  it("leer oder nur Leerzeichen: keine Taste; mit Befehl: Taste", () => {
    expect(fieldValues(feed, { ...fs, lintCommand: "" }, 0).vault.lint).toBe(false);
    expect(fieldValues(feed, { ...fs, lintCommand: "  " }, 0).vault.lint).toBe(false);
    expect(fieldValues(feed, { ...fs, lintCommand: "/lint" }, 0).vault.lint).toBe(true);
  });
});

describe("Pull ohne Briefing-Ordner", () => {
  it("Zustand „unset“ sagt, was einzustellen ist", () => {
    const p = new PullState();
    p.setUnset(5);
    expect(p.snapshot()).toEqual({ status: "unset", at: 5, error: null });
    expect(formatPullStatus(p.snapshot(), () => "t").text).toBe("nicht eingerichtet: Einstellung „Briefing-Ordner“");
  });
  it("leerer briefingsDir: kein git pull, auch wenn in der Vault-Wurzel ein .git liegt", async () => {
    const base = mkdtempSync(join(tmpdir(), "cockpit-pull-"));
    mkdirSync(join(base, ".git"));
    let pathDirsAufrufe = 0;
    const c = new PullController({
      vaultBase: () => base,
      settings: () => ({ ...DEFAULT_SETTINGS, briefingsDir: "" }),
      pathDirs: async () => { pathDirsAufrufe++; return []; },
      now: () => 1,
    });
    await c.pullNow();
    expect(pathDirsAufrufe).toBe(0);
    expect(c.state.snapshot().status).toBe("unset");
  });
});

describe("Pull-Karte der Listenansicht (Fix 21.2)", () => {
  it("bei „unset“ gibt es den Knopf in die Einstellungen", () => {
    const v = src("src/host/dashboard-view.ts");
    expect(v).toMatch(/hidden = s\.status !== "unset"/);
    expect(v).toMatch(/pullSettingsButton/);
    expect(v).toMatch(/OPEN_SETTINGS_TEXT[^;]*pullSettingsButton|pullSettingsButton[^;]*OPEN_SETTINGS_TEXT|cockpit-unset-open/);
  });
});

describe("Sprung in die Einstellungen: eine Stelle, mit Rückfall", () => {
  it("open-settings.ts kapselt app.setting, öffnet den Tab des Plugins und fällt auf open() zurück", () => {
    const s = src("src/host/open-settings.ts");
    expect(s).toMatch(/openTabById/);
    expect(s).toMatch(/\.open\(\)/);
    expect(s).toMatch(/typeof [\w.]*openTabById === "function"/);
  });
  it("nur open-settings.ts greift auf app.setting zu; Plugin und Briefing-Karte nutzen den Helfer", () => {
    for (const f of ["src/main.ts", "src/host/dashboard-view.ts", "src/host/cockpit-layout.ts"]) expect(src(f)).not.toMatch(/\.setting\b/);
    expect(src("src/main.ts")).toMatch(/openCockpitSettings\(this\.app, this\.manifest\.id\)/);
    expect(src("src/host/dashboard-view.ts")).toMatch(/this\.deps\.actions\.openSettings\(\)/);
  });
  const RADAR_QUELLEN = ["src/core/radar-lamp.ts", "src/host/feed-source.ts", "src/core/feed-compose.ts", "src/core/cockpit-panels.ts"];
  it("keine festen Radar-Namen im Quelltext", () => {
    for (const f of RADAR_QUELLEN) for (const wort of ["Projekt-Monitor", "AV-Lager"]) expect(src(f).toLowerCase()).not.toContain(wort.toLowerCase());
  });
  it.skipIf(personalTerms().length === 0)("keine persönlichen Begriffe im Radar-Quelltext (übersprungen ohne lokale Sperrliste)", () => {
    for (const f of RADAR_QUELLEN) for (const wort of personalTerms()) expect(src(f).toLowerCase()).not.toContain(wort);
  });
});
