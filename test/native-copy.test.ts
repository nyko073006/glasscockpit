import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PTY_TARGETS, copyNodePty } from "../scripts/lib/native-copy";
import { NATIVE_TARGETS } from "../src/core/shell";
import { ROOT } from "./helpers/files";

const PTY = join(ROOT, "node_modules", "node-pty");
const aufraeumen: string[] = [];
function frischerOrdner(): string {
  const dir = mkdtempSync(join(tmpdir(), "glasscockpit-native-"));
  aufraeumen.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of aufraeumen.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("Abend 25 (1): node-pty-Kopie für Deploy und Release", () => {
  it("die Zielliste ist die des Loaders (Loader und Kopie dürfen nicht auseinanderlaufen)", () => {
    expect([...PTY_TARGETS]).toEqual([...NATIVE_TARGETS]);
  });

  it("kopiert beide Prebuilds samt lib/ und package.json", () => {
    const ziel = frischerOrdner();
    const anzahl = copyNodePty(PTY, ziel);
    expect(anzahl).toBeGreaterThan(6);
    for (const t of ["darwin-arm64", "darwin-x64"]) {
      for (const datei of ["package.json", "lib/index.js", `prebuilds/${t}/pty.node`, `prebuilds/${t}/spawn-helper`]) {
        expect(existsSync(join(ziel, t, datei)), `${t}/${datei}`).toBe(true);
      }
    }
  });

  it("spawn-helper und pty.node haben 0755, auch wenn die Quelle es nicht hat", () => {
    const ziel = frischerOrdner();
    copyNodePty(PTY, ziel);
    for (const t of ["darwin-arm64", "darwin-x64"]) {
      for (const b of ["pty.node", "spawn-helper"]) {
        expect(statSync(join(ziel, t, "prebuilds", t, b)).mode & 0o777, `${t}/${b}`).toBe(0o755);
      }
    }
  });

  it("nimmt weder Windows-Prebuilds noch Testdateien noch Source-Maps mit", () => {
    const ziel = frischerOrdner();
    copyNodePty(PTY, ziel);
    expect(existsSync(join(ziel, "win32-x64"))).toBe(false);
    expect(existsSync(join(ziel, "darwin-arm64", "prebuilds", "win32-x64"))).toBe(false);
    const lib = join(ziel, "darwin-arm64", "lib");
    expect(existsSync(join(lib, "index.js"))).toBe(true);
    expect(existsSync(join(lib, "eventEmitter2.js"))).toBe(true);
    expect(existsSync(join(lib, "eventEmitter2.test.js"))).toBe(false);
    expect(existsSync(join(lib, "index.js.map"))).toBe(false);
  });

  it("fehlt ein Prebuild im Paket, bricht es ab, bevor etwas geschrieben wird", () => {
    const ziel = frischerOrdner();
    expect(() => copyNodePty(join(ziel, "gibt-es-nicht"), join(ziel, "native"))).toThrow("node-pty unvollständig");
    expect(existsSync(join(ziel, "native"))).toBe(false);
  });
});
