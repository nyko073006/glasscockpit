import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RADAR_FULL_HINT, RADAR_VISIBLE_HINT, addRadar, canAddRadar, removeRadar, renameRadar, setRadarFile } from "../src/core/radar-list";
import { SessionStore } from "../src/core/session-store";
import { FakeTimers } from "./helpers/fakes";
import { DEFAULT_SETTINGS, parseSettings, validateSetting, type RadarEntry } from "../src/core/settings";
import { RADAR_SLOTS } from "../src/core/constants";

// Abend 21.3: Radar-Liste der Einstellungsseite als reine Logik.
const one: RadarEntry[] = [{ name: "Test", stateFile: "~/x/state.json" }];

describe("Radar-Liste bearbeiten", () => {
  it("hinzufügen hängt einen leeren Eintrag an, ohne die Eingabe zu ändern", () => {
    const out = addRadar([]);
    expect(out).toEqual([{ name: "", stateFile: "" }]);
    expect(one).toHaveLength(1);
    expect(addRadar(one)).toHaveLength(2);
  });
  it("bei voller Liste (RADAR_SLOTS) ist Hinzufügen gesperrt und ändert nichts", () => {
    const full = addRadar(addRadar([]));
    expect(full).toHaveLength(RADAR_SLOTS);
    expect(canAddRadar([])).toBe(true);
    expect(canAddRadar(one)).toBe(true);
    expect(canAddRadar(full)).toBe(false);
    expect(addRadar(full)).toEqual(full);
    expect(RADAR_FULL_HINT).toContain(String(RADAR_SLOTS));
    expect(RADAR_VISIBLE_HINT).toContain("zwei");
  });
  it("entfernen nimmt genau den Eintrag, falscher Index ändert nichts", () => {
    const two: RadarEntry[] = [{ name: "A", stateFile: "a" }, { name: "B", stateFile: "b" }];
    expect(removeRadar(two, 0)).toEqual([{ name: "B", stateFile: "b" }]);
    expect(removeRadar(two, 1)).toEqual([{ name: "A", stateFile: "a" }]);
    expect(removeRadar(two, 5)).toEqual(two);
    expect(removeRadar(two, -1)).toEqual(two);
  });
  it("umbenennen und Pfad setzen treffen nur den Eintrag", () => {
    const two: RadarEntry[] = [{ name: "A", stateFile: "a" }, { name: "B", stateFile: "b" }];
    expect(renameRadar(two, 1, "Neu")).toEqual([{ name: "A", stateFile: "a" }, { name: "Neu", stateFile: "b" }]);
    expect(setRadarFile(two, 0, "~/z.json")).toEqual([{ name: "A", stateFile: "~/z.json" }, { name: "B", stateFile: "b" }]);
    expect(renameRadar(two, 9, "x")).toEqual(two);
  });
  it("jedes Ergebnis besteht die Prüfung der Einstellung", () => {
    expect(validateSetting("radars", addRadar(addRadar([])))).toBeNull();
    expect(validateSetting("radars", renameRadar(one, 0, "Test"))).toBeNull();
  });
});

describe("Vault-Ordner: Wurzel-Fallen", () => {
  it.each([".", "./", "./.", "a/./b", " . ", "/./"])("lehnt %j ab", (v) => {
    expect(validateSetting("briefingsDir", v)).not.toBeNull();
    expect(validateSetting("inboxDir", v)).not.toBeNull();
    expect(validateSetting("dailyDir", v)).not.toBeNull();
  });
  it.each(["a/ ../b", "a/ ./b", " .. /a", "..\\x", "a\\..\\b", ".\\", "a\\.\\b", "a/..\\b"])("lehnt versteckte Segmente %j ab", (v) => {
    for (const k of ["briefingsDir", "inboxDir", "dailyDir"] as const) expect(validateSetting(k, v), `${k} ${v}`).not.toBeNull();
    for (const k of ["indexFile", "tasksFile"] as const) expect(validateSetting(k, v + ".md"), `${k} ${v}`).not.toBeNull();
  });
  it("tasksFile: Punkt-Segmente abgelehnt, leer bleibt verboten, normale Datei gültig", () => {
    expect(validateSetting("tasksFile", "./Tasks.md")).not.toBeNull();
    expect(validateSetting("tasksFile", "a/./Tasks.md")).not.toBeNull();
    expect(validateSetting("tasksFile", "a/ .. /Tasks.md")).not.toBeNull();
    expect(validateSetting("tasksFile", "")).not.toBeNull();
    expect(validateSetting("tasksFile", "Cockpit Tasks.md")).toBeNull();
    expect(validateSetting("tasksFile", "Ordner/Cockpit Tasks.md")).toBeNull();
  });
  it("Grund nennt die Wurzel", () => {
    expect(validateSetting("briefingsDir", ".")).toContain("Wurzel");
  });
  it.each(["", "  ", "Briefings", "a/b", "/a/b/", "…/x", ".hidden", "a.b/c"])("lässt %j zu", (v) => {
    expect(validateSetting("briefingsDir", v)).toBeNull();
  });
  it("Dateien: . und .. als Segment werden abgelehnt, eine echte .md-Datei bleibt gültig", () => {
    expect(validateSetting("indexFile", "..")).not.toBeNull();
    expect(validateSetting("indexFile", ".")).not.toBeNull();
    expect(validateSetting("indexFile", "./index.md")).not.toBeNull();
    expect(validateSetting("indexFile", "Ordner/Index.md")).toBeNull();
    expect(validateSetting("indexFile", "")).toBeNull();
  });
});

describe("Einstellungsseite (Quelltext)", () => {
  const src = readFileSync(new URL("../src/host/settings-tab.ts", import.meta.url), "utf8");
  it("hat Lint-Befehl, Radar-Liste mit Entfernen und gesperrtem Hinzufügen", () => {
    expect(src).toContain('"lintCommand", "Lint-Befehl"');
    expect(src).toContain("Entfernen");
    expect(src).toContain("canAddRadar");
    expect(src).toContain("setDisabled(full)");
    expect(src).toContain('updateSetting("radars"');
  });
  it("die fünf Vault-Pfade nennen „Leer = aus“", () => {
    for (const k of ["projectsRoot", "briefingsDir", "inboxDir", "indexFile", "dailyDir"]) {
      const line = src.split("\n").find((l) => l.includes(`textField("${k}"`)) ?? "";
      expect(line, k).toContain("Leer = aus");
    }
  });
});

describe("Radar-Änderung wirkt sofort (Verdrahtung)", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  it("onSettingsChange liest bei geänderter Radar-Liste die Feed-Quelle neu", () => {
    const i = main.indexOf("store.onSettingsChange((s) =>", main.indexOf("const feedSource"));
    expect(i).toBeGreaterThan(-1);
    const block = main.slice(i, i + 500);
    expect(block).toContain("radars");
    expect(block).toContain("feedSource.refresh()");
  });
});
