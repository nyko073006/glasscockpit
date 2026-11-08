import { describe, expect, it } from "vitest";
import {
  asPlatform,
  expandHomePath,
  isAbsolutePath,
  isRootRelative,
  joinPath,
  lastSegment,
  matchVaultCase,
  pathDelimiter,
  pathKey,
  programCandidates,
  relativeInside,
  resolveAgainst,
  splitPathList,
  system32Path,
  trimTrailingSep,
  withPathDirs,
} from "../src/core/platform-path";

describe("Abend 40 (1): asPlatform", () => {
  it("kennt darwin und win32", () => {
    expect(asPlatform("darwin")).toBe("darwin");
    expect(asPlatform("win32")).toBe("win32");
  });

  it.each(["linux", "freebsd", "", "Darwin", "win64"])("%j ist keine unterstützte Plattform", (wert) => {
    expect(asPlatform(wert)).toBeNull();
  });
});

describe("Abend 40 (1): joinPath", () => {
  it("win32: gemischte Trenner werden zu reinen Windows-Pfaden (8.3-Kurzname bleibt)", () => {
    expect(joinPath("win32", "C:\\Users\\RUNNER~1\\vault", ".obsidian/plugins/glasscockpit", "native")).toBe(
      "C:\\Users\\RUNNER~1\\vault\\.obsidian\\plugins\\glasscockpit\\native",
    );
  });

  it("darwin: Schrägstrich am Ende stört nicht", () => {
    expect(joinPath("darwin", "/Users/alex/vault/", "native")).toBe("/Users/alex/vault/native");
  });

  it("darwin lässt einen Rückwärtsstrich im Namen stehen (kein Windows-Pfad)", () => {
    expect(joinPath("darwin", "/a", "b\\c")).toBe("/a/b\\c");
  });
});

