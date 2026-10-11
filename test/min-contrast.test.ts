import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MIN_CONTRAST } from "../src/core/constants";
import { DEFAULT_SETTINGS, parseSettings, validateSetting } from "../src/core/settings";
import { changedXtermOptions, xtermOptions } from "../src/core/terminal-options";
import { ROOT } from "./helpers/files";

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// Abend 26c: Claude Code schickt den Fragetext fest weiß (ESC[38;2;255;255;255m); im hellen Theme hilft nur xterms minimumContrastRatio.
describe("Mindestkontrast im Terminal (Abend 26c)", () => {
  it("Vorgabe ist 4.5", () => {
    expect(DEFAULT_MIN_CONTRAST).toBe(4.5);
    expect(DEFAULT_SETTINGS.minimumContrast).toBe(4.5);
    expect(parseSettings(undefined).settings.minimumContrast).toBe(4.5);
  });
  it("Bereich 1 bis 21, Dezimalwerte erlaubt, sonst Grund", () => {
    expect(validateSetting("minimumContrast", 1)).toBeNull();
    expect(validateSetting("minimumContrast", 21)).toBeNull();
    expect(validateSetting("minimumContrast", 4.5)).toBeNull();
    expect(validateSetting("minimumContrast", 0.9)).toBe("Zahl von 1 bis 21");
    expect(validateSetting("minimumContrast", 21.1)).toBe("Zahl von 1 bis 21");
    expect(validateSetting("minimumContrast", NaN)).not.toBeNull();
    expect(validateSetting("minimumContrast", "4.5")).not.toBeNull();
  });
  it("beim Laden: Dezimalwert bleibt, außerhalb wird geklemmt, Unfug meldet invalid", () => {
    expect(parseSettings({ minimumContrast: 7.25 }).settings.minimumContrast).toBe(7.25);
    expect(parseSettings({ minimumContrast: 99.5 }).settings.minimumContrast).toBe(21);
    expect(parseSettings({ minimumContrast: 0.2 }).settings.minimumContrast).toBe(1);
    const r = parseSettings({ minimumContrast: "hoch" });
    expect(r.invalid).toEqual(["minimumContrast"]);
    expect(r.settings.minimumContrast).toBe(4.5);
  });
  it("beim Erzeugen übergibt xtermOptions den Wert an minimumContrastRatio", () => {
    expect(xtermOptions({ fontSize: 13, scrollback: 5000, minimumContrast: 4.5 })).toEqual({ fontSize: 13, scrollback: 5000, minimumContrastRatio: 4.5 });
    expect(xtermOptions({ fontSize: 13, scrollback: 5000, minimumContrast: 1 }).minimumContrastRatio).toBe(1);
  });
  it("live: nur Geändertes wird gesetzt, der Kontrast wirkt ohne Neustart", () => {
    const cur = { fontSize: 13, scrollback: 5000, minimumContrastRatio: 1 };
    expect(changedXtermOptions(cur, { fontSize: 13, scrollback: 5000, minimumContrast: 4.5 })).toEqual({ minimumContrastRatio: 4.5 });
    expect(changedXtermOptions(cur, { fontSize: 14, scrollback: 5000, minimumContrast: 1 })).toEqual({ fontSize: 14 });
    expect(changedXtermOptions(cur, { fontSize: 13, scrollback: 5000, minimumContrast: 1 })).toEqual({});
  });
  it("Verdrahtung: Pane nutzt beide Helfer, die View reicht die Einstellung durch", () => {
    const pane = read("src/host/terminal-pane.ts");
    expect(pane).toMatch(/new Terminal\(\{[^}]*\.\.\.xtermOptions\(options\)/s);
    expect(pane).toMatch(/Object\.assign\(this\.term\.options, changedXtermOptions\(this\.term\.options, options\)\)/);
    const view = read("src/host/terminal-view.ts");
    expect(view).toMatch(/const \{ fontSize, scrollback, minimumContrast \} = this\.deps\.settings\(\);\s*return \{ fontSize, scrollback, minimumContrast \};/);
    expect(read("src/host/settings-tab.ts")).toMatch(/numberField\(\s*"minimumContrast", "Mindestkontrast im Terminal"/);
  });
});
