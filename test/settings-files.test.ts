import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsFiles } from "../src/host/settings-files";
import { fakeSettingsFs } from "./helpers/fake-settings-fs";

const DIR = "C:\\Users\\Jürgen Müller\\Mein Vault\\.obsidian\\plugins\\glasscockpit";
const ID = "11111111-1111-4111-8111-111111111111";
const FILE = `${DIR}\\.sessions\\${ID}.settings.json`;

describe("SettingsFiles", () => {
  it("write legt <dir>\\.sessions\\<id>.settings.json an und gibt den Pfad zurück", () => {
    const { fs, files } = fakeSettingsFs();
    const path = new SettingsFiles(DIR, fs).write(ID, '{"a":1}');
    expect(path).toBe(FILE);
    expect(files.get(FILE)).toBe('{"a":1}');
  });
  it("Pfad mit Schrägstrichen im Plugin-Ordner (so liefert ihn pluginDirOf) wird zu Windows-Schreibweise", () => {
    const { fs, files } = fakeSettingsFs();
    const path = new SettingsFiles("C:\\Users\\Jürgen Müller\\Mein Vault/.obsidian/plugins/glasscockpit", fs).write(ID, "{}");
    expect(path).toBe(FILE);
    expect(files.has(FILE)).toBe(true);
  });
  it("schreibt atomar: erst temporäre Datei, dann rename, keine Rest-Datei", () => {
    const { fs, files, calls } = fakeSettingsFs();
    new SettingsFiles(DIR, fs).write(ID, "{}");
    expect(calls.some((c) => c.startsWith("rename ") && c.endsWith(` ${FILE}`))).toBe(true);
    expect([...files.keys()]).toEqual([FILE]);
  });
  it("das zweite write überschreibt", () => {
    const { fs, files } = fakeSettingsFs();
    const sf = new SettingsFiles(DIR, fs);
    sf.write(ID, '{"a":1}');
    sf.write(ID, '{"b":2}');
    expect(files.get(FILE)).toBe('{"b":2}');
    expect(files.size).toBe(1);
  });
  it("remove löscht die Datei; auf eine fehlende Datei wirft es nicht", () => {
    const { fs, files } = fakeSettingsFs();
    const sf = new SettingsFiles(DIR, fs);
    sf.write(ID, "{}");
    sf.remove(ID);
    expect(files.size).toBe(0);
    expect(() => sf.remove(ID)).not.toThrow();
    expect(() => sf.remove("nie-geschrieben")).not.toThrow();
  });
  it("remove wirft nie, auch wenn das Dateisystem wirft", () => {
    const { fs } = fakeSettingsFs();
    fs.rmSync = () => {
      throw new Error("EPERM");
    };
    expect(() => new SettingsFiles(DIR, fs).remove(ID)).not.toThrow();
  });
  it("clear löscht nur *.settings.json im Unterordner .sessions", () => {
    const { fs, files, dirs } = fakeSettingsFs();
    const sf = new SettingsFiles(DIR, fs);
    sf.write(ID, "{}");
    sf.write("22222222-2222-4222-8222-222222222222", "{}");
    dirs.add(`${DIR}\\.sessions`);
    files.set(`${DIR}\\.sessions\\notiz.txt`, "bleibt");
    files.set(`${DIR}\\main.js`, "bleibt");
    files.set(`${DIR}\\x.settings.json`, "bleibt: nicht im Unterordner");
    sf.clear();
    expect([...files.keys()].sort()).toEqual([`${DIR}\\.sessions\\notiz.txt`, `${DIR}\\main.js`, `${DIR}\\x.settings.json`].sort());
  });
  it("clear ohne Unterordner oder bei Dateisystemfehler wirft nicht", () => {
    const { fs } = fakeSettingsFs();
    expect(() => new SettingsFiles(DIR, fs).clear()).not.toThrow();
    fs.readdirSync = () => {
      throw new Error("EACCES");
    };
    expect(() => new SettingsFiles(DIR, fs).clear()).not.toThrow();
  });
  it("ohne Ordner (null): write gibt null, remove und clear tun nichts und werfen nie", () => {
    const { fs, calls } = fakeSettingsFs();
    const sf = new SettingsFiles(null, fs);
    expect(sf.write(ID, "{}")).toBeNull();
    expect(() => sf.remove(ID)).not.toThrow();
    expect(() => sf.clear()).not.toThrow();
    expect(calls).toEqual([]);
  });
  it("write reicht Dateisystemfehler weiter und lässt keine temporäre Datei liegen", () => {
    const { fs, files } = fakeSettingsFs();
    fs.renameSync = () => {
      throw new Error("EPERM");
    };
    expect(() => new SettingsFiles(DIR, fs).write(ID, "{}")).toThrow("EPERM");
    expect(files.size).toBe(0);
  });
});

describe("Verdrahtung in main.ts (Abend 41)", () => {
  const main = readFileSync(resolve(__dirname, "..", "src", "main.ts"), "utf8");
  const body = (name: string) => {
    const start = main.indexOf(name);
    expect(start, `${name} fehlt`).toBeGreaterThan(-1);
    return main.slice(start, main.indexOf("\n  }\n", start));
  };

  it("nur unter Windows bekommt SettingsFiles den Plugin-Ordner, auf dem Mac null", () => {
    expect(main).toContain('new SettingsFiles(platform === "win32" ? pluginDir : null)');
  });
  it("onload leert den Ordner, onunload nach killAll", () => {
    expect(body("async onload()")).toContain("settingsFiles.clear()");
    const unload = body("onunload()");
    expect(unload.indexOf("killAll")).toBeGreaterThan(-1);
    expect(unload.indexOf("settingsFiles?.clear()")).toBeGreaterThan(unload.indexOf("killAll"));
  });
  it("stopSession löscht die Datei der Claude-ID, nicht bei Shell-Tabs", () => {
    const stop = body("private stopSession(");
    expect(stop).toContain("this.settingsFiles?.remove(claudeIdOf(record))");
    expect(stop).toContain('record.kind !== "shell"');
  });
  it("der Launcher bekommt SettingsFiles und SystemRoot aus dem Host", () => {
    expect(main).toMatch(/settingsFiles, systemRoot: process\.env\.SystemRoot \}/);
  });
  it("main.ts reicht SystemRoot ohne eigenen Rückfall weiter, C:\\Windows lebt allein in system32Path (M5)", () => {
    expect(main).not.toMatch(/SystemRoot \?\?/);
    expect(main).not.toContain("C:\\\\Windows");
  });
  it("die Plugin-Einstellung windowsShell geht an den Launcher (M3)", () => {
    expect(main).toMatch(/launcher\.plan\(record, \{[^\n]*windowsShell: store\.settings\(\)\.windowsShell/);
  });
  it("Kill-Optionen unter win32: platform und forceKillTree, auf dem Mac signalGroup (M3)", () => {
    expect(main).toMatch(/platform === "win32"\s*\? \{ platform, forceKillTree: \(pid: number\) => forceKillTree\(pid, process\.env\.SystemRoot\) \}\s*: \{ signalGroup:/);
  });
});
