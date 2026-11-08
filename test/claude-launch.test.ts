import { describe, expect, it } from "vitest";
import { Launcher } from "../src/host/launcher";
import {
  buildArgs,
  buildEnv,
  findBinary,
  headerTitle,
  notFoundMessage,
  shortPath,
  tabTitle,
} from "../src/core/claude-launch";

describe("findBinary", () => {
  it("liefert den ersten Treffer in der Reihenfolge der Verzeichnisse", () => {
    const vorhanden = new Set(["/b/claude", "/c/claude"]);
    expect(findBinary("claude", ["/a", "/b", "/c"], (p) => vorhanden.has(p))).toBe("/b/claude");
  });

  it("fragt jeden Kandidaten als Verzeichnis/Name ab, auch bei Schrägstrich am Ende", () => {
    const gefragt: string[] = [];
    findBinary("claude", ["/a/", "/b"], (p) => (gefragt.push(p), false));
    expect(gefragt).toEqual(["/a/claude", "/b/claude"]);
  });

  it("kein Treffer: null", () => {
    expect(findBinary("claude", ["/a", "/b"], () => false)).toBeNull();
    expect(findBinary("claude", [], () => true)).toBeNull();
  });
});

describe("findBinary unter Windows (Abend 41)", () => {
  it(".exe vor .cmd im selben Ordner, erster Ordner mit Treffer gewinnt", () => {
    const vorhanden = (p: string) => p === "C:\\b\\claude.cmd" || p === "C:\\b\\claude.exe";
    expect(findBinary("claude", ["C:\\a", "C:\\b"], vorhanden, "win32")).toBe("C:\\b\\claude.exe");
  });

  it("nur .cmd vorhanden: der .cmd-Pfad", () => {
    expect(findBinary("claude", ["C:\\a", "C:\\b"], (p) => p === "C:\\b\\claude.cmd", "win32")).toBe("C:\\b\\claude.cmd");
  });

  it("ein Treffer ohne Endung zählt unter Windows nicht", () => {
    expect(findBinary("claude", ["C:\\a"], (p) => p === "C:\\a\\claude", "win32")).toBeNull();
  });

  it("Ordner mit Leerzeichen und Umlaut, Schrägstrich am Ende", () => {
    const gefragt: string[] = [];
    findBinary("claude", ["C:\\Users\\Jürgen Müller\\bin\\"], (p) => (gefragt.push(p), false), "win32");
    expect(gefragt).toEqual(["C:\\Users\\Jürgen Müller\\bin\\claude.exe", "C:\\Users\\Jürgen Müller\\bin\\claude.cmd"]);
  });
});

describe("buildArgs", () => {
  it("Standard: kein Rechte-Flag (Einstellung skipPermissions, Abend 20)", () => {
    expect(buildArgs()).toEqual([]);
  });

  it("skipPermissions false: kein Rechte-Flag, true: das Flag", () => {
    expect(buildArgs({ skipPermissions: false })).toEqual([]);
    expect(buildArgs({ skipPermissions: true })).toEqual(["--dangerously-skip-permissions"]);
  });

  it("mit Agent: --agent= mit dem Namen", () => {
    expect(buildArgs({ agentName: "stefan", skipPermissions: true })).toEqual(["--agent=stefan", "--dangerously-skip-permissions"]);
    expect(buildArgs({ agentName: "stefan", skipPermissions: false })).toEqual(["--agent=stefan"]);
  });

  it("leerer Agent-Name zählt nicht", () => {
    expect(buildArgs({ agentName: "  " })).toEqual([]);
  });

  it("Session-ID und Name als eigene Argumente, ohne Shell-Quoting", () => {
    const id = "0f4b7c1e-2d3a-4b5c-8d9e-0123456789ab";
    expect(buildArgs({ sessionId: id, name: "Vault 09:05", skipPermissions: true })).toEqual([
      "--session-id",
      id,
      "--name",
      "Vault 09:05",
      "--dangerously-skip-permissions",
    ]);
  });

  it("kein Resume, kein Continue", () => {
    const args = buildArgs({ agentName: "a", sessionId: "x", name: "n" });
    expect(args.some((a) => /^--(resume|continue)\b|^-[rc]$/.test(a))).toBe(false);
  });
});

