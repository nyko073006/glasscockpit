import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, validateSetting } from "../src/core/settings";

// Nachtrag 41c: Schatten am aktiven Tab im hellen Theme, abschaltbar (tabShadow).
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), "utf8");

describe("Einstellung tabShadow", () => {
  it("ist an und nur an/aus", () => {
    expect(DEFAULT_SETTINGS.tabShadow).toBe(true);
    expect(validateSetting("tabShadow", false)).toBeNull();
    expect(validateSetting("tabShadow", "an")).toBe("muss an oder aus sein");
  });

  it("steht auf der Einstellungsseite im Abschnitt Terminal", () => {
    const tab = src("src/host/settings-tab.ts");
    const terminal = tab.slice(tab.indexOf('this.group("Terminal"'), tab.indexOf('this.group("Benachrichtigung"'));
    expect(terminal).toContain('this.toggleField(\n          "tabShadow"');
  });
});

describe("Verdrahtung tabShadow", () => {
  const main = src("src/main.ts");

  it("setzt die Body-Klasse beim Laden, bei Änderung und nimmt sie beim Entladen weg", () => {
    expect(main).toMatch(/toggleClass\(TAB_SHADOW_CLASS, s\.tabShadow\)/);
    expect(main).toMatch(/applyTabShadow\(store\.settings\(\)\)/);
    expect(main).toMatch(/store\.onSettingsChange\(applyTabShadow\)/);
    expect(main).toMatch(/removeClass\(TAB_SHADOW_CLASS\)/);
  });
});

describe("CSS tabShadow", () => {
  const css = src("src/styles.css");

  it("wirkt nur im hellen Theme, nur in der Hauptfläche und nur mit der Klasse", () => {
    const regel = /body\.theme-light\.cockpit-tab-shadow \.workspace-split\.mod-root \.workspace-tab-header-container \.workspace-tab-header\.is-active \{[^}]*filter: drop-shadow\(/;
    expect(css).toMatch(regel);
  });

  it("blendet weich über und steht bei reduzierter Bewegung still", () => {
    expect(css).toMatch(/\.cockpit-tab-shadow \.workspace-split\.mod-root \.workspace-tab-header-container \.workspace-tab-header \{[^}]*transition: filter/);
    const reduziert = css.slice(css.indexOf("/* Tab-Schatten"));
    expect(reduziert).toMatch(/prefers-reduced-motion: reduce\)[^@]*\.cockpit-tab-shadow[^}]*transition: none/);
  });
});
