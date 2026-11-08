import { describe, expect, it } from "vitest";
import {
  buildShellSpawn,
  canResize,
  NATIVE_TARGETS,
  nativeLayout,
  nativePaths,
  ptyPlatformOptions,
  redTerminalText,
  sessionEndedLine,
  startSize,
  stoppedLine,
  grayLine,
  windowsBuildProblem,
} from "../src/core/shell";

describe("buildShellSpawn", () => {
  it("$SHELL als Login-Shell im Home-Ordner", () => {
    const spawn = buildShellSpawn({ SHELL: "/opt/homebrew/bin/fish", PATH: "/usr/bin" }, "/Users/alex");
    expect(spawn.file).toBe("/opt/homebrew/bin/fish");
    expect(spawn.args).toEqual(["-l"]);
    expect(spawn.cwd).toBe("/Users/alex");
  });

  it.each([
    ["fehlt", {}],
    ["leer", { SHELL: "" }],
  ])("Rückfall /bin/zsh, wenn $SHELL %s", (_, env) => {
    expect(buildShellSpawn(env, "/Users/alex").file).toBe("/bin/zsh");
  });

  it("Env: alles aus process.env, dazu TERM und COLORTERM, beide überschrieben", () => {
    const spawn = buildShellSpawn({ PATH: "/usr/bin", TERM: "dumb", COLORTERM: "nein", LANG: "de_DE.UTF-8" }, "/h");
    expect(spawn.env).toEqual({
      PATH: "/usr/bin",
      LANG: "de_DE.UTF-8",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    });
  });

  it("Env: undefined-Werte fallen weg, node-pty nimmt nur Strings", () => {
    const spawn = buildShellSpawn({ PATH: "/usr/bin", LEER: undefined }, "/h");
    expect(Object.keys(spawn.env)).not.toContain("LEER");
  });

  it("verändert die übergebene Env nicht", () => {
    const env = { TERM: "dumb" };
    buildShellSpawn(env, "/h");
    expect(env).toEqual({ TERM: "dumb" });
  });
});

