import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashTree } from "../scripts/lib/native-checksums";
import { copyNodePty } from "../scripts/lib/native-copy";
import { packRelease } from "../scripts/lib/release";
import { type CleanupFs, type DownloadDeps, defaultExtract, downloadNative, nativeInstalled, windowsExtract } from "../src/host/native-download";
import { nativeAssetUrl } from "../src/core/native-verify";
import { ROOT } from "./helpers/files";
import { ON_WINDOWS } from "./helpers/platform";

const PTY = join(ROOT, "node_modules", "node-pty");
const T = "darwin-arm64";
const aufraeumen: string[] = [];
function temp(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `glasscockpit-${name}-`));
  aufraeumen.push(d);
  return d;
}
afterEach(() => {
  for (const d of aufraeumen.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Stand eines Ordners als Text: Pfad, Art, Summe, Rechte. Gleicher Text = unverändert. */
function schnappschuss(dir: string): string {
  if (!existsSync(dir)) return "(fehlt)";
  return JSON.stringify(hashTree(dir).map((e) => [e.path, e.kind, e.sha256, e.kind === "file" ? lstatSync(join(dir, e.path)).mode & 0o777 : 0]));
}

/** Ein Plugin-Ordner mit altem native/darwin-arm64 (Stand „vorher“). */
function pluginMitAltemNative(): string {
  const plugin = temp("plugin");
  const nativeDir = join(plugin, "native", T);
  mkdirSync(nativeDir, { recursive: true });
  writeFileSync(join(nativeDir, "alt.txt"), "alt");
  return plugin;
}

type Aenderung = (entpackt: string) => void;
/** Deps, deren „Entpacken“ den echten Baum aus copyNodePty hinlegt und danach optional verändert. */
function deps(aendere?: Aenderung, extra: Partial<DownloadDeps> = {}) {
  const aufrufe = { urls: [] as string[], quarantaene: [] as string[], entpackt: [] as string[] };
  const d: DownloadDeps = {
    fetchBytes: async (url) => {
      aufrufe.urls.push(url);
      return { status: 200, bytes: new Uint8Array([1, 2, 3]) };
    },
    extract: async (_zip, ziel) => {
      const quelle = temp("quelle");
      copyNodePty(PTY, quelle);
      mkdirSync(ziel, { recursive: true });
      cpSync(join(quelle, T), ziel, { recursive: true });
      aufrufe.entpackt.push(ziel);
      aendere?.(ziel);
    },
    clearQuarantine: async (dir) => {
      aufrufe.quarantaene.push(dir);
    },
    ...extra,
  };
  return { d, aufrufe };
}
const OPT = (plugin: string) => ({ pluginDir: plugin, platform: "darwin", arch: "arm64", version: "0.2.0" });
const PTYNODE = `prebuilds/${T}/pty.node`;

describe("Abend 26 (4): downloadNative, Erfolg", () => {
  // Windows: Test prüft den POSIX-Modus 0o755 (Inventur H19)
  it.skipIf(ON_WINDOWS)("lädt die feste Adresse, ersetzt native/darwin-arm64 vollständig, setzt 0755, räumt auf", async () => {
    const plugin = pluginMitAltemNative();
    const { d, aufrufe } = deps();
    const r = await downloadNative(OPT(plugin), d);
    expect(r.ok).toBe(true);
    expect(aufrufe.urls).toEqual([nativeAssetUrl("0.2.0", T)]);
    const ziel = join(plugin, "native", T);
    expect(existsSync(join(ziel, "alt.txt"))).toBe(false);
    expect(readFileSync(join(ziel, PTYNODE)).equals(readFileSync(join(PTY, "prebuilds", T, "pty.node")))).toBe(true);
    for (const b of ["pty.node", "spawn-helper"]) expect(lstatSync(join(ziel, "prebuilds", T, b)).mode & 0o777).toBe(0o755);
    // Quarantäne wurde auf dem geprüften Baum entfernt, und nichts blieb im Plugin-Ordner liegen
    expect(aufrufe.quarantaene.length).toBe(1);
    expect(readdirSync(plugin)).toEqual(["native"]);
    expect(nativeInstalled(plugin, "darwin", "arm64")).toBe(true);
  });

  it("legt native/ an, wenn es noch fehlt, und lässt die andere Plattform unberührt", async () => {
    const plugin = temp("plugin");
    mkdirSync(join(plugin, "native", "darwin-x64"), { recursive: true });
    writeFileSync(join(plugin, "native", "darwin-x64", "bleibt.txt"), "x");
    const r = await downloadNative(OPT(plugin), deps().d);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(plugin, "native", "darwin-x64", "bleibt.txt"), "utf8")).toBe("x");
  });
});

describe("Abend 26 (4): downloadNative, Pflicht-Gegentests (native/ bleibt unverändert)", () => {
  async function scheitert(aendere: Aenderung | undefined, extra: Partial<DownloadDeps> = {}) {
    const plugin = pluginMitAltemNative();
    const vorher = schnappschuss(join(plugin, "native", T));
    const { d } = deps(aendere, extra);
    const r = await downloadNative(OPT(plugin), d);
    expect(r.ok).toBe(false);
    expect(schnappschuss(join(plugin, "native", T))).toBe(vorher);
    expect(readdirSync(plugin)).toEqual(["native"]); // Temp aufgeräumt
    return r.ok ? "" : r.reason;
  }

  it("(a) eine veränderte Datei im entpackten Baum", async () => {
    const grund = await scheitert((z) => writeFileSync(join(z, "lib", "index.js"), "// manipuliert"));
    expect(grund).toContain("lib/index.js");
  });

  it("(a) ein manipuliertes pty.node", async () => {
    const grund = await scheitert((z) => writeFileSync(join(z, PTYNODE), Buffer.from("böse")));
    expect(grund).toContain("pty.node");
  });

  it("(b) eine Zusatzdatei", async () => {
    const grund = await scheitert((z) => writeFileSync(join(z, "lib", "zusatz.js"), "x"));
    expect(grund).toContain("zusatz.js");
  });

  // Windows: Symlink anlegen braucht Rechte (Inventur H19)
  it.skipIf(ON_WINDOWS)("(c) Symlink statt Datei", async () => {
    const grund = await scheitert((z) => {
      rmSync(join(z, PTYNODE));
      symlinkSync("/usr/bin/true", join(z, PTYNODE));
    });
    expect(grund).toContain("Symlink");
  });

  // Windows: Symlink anlegen braucht Rechte (Inventur H19)
  it.skipIf(ON_WINDOWS)("(c) Symlink auf einen Ordner außerhalb", async () => {
    await scheitert((z) => symlinkSync(tmpdir(), join(z, "raus")));
  });

  it("eine fehlende Datei", async () => {
    const grund = await scheitert((z) => rmSync(join(z, "package.json")));
    expect(grund).toContain("package.json");
  });

  it("nichts entpackt (leerer Baum)", async () => {
    await scheitert(undefined, {
      extract: async (_zip, ziel) => {
        mkdirSync(ziel, { recursive: true });
      },
    });
  });

  it("HTTP-Fehler, Netzfehler, Zeitüberschreitung, zu große und leere Antwort", async () => {
    expect(await scheitert(undefined, { fetchBytes: async () => ({ status: 404, bytes: new Uint8Array() }) })).toContain("404");
    expect(await scheitert(undefined, { fetchBytes: async () => { throw new Error("Zeitüberschreitung"); } })).toContain("Zeitüberschreitung");
    expect(await scheitert(undefined, { fetchBytes: async () => ({ status: 200, bytes: new Uint8Array() }) })).toContain("leer");
    expect(await scheitert(undefined, { fetchBytes: async () => ({ status: 200, bytes: new Uint8Array(21 * 1024 * 1024) }) })).toContain("groß");
  });

  it("Entpacken schlägt fehl", async () => {
    await scheitert(undefined, { extract: async () => { throw new Error("ditto kaputt"); } });
  });

  it("Quarantäne-Entfernung schlägt fehl: vor dem Tausch, native/ unverändert", async () => {
    await scheitert(undefined, { clearQuarantine: async () => { throw new Error("xattr kaputt"); } });
  });

  it("scheitert der Tausch (zweites rename), wird das alte native/ zurückgelegt", async () => {
    let n = 0;
    const grund = await scheitert(undefined, {
      rename: async (von, nach) => {
        n += 1;
        if (n === 2) throw new Error("rename kaputt");
        const { rename } = await import("node:fs/promises");
        await rename(von, nach);
      },
    });
    expect(grund).toContain("rename kaputt");
    expect(n).toBe(3); // alt weg, neu scheitert, alt zurück
  });

  it("andere Plattform als macOS arm64/x64: kein Abruf, Fehler", async () => {
    const plugin = temp("plugin");
    const { d, aufrufe } = deps();
    const r = await downloadNative({ ...OPT(plugin), platform: "linux", arch: "x64" }, d);
    expect(r.ok).toBe(false);
    expect(aufrufe.urls).toEqual([]);
  });

  it("ungültige Version: kein Abruf, Fehler", async () => {
    const plugin = temp("plugin");
    const { d, aufrufe } = deps();
    const r = await downloadNative({ ...OPT(plugin), version: "0.2.0/../x" }, d);
    expect(r.ok).toBe(false);
    expect(aufrufe.urls).toEqual([]);
  });
});

// Windows: echtes defaultExtract (ditto, unzip), packRelease (zip), python3, POSIX-Modus (Inventur H19)
describe.skipIf(ON_WINDOWS)("Abend 26 (4): echtes Entpacken mit ditto", () => {
  function echtesZip(): string {
    const wurzel = temp("wurzel");
    mkdirSync(join(wurzel, "build"));
    for (const [n, i] of [["build/main.js", "//"], ["build/styles.css", "/**/"], ["LICENSE", "MIT"], ["THIRD-PARTY-NOTICES.md", "#"]]) writeFileSync(join(wurzel, n), i);
    writeFileSync(join(wurzel, "manifest.json"), JSON.stringify({ id: "glasscockpit", version: "9.9.9" }));
    writeFileSync(join(wurzel, "package.json"), JSON.stringify({ version: "9.9.9" }));
    packRelease({ root: wurzel, ptyQuelle: PTY });
    return join(wurzel, "dist", `glasscockpit-native-${T}.zip`);
  }

  it("Ende-zu-Ende: das Release-ZIP, über den Fetch geliefert, ergibt ein funktionsfertiges native/", async () => {
    const zip = echtesZip();
    const plugin = pluginMitAltemNative();
    const bytes = readFileSync(zip);
    const r = await downloadNative(OPT(plugin), {
      fetchBytes: async () => ({ status: 200, bytes: new Uint8Array(bytes) }),
      extract: defaultExtract,
      clearQuarantine: async () => {},
    });
    expect(r).toMatchObject({ ok: true });
    const ziel = join(plugin, "native", T);
    for (const b of ["pty.node", "spawn-helper"]) expect(lstatSync(join(ziel, "prebuilds", T, b)).mode & 0o777).toBe(0o755);
    expect(existsSync(join(ziel, "alt.txt"))).toBe(false);
  });

  it("ein ZIP mit Pfad nach außen (..) wird vor dem Entpacken abgelehnt, nichts landet außerhalb", async () => {
    const dir = temp("slip");
    const zip = join(dir, "boese.zip");
    execFileSync("python3", ["-I", "-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('../ausbruch.txt','x'); z.writestr('ok.txt','y'); z.close()", zip]);
    const ziel = join(dir, "a", "b");
    mkdirSync(ziel, { recursive: true });
    await expect(defaultExtract(zip, ziel)).rejects.toThrow(/Pfad|\.\./);
    expect(existsSync(join(dir, "a", "ausbruch.txt"))).toBe(false);
    expect(readdirSync(ziel)).toEqual([]);
  });

  it("ein kaputtes ZIP wirft", async () => {
    const dir = temp("kaputt");
    writeFileSync(join(dir, "x.zip"), "kein zip");
    await expect(defaultExtract(join(dir, "x.zip"), join(dir, "ziel"))).rejects.toThrow();
  });
});

describe("Abend 40 (3): windowsExtract", () => {
  const TAR = "C:\\W\\System32\\tar.exe";
  type Aufruf = [string, string[]];
  function fakeRun(listing: string) {
    const aufrufe: Aufruf[] = [];
    const run = async (datei: string, args: string[]): Promise<string> => {
      aufrufe.push([datei, args]);
      return args[0] === "-t" ? listing : "";
    };
    return { run, aufrufe };
  }

  it("listet zuerst (tar.exe unter System32), legt den Zielordner an und entpackt dann", async () => {
    const dir = temp("win");
    const zip = join(dir, "native.zip");
    const dest = join(dir, "entpackt");
    const { run, aufrufe } = fakeRun("lib/\r\nlib/index.js\r\nprebuilds/win32-x64/conpty.node\r\n");
    await windowsExtract(zip, dest, "C:\\W", run);
    expect(aufrufe).toEqual([
      [TAR, ["-t", "-f", zip]],
      [TAR, ["-x", "-f", zip, "-C", dest]],
    ]);
    expect(existsSync(dest)).toBe(true); // mkdir lief vor dem Entpacken
  });

  it("ein Pfad nach außen im Listing wirft vor jedem Schreiben: nur ein Aufruf, kein Zielordner", async () => {
    for (const boese of ["../x", "/abs", "C:\\x", "./lib/index.js", "C:/Windows/x", "C:x", "lib/index.js:s"]) {
      const dir = temp("win");
      const zip = join(dir, "native.zip");
      const dest = join(dir, "entpackt");
      const { run, aufrufe } = fakeRun(`lib/index.js\r\n${boese}\r\n`);
      await expect(windowsExtract(zip, dest, "C:\\W", run), boese).rejects.toThrow("Unzulässiger Pfad im ZIP");
      expect(aufrufe, boese).toEqual([[TAR, ["-t", "-f", zip]]]);
      expect(existsSync(dest), boese).toBe(false);
    }
  });

  it("scheitert das Listing selbst, kommt der Fehler weiter und nichts wird angelegt oder entpackt", async () => {
    const dir = temp("win");
    const dest = join(dir, "entpackt");
    const aufrufe: string[][] = [];
    const run = async (_datei: string, args: string[]): Promise<string> => {
      aufrufe.push(args);
      throw new Error("tar kaputt");
    };
    await expect(windowsExtract(join(dir, "native.zip"), dest, "C:\\W", run)).rejects.toThrow("tar kaputt");
    expect(aufrufe.length).toBe(1);
    expect(existsSync(dest)).toBe(false);
  });

  it("ohne SystemRoot (leer oder fehlend) gilt C:\\Windows, nie ein Aufruf über PATH", async () => {
    // Der Fall „fehlend“ greift auf den Vorgabewert process.env.SystemRoot zurück; der Test entfernt ihn, damit ein echter Wert
    // (unter Windows gesetzt) das Ergebnis nicht bestimmt.
    const echt = process.env.SystemRoot;
    delete process.env.SystemRoot;
    try {
      for (const wurzel of [undefined, ""]) {
        const dir = temp("win");
        const { run, aufrufe } = fakeRun("lib/\n");
        await windowsExtract(join(dir, "a.zip"), join(dir, "ziel"), wurzel, run);
        expect(aufrufe.map(([datei]) => datei)).toEqual(["C:\\Windows\\System32\\tar.exe", "C:\\Windows\\System32\\tar.exe"]);
      }
    } finally {
      if (echt !== undefined) process.env.SystemRoot = echt;
    }
  });
});

describe("Abend 40 (3): downloadNative räumt über removeUnlessLoaded auf", () => {
  it("bleibt eine .node-Datei in Benutzung, bleibt der Temp-Ordner liegen, der Tausch steht und das Ergebnis ist ok", async () => {
    const plugin = pluginMitAltemNative();
    const aufrufe: string[] = [];
    const cleanup: CleanupFs = {
      files: async (dir) => {
        aufrufe.push(`files ${dir}`);
        return [join(dir, "alt", "geladen.node")];
      },
      unlink: async (datei) => {
        aufrufe.push(`unlink ${datei}`);
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      },
      rmTree: async (dir) => {
        aufrufe.push(`rmTree ${dir}`);
      },
      list: async () => [],
    };
    const { d } = deps(undefined, { cleanup });
    const r = await downloadNative(OPT(plugin), d);
    expect(r.ok).toBe(true);
    expect(existsSync(join(plugin, "native", T, "alt.txt"))).toBe(false); // getauscht
    const reste = readdirSync(plugin).filter((n) => n.startsWith(".native-download-"));
    expect(reste.length).toBe(1);
    const tempDir = join(plugin, reste[0]);
    expect(aufrufe).toEqual([`files ${tempDir}`, `unlink ${join(tempDir, "alt", "geladen.node")}`]);
    expect(existsSync(join(tempDir, "alt", "alt.txt"))).toBe(true); // das alte Paket liegt unversehrt in alt/
  });

  it("auch bei einem Fehler vor dem Tausch geht das Aufräumen über die Abhängigkeit", async () => {
    const plugin = pluginMitAltemNative();
    const aufrufe: string[] = [];
    const cleanup: CleanupFs = {
      files: async (dir) => {
        aufrufe.push(`files ${dir}`);
        return [];
      },
      unlink: async () => {},
      rmTree: async (dir) => {
        aufrufe.push(`rmTree ${dir}`);
      },
      list: async () => [],
    };
    const { d } = deps(undefined, { cleanup, fetchBytes: async () => ({ status: 404, bytes: new Uint8Array() }) });
    const r = await downloadNative(OPT(plugin), d);
    expect(r.ok).toBe(false);
    expect(aufrufe.map((a) => a.split(" ")[0])).toEqual(["files", "rmTree"]);
  });
});

describe("Abend 26 (4): nativeInstalled", () => {
  it("false ohne native/, false bei halbem Ordner, true bei vollständigen Kerndateien", () => {
    const plugin = temp("plugin");
    expect(nativeInstalled(plugin, "darwin", "arm64")).toBe(false);
    mkdirSync(join(plugin, "native", T, "lib"), { recursive: true });
    writeFileSync(join(plugin, "native", T, "lib", "index.js"), "");
    expect(nativeInstalled(plugin, "darwin", "arm64")).toBe(false);
    copyNodePty(PTY, join(plugin, "native"));
    expect(nativeInstalled(plugin, "darwin", "arm64")).toBe(true);
    expect(nativeInstalled(plugin, "linux", "x64")).toBe(false);
  });
});
