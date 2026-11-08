import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

/**
 * Wächter (Abend 41): scripts/deploy.mjs kopiert node-pty nur für Ziele, die mit „darwin-“ beginnen.
 * Der Deploy bleibt beim Mac (xattr, chmod); ohne den Filter landeten win32-Ziele im Vault eines Mac-Nutzers.
 * Geprüft wird der Quelltext, denn deploy.mjs führt beim Import den Deploy aus.
 */
const FILTER = /copyNodePty\(\s*PTY_QUELLE\s*,\s*nativeZiel\s*,\s*PTY_TARGETS\.filter\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\.startsWith\(\s*"darwin-"\s*\)\s*\)\s*\)/;

describe("Abend 41: deploy.mjs kopiert nur darwin-Ziele", () => {
  it("der Aufruf von copyNodePty in deploy.mjs filtert PTY_TARGETS auf „darwin-“", () => {
    const quelle = readFileSync(join(ROOT, "scripts", "deploy.mjs"), "utf8");
    expect(quelle).toMatch(FILTER);
  });

  it("Gegenprobe: das Muster erkennt fehlende oder falsche Filter als Fehler", () => {
    const ohne = 'copyNodePty(PTY_QUELLE, nativeZiel, PTY_TARGETS)';
    const win = 'copyNodePty(PTY_QUELLE, nativeZiel, PTY_TARGETS.filter((t) => t.startsWith("win32-")))';
    const ohneArgument = 'copyNodePty(PTY_QUELLE, nativeZiel)';
    const richtig = 'copyNodePty(PTY_QUELLE, nativeZiel, PTY_TARGETS.filter((t) => t.startsWith("darwin-")))';
    expect(ohne).not.toMatch(FILTER);
    expect(win).not.toMatch(FILTER);
    expect(ohneArgument).not.toMatch(FILTER);
    expect(richtig).toMatch(FILTER);
  });
});
