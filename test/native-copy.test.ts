import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONOUT_ORIGINAL_SHA256, PTY_TARGETS, copyNodePty } from "../scripts/lib/native-copy";
import { NATIVE_TARGETS } from "../src/core/shell";
import { ROOT, listFilesRecursive } from "./helpers/files";
import { ON_WINDOWS } from "./helpers/platform";

const PTY = join(ROOT, "node_modules", "node-pty");
const ERSATZ = join(ROOT, "scripts", "lib", "node-pty-windows", "windowsConoutConnection.js");
const DARWIN = ["darwin-arm64", "darwin-x64"];
const aufraeumen: string[] = [];
function frischerOrdner(): string {
  const dir = mkdtempSync(join(tmpdir(), "glasscockpit-native-"));
  aufraeumen.push(dir);
  return dir;
}
/** Dateien unterhalb von dir, relativ, mit "/" getrennt, sortiert. */
function dateien(dir: string): string[] {
  return listFilesRecursive(dir).map((f) => relative(dir, f).split("\\").join("/")).sort();
}
afterEach(() => {
  for (const d of aufraeumen.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("Abend 25 (1): node-pty-Kopie für Deploy und Release", () => {
  it("die Zielliste ist die des Loaders (Loader und Kopie dürfen nicht auseinanderlaufen)", () => {
    expect([...PTY_TARGETS]).toEqual([...NATIVE_TARGETS]);
  });

  it("kopiert alle vier Ziele samt lib/ und package.json", () => {
    const ziel = frischerOrdner();
    const anzahl = copyNodePty(PTY, ziel);
    expect(anzahl).toBeGreaterThan(6);
    expect(readdirSync(ziel).sort()).toEqual(["darwin-arm64", "darwin-x64", "win32-arm64", "win32-x64"]);
    for (const t of DARWIN) {
      for (const datei of ["package.json", "lib/index.js", `prebuilds/${t}/pty.node`, `prebuilds/${t}/spawn-helper`]) {
        expect(existsSync(join(ziel, t, datei)), `${t}/${datei}`).toBe(true);
      }
    }
    for (const t of ["win32-arm64", "win32-x64"]) {
      for (const datei of ["package.json", "lib/index.js", `prebuilds/${t}/conpty.node`]) {
        expect(existsSync(join(ziel, t, datei)), `${t}/${datei}`).toBe(true);
      }
    }
  });

  it("die Rückgabe zählt jede kopierte Datei genau einmal", () => {
    const ziel = frischerOrdner();
    expect(copyNodePty(PTY, ziel)).toBe(listFilesRecursive(ziel).length);
  });

  // Windows: prüft den POSIX-Modus 0o755 (Inventur H20)
  it.skipIf(ON_WINDOWS)("spawn-helper und pty.node haben 0755, auch wenn die Quelle es nicht hat", () => {
    const ziel = frischerOrdner();
    copyNodePty(PTY, ziel);
    for (const t of DARWIN) {
      for (const b of ["pty.node", "spawn-helper"]) {
        expect(statSync(join(ziel, t, "prebuilds", t, b)).mode & 0o777, `${t}/${b}`).toBe(0o755);
      }
    }
  });

  it("die darwin-Ziele nehmen weder Windows-Prebuilds noch Testdateien noch Source-Maps mit", () => {
    const ziel = frischerOrdner();
    copyNodePty(PTY, ziel);
    for (const t of DARWIN) {
      expect(existsSync(join(ziel, t, "prebuilds", "win32-x64")), t).toBe(false);
      const lib = join(ziel, t, "lib");
      expect(existsSync(join(lib, "index.js"))).toBe(true);
      expect(existsSync(join(lib, "eventEmitter2.js"))).toBe(true);
      expect(existsSync(join(lib, "eventEmitter2.test.js"))).toBe(false);
      expect(existsSync(join(lib, "index.js.map"))).toBe(false);
    }
  });

  it("fehlt ein Prebuild im Paket, bricht es ab, bevor etwas geschrieben wird", () => {
    const ziel = frischerOrdner();
    expect(() => copyNodePty(join(ziel, "gibt-es-nicht"), join(ziel, "native"))).toThrow("node-pty unvollständig");
    expect(existsSync(join(ziel, "native"))).toBe(false);
  });
});

describe("Abend 40 (1): win32-Ziele mit Ersatzdatei", () => {
  it("win32 enthält unter prebuilds/ genau die Windows-Dateien (kein pty.node, kein winpty, keine .pdb)", () => {
    const ziel = frischerOrdner();
    copyNodePty(PTY, ziel);
    expect(dateien(join(ziel, "win32-x64", "prebuilds"))).toEqual([
      "win32-x64/conpty.node",
      "win32-x64/conpty/OpenConsole.exe",
      "win32-x64/conpty/conpty.dll",
      "win32-x64/conpty_console_list.node",
    ]);
    expect(dateien(join(ziel, "win32-arm64", "prebuilds"))).toEqual([
      "win32-arm64/conpty.node",
      "win32-arm64/conpty/OpenConsole.exe",
      "win32-arm64/conpty/conpty.dll",
      "win32-arm64/conpty_console_list.node",
    ]);
  });

  it("win32 bekommt lib/ ohne Tests und Maps und die Dateien byte-gleich aus dem Paket", () => {
    const ziel = frischerOrdner();
    copyNodePty(PTY, ziel);
    const lib = dateien(join(ziel, "win32-x64", "lib"));
    expect(lib).toContain("index.js");
    expect(lib).toContain("windowsPtyAgent.js");
    expect(lib.filter((n) => /\.test\.js$|\.map$/.test(n))).toEqual([]);
    for (const datei of ["prebuilds/win32-x64/conpty.node", "prebuilds/win32-x64/conpty/conpty.dll", "package.json", "lib/index.js"]) {
      expect(readFileSync(join(ziel, "win32-x64", datei)).equals(readFileSync(join(PTY, datei))), datei).toBe(true);
    }
  });

  it("win32 bekommt die Ersatzdatei, darwin das Original", () => {
    const ziel = frischerOrdner();
    copyNodePty(PTY, ziel);
    const ersatz = readFileSync(ERSATZ);
    for (const t of ["win32-arm64", "win32-x64"]) {
      const kopie = readFileSync(join(ziel, t, "lib", "windowsConoutConnection.js"));
      expect(kopie.equals(ersatz), t).toBe(true);
      expect(kopie.toString("utf8")).not.toContain("worker_threads");
    }
    const original = readFileSync(join(PTY, "lib", "windowsConoutConnection.js"));
    expect(original.toString("utf8")).toContain("worker_threads");
    for (const t of DARWIN) {
      expect(readFileSync(join(ziel, t, "lib", "windowsConoutConnection.js")).equals(original), t).toBe(true);
    }
  });

  it("CONOUT_ORIGINAL_SHA256 ist die Summe des Originals aus node-pty 1.1.0", () => {
    expect(JSON.parse(readFileSync(join(PTY, "package.json"), "utf8")).version).toBe("1.1.0");
    const summe = createHash("sha256").update(readFileSync(join(PTY, "lib", "windowsConoutConnection.js"))).digest("hex");
    expect(CONOUT_ORIGINAL_SHA256).toBe(summe);
  });

  it("bricht ab, wenn das Original nicht passt, bevor etwas geschrieben wird", () => {
    const kopie = frischerOrdner();
    copyFileSync(join(PTY, "package.json"), join(kopie, "package.json"));
    cpSync(join(PTY, "lib"), join(kopie, "lib"), { recursive: true });
    cpSync(join(PTY, "prebuilds"), join(kopie, "prebuilds"), { recursive: true, filter: (q) => !q.endsWith(".pdb") });
    appendFileSync(join(kopie, "lib", "windowsConoutConnection.js"), "// anders\n");
    const ziel = join(frischerOrdner(), "native");
    expect(() => copyNodePty(kopie, ziel)).toThrow(/windowsConoutConnection\.js.*1\.1\.0/s);
    expect(existsSync(ziel)).toBe(false);
  });

  it("nur die genannten Ziele", () => {
    const ziel = frischerOrdner();
    copyNodePty(PTY, join(ziel, "native"), ["win32-arm64"]);
    expect(readdirSync(join(ziel, "native"))).toEqual(["win32-arm64"]);
  });

  it("ein unbekanntes Ziel bricht ab, bevor etwas geschrieben wird", () => {
    const ziel = join(frischerOrdner(), "native");
    expect(() => copyNodePty(PTY, ziel, ["darwin-arm64", "linux-x64"])).toThrow("Unbekanntes Ziel: linux-x64");
    expect(existsSync(ziel)).toBe(false);
  });

  it("die Ersatzdatei bleibt in jedem Checkout LF (.gitattributes), sonst ändert sich ihre Prüfsumme", () => {
    const ausgabe = execFileSync("git", ["check-attr", "eol", "--", "scripts/lib/node-pty-windows/windowsConoutConnection.js"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(ausgabe.trimEnd()).toMatch(/eol: lf$/);
    expect(readFileSync(ERSATZ, "utf8")).not.toContain("\r");
  });
});
