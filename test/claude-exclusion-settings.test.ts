import { describe, expect, it } from "vitest";
import { applyDependencies, DEFAULT_SETTINGS, dependencyReason, parseSettings } from "../src/core/settings";

describe("Ausschluss-Einstellungen (Abend 33)", () => {
  it("Vorgaben: Sperre an, Sandbox aus; fehlende Schlüssel in geladenen Daten bekommen die Vorgaben", () => {
    expect(DEFAULT_SETTINGS.claudeExclusion).toBe(true);
    expect(DEFAULT_SETTINGS.claudeExclusionSandbox).toBe(false);
    const alt = parseSettings({ skipPermissions: true });
    expect(alt.settings.claudeExclusion).toBe(true);
    expect(alt.settings.claudeExclusionSandbox).toBe(false);
    expect(parseSettings(undefined).settings.claudeExclusion).toBe(true);
  });
  it("gespeicherte Werte bleiben", () => {
    const r = parseSettings({ claudeExclusion: false, claudeExclusionSandbox: false });
    expect(r.settings.claudeExclusion).toBe(false);
    const s = parseSettings({ claudeExclusion: true, claudeExclusionSandbox: true });
    expect(s.settings.claudeExclusionSandbox).toBe(true);
  });
  it("Unsinn fällt auf die Vorgabe und wird gemeldet", () => {
    const kaputt = parseSettings({ claudeExclusion: "ja", claudeExclusionSandbox: 1 });
    expect(kaputt.settings.claudeExclusion).toBe(true);
    expect(kaputt.settings.claudeExclusionSandbox).toBe(false);
    expect(kaputt.invalid).toContain("claudeExclusion");
    expect(kaputt.invalid).toContain("claudeExclusionSandbox");
  });
  it("applyDependencies schaltet nur die Sandbox ab und nur ohne Sperre", () => {
    const aus = { ...DEFAULT_SETTINGS, claudeExclusion: false };
    expect(applyDependencies({ ...aus, claudeExclusionSandbox: true })).toEqual({ ...aus, claudeExclusionSandbox: false });
    expect(applyDependencies({ ...DEFAULT_SETTINGS, claudeExclusionSandbox: true }).claudeExclusionSandbox).toBe(true);
    expect(parseSettings({ claudeExclusion: false, claudeExclusionSandbox: true }).settings.claudeExclusionSandbox).toBe(false);
  });
  it("dependencyReason: Sandbox einschalten ohne Sperre hat einen Grund, alles andere nicht", () => {
    const aus = { ...DEFAULT_SETTINGS, claudeExclusion: false };
    expect(dependencyReason(aus, "claudeExclusionSandbox", true)).toBe("braucht die Sperre ausgeschlossener Dateien");
    expect(dependencyReason(aus, "claudeExclusionSandbox", false)).toBeNull();
    expect(dependencyReason(DEFAULT_SETTINGS, "claudeExclusionSandbox", true)).toBeNull();
    expect(dependencyReason(DEFAULT_SETTINGS, "claudeExclusion", false)).toBeNull();
  });
});