describe("buildShellSpawn unter Windows (Abend 41)", () => {
  const PWSH = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
  const DIRS = ["C:\\Windows\\System32", "C:\\Program Files\\PowerShell\\7"];
  const winEnv = { Path: "C:\\Windows\\System32", TERM: "dumb", COLORTERM: "nein" };
  const home = "C:\\Users\\alex";
  const win = (shell: string, vorhanden: string[], dirs: readonly string[] = DIRS, systemRoot?: string) => ({
    shell, dirs, systemRoot, exists: (p: string) => vorhanden.includes(p),
  });

  it("leere Einstellung, pwsh.exe im PATH: pwsh.exe mit -NoLogo im Home-Ordner", () => {
    const spawn = buildShellSpawn(winEnv, home, "win32", win("", [PWSH]));
    expect(spawn).toMatchObject({ file: PWSH, args: ["-NoLogo"], cwd: home });
  });

  it("ohne pwsh.exe: Windows PowerShell aus System32, -NoLogo", () => {
    const spawn = buildShellSpawn(winEnv, home, "win32", win("", []));
    expect(spawn).toMatchObject({ file: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", args: ["-NoLogo"], cwd: home });
  });

  it("ohne pwsh.exe, anderes SystemRoot: der Rückfall folgt SystemRoot", () => {
    const spawn = buildShellSpawn(winEnv, home, "win32", win("", [], DIRS, "D:\\Win"));
    expect(spawn).toMatchObject({ file: "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" });
  });

  it("pwsh.cmd zählt nicht: nur pwsh.exe wird gesucht", () => {
    const cmd = "C:\\Program Files\\PowerShell\\7\\pwsh.cmd";
    const spawn = buildShellSpawn(winEnv, home, "win32", win("", [cmd]));
    expect((spawn as { file: string }).file).toMatch(/powershell\.exe$/);
  });

  it("eingestellte Shell, die es gibt: dieser Pfad, keine Argumente", () => {
    const spawn = buildShellSpawn(winEnv, home, "win32", win("D:\\tools\\nu.exe", ["D:\\tools\\nu.exe", PWSH]));
    expect(spawn).toMatchObject({ file: "D:\\tools\\nu.exe", args: [], cwd: home });
  });

  it("eingestellte Shell, die fehlt: Fehlertext mit dem Pfad, auch wenn pwsh da ist", () => {
    expect(buildShellSpawn(winEnv, home, "win32", win("D:\\tools\\nu.exe", [PWSH]))).toEqual({ error: "Shell nicht gefunden: D:\\tools\\nu.exe" });
  });

  it("umschließende Anführungszeichen („Als Pfad kopieren“) fallen weg: vorhandene Shell", () => {
    const spawn = buildShellSpawn(winEnv, home, "win32", win(' "D:\\tools\\nu.exe" ', ["D:\\tools\\nu.exe"]));
    expect(spawn).toMatchObject({ file: "D:\\tools\\nu.exe", args: [], cwd: home });
  });

  it("umschließende Anführungszeichen: fehlende Shell, Meldung mit bereinigtem Pfad", () => {
    expect(buildShellSpawn(winEnv, home, "win32", win('"D:\\tools\\nu.exe"', []))).toEqual({ error: "Shell nicht gefunden: D:\\tools\\nu.exe" });
  });

  it.each(['"D:\\tools\\nu.exe', 'D:\\tools\\nu.exe"'])("Anführungszeichen nur an einer Seite bleibt: %s", (shell) => {
    expect(buildShellSpawn(winEnv, home, "win32", win(shell, []))).toEqual({ error: `Shell nicht gefunden: ${shell}` });
  });

  it("Env: ohne SHELL-Annahme, Pfad-Schlüssel wie im Original, TERM und COLORTERM überschrieben", () => {
    const spawn = buildShellSpawn(winEnv, home, "win32", win("", [PWSH]));
    expect((spawn as { env: object }).env).toEqual({ Path: "C:\\Windows\\System32", TERM: "xterm-256color", COLORTERM: "truecolor" });
  });

  it("$SHELL in der Env wird unter Windows ignoriert", () => {
    const spawn = buildShellSpawn({ ...winEnv, SHELL: "/bin/bash" }, home, "win32", win("", [PWSH]));
    expect((spawn as { file: string }).file).toBe(PWSH);
  });

  it("darwin bleibt: $SHELL, -l, auch wenn eine Windows-Angabe mitkommt", () => {
    const spawn = buildShellSpawn({ SHELL: "/bin/fish" }, "/Users/alex", "darwin", win("D:\\x.exe", []));
    expect(spawn).toMatchObject({ file: "/bin/fish", args: ["-l"], cwd: "/Users/alex" });
  });

  it("win32 ohne Windows-Angaben: Rückfall powershell.exe statt Wurf", () => {
    const spawn = buildShellSpawn(winEnv, home, "win32");
    expect(spawn).toMatchObject({ file: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", args: ["-NoLogo"] });
  });
});

describe("startSize", () => {
  it("nimmt die Maße der Pane", () => {
    expect(startSize({ cols: 97, rows: 41 })).toEqual({ cols: 97, rows: 41 });
  });

  it("Rückfall 120 mal 30, wenn fit nichts geliefert hat", () => {
    expect(startSize(null)).toEqual({ cols: 120, rows: 30 });
  });
});

describe("canResize", () => {
  it.each([
    [80, 24, true],
    [1, 1, true],
    [0, 24, false],
    [80, 0, false],
    [-1, 24, false],
    [Number.NaN, 24, false],
    [80, Number.POSITIVE_INFINITY, false],
  ])("%s x %s: %s", (cols, rows, erwartet) => {
    expect(canResize(cols, rows)).toBe(erwartet);
  });
});

describe("sessionEndedLine", () => {
  it.each([0, 1, 130])("Exit %s", (code) => {
    expect(sessionEndedLine(code)).toBe(`\r\n[Sitzung beendet, Exit ${code}]\r\n`);
  });
});

describe("stoppedLine", () => {
  it("nennt Neu starten, beginnt und endet mit CRLF", () => {
    const line = stoppedLine();
    expect(line).toBe("\r\n[Sitzung beendet. Tab-Menü → Neu starten]\r\n");
    expect(line).toContain("Neu starten");
  });
});

describe("redTerminalText", () => {
  it("rot, Zeilenenden als CRLF, am Ende zurückgesetzt", () => {
    expect(redTerminalText("eins\nzwei")).toBe("\x1b[31meins\r\nzwei\x1b[0m\r\n");
  });

  it("vorhandene CRLF werden nicht verdoppelt", () => {
    expect(redTerminalText("eins\r\nzwei")).toBe("\x1b[31meins\r\nzwei\x1b[0m\r\n");
  });
});

describe("nativePaths", () => {
  const P = "/Users/alex/vault/.obsidian/plugins/glasscockpit";

  it("native/<platform>-<arch>/ in der Struktur des npm-Pakets", () => {
    const ziel = `${P}/native/darwin-arm64`;
    const pty = `${ziel}/prebuilds/darwin-arm64/pty.node`;
    const helper = `${ziel}/prebuilds/darwin-arm64/spawn-helper`;
    expect(nativePaths(P, "darwin", "arm64")).toEqual({
      nativeDir: `${P}/native`,
      targetDir: ziel,
      indexJs: `${ziel}/lib/index.js`,
      binary: pty,
      executables: [pty, helper],
      required: [`${ziel}/lib/index.js`, pty, helper],
    });
  });

  it("Plattform und Arch kommen aus den Argumenten", () => {
    expect(nativePaths(P, "darwin", "x64").binary).toBe(`${P}/native/darwin-x64/prebuilds/darwin-x64/pty.node`);
  });

  it("abschließender Schrägstrich am Plugin-Ordner stört nicht", () => {
    expect(nativePaths(`${P}/`, "darwin", "arm64").nativeDir).toBe(`${P}/native`);
  });

  it("x64 hat denselben Aufbau wie arm64 (vollständig)", () => {
    const ziel = `${P}/native/darwin-x64`;
    const pty = `${ziel}/prebuilds/darwin-x64/pty.node`;
    const helper = `${ziel}/prebuilds/darwin-x64/spawn-helper`;
    expect(nativePaths(P, "darwin", "x64")).toEqual({
      nativeDir: `${P}/native`,
      targetDir: ziel,
      indexJs: `${ziel}/lib/index.js`,
      binary: pty,
      executables: [pty, helper],
      required: [`${ziel}/lib/index.js`, pty, helper],
    });
  });

  describe("Windows: gemischte Trenner wie bei getBasePath() plus manifest.dir (8.3-Kurzname, Abend 40)", () => {
    const W = "C:\\Users\\RUNNER~1\\vault\\.obsidian/plugins/glasscockpit";
    const ZIEL = "C:\\Users\\RUNNER~1\\vault\\.obsidian\\plugins\\glasscockpit\\native\\win32-x64";

    it("alle Pfade sind reine Windows-Pfade, ohne ausführbare Dateien", () => {
      const p = nativePaths(W, "win32", "x64");
      expect(p).toEqual({
        nativeDir: "C:\\Users\\RUNNER~1\\vault\\.obsidian\\plugins\\glasscockpit\\native",
        targetDir: ZIEL,
        indexJs: `${ZIEL}\\lib\\index.js`,
        binary: `${ZIEL}\\prebuilds\\win32-x64\\conpty.node`,
        executables: [],
        required: [
          `${ZIEL}\\lib\\index.js`,
          `${ZIEL}\\prebuilds\\win32-x64\\conpty.node`,
          `${ZIEL}\\prebuilds\\win32-x64\\conpty\\conpty.dll`,
          `${ZIEL}\\prebuilds\\win32-x64\\conpty\\OpenConsole.exe`,
        ],
      });
    });

    it("kein Feld enthält einen Schrägstrich", () => {
      const p = nativePaths(W, "win32", "x64");
      const alle = [p.nativeDir, p.targetDir, p.indexJs, p.binary, ...p.executables, ...p.required];
      expect(alle.filter((f) => f.includes("/"))).toEqual([]);
    });

    it("arm64 nimmt sein eigenes Ziel", () => {
      expect(nativePaths(W, "win32", "arm64").binary).toBe(
        "C:\\Users\\RUNNER~1\\vault\\.obsidian\\plugins\\glasscockpit\\native\\win32-arm64\\prebuilds\\win32-arm64\\conpty.node",
      );
    });

    it("Langname mit Leerzeichen, Umlaut und Klammern bleibt ein reiner Windows-Pfad", () => {
      const lang = "C:\\Users\\Jürgen Müller\\Mein Vault (ä)\\.obsidian/plugins/glasscockpit";
      const ziel = "C:\\Users\\Jürgen Müller\\Mein Vault (ä)\\.obsidian\\plugins\\glasscockpit\\native\\win32-x64";
      const p = nativePaths(lang, "win32", "x64");
      expect(p).toEqual({
        nativeDir: "C:\\Users\\Jürgen Müller\\Mein Vault (ä)\\.obsidian\\plugins\\glasscockpit\\native",
        targetDir: ziel,
        indexJs: `${ziel}\\lib\\index.js`,
        binary: `${ziel}\\prebuilds\\win32-x64\\conpty.node`,
        executables: [],
        required: [
          `${ziel}\\lib\\index.js`,
          `${ziel}\\prebuilds\\win32-x64\\conpty.node`,
          `${ziel}\\prebuilds\\win32-x64\\conpty\\conpty.dll`,
          `${ziel}\\prebuilds\\win32-x64\\conpty\\OpenConsole.exe`,
        ],
      });
    });
  });

  it.each([
    ["linux", "x64"],
    ["win32", "ia32"],
    ["darwin", "ia32"],
    ["darwin", "ppc64"],
  ])("%s/%s: klare Fehlermeldung statt erfundenem Pfad", (platform, arch) => {
    expect(() => nativePaths(P, platform, arch)).toThrow("nur macOS und Windows");
    expect(() => nativePaths(P, platform, arch)).toThrow(`${platform}-${arch}`);
  });
});

describe("nativeLayout", () => {
  it("darwin: pty.node und spawn-helper sind ausführbar und Pflicht", () => {
    expect(nativeLayout("darwin", "arm64")).toEqual({
      target: "darwin-arm64",
      binary: "prebuilds/darwin-arm64/pty.node",
      executables: ["prebuilds/darwin-arm64/pty.node", "prebuilds/darwin-arm64/spawn-helper"],
      required: ["lib/index.js", "prebuilds/darwin-arm64/pty.node", "prebuilds/darwin-arm64/spawn-helper"],
    });
  });

  it("win32: conpty.node, DLL und OpenConsole sind Pflicht, nichts wird ausführbar gesetzt", () => {
    expect(nativeLayout("win32", "arm64")).toEqual({
      target: "win32-arm64",
      binary: "prebuilds/win32-arm64/conpty.node",
      executables: [],
      required: [
        "lib/index.js",
        "prebuilds/win32-arm64/conpty.node",
        "prebuilds/win32-arm64/conpty/conpty.dll",
        "prebuilds/win32-arm64/conpty/OpenConsole.exe",
      ],
    });
  });

  it.each([...NATIVE_TARGETS])("%s: Pfade relativ, mit Schrägstrich, im Ordner des Ziels", (ziel) => {
    const [platform, arch] = ziel.split("-");
    const l = nativeLayout(platform, arch);
    expect(l.target).toBe(ziel);
    for (const p of [l.binary, ...l.executables, ...l.required]) {
      expect(p, p).toMatch(/^(lib\/index\.js|prebuilds\/[a-z0-9-]+\/[A-Za-z_./-]+)$/);
      expect(p.includes("\\")).toBe(false);
    }
    expect(l.required).toContain(l.binary);
    for (const e of l.executables) expect(l.required).toContain(e);
  });

  it("die Zielliste hat genau die vier Ziele, Mac zuerst", () => {
    expect([...NATIVE_TARGETS]).toEqual(["darwin-arm64", "darwin-x64", "win32-arm64", "win32-x64"]);
  });

  it.each([
    ["linux", "x64"],
    ["win32", "ia32"],
  ])("%s/%s wirft mit dem Ziel", (platform, arch) => {
    expect(() => nativeLayout(platform, arch)).toThrow("nur macOS und Windows");
    expect(() => nativeLayout(platform, arch)).toThrow(`${platform}-${arch}`);
  });
});

describe("grayLine", () => {
  it("graue Zeile mit CRLF davor und danach, Farbe wird zurückgesetzt", () => {
    expect(grayLine("Hinweis")).toBe("\r\n\x1b[90mHinweis\x1b[0m\r\n");
  });
  it("Zeilenumbrüche im Text werden CRLF", () => {
    expect(grayLine("a\nb")).toBe("\r\n\x1b[90ma\r\nb\x1b[0m\r\n");
  });
});

describe("windowsBuildProblem (Abend 40)", () => {
  it.each(["10.0.26100", "10.0.18309"])("%s ist neu genug", (release) => {
    expect(windowsBuildProblem(release)).toBeNull();
  });

  it("Build 18308 ist eins zu alt", () => {
    expect(windowsBuildProblem("10.0.18308")).toBe(
      "Glasscockpit braucht unter Windows mindestens Windows 10 Version 1903 (hier: Build 18308).",
    );
  });

  it("10.0.17763 nennt den Build", () => {
    expect(windowsBuildProblem("10.0.17763")).toBe(
      "Glasscockpit braucht unter Windows mindestens Windows 10 Version 1903 (hier: Build 17763).",
    );
  });

  it("ohne lesbare Nummer steht der Rohtext in der Meldung", () => {
    expect(windowsBuildProblem("kaputt")).toBe(
      "Glasscockpit braucht unter Windows mindestens Windows 10 Version 1903 (hier: kaputt).",
    );
  });

  it("die dritte Zahl zählt, nicht die erste: 18309.0.0 ist zu alt", () => {
    expect(windowsBuildProblem("18309.0.0")).not.toBeNull();
  });
});

describe("ptyPlatformOptions (Abend 40)", () => {
  it("win32: die ConPTY-DLL", () => {
    expect(ptyPlatformOptions("win32")).toStrictEqual({ useConptyDll: true });
  });
  it.each(["darwin", null] as const)("%s: nichts", (platform) => {
    expect(ptyPlatformOptions(platform)).toStrictEqual({});
  });
});