describe("buildEnv", () => {
  const base = { HOME: "/Users/alex", PATH: "/usr/bin", TERM: "dumb", LEER: undefined, LANG: "de_DE.UTF-8" };

  it("übernimmt alle String-Werte aus base, undefined fällt weg", () => {
    const env = buildEnv(base, ["/a"]);
    expect(env.HOME).toBe("/Users/alex");
    expect("LEER" in env).toBe(false);
  });

  it("setzt PATH und die Pflichtvariablen, TERM wird überschrieben", () => {
    const env = buildEnv(base, ["/Users/alex/.local/bin", "/usr/bin"]);
    expect(env.PATH).toBe("/Users/alex/.local/bin:/usr/bin");
    expect(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN).toBe("1");
    expect(env.CLAUDE_CODE_DISABLE_MOUSE).toBe("1");
    expect(env.TERM).toBe("xterm-256color");
    expect(env.COLORTERM).toBe("truecolor");
  });

  it("LANG bleibt, wenn gesetzt", () => {
    expect(buildEnv(base, [], "en_GB.UTF-8").LANG).toBe("de_DE.UTF-8");
  });

  it.each([
    ["fehlt", {}],
    ["leer", { LANG: "" }],
  ])("LANG %s: Wert der Login-Shell", (_, env) => {
    expect(buildEnv(env, [], "de_AT.UTF-8").LANG).toBe("de_AT.UTF-8");
  });

  it("LANG leer und keiner aus der Login-Shell: en_US.UTF-8", () => {
    expect(buildEnv({ LANG: "" }, [], null).LANG).toBe("en_US.UTF-8");
    expect(buildEnv({}, [], "").LANG).toBe("en_US.UTF-8");
  });

  it("Vollbild aus (Vorgabe): klassisch, kein NO_FLICKER", () => {
    for (const env of [buildEnv(base, ["/a"]), buildEnv(base, ["/a"], null, {}, false)]) {
      expect(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN).toBe("1");
      expect(env.CLAUDE_CODE_DISABLE_MOUSE).toBe("1");
      expect("CLAUDE_CODE_NO_FLICKER" in env).toBe(false);
    }
  });

  it("Vollbild an: NO_FLICKER, keine Sperre für Alternate Screen und Maus, auch nicht geerbt (Abend 19f)", () => {
    const geerbt = { ...base, CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1", CLAUDE_CODE_DISABLE_MOUSE: "1" };
    const env = buildEnv(geerbt, ["/a"], null, {}, true);
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("1");
    expect("CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN" in env).toBe(false);
    expect("CLAUDE_CODE_DISABLE_MOUSE" in env).toBe(false);
    expect(env.TERM).toBe("xterm-256color");
  });

  // Startet eine Claude-Sitzung Obsidian neu, erbt jeder Tab ihre Variablen; mit CLAUDE_CODE_CHILD_SESSION
  // speichert claude interaktiv kein Transkript (geprüft an 2.1.306 am 21.10.2026).
  it.each([
    "CLAUDECODE",
    "AI_AGENT",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_INVOKED_SKILLS",
    "CLAUDE_CODE_BRIDGE_SESSION_ID",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SSE_PORT",
    "ENABLE_IDE_INTEGRATION",
  ])("Marker der Elternsitzung fällt weg: %s", (key) => {
    expect(key in buildEnv({ ...base, [key]: "1" }, ["/a"])).toBe(false);
  });

  it("Nutzer-Einstellungen und allgemeine Variablen bleiben", () => {
    const env = buildEnv({ ...base, CLAUDE_CODE_SUBAGENT_MODEL: "sonnet", SHELL: "/bin/zsh", TMPDIR: "/t/" }, ["/a"]);
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("sonnet");
    expect(env.SHELL).toBe("/bin/zsh");
    expect(env.TMPDIR).toBe("/t/");
  });

  it("die eigene IDE-Brücke setzt Port und Schalter trotz Filter (extra kommt danach)", () => {
    const geerbt = { ...base, CLAUDE_CODE_SSE_PORT: "1111", ENABLE_IDE_INTEGRATION: "true" };
    const env = buildEnv(geerbt, ["/a"], null, { ENABLE_IDE_INTEGRATION: "true", CLAUDE_CODE_SSE_PORT: "2222" });
    expect(env.CLAUDE_CODE_SSE_PORT).toBe("2222");
    expect(env.ENABLE_IDE_INTEGRATION).toBe("true");
  });

  it("verändert base nicht", () => {
    const original = { TERM: "dumb" };
    buildEnv(original, ["/a"]);
    expect(original).toEqual({ TERM: "dumb" });
  });
});

describe("Namen und Titel", () => {
  it("Tab-Titel: die ersten 8 Zeichen der ID vorn, dann der Name", () => {
    expect(tabTitle("Vault 09:05", "0f4b7c1e-2d3a-4b5c-8d9e-0123456789ab")).toBe("0f4b7c1e · Vault 09:05");
    expect(tabTitle("claude 4", "90ef2efe-1111-4222-8333-444455556666")).toBe("90ef2efe · claude 4");
  });

  it("Tab-Titel ohne Namen (leer oder nur Leerzeichen) heißt Claude, nie leer", () => {
    expect(tabTitle("", "0f4b7c1e-2d3a")).toBe("0f4b7c1e · Claude");
    expect(tabTitle("   ", "0f4b7c1e-2d3a")).toBe("0f4b7c1e · Claude");
  });
});

describe("buildEnv unter Windows (Abend 41)", () => {
  it("genau ein Path-Schlüssel mit der Schreibweise des Originals, Semikolon, kein PATH", () => {
    const env = buildEnv({ Path: "alt", PATH: "auch", HOME: "h" }, ["C:\\a", "C:\\b"], null, {}, false, "win32");
    expect(env.Path).toBe("C:\\a;C:\\b");
    expect("PATH" in env).toBe(false);
    expect(Object.keys(env).filter((k) => k.toLowerCase() === "path")).toEqual(["Path"]);
    expect(env.HOME).toBe("h");
    expect(env.TERM).toBe("xterm-256color");
  });

  it("buildEnv({ Path: alt }) ersetzt den Wert", () => {
    const env = buildEnv({ Path: "alt" }, ["C:\\a"], null, {}, false, "win32");
    expect(env.Path).toBe("C:\\a");
    expect("PATH" in env).toBe(false);
  });

  it("ohne Plattform bleibt es der Mac: PATH mit Doppelpunkt", () => {
    expect(buildEnv({ PATH: "alt" }, ["/a", "/b"]).PATH).toBe("/a:/b");
  });
});

describe("notFoundMessage", () => {
  it("nennt das Programm und jedes durchsuchte Verzeichnis", () => {
    const text = notFoundMessage("claude", ["/Users/alex/.local/bin", "/opt/homebrew/bin"]);
    expect(text).toContain("claude nicht gefunden");
    expect(text).toContain("/Users/alex/.local/bin");
    expect(text).toContain("/opt/homebrew/bin");
  });
});

describe("notFoundMessage unter Windows (Abend 41)", () => {
  it("wörtlicher Text mit Semikolon-Liste", () => {
    expect(notFoundMessage("claude", ["C:\\a", "C:\\b"], "win32")).toBe("claude.exe oder claude.cmd nicht gefunden. Gesucht in: C:\\a; C:\\b");
  });
});

describe("resume, settings, Titel mit Ordner", () => {
  it("resume nimmt --resume statt --session-id", () => {
    expect(buildArgs({ sessionId: "x", resume: true, skipPermissions: false })).toEqual(["--resume", "x"]);
    expect(buildArgs({ sessionId: "x", resume: false, skipPermissions: false })).toEqual(["--session-id", "x"]);
    expect(buildArgs({ resume: true, skipPermissions: false })).toEqual([]);
  });
  it("settings als eigenes Argument vor dem Rechte-Flag", () => {
    expect(buildArgs({ sessionId: "x", name: "n", agentName: "a", settings: '{"a":1}', skipPermissions: true })).toEqual(
      ["--session-id", "x", "--name", "n", "--agent=a", "--settings", '{"a":1}', "--dangerously-skip-permissions"]);
  });
  it("shortPath und headerTitle", () => {
    expect(shortPath("/Users/alex/x", "/Users/alex")).toBe("~/x");
    expect(shortPath("/Users/alex", "/Users/alex")).toBe("~");
    expect(shortPath("/Users/alexX", "/Users/alex")).toBe("/Users/alexX");
    expect(headerTitle("Briefing", "1234567890", "/Users/alex/v", "/Users/alex")).toBe("12345678 · Briefing · ~/v");
  });
  it("shortPath unter win32: Backslash, Groß-/Kleinschreibung egal, nur ganze Teile", () => {
    expect(shortPath("C:\\Users\\x\\Projekt", "C:\\Users\\x", "win32")).toBe("~\\Projekt");
    expect(shortPath("c:\\users\\x\\p", "C:\\Users\\x", "win32")).toBe("~\\p");
    expect(shortPath("C:\\Users\\x", "C:\\Users\\x", "win32")).toBe("~");
    expect(shortPath("C:\\Users\\x\\", "C:\\Users\\x\\", "win32")).toBe("~");
    expect(shortPath("C:\\Users\\xy\\p", "C:\\Users\\x", "win32")).toBe("C:\\Users\\xy\\p");
    expect(shortPath("D:\\Users\\x\\p", "C:\\Users\\x", "win32")).toBe("D:\\Users\\x\\p");
    expect(shortPath("C:/Users/x/a/b", "C:\\Users\\x", "win32")).toBe("~\\a\\b");
    expect(shortPath("C:\\p", "", "win32")).toBe("C:\\p");
  });
  it("shortPath darwin mit ausdrücklicher Angabe: Windows-Pfad bleibt, wie er ist", () => {
    expect(shortPath("C:\\Users\\x\\p", "C:\\Users\\x", "darwin")).toBe("C:\\Users\\x\\p");
  });
  it("headerTitle unter win32 kürzt mit ~", () => {
    expect(headerTitle("Briefing", "1234567890", "C:\\Users\\x\\v", "C:\\Users\\x", "win32")).toBe("12345678 · Briefing · ~\\v");
  });
});

describe("Effort der nächsten Sitzung (Abend 18)", () => {
  it("aus: kein Flag, auch nicht bei Agent-Start", () => {
    expect(buildArgs({ sessionId: "x", effort: "aus", skipPermissions: false })).toEqual(["--session-id", "x"]);
    expect(buildArgs({ agentName: "a", effort: "aus", skipPermissions: false })).toEqual(["--agent=a"]);
  });
  it("jede andere Stufe: --effort <stufe> als zwei Argumente, vor dem Rechte-Flag", () => {
    for (const step of ["low", "medium", "high", "xhigh", "max"] as const) {
      expect(buildArgs({ sessionId: "x", effort: step, skipPermissions: true })).toEqual(["--session-id", "x", "--effort", step, "--dangerously-skip-permissions"]);
    }
  });
  it("Agent-Start bekommt den Effort ebenso", () => {
    expect(buildArgs({ agentName: "stefan", effort: "high", skipPermissions: false })).toEqual(["--agent=stefan", "--effort", "high"]);
  });
  it("ohne Angabe wie bisher (alte Aufrufer ändern sich nicht)", () => {
    expect(buildArgs({ sessionId: "x" })).toEqual(["--session-id", "x"]);
  });
});

describe("buildArgs prompt (Abend 19h)", () => {
  it("Startnachricht ist das letzte Argument", () => {
    const a = buildArgs({ sessionId: "id-1", skipPermissions: true, prompt: "Handoff: P/a.md\nNächster Auftrag: x" });
    expect(a.at(-1)).toBe("Handoff: P/a.md\nNächster Auftrag: x");
    expect(a.slice(0, 2)).toEqual(["--session-id", "id-1"]);
  });
  it("Startnachricht mit führendem - bekommt ein Leerzeichen davor", () => {
    expect(buildArgs({ sessionId: "id-1", prompt: "- Tests ergänzen" }).at(-1)).toBe(" - Tests ergänzen");
  });
  it("ohne oder mit leerem prompt kein zusätzliches Argument", () => {
    expect(buildArgs({ sessionId: "id-1" })).toEqual(["--session-id", "id-1"]);
    expect(buildArgs({ sessionId: "id-1", prompt: "  " })).toEqual(["--session-id", "id-1"]);
  });
});

describe("Launcher unter Windows (Abend 41)", () => {
  const ENV = {
    Path: "C:\\Windows\\System32;;C:\\Tools",
    PATH: "wird ignoriert",
    USERPROFILE: "C:\\Users\\x",
    LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local",
    APPDATA: "C:\\Users\\x\\AppData\\Roaming",
    SHELL: "/bin/gibt-es-nicht",
  };

  it("PATH = feste Liste vor Obsidians Path, Herkunft fest, keine Meldung, keine Login-Shell", async () => {
    let gemeldet = 0;
    const launcher = new Launcher(() => gemeldet++, () => null, 100, { platform: "win32", env: () => ENV });
    expect(await launcher.pathDirs()).toEqual([
      "C:\\Users\\x\\.local\\bin",
      "C:\\Users\\x\\AppData\\Local\\Microsoft\\WinGet\\Links",
      "C:\\Users\\x\\AppData\\Roaming\\npm",
      "C:\\Windows\\System32",
      "C:\\Tools",
    ]);
    const info = await launcher.info();
    expect(info).toMatchObject({ origin: "fest", reason: null, binary: null });
    expect(gemeldet).toBe(0);
  });
});
