import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cmdShimCommandLine, escapeCmdArgument, escapeCmdCommand } from "../src/core/cmd-shim";
import { windowsSettings } from "../src/core/attention";
import { system32Path } from "../src/core/platform-path";
import { type SessionRecord, claudeIdOf } from "../src/core/session-model";
import { Launcher } from "../src/host/launcher";
import { SettingsFiles } from "../src/host/settings-files";
import { fakeSettingsFs } from "./helpers/fake-settings-fs";
import { ON_WINDOWS } from "./helpers/platform";

const START = { startKind: "new" as const, fresh: false, resumeConversations: true, fullscreen: false, effort: "aus" as const, skipPermissions: false };
const EXCLUSION = { settings: { permissions: { deny: ["Read(//V/Vertraulich/**)"] } }, notice: "Ausschluss aktiv: 1 Eintrag gesperrt, Shell-Befehle wie grep -r nicht (Sandbox aus)." };
const settingsOf = (args: string | string[]) => {
  const list = args as string[]; // auf dem Mac immer ein Array (Abend 41: ShellSpawn.args kann unter Windows ein String sein)
  return JSON.parse(list[list.indexOf("--settings") + 1]);
};

describe("Launcher mit Ausschluss (Abend 33)", () => {
  let dir: string;
  const saved = { PATH: process.env.PATH, SHELL: process.env.SHELL };
  const record: SessionRecord = { id: "33333333-3333-4333-8333-333333333333", name: "c", kind: "claude", cwd: "", createdAt: "2026-10-13T00:00:00.000Z" };
  const shell: SessionRecord = { id: "44444444-4444-4444-8444-444444444444", name: "Shell", kind: "shell", cwd: "/tmp", createdAt: "2026-10-13T00:00:00.000Z" };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "exclusion-launch-"));
    writeFileSync(join(dir, "claude"), "#!/bin/sh\n");
    chmodSync(join(dir, "claude"), 0o755);
    process.env.PATH = `${dir}:${saved.PATH ?? ""}`;
    process.env.SHELL = "/bin/sh";
    record.cwd = dir; // Arbeitsordner außerhalb des Vault-Pfads /V (Review Focus)
  });
  afterAll(() => {
    process.env.PATH = saved.PATH;
    process.env.SHELL = saved.SHELL;
    rmSync(dir, { recursive: true, force: true });
  });

  // Windows: Launcher liest PATH über /bin/sh, claude-Attrappe mit chmod 0o755 (Inventur H17)
  it.skipIf(ON_WINDOWS)("ohne Ausschluss: --settings nur mit Hooks, keine Zeile", async () => {
    const plan = await new Launcher(() => undefined, () => null, undefined, { platform: "darwin", env: () => process.env }).plan(record, START);
    if (!plan.ok) throw new Error("Plan nicht ok");
    expect(Object.keys(settingsOf(plan.spawn.args))).toEqual(["hooks"]);
    expect(plan.notice).toBeNull();
  });
  // Windows: Launcher liest PATH über /bin/sh, claude-Attrappe mit chmod 0o755 (Inventur H17)
  it.skipIf(ON_WINDOWS)("mit Ausschluss: Regeln neben den Hooks, Zeile in der Pane, egal welcher Arbeitsordner", async () => {
    const plan = await new Launcher(() => undefined, () => null, undefined, { platform: "darwin", env: () => process.env }).plan(record, { ...START, exclusion: EXCLUSION });
    if (!plan.ok) throw new Error("Plan nicht ok");
    const s = settingsOf(plan.spawn.args);
    expect(s.permissions).toEqual({ deny: ["Read(//V/Vertraulich/**)"] });
    expect(s.hooks).toBeDefined();
    expect(plan.notice).toBe(EXCLUSION.notice);
  });
  // Windows: Launcher liest PATH über /bin/sh, claude-Attrappe mit chmod 0o755 (Inventur H17)
  it.skipIf(ON_WINDOWS)("Wiederherstellen: Zeile steht unter dem bisherigen Hinweis (Review Focus)", async () => {
    const plan = await new Launcher(() => undefined, () => null, undefined, { platform: "darwin", env: () => process.env }).plan(record, { ...START, startKind: "restore", exclusion: EXCLUSION });
    if (!plan.ok) throw new Error("Plan nicht ok");
    expect(plan.notice).toBe(`Keine gespeicherte Unterhaltung gefunden, Claude startet frisch.\n${EXCLUSION.notice}`);
    expect(settingsOf(plan.spawn.args).permissions).toBeDefined();
  });
  it("Shell-Tab: keine Regeln, keine Zeile", async () => {
    const plan = await new Launcher(() => undefined, () => null, undefined, { platform: "darwin", env: () => process.env }).plan(shell, { ...START, exclusion: EXCLUSION });
    if (!plan.ok) throw new Error("Plan nicht ok");
    expect(plan.spawn.args).not.toContain("--settings");
    expect(plan.notice).toBeNull();
  });
});

