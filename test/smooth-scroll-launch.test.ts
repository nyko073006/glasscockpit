import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type SessionRecord, claudeIdOf } from "../src/core/session-model";
import { system32Path } from "../src/core/platform-path";
import { Launcher } from "../src/host/launcher";
import { SettingsFiles } from "../src/host/settings-files";
import { fakeSettingsFs } from "./helpers/fake-settings-fs";
import { ON_WINDOWS } from "./helpers/platform";

// Weich scrollen (Nachtrag 43f): Claude-Sitzungen starten mit abgeschalteter Rad-Beschleunigung und CLAUDE_CODE_SCROLL_SPEED=1.

const START = { startKind: "new" as const, fresh: false, resumeConversations: true, fullscreen: false, effort: "aus" as const, skipPermissions: false };
const EXCLUSION = { settings: { permissions: { deny: ["Read(//V/Vertraulich/**)"] } }, notice: "Ausschluss aktiv." };
const settingsOf = (args: string | string[]) => {
  const list = args as string[];
  return JSON.parse(list[list.indexOf("--settings") + 1]);
};

describe("Launcher mit weichem Scrollen (43f)", () => {
  let dir: string;
  const saved = { PATH: process.env.PATH, SHELL: process.env.SHELL };
  const record: SessionRecord = { id: "66666666-6666-4666-8666-666666666666", name: "s", kind: "claude", cwd: "", createdAt: "2026-11-04T00:00:00.000Z" };
  const shell: SessionRecord = { id: "77777777-7777-4777-8777-777777777777", name: "Shell", kind: "shell", cwd: "/tmp", createdAt: "2026-11-04T00:00:00.000Z" };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "smooth-launch-"));
    writeFileSync(join(dir, "claude"), "#!/bin/sh\n");
    chmodSync(join(dir, "claude"), 0o755);
    process.env.PATH = `${dir}:${saved.PATH ?? ""}`;
    process.env.SHELL = "/bin/sh";
    record.cwd = dir;
  });
  afterAll(() => {
    process.env.PATH = saved.PATH;
    process.env.SHELL = saved.SHELL;
    rmSync(dir, { recursive: true, force: true });
  });
  const mac = (env: Record<string, string | undefined> = process.env) =>
    new Launcher(() => undefined, () => null, undefined, { platform: "darwin", env: () => env });

  it.skipIf(ON_WINDOWS)("an: --settings hat die Abschaltung, Ausschluss-Regeln und Hooks; Variable gesetzt, auch gegen geerbten Wert; meta merkt es", async () => {
    const plan = await mac({ ...process.env, CLAUDE_CODE_SCROLL_SPEED: "7" }).plan(record, { ...START, smoothScroll: true, exclusion: EXCLUSION });
    if (!plan.ok) throw new Error("Plan nicht ok");
    const s = settingsOf(plan.spawn.args);
    expect(s.wheelScrollAccelerationEnabled).toBe(false);
    expect(s.permissions).toEqual(EXCLUSION.settings.permissions);
    expect(s.hooks).toBeDefined();
    expect(plan.spawn.env.CLAUDE_CODE_SCROLL_SPEED).toBe("1");
    expect(plan.meta.smoothScroll).toBe(true);
  });
  it.skipIf(ON_WINDOWS)("aus und fehlend: Argumente gleich, geerbter Wert bleibt, meta ist genau { kind, title }", async () => {
    const env = { ...process.env, CLAUDE_CODE_SCROLL_SPEED: "7" };
    const ohne = await mac(env).plan(record, START);
    const aus = await mac(env).plan(record, { ...START, smoothScroll: false });
    if (!ohne.ok || !aus.ok) throw new Error("Plan nicht ok");
    expect(aus.spawn.args).toEqual(ohne.spawn.args);
    expect(settingsOf(aus.spawn.args)).not.toHaveProperty("wheelScrollAccelerationEnabled");
    expect(aus.spawn.env.CLAUDE_CODE_SCROLL_SPEED).toBe("7");
    expect(ohne.spawn.env.CLAUDE_CODE_SCROLL_SPEED).toBe("7");
    expect(Object.keys(ohne.meta)).toEqual(["kind", "title"]);
    expect(Object.keys(aus.meta)).toEqual(["kind", "title"]);
  });
  it("Shell-Plan mit smoothScroll: kein meta.smoothScroll, keine Variable", async () => {
    const env = { ...process.env };
    delete env.CLAUDE_CODE_SCROLL_SPEED;
    const plan = await mac(env).plan(shell, { ...START, smoothScroll: true });
    if (!plan.ok) throw new Error("Plan nicht ok");
    expect(plan.meta).not.toHaveProperty("smoothScroll");
    expect(plan.spawn.env.CLAUDE_CODE_SCROLL_SPEED).toBeUndefined();
  });

  it("Windows: die Settings-Datei hat die Abschaltung", async () => {
    const pluginDir = "C:\\Users\\x\\Vault\\.obsidian\\plugins\\glasscockpit";
    const fake = fakeSettingsFs();
    const l = new Launcher(() => undefined, () => null, 100, {
      platform: "win32", env: () => ({ Path: "C:\\b", USERPROFILE: "C:\\Users\\x", SystemRoot: "D:\\Win" }),
      exists: (p) => p === "C:\\b\\claude.exe", settingsFiles: new SettingsFiles(pluginDir, fake.fs), systemRoot: "D:\\Win",
    });
    const win: SessionRecord = { ...record, id: "88888888-8888-4888-8888-888888888888", cwd: dir };
    const plan = await l.plan(win, { ...START, smoothScroll: true, exclusion: EXCLUSION });
    if (!plan.ok) throw new Error(`Plan nicht ok: ${plan.message}`);
    const geschrieben = JSON.parse(fake.files.get(`${pluginDir}\\.sessions\\${claudeIdOf(win)}.settings.json`) ?? "null");
    expect(geschrieben.wheelScrollAccelerationEnabled).toBe(false);
    expect(geschrieben.permissions).toEqual(EXCLUSION.settings.permissions);
    expect(system32Path("D:\\Win", "cmd.exe")).toBeTruthy();
    expect(plan.meta.smoothScroll).toBe(true);
    expect(plan.spawn.env.CLAUDE_CODE_SCROLL_SPEED).toBe("1");
  });
});
