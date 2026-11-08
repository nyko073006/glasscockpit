import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { copyNodePty } from "../scripts/lib/native-copy";
import { system32Path } from "../src/core/platform-path";
import { cleanupStaleDownloads, downloadNative, windowsExtract } from "../src/host/native-download";
import { ROOT } from "./helpers/files";

const PTY = join(ROOT, "node_modules", "node-pty");

// Nur unter Windows (Abend 40, Task 3; läuft im Probe-Repo nur im Job vitest auf windows-latest, x64; auf windows-11-arm
// läuft nur die E2E-Prüfung, dieser Test nicht): echtes tar.exe und eine
// echte, geladene conpty.node. Das ist die Lage der meisten Nutzer, die ihr Paket erneuern, während Obsidian node-pty hält.
describe.runIf(process.platform === "win32")("Abend 40 (3): Download unter Windows, während node-pty geladen ist", () => {
  const ziel = `win32-${process.arch}`;
  const angelegt: string[] = [];
  function temp(name: string): string {
    const d = mkdtempSync(join(tmpdir(), `glasscockpit-${name}-`));
    angelegt.push(d);
    return d;
  }
  // Aufräumen darf scheitern: Die geladene conpty.node hält ihren Ordner fest (EPERM/EBUSY), der Runner ist flüchtig.
  afterAll(() => {
    for (const d of angelegt) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // geladene .node-Datei, bleibt bis zum Ende des Runners liegen
      }
    }
  });

  it("tauscht sofort, lässt den alten Baum mit conpty.dll und OpenConsole.exe liegen, und das Aufräumen wirft nicht", { timeout: 60_000 }, async () => {
    // Der Stand „vorher“: ein installiertes native/<ziel> mit Marker, dessen conpty.node geladen ist (wie in Obsidian).
    const plugin = temp("plugin");
    copyNodePty(PTY, join(plugin, "native"), [ziel]);
    writeFileSync(join(plugin, "native", ziel, "marker.txt"), "alt");
    const laden = createRequire(import.meta.url);
    laden(join(plugin, "native", ziel, "prebuilds", ziel, "conpty.node"));

    // Das Release-ZIP des Ziels: Inhalt von native/<ziel>/ direkt an der Wurzel, gepackt mit tar.exe wie im Release.
    const quelle = temp("quelle");
    copyNodePty(PTY, quelle, [ziel]);
    const zip = join(temp("zip"), "native.zip");
    execFileSync(system32Path(process.env.SystemRoot, "tar.exe"), ["-a", "-c", "-f", zip, "-C", join(quelle, ziel), "lib", "package.json", "prebuilds"]);

    const r = await downloadNative(
      { pluginDir: plugin, platform: "win32", arch: process.arch, version: "0.3.9" },
      {
        fetchBytes: async () => ({ status: 200, bytes: readFileSync(zip) }),
        extract: (z, d) => windowsExtract(z, d),
        clearQuarantine: async () => {},
      },
    );
    expect(r.ok, r.ok ? "" : r.reason).toBe(true);

    // Der Tausch steht sofort: das neue Paket liegt da, der Marker des alten ist weg.
    expect(existsSync(join(plugin, "native", ziel, "marker.txt"))).toBe(false);
    expect(existsSync(join(plugin, "native", ziel, "lib", "index.js"))).toBe(true);

    // Das alte Paket liegt vollständig im Temp-Ordner, weil sich die geladene conpty.node nicht löschen lässt und
    // removeUnlessLoaded dann nichts weiter anfasst. Gebraucht wird es nicht: conpty.node sucht conpty.dll im neuen native/<ziel>.
    const reste = readdirSync(plugin).filter((n) => n.startsWith(".native-download-"));
    expect(reste.length).toBe(1);
    const alt = join(plugin, reste[0], "alt");
    for (const rel of [
      "marker.txt",
      join("prebuilds", ziel, "conpty.node"),
      join("prebuilds", ziel, "conpty", "conpty.dll"),
      join("prebuilds", ziel, "conpty", "OpenConsole.exe"),
    ]) {
      expect(existsSync(join(alt, rel)), rel).toBe(true);
    }

    // Das Aufräumen beim nächsten Laden versucht es, scheitert an der geladenen Datei und wirft nicht.
    await expect(cleanupStaleDownloads(plugin)).resolves.toEqual({ entfernt: 0, inBenutzung: 1 });
    expect(existsSync(join(alt, "prebuilds", ziel, "conpty", "conpty.dll"))).toBe(true);
  });
});