const PLUGIN_DIR = "C:\\Users\\Jürgen Müller\\Mein Vault\\.obsidian\\plugins\\glasscockpit";
const WIN_ENV = { Path: "C:\\b", USERPROFILE: "C:\\Users\\x", SystemRoot: "D:\\Win" };
const WIN_PS = system32Path("D:\\Win", "WindowsPowerShell", "v1.0", "powershell.exe");
const hookCommands = (settings: { hooks: Record<string, { hooks: { command: string }[] }[]> }) =>
  Object.values(settings.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));

describe("Launcher unter Windows: Settings-Datei und claude.cmd (Abend 41)", () => {
  let cwd: string;
  const record: SessionRecord = { id: "55555555-5555-4555-8555-555555555555", name: "w", kind: "claude", cwd: "", createdAt: "2026-10-21T00:00:00.000Z" };
  const settingsPath = `${PLUGIN_DIR}\\.sessions\\${claudeIdOf(record)}.settings.json`;
  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), "win-launch-"));
    record.cwd = cwd;
  });
  afterAll(() => rmSync(cwd, { recursive: true, force: true }));

  const launcher = (vorhanden: string[], dir: string | null = PLUGIN_DIR, systemRoot: string | null = "D:\\Win") => {
    const fake = fakeSettingsFs();
    const settingsFiles = new SettingsFiles(dir, fake.fs);
    const l = new Launcher(() => undefined, () => null, 100, {
      platform: "win32", env: () => WIN_ENV, exists: (p) => vorhanden.includes(p), settingsFiles, systemRoot: systemRoot ?? undefined,
    });
    return { l, fake };
  };

  it("claude.exe: direkt gestartet, --settings mit Dateipfad (kein JSON), Datei hat die Ausschluss-Einstellungen und Hooks über powershell.exe aus System32", async () => {
    const { l, fake } = launcher(["C:\\b\\claude.exe"]);
    const plan = await l.plan(record, { ...START, exclusion: EXCLUSION });
    if (!plan.ok) throw new Error(`Plan nicht ok: ${plan.message}`);
    expect(plan.spawn.file).toBe("C:\\b\\claude.exe");
    expect(Array.isArray(plan.spawn.args)).toBe(true);
    const args = plan.spawn.args as string[];
    expect(args[args.indexOf("--settings") + 1]).toBe(settingsPath);
    const geschrieben = JSON.parse(fake.files.get(settingsPath) ?? "null");
    expect(geschrieben).toEqual({ ...EXCLUSION.settings, hooks: JSON.parse(windowsSettings({}, WIN_PS)).hooks });
    expect(hookCommands(geschrieben)).toEqual(Array(6).fill(WIN_PS));
    expect(plan.notice).toBe(EXCLUSION.notice);
    expect(plan.notice).not.toContain("ohne Wirkung");
  });

  it("Notice unter Windows gleich der vom Mac (jede Variante der Ausschluss-Meldung), nichts wird ersetzt", async () => {
    const { l } = launcher(["C:\\b\\claude.exe"]);
    for (const notice of [EXCLUSION.notice, "Ausschluss NICHT aktiv: app.json nicht lesbar (x).", "Ausschluss unter Windows nur für Vaults auf einem Laufwerk (C:\\…), nicht auf einem Netzwerkpfad."]) {
      const plan = await l.plan(record, { ...START, exclusion: { settings: {}, notice } });
      if (!plan.ok) throw new Error(`Plan nicht ok: ${plan.message}`);
      expect(plan.notice).toBe(notice);
    }
  });

  it("Wächter: WIN_EXCLUSION_NOTICE und der Text „noch ohne Wirkung“ stehen nicht mehr im Launcher", () => {
    const code = readFileSync(join(__dirname, "..", "src/host/launcher.ts"), "utf8");
    expect(code).not.toContain("WIN_EXCLUSION_NOTICE");
    expect(code).not.toContain("noch ohne Wirkung");
    // Positivprobe: die Suche findet im Launcher etwas Bekanntes.
    expect(code).toContain("NO_VAULT_DIR");
  });

  it("ohne Ausschluss: Datei mit genau den Hooks (wie auf dem Mac)", async () => {
    const { l, fake } = launcher(["C:\\b\\claude.exe"]);
    const plan = await l.plan(record, START);
    if (!plan.ok) throw new Error(`Plan nicht ok: ${plan.message}`);
    const geschrieben = JSON.parse(fake.files.get(settingsPath) ?? "null");
    expect(Object.keys(geschrieben)).toEqual(["hooks"]);
    expect(Object.keys(geschrieben.hooks)).toHaveLength(6);
    expect(geschrieben).toEqual({ hooks: JSON.parse(windowsSettings({}, WIN_PS)).hooks });
  });

  it("ohne SystemRoot: powershell.exe aus C:\\Windows\\System32, nie über PATH", async () => {
    const { l, fake } = launcher(["C:\\b\\claude.exe"], PLUGIN_DIR, null);
    const plan = await l.plan(record, START);
    if (!plan.ok) throw new Error(`Plan nicht ok: ${plan.message}`);
    expect(hookCommands(JSON.parse(fake.files.get(settingsPath) ?? "null"))).toEqual(
      Array(6).fill("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
    );
  });

  it("nur claude.cmd: cmd.exe aus System32 des SystemRoot, args ist die Befehlszeile aus cmdShimCommandLine", async () => {
    const { l } = launcher(["C:\\b\\claude.cmd"]);
    const plan = await l.plan(record, { ...START, prompt: "a&b %PATH%" });
    if (!plan.ok) throw new Error(`Plan nicht ok: ${plan.message}`);
    expect(plan.spawn.file).toBe(system32Path("D:\\Win", "cmd.exe"));
    expect(plan.spawn.file).toBe("D:\\Win\\System32\\cmd.exe");
    expect(typeof plan.spawn.args).toBe("string");
    const zeile = plan.spawn.args as string;
    expect(zeile.startsWith('/d /s /c "')).toBe(true);
    expect(zeile).toContain(`"${escapeCmdCommand("C:\\b\\claude.cmd")} `);
    expect(zeile).toContain(`${escapeCmdArgument("--settings")} ${escapeCmdArgument(settingsPath)}`);
    expect(zeile).toContain(escapeCmdArgument("a&b %PATH%"));
    expect(zeile).toBe(cmdShimCommandLine("C:\\b\\claude.cmd", ["--session-id", claudeIdOf(record), "--name", "w", "--settings", settingsPath, "a&b %PATH%"]));
  });

  // cmd.exe verarbeitet höchstens 8191 Zeichen Befehlszeile (cmd.exe-Pfad, Leerzeichen und Argumentzeile zusammen).
  it("claude.cmd: Befehlszeile genau 8191 Zeichen ist ok, 8192 liefert die Meldung und hinterlässt keine Settings-Datei", async () => {
    const { l, fake } = launcher(["C:\\b\\claude.cmd"]);
    const probe = await l.plan(record, { ...START, prompt: "x" });
    if (!probe.ok) throw new Error(`Plan nicht ok: ${probe.message}`);
    const laenge = (p: Awaited<ReturnType<typeof l.plan>>) => (p.ok ? `${p.spawn.file} ${p.spawn.args as string}`.length : -1);
    const n = 8191 - laenge(probe) + 1; // jedes "x" bleibt ein Zeichen
    const genau = await l.plan(record, { ...START, prompt: "x".repeat(n) });
    expect(laenge(genau)).toBe(8191);
    expect(genau.ok).toBe(true);
    fake.files.clear();
    const zuLang = await l.plan(record, { ...START, prompt: "x".repeat(n + 1) });
    expect(zuLang).toEqual({ ok: false, message: "Befehlszeile für claude.cmd zu lang (8192 von 8191 Zeichen). Startnachricht kürzen oder claude.exe installieren." });
    expect(fake.files.size).toBe(0);
  });

  it("claude.exe: keine Längengrenze (Array, kein cmd.exe)", async () => {
    const { l } = launcher(["C:\\b\\claude.exe"]);
    const plan = await l.plan(record, { ...START, prompt: "x".repeat(20000) });
    expect(plan.ok).toBe(true);
  });

  it("ohne systemRoot-Option gilt C:\\Windows", async () => {
    const { l } = launcher(["C:\\b\\claude.cmd"], PLUGIN_DIR, null);
    const plan = await l.plan(record, START);
    if (!plan.ok) throw new Error(`Plan nicht ok: ${plan.message}`);
    expect(plan.spawn.file).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("Ordner mit .exe und .cmd: .exe gewinnt", async () => {
    const { l } = launcher(["C:\\b\\claude.cmd", "C:\\b\\claude.exe"]);
    const plan = await l.plan(record, START);
    if (!plan.ok) throw new Error("Plan nicht ok");
    expect(plan.spawn.file).toBe("C:\\b\\claude.exe");
  });

  it("ohne Plugin-Ordner: Meldung, Claude startet nicht", async () => {
    const { l } = launcher(["C:\\b\\claude.exe"], null);
    expect(await l.plan(record, START)).toEqual({ ok: false, message: "Unter Windows braucht Glasscockpit einen Vault-Ordner auf der Festplatte." });
  });

  it("ohne SettingsFiles in den Optionen genauso", async () => {
    const l = new Launcher(() => undefined, () => null, 100, { platform: "win32", env: () => WIN_ENV, exists: () => true });
    expect(await l.plan(record, START)).toEqual({ ok: false, message: "Unter Windows braucht Glasscockpit einen Vault-Ordner auf der Festplatte." });
  });

  it("Schreiben der Datei scheitert: Meldung mit Ursache statt Wurf", async () => {
    const { l, fake } = launcher(["C:\\b\\claude.exe"]);
    fake.fs.writeFileSync = () => {
      throw new Error("ENOSPC");
    };
    const plan = await l.plan(record, START);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain("ENOSPC");
  });

  it("Shell-Tab schreibt keine Datei", async () => {
    const { l, fake } = launcher(["C:\\b\\claude.exe"]);
    const shellRecord: SessionRecord = { id: "77777777-7777-4777-8777-777777777777", name: "Shell", kind: "shell", cwd: cwd, createdAt: "2026-10-21T00:00:00.000Z" };
    await l.plan(shellRecord, START);
    expect(fake.calls).toEqual([]);
  });
});

describe("Launcher auf darwin: Mac unverändert (Abend 41)", () => {
  let dir: string;
  const record: SessionRecord = { id: "66666666-6666-4666-8666-666666666666", name: "m", kind: "claude", cwd: "", createdAt: "2026-10-21T00:00:00.000Z" };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mac-launch-"));
    writeFileSync(join(dir, "claude"), "#!/bin/sh\n");
    chmodSync(join(dir, "claude"), 0o755);
    record.cwd = dir;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(ON_WINDOWS)("--settings mit JSON wie bisher, SettingsFiles.write nie aufgerufen", async () => {
    const settingsFiles = { write: vi.fn(() => "x"), remove: vi.fn(), clear: vi.fn() } as unknown as SettingsFiles;
    const env = { PATH: dir, SHELL: "/bin/sh" };
    const l = new Launcher(() => undefined, () => null, 100, { platform: "darwin", env: () => env, settingsFiles });
    const plan = await l.plan(record, { ...START, exclusion: EXCLUSION });
    if (!plan.ok) throw new Error(`Plan nicht ok: ${plan.message}`);
    expect(typeof plan.spawn.args).not.toBe("string");
    const s = settingsOf(plan.spawn.args);
    expect(s.hooks).toBeDefined();
    expect(s.permissions).toEqual(EXCLUSION.settings.permissions);
    expect(settingsFiles.write).not.toHaveBeenCalled();
  });
});

describe("Launcher: Shell-Tabs (Abend 41, Task 3)", () => {
  const shell: SessionRecord = { id: "88888888-8888-4888-8888-888888888888", name: "Shell", kind: "shell", cwd: "/tmp", createdAt: "2026-10-21T00:00:00.000Z" };
  const win = (vorhanden: string[], env: Record<string, string | undefined> = WIN_ENV) =>
    new Launcher(() => undefined, () => null, 100, { platform: "win32", env: () => env, exists: (p) => vorhanden.includes(p), systemRoot: "D:\\Win" });

  it("win32: pwsh.exe aus den PATH-Ordnern des Launchers, -NoLogo, Env aus den Optionen", async () => {
    const plan = await win(["C:\\b\\pwsh.exe"]).plan(shell, START);
    if (!plan.ok) throw new Error(`Plan nicht ok: ${plan.message}`);
    expect(plan.spawn.file).toBe("C:\\b\\pwsh.exe");
    expect(plan.spawn.args).toEqual(["-NoLogo"]);
    expect(plan.spawn.env).toEqual({ ...WIN_ENV, TERM: "xterm-256color", COLORTERM: "truecolor" });
    expect(plan.meta.kind).toBe("shell");
  });

  it("win32: feste Ordner (WinGet) zählen mit", async () => {
    const plan = await win(["C:\\Users\\x\\.local\\bin\\pwsh.exe"]).plan(shell, START);
    if (!plan.ok) throw new Error(`Plan nicht ok: ${plan.message}`);
    expect(plan.spawn.file).toBe("C:\\Users\\x\\.local\\bin\\pwsh.exe");
  });

  it("win32 ohne pwsh: Windows PowerShell unter dem SystemRoot der Optionen", async () => {
    const plan = await win([]).plan(shell, START);
    if (!plan.ok) throw new Error(`Plan nicht ok: ${plan.message}`);
    expect(plan.spawn.file).toBe("D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  });

  it("win32 mit eingestellter Shell: dieser Pfad ohne Argumente", async () => {
    const plan = await win(["D:\\tools\\nu.exe", "C:\\b\\pwsh.exe"]).plan(shell, { ...START, windowsShell: "D:\\tools\\nu.exe" });
    if (!plan.ok) throw new Error(`Plan nicht ok: ${plan.message}`);
    expect(plan.spawn).toMatchObject({ file: "D:\\tools\\nu.exe", args: [] });
  });

  it("win32 mit fehlender eingestellter Shell: Meldung statt Plan", async () => {
    expect(await win(["C:\\b\\pwsh.exe"]).plan(shell, { ...START, windowsShell: "D:\\tools\\nu.exe" })).toEqual({
      ok: false, message: "Shell nicht gefunden: D:\\tools\\nu.exe",
    });
  });

  it("darwin: $SHELL aus der Env der Optionen, -l, windowsShell wirkungslos", async () => {
    const l = new Launcher(() => undefined, () => null, 100, { platform: "darwin", env: () => ({ SHELL: "/bin/fish", PATH: "/usr/bin" }) });
    const plan = await l.plan(shell, { ...START, windowsShell: "D:\\x.exe" });
    if (!plan.ok) throw new Error(`Plan nicht ok: ${plan.message}`);
    expect(plan.spawn).toMatchObject({ file: "/bin/fish", args: ["-l"] });
    expect(plan.spawn.env).toEqual({ SHELL: "/bin/fish", PATH: "/usr/bin", TERM: "xterm-256color", COLORTERM: "truecolor" });
  });
});
