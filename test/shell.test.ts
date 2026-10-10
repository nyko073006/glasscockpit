import { describe, expect, it } from "vitest";
import {
  buildShellSpawn,
  canResize,
  nativePaths,
  redTerminalText,
  sessionEndedLine,
  startSize,
  stoppedLine,
  grayLine,
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
  const P = "/Vault/.obsidian/plugins/glasscockpit";

  it("native/<platform>-<arch>/ in der Struktur des npm-Pakets", () => {
    expect(nativePaths(P, "darwin", "arm64")).toEqual({
      nativeDir: `${P}/native`,
      indexJs: `${P}/native/darwin-arm64/lib/index.js`,
      ptyNode: `${P}/native/darwin-arm64/prebuilds/darwin-arm64/pty.node`,
      spawnHelper: `${P}/native/darwin-arm64/prebuilds/darwin-arm64/spawn-helper`,
    });
  });

  it("Plattform und Arch kommen aus den Argumenten", () => {
    expect(nativePaths(P, "darwin", "x64").ptyNode).toBe(`${P}/native/darwin-x64/prebuilds/darwin-x64/pty.node`);
  });

  it("abschließender Schrägstrich am Plugin-Ordner stört nicht", () => {
    expect(nativePaths(`${P}/`, "darwin", "arm64").nativeDir).toBe(`${P}/native`);
  });

  it("x64 hat denselben Aufbau wie arm64 (vollständig)", () => {
    expect(nativePaths(P, "darwin", "x64")).toEqual({
      nativeDir: `${P}/native`,
      indexJs: `${P}/native/darwin-x64/lib/index.js`,
      ptyNode: `${P}/native/darwin-x64/prebuilds/darwin-x64/pty.node`,
      spawnHelper: `${P}/native/darwin-x64/prebuilds/darwin-x64/spawn-helper`,
    });
  });

  it.each([
    ["win32", "x64"],
    ["linux", "x64"],
    ["darwin", "ia32"],
    ["darwin", "ppc64"],
  ])("%s/%s: klare Fehlermeldung statt erfundenem Pfad", (platform, arch) => {
    expect(() => nativePaths(P, platform, arch)).toThrow("nur macOS arm64/x64");
    expect(() => nativePaths(P, platform, arch)).toThrow(`${platform}-${arch}`);
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
