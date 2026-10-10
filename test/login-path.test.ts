import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  LANG_MARK_END,
  LANG_MARK_START,
  PATH_MARK_END,
  PATH_MARK_START,
  fixedPaths,
  loginShellScript,
  mergePath,
  parseMarked,
  parseMarkedPath,
} from "../src/core/login-path";

const marked = (path: string) => `${PATH_MARK_START}${path}${PATH_MARK_END}`;

describe("parseMarkedPath", () => {
  it("liest den PATH zwischen den Markern und ignoriert Rauschen davor und danach", () => {
    const stdout = `Last login: Sun Oct  4\nnvm: Version 22\n${marked("/a/bin:/usr/bin")}\nTschüss\n`;
    expect(parseMarkedPath(stdout)).toEqual(["/a/bin", "/usr/bin"]);
  });

  it.each([
    ["ganz ohne Marker", "/usr/bin:/bin\n"],
    ["nur mit Startmarker", `${PATH_MARK_START}/usr/bin`],
    ["nur mit Endmarker", `/usr/bin${PATH_MARK_END}`],
    ["Endmarker vor dem Startmarker", `${PATH_MARK_END}/usr/bin${PATH_MARK_START}`],
  ])("%s: null", (_, stdout) => {
    expect(parseMarkedPath(stdout)).toBeNull();
  });

  it("leerer Pfad zwischen den Markern: leere Liste, nicht null", () => {
    expect(parseMarkedPath(marked(""))).toEqual([]);
  });

  it("leere Einträge fallen weg", () => {
    expect(parseMarkedPath(marked(":/a::/b:"))).toEqual(["/a", "/b"]);
  });
});

describe("parseMarked", () => {
  it("liest beliebige Markerpaare, hier LANG", () => {
    const stdout = `x${marked("/bin")}${LANG_MARK_START}de_DE.UTF-8${LANG_MARK_END}y`;
    expect(parseMarked(stdout, LANG_MARK_START, LANG_MARK_END)).toBe("de_DE.UTF-8");
  });
});

describe("fixedPaths", () => {
  it("ersetzt ~ durch das Home-Verzeichnis, Reihenfolge wie festgelegt", () => {
    expect(fixedPaths("/Users/alex")).toEqual([
      "/Users/alex/.npm-global/bin",
      "/Users/alex/.bun/bin",
      "/Users/alex/.local/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ]);
  });
});

describe("mergePath", () => {
  it("Login, dann fest, dann aktuell, jedes Verzeichnis nur beim ersten Auftreten", () => {
    expect(mergePath(["/x", "/usr/bin"], ["/usr/bin", "/bin"], ["/bin", "/y", "/x"])).toEqual([
      "/x",
      "/usr/bin",
      "/bin",
      "/y",
    ]);
  });

  it("ohne Login-PATH: fest, dann aktuell", () => {
    expect(mergePath([], ["/opt/homebrew/bin"], ["/usr/bin"])).toEqual(["/opt/homebrew/bin", "/usr/bin"]);
  });

  it("leere Einträge fallen weg", () => {
    expect(mergePath(["", "/a"], [""], ["/b", ""])).toEqual(["/a", "/b"]);
  });
});

describe("loginShellScript", () => {
  it("enthält die Marker nicht wörtlich: ein Echo des Befehls täuscht keinen Treffer vor", () => {
    const script = loginShellScript();
    expect(script).not.toContain(PATH_MARK_START);
    expect(script).not.toContain(LANG_MARK_START);
    expect(parseMarkedPath(script)).toBeNull();
  });

  it("von sh ausgeführt, liefert es PATH und LANG zwischen den Markern", () => {
    const stdout = execFileSync("/bin/sh", ["-c", loginShellScript()], {
      env: { PATH: "/p/eins:/usr/bin:/bin", LANG: "de_DE.UTF-8" },
      encoding: "utf8",
    });
    expect(parseMarkedPath(stdout)).toEqual(["/p/eins", "/usr/bin", "/bin"]);
    expect(parseMarked(stdout, LANG_MARK_START, LANG_MARK_END)).toBe("de_DE.UTF-8");
  });

  it("ohne LANG: leerer Wert zwischen den LANG-Markern", () => {
    const stdout = execFileSync("/bin/sh", ["-c", loginShellScript()], { env: { PATH: "/usr/bin:/bin" }, encoding: "utf8" });
    expect(parseMarked(stdout, LANG_MARK_START, LANG_MARK_END)).toBe("");
  });
});
