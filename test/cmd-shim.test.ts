import { describe, expect, it } from "vitest";
import { cmdShimCommandLine, escapeCmdArgument, escapeCmdCommand } from "../src/core/cmd-shim";

// Erwartungen von Hand nach dem Verfahren von cross-spawn (escapeArgument mit doubleEscape) gerechnet:
// Backslashes vor " und am Ende verdoppeln, " → \", in " einschließen, dann Metazeichen zweimal mit ^ versehen.
describe("escapeCmdArgument", () => {
  it("& wird in Anführungszeichen gesetzt und doppelt mit ^ geschützt", () => {
    expect(escapeCmdArgument("a&b")).toBe('^^^"a^^^&b^^^"');
  });
  it("%PATH% wird nicht expandiert: beide % mit ^", () => {
    expect(escapeCmdArgument("%PATH%")).toBe('^^^"^^^%PATH^^^%^^^"');
  });
  it("^ wird verdoppelt und dann nochmals", () => {
    expect(escapeCmdArgument("^")).toBe('^^^"^^^^^^^"');
  });
  it('Anführungszeichen im Text: \\" und beide Schichten ^', () => {
    expect(escapeCmdArgument('"x"')).toBe('^^^"\\^^^"x\\^^^"^^^"');
  });
  it("Backslash am Ende wird verdoppelt, Leerzeichen mit ^", () => {
    expect(escapeCmdArgument("C:\\Pfad mit Leer\\")).toBe('^^^"C:\\Pfad^^^ mit^^^ Leer\\\\^^^"');
  });
  it("Zeilenumbruch (\\n, \\r\\n, \\r) wird zu einem Leerzeichen", () => {
    const erwartet = '^^^"zeile1^^^ zeile2^^^"';
    expect(escapeCmdArgument("zeile1\nzeile2")).toBe(erwartet);
    expect(escapeCmdArgument("zeile1\r\nzeile2")).toBe(erwartet);
    expect(escapeCmdArgument("zeile1\rzeile2")).toBe(erwartet);
  });
  it("Klammern, !, |, ;, Komma, *, ? bekommen ^", () => {
    expect(escapeCmdArgument("(x)!")).toBe('^^^"^^^(x^^^)^^^!^^^"');
    expect(escapeCmdArgument("a|b;c,d*e?")).toBe('^^^"a^^^|b^^^;c^^^,d^^^*e^^^?^^^"');
  });
  it("Umlaute bleiben unverändert", () => {
    expect(escapeCmdArgument("Jürgen")).toBe('^^^"Jürgen^^^"');
  });
});

describe("escapeCmdCommand", () => {
  it("Leerzeichen im Pfad bekommt ^, keine Anführungszeichen, Umlaute bleiben", () => {
    expect(escapeCmdCommand("C:\\Users\\Jürgen Müller\\npm\\claude.cmd")).toBe("C:\\Users\\Jürgen^ Müller\\npm\\claude.cmd");
  });
  it("Metazeichen nur einmal: Klammern im Pfad", () => {
    expect(escapeCmdCommand("C:\\Program Files (x86)\\npm\\claude.cmd")).toBe("C:\\Program^ Files^ ^(x86^)\\npm\\claude.cmd");
  });
});

describe("cmdShimCommandLine", () => {
  const shim = "C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd";
  const settings = "C:\\Users\\Jürgen Müller\\v\\.obsidian\\plugins\\glasscockpit\\.sessions\\id.settings.json";

  it("beginnt mit /d /s /c \" und endet mit \"", () => {
    const zeile = cmdShimCommandLine(shim, ["--settings", settings]);
    expect(zeile.startsWith('/d /s /c "')).toBe(true);
    expect(zeile.endsWith('"')).toBe(true);
  });
  it("Befehl einmal, jedes Argument doppelt escaped, durch Leerzeichen getrennt; der Pfad mit Leerzeichen und Umlaut bleibt ganz", () => {
    const zeile = cmdShimCommandLine(shim, ["--settings", settings]);
    expect(zeile).toBe(`/d /s /c "${shim} ${escapeCmdArgument("--settings")} ${escapeCmdArgument(settings)}"`);
    expect(zeile).toContain("Jürgen^^^ Müller");
  });
  it("ohne Argumente: nur der Befehl", () => {
    expect(cmdShimCommandLine(shim, [])).toBe(`/d /s /c "${shim}"`);
  });
  it("Startnachricht mit & und %PATH% erscheint nur in der geschützten Form", () => {
    const zeile = cmdShimCommandLine(shim, ["a&b %PATH%"]);
    expect(zeile).toBe(`/d /s /c "${shim} ^^^"a^^^&b^^^ ^^^%PATH^^^%^^^""`);
  });
});