describe("Abend 40 (1): system32Path", () => {
  it("hängt System32 und die Teile an SystemRoot", () => {
    expect(system32Path("C:\\Windows", "tar.exe")).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("ohne SystemRoot (undefined oder leer) gilt C:\\Windows", () => {
    expect(system32Path(undefined, "tar.exe")).toBe("C:\\Windows\\System32\\tar.exe");
    expect(system32Path("", "tar.exe")).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("anderes Laufwerk und mehrere Teile", () => {
    expect(system32Path("D:\\WIN", "WindowsPowerShell", "v1.0", "powershell.exe")).toBe(
      "D:\\WIN\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
  });
});

describe("Abend 41 (1): PATH-Trenner und -Liste", () => {
  it("win32 trennt mit Semikolon, darwin mit Doppelpunkt", () => {
    expect(pathDelimiter("win32")).toBe(";");
    expect(pathDelimiter("darwin")).toBe(":");
  });

  it("win32: leere Einträge fallen weg, Leerzeichen im Pfad und Laufwerksbuchstabe bleiben", () => {
    expect(splitPathList("win32", "C:\\a;;C:\\b c;")).toEqual(["C:\\a", "C:\\b c"]);
  });

  it("darwin: leere Einträge fallen weg", () => {
    expect(splitPathList("darwin", "/a::/b")).toEqual(["/a", "/b"]);
  });

  it("leerer Wert gibt eine leere Liste", () => {
    expect(splitPathList("win32", "")).toEqual([]);
    expect(splitPathList("darwin", "")).toEqual([]);
  });
});

describe("Abend 41 (1): pathKey", () => {
  it("win32: nimmt die Schreibweise des Originals", () => {
    expect(pathKey({ Path: "x" }, "win32")).toBe("Path");
    expect(pathKey({ PATH: "x" }, "win32")).toBe("PATH");
    expect(pathKey({ path: "x" }, "win32")).toBe("path");
  });

  it("win32: ohne vorhandenen Schlüssel (auch bei undefined) Path", () => {
    expect(pathKey({}, "win32")).toBe("Path");
    expect(pathKey({ Path: undefined }, "win32")).toBe("Path");
  });

  it("darwin: immer PATH", () => {
    expect(pathKey({ Path: "x" }, "darwin")).toBe("PATH");
    expect(pathKey({}, "darwin")).toBe("PATH");
  });
});

describe("Abend 41 (1): withPathDirs", () => {
  it("win32: genau ein path-Schlüssel, Semikolon als Trenner, Rest bleibt", () => {
    const env = withPathDirs({ Path: "alt", PATH: "auch", HOME: "h" }, ["C:\\a", "C:\\b"], "win32");
    expect(env).toEqual({ Path: "C:\\a;C:\\b", HOME: "h" });
    expect(Object.keys(env).filter((k) => k.toLowerCase() === "path")).toHaveLength(1);
  });

  it("win32: ohne path-Schlüssel entsteht Path", () => {
    expect(withPathDirs({ HOME: "h" }, ["C:\\a"], "win32")).toEqual({ HOME: "h", Path: "C:\\a" });
  });

  it("win32: Werte undefined fallen weg, das Original bleibt unverändert", () => {
    const original = { Path: "alt", X: undefined, Y: "y" };
    expect(withPathDirs(original, ["C:\\a"], "win32")).toEqual({ Path: "C:\\a", Y: "y" });
    expect(original).toEqual({ Path: "alt", X: undefined, Y: "y" });
  });

  it("darwin: PATH mit Doppelpunkt", () => {
    expect(withPathDirs({ PATH: "alt", HOME: "/h" }, ["/a", "/b"], "darwin")).toEqual({ PATH: "/a:/b", HOME: "/h" });
  });
});

describe("Abend 41 (1): programCandidates", () => {
  it("win32: .exe vor .cmd", () => {
    expect(programCandidates("win32", "C:\\Users\\x\\.local\\bin", "claude")).toEqual([
      "C:\\Users\\x\\.local\\bin\\claude.exe",
      "C:\\Users\\x\\.local\\bin\\claude.cmd",
    ]);
  });

  it("darwin: ein Kandidat ohne Endung", () => {
    expect(programCandidates("darwin", "/opt/homebrew/bin", "claude")).toEqual(["/opt/homebrew/bin/claude"]);
  });
});

// Abend 42, Task 1: Pfadbausteine. Windows-Pfade laufen hier auf dem Mac über platform "win32".
describe("isAbsolutePath", () => {
  it("darwin: nur mit Schrägstrich am Anfang", () => {
    expect(isAbsolutePath("darwin", "/a")).toBe(true);
    expect(isAbsolutePath("darwin", "~/a")).toBe(false);
    expect(isAbsolutePath("darwin", "a/b")).toBe(false);
  });
  it("win32: Laufwerk mit Trenner oder UNC", () => {
    for (const p of ["C:\\a", "c:/a", "\\\\srv\\share\\x"]) expect(isAbsolutePath("win32", p)).toBe(true);
    for (const p of ["C:a", "\\a", "a\\b", "/a", ""]) expect(isAbsolutePath("win32", p)).toBe(false);
  });
});

describe("expandHomePath", () => {
  const home = "C:\\Users\\x";
  it("win32: ~ , ~\\ und ~/", () => {
    expect(expandHomePath("win32", "~\\x\\y", home)).toBe("C:\\Users\\x\\x\\y");
    expect(expandHomePath("win32", "~/x", home)).toBe("C:\\Users\\x\\x");
    expect(expandHomePath("win32", "~", home)).toBe("C:\\Users\\x");
    expect(expandHomePath("win32", "~foo", home)).toBe("~foo");
  });
  it("darwin: wie bisher, Backslash zählt nicht", () => {
    expect(expandHomePath("darwin", "~/a", "/Users/n")).toBe("/Users/n/a");
    expect(expandHomePath("darwin", "~", "/Users/n")).toBe("/Users/n");
    expect(expandHomePath("darwin", "~\\a", "/Users/n")).toBe("~\\a");
  });
});

describe("relativeInside", () => {
  it("win32: beide Trenner, ohne Groß-/Kleinschreibung", () => {
    expect(relativeInside("win32", "C:\\Vault\\", "c:/vault/Ordner/a.md")).toBe("Ordner/a.md");
    expect(relativeInside("win32", "C:\\Vault", "C:\\Vault")).toBe("");
    expect(relativeInside("win32", "C:\\Vault", "C:\\Vault\\\\Ordner//a.md")).toBe("Ordner/a.md");
  });
  it("win32: Präfix-Falle und anderes Laufwerk sind außerhalb", () => {
    expect(relativeInside("win32", "C:\\Vault", "C:\\Vault2\\a.md")).toBeNull();
    expect(relativeInside("win32", "C:\\Vault", "D:\\Vault\\a")).toBeNull();
    expect(relativeInside("win32", "C:\\Vault", "C:\\a.md")).toBeNull();
  });
  it("darwin: wie vaultRelative, Groß-/Kleinschreibung zählt", () => {
    expect(relativeInside("darwin", "/v", "/v/a/b")).toBe("a/b");
    expect(relativeInside("darwin", "/v", "/V/a")).toBeNull();
    expect(relativeInside("darwin", "/v/", "/v/a")).toBe("a");
    expect(relativeInside("darwin", "/v", "/v")).toBe("");
    expect(relativeInside("darwin", "/v", "/v2/a")).toBeNull();
  });
});

describe("lastSegment und trimTrailingSep", () => {
  it("lastSegment", () => {
    expect(lastSegment("win32", "C:\\a\\Projekt\\")).toBe("Projekt");
    expect(lastSegment("win32", "C:/a/b")).toBe("b");
    expect(lastSegment("darwin", "/a/b/")).toBe("b");
    expect(lastSegment("darwin", "/")).toBe("");
  });
  it("trimTrailingSep: Wurzel bleibt", () => {
    expect(trimTrailingSep("win32", "C:\\Dev\\")).toBe("C:\\Dev");
    expect(trimTrailingSep("win32", "C:\\")).toBe("C:\\");
    expect(trimTrailingSep("win32", "C:/Dev/")).toBe("C:/Dev");
    expect(trimTrailingSep("darwin", "/a/b/")).toBe("/a/b");
    expect(trimTrailingSep("darwin", "/")).toBe("/");
  });
});

describe("resolveAgainst (Abend 43)", () => {
  const W = "C:\\Vault";
  it("win32: wurzelrelativ hängt an der Wurzel des Laufwerks der Basis, beide Trenner", () => {
    expect(resolveAgainst("win32", W, "\\x\\a.md")).toBe("C:\\x\\a.md");
    expect(resolveAgainst("win32", W, "/x/a.md")).toBe("C:\\x\\a.md");
    expect(resolveAgainst("win32", "D:\\p\\q", "\\x")).toBe("D:\\x");
  });
  it("win32: UNC-Basis: die Wurzel ist die Freigabe", () => {
    expect(resolveAgainst("win32", "\\\\srv\\share\\V", "\\x")).toBe("\\\\srv\\share\\x");
  });
  it("win32: Laufwerk ohne Trenner ergibt null, auch bei absoluter Basis", () => {
    expect(resolveAgainst("win32", W, "C:a.md")).toBeNull();
    expect(resolveAgainst("win32", W, "D:a.md")).toBeNull();
  });
  it("win32: Relatives wird verbunden, Absolutes bleibt (normalisiert)", () => {
    expect(resolveAgainst("win32", W, "Ordner\\a.md")).toBe("C:\\Vault\\Ordner\\a.md");
    expect(resolveAgainst("win32", W, "Ordner/a.md")).toBe("C:\\Vault\\Ordner\\a.md");
    expect(resolveAgainst("win32", W, "D:/x/./a.md")).toBe("D:\\x\\a.md");
    expect(resolveAgainst("win32", "relativ", "D:\\x")).toBe("D:\\x");
  });
  it("win32: ohne absolute Basis gibt es für Relatives und Wurzelrelatives null", () => {
    expect(resolveAgainst("win32", "relativ", "a.md")).toBeNull();
    expect(resolveAgainst("win32", "relativ", "\\a.md")).toBeNull();
    expect(resolveAgainst("win32", "", "\\a.md")).toBeNull();
  });
  it("win32: doppelter Trenner ohne vollständiges UNC wird nie zu C:\\server", () => {
    for (const p of ["\\\\server", "//server", "\\\\", "\\"]) expect(resolveAgainst("win32", W, p), p).toBeNull();
    expect(resolveAgainst("win32", W, "\\\\srv\\share\\a")).toBe("\\\\srv\\share\\a");
  });
  it("isRootRelative: genau ein Trenner, danach ein Name", () => {
    for (const p of ["\\x", "/x", "\\Vault\\a.md"]) expect(isRootRelative(p), p).toBe(true);
    for (const p of ["", "\\", "/", "\\\\x", "//x", "x\\y", "C:\\x"]) expect(isRootRelative(p), p).toBe(false);
  });
  it("darwin: wie bisher, Backslash und Laufwerk sind gewöhnliche Namen", () => {
    expect(resolveAgainst("darwin", "/V", "/x/./a.md")).toBe("/x/a.md");
    expect(resolveAgainst("darwin", "/V", "o/a.md")).toBe("/V/o/a.md");
    expect(resolveAgainst("darwin", "/V", "\\x\\a.md")).toBe("/V/\\x\\a.md");
    expect(resolveAgainst("darwin", "/V", "C:a.md")).toBe("/V/C:a.md");
    expect(resolveAgainst("darwin", "relativ", "a.md")).toBeNull();
  });
});

describe("matchVaultCase (Abend 43)", () => {
  const paths = ["Ordner/a.md", "ordner/A.md", "Anderes/b.md"];
  it("win32: der erste Eintrag, der ohne Groß-/Kleinschreibung passt", () => {
    expect(matchVaultCase("win32", "ORDNER/a.MD", paths)).toBe("Ordner/a.md");
    expect(matchVaultCase("win32", "anderes/B.md", paths)).toBe("Anderes/b.md");
  });
  it("win32: kein Treffer oder leere Liste: die Eingabe bleibt; ein Teilpfad ist kein Treffer", () => {
    expect(matchVaultCase("win32", "neu/c.md", paths)).toBe("neu/c.md");
    expect(matchVaultCase("win32", "Ordner", paths)).toBe("Ordner");
    expect(matchVaultCase("win32", "Ordner/a.md", [])).toBe("Ordner/a.md");
  });
  it("win32: neue Datei: das längste vorhandene Ordner-Präfix wird angeglichen, der Rest bleibt", () => {
    expect(matchVaultCase("win32", "ORDNER/neu.md", ["Ordner/a.md"])).toBe("Ordner/neu.md");
    expect(matchVaultCase("win32", "ORDNER/UNTER/neu.md", ["Ordner/a.md"])).toBe("Ordner/UNTER/neu.md");
    expect(matchVaultCase("win32", "ORDNER/Sub/neu.md", ["Ordner/a.md", "ordner/SUB/b.md"])).toBe("ordner/SUB/neu.md");
    expect(matchVaultCase("win32", "ANDERS/neu.md", ["Ordner/a.md"])).toBe("ANDERS/neu.md");
    expect(matchVaultCase("win32", "neu.md", ["Ordner/a.md"])).toBe("neu.md");
  });
  it("darwin: immer die Eingabe (Dateisystem unterscheidet Schreibweisen)", () => {
    expect(matchVaultCase("darwin", "ORDNER/a.md", paths)).toBe("ORDNER/a.md");
  });
});
