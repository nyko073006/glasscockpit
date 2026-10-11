import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashTree } from "../scripts/lib/native-checksums";
import { copyNodePty } from "../scripts/lib/native-copy";
import { packRelease } from "../scripts/lib/release";
import { type DownloadDeps, defaultExtract, downloadNative, nativeInstalled } from "../src/host/native-download";
import { nativeAssetUrl } from "../src/core/native-verify";
import { ROOT } from "./helpers/files";

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
      execFileSync("cp", ["-Rp", `${join(quelle, T)}/.`, ziel]);
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
  it("lädt die feste Adresse, ersetzt native/darwin-arm64 vollständig, setzt 0755, räumt auf", async () => {
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

  it("(c) Symlink statt Datei", async () => {
    const grund = await scheitert((z) => {
      rmSync(join(z, PTYNODE));
      symlinkSync("/usr/bin/true", join(z, PTYNODE));
    });
    expect(grund).toContain("Symlink");
  });

  it("(c) Symlink auf einen Ordner außerhalb", async () => {
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

describe("Abend 26 (4): echtes Entpacken mit ditto", () => {
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
