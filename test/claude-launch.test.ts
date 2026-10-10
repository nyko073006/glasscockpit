import { describe, expect, it } from "vitest";
import {
  buildArgs,
  buildEnv,
  defaultSessionName,
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

  it("verändert base nicht", () => {
    const original = { TERM: "dumb" };
    buildEnv(original, ["/a"]);
    expect(original).toEqual({ TERM: "dumb" });
  });
});

describe("Namen und Titel", () => {
  it("Startname: Ordnername und Uhrzeit mit führenden Nullen", () => {
    expect(defaultSessionName("Vault", new Date(2026, 9, 4, 9, 5))).toBe("Vault 09:05");
  });

  it("Tab-Titel: Name und die ersten 8 Zeichen der ID", () => {
    expect(tabTitle("Vault 09:05", "0f4b7c1e-2d3a-4b5c-8d9e-0123456789ab")).toBe("Vault 09:05 · 0f4b7c1e");
  });

  it("Tab-Titel ohne Namen ist nie nur „claude“", () => {
    expect(tabTitle("", "0f4b7c1e-2d3a")).toBe("Claude · 0f4b7c1e");
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
    expect(headerTitle("Briefing", "1234567890", "/Users/alex/v", "/Users/alex")).toBe("Briefing · 12345678 · ~/v");
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
