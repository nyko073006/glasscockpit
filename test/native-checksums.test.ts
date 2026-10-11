import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyNodePty } from "../scripts/lib/native-copy";
import { computeNativeChecksums, hashTree, renderChecksumsModule } from "../scripts/lib/native-checksums";
import { NATIVE_CHECKSUMS } from "../src/core/native-checksums";
import { NATIVE_TARGETS } from "../src/core/shell";
import { isSafeRelPath, verifyNative } from "../src/core/native-verify";
import { ROOT } from "./helpers/files";

const PTY = join(ROOT, "node_modules", "node-pty");
const aufraeumen: string[] = [];
afterEach(() => {
  for (const d of aufraeumen.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("Abend 26 (2): eingecheckte Prüfsummen", () => {
  it("Wächter: frisch erzeugt aus node_modules/node-pty gleich der eingecheckten Liste", () => {
    // Wird rot, wenn node-pty oder copyNodePty sich ändern. Dann: npm run native-checksums
    expect(computeNativeChecksums(PTY)).toEqual(NATIVE_CHECKSUMS);
  });

  it("die Datei ist byte-genau das, was der Generator schreiben würde", () => {
    const datei = readFileSync(join(ROOT, "src/core/native-checksums.ts"), "utf8");
    expect(datei).toBe(renderChecksumsModule(computeNativeChecksums(PTY)));
  });

  it("genau die Ziele des Loaders, jedes mit den vier Kerndateien", () => {
    expect(Object.keys(NATIVE_CHECKSUMS).sort()).toEqual([...NATIVE_TARGETS].sort());
    for (const t of NATIVE_TARGETS) {
      const pfade = Object.keys(NATIVE_CHECKSUMS[t]);
      for (const d of ["package.json", "lib/index.js", `prebuilds/${t}/pty.node`, `prebuilds/${t}/spawn-helper`]) {
        expect(pfade, `${t}/${d}`).toContain(d);
      }
      // Nur das eigene Ziel, keine Fremdplattform
      expect(pfade.filter((p) => p.startsWith("prebuilds/") && !p.startsWith(`prebuilds/${t}/`))).toEqual([]);
      for (const p of pfade) {
        expect(isSafeRelPath(p), p).toBe(true);
        expect(NATIVE_CHECKSUMS[t][p], p).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it("hashTree liest den von copyNodePty angelegten Baum so, dass verifyNative ihn annimmt", () => {
    const ziel = mkdtempSync(join(tmpdir(), "glasscockpit-hash-"));
    aufraeumen.push(ziel);
    copyNodePty(PTY, ziel);
    for (const t of NATIVE_TARGETS) {
      expect(verifyNative(NATIVE_CHECKSUMS[t], hashTree(join(ziel, t)))).toEqual({ ok: true });
    }
  });
});
