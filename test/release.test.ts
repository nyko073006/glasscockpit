import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashTree } from "../scripts/lib/native-checksums";
import { packRelease } from "../scripts/lib/release";
import { NATIVE_CHECKSUMS } from "../src/core/native-checksums";
import { nativeAssetName, verifyNative } from "../src/core/native-verify";
import { ROOT } from "./helpers/files";

const PTY = join(ROOT, "node_modules", "node-pty");
const aufraeumen: string[] = [];

/** Kleine Wurzel mit Platzhalter-Build; node-pty kommt echt aus dem Repo. */
function fakeWurzel(ohne: string[] = [], version = "9.9.9"): string {
  const dir = mkdtempSync(join(tmpdir(), "glasscockpit-release-"));
  aufraeumen.push(dir);
  mkdirSync(join(dir, "build"));
  const dateien: Record<string, string> = {
    "build/main.js": "// main",
    "build/styles.css": "/* css */",
    "manifest.json": JSON.stringify({ id: "glasscockpit", name: "Glasscockpit", version }),
    "package.json": JSON.stringify({ name: "glasscockpit", version: "9.9.9" }),
    LICENSE: "MIT",
    "THIRD-PARTY-NOTICES.md": "# Notices",
  };
  for (const [name, inhalt] of Object.entries(dateien)) {
    if (!ohne.includes(name)) writeFileSync(join(dir, name), inhalt);
  }
  return dir;
}

interface Eintrag {
  rechte: string;
  name: string;
}
function zipListe(zip: string): Eintrag[] {
  const roh = execFileSync("unzip", ["-Z", zip], { encoding: "utf8" });
  return roh
    .split("\n")
    .map((z) => /^([-d][rwx-]{9})\s+\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/.exec(z))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ rechte: m[1], name: m[2] }));
}

afterEach(() => {
  for (const d of aufraeumen.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("Abend 25 (2): Release-ZIP", () => {
  it("heißt <id>-<version>.zip in dist/ und enthält genau <id>/ mit den Pflichtdateien", () => {
    const wurzel = fakeWurzel();
    const zip = packRelease({ root: wurzel, ptyQuelle: PTY });
    expect(zip).toBe(join(wurzel, "dist", "glasscockpit-9.9.9.zip"));
    const dateien = zipListe(zip).filter((e) => !e.rechte.startsWith("d")).map((e) => e.name);
    for (const pflicht of ["main.js", "manifest.json", "styles.css", "LICENSE", "THIRD-PARTY-NOTICES.md"]) {
      expect(dateien, pflicht).toContain(`glasscockpit/${pflicht}`);
    }
    // Nichts außerhalb von glasscockpit/, und nichts außer den Pflichtdateien und native/
    expect(dateien.filter((n) => !n.startsWith("glasscockpit/"))).toEqual([]);
    const rest = dateien.map((n) => n.slice("glasscockpit/".length)).filter((n) => !n.startsWith("native/"));
    expect(rest.sort()).toEqual(["LICENSE", "THIRD-PARTY-NOTICES.md", "main.js", "manifest.json", "styles.css"]);
  });

  it("native/ hat genau darwin-arm64 und darwin-x64, ohne Windows, Tests, Maps oder Macken", () => {
    const zip = packRelease({ root: fakeWurzel(), ptyQuelle: PTY });
    const namen = zipListe(zip).map((e) => e.name);
    const native = namen.filter((n) => n.startsWith("glasscockpit/native/"));
    const ziele = new Set(native.map((n) => n.split("/")[2]).filter(Boolean));
    expect([...ziele].sort()).toEqual(["darwin-arm64", "darwin-x64"]);
    for (const t of ["darwin-arm64", "darwin-x64"]) {
      for (const d of ["package.json", "lib/index.js", `prebuilds/${t}/pty.node`, `prebuilds/${t}/spawn-helper`]) {
        expect(namen, `${t}/${d}`).toContain(`glasscockpit/native/${t}/${d}`);
      }
    }
    expect(namen.filter((n) => /win32|\.map$|\.test\.js$|\.DS_Store|__MACOSX|\.pdb$/.test(n))).toEqual([]);
  });

  it("pty.node und spawn-helper tragen im ZIP das Ausführrecht (0755), die übrigen Dateien nicht", () => {
    const zip = packRelease({ root: fakeWurzel(), ptyQuelle: PTY });
    const liste = zipListe(zip).filter((e) => !e.rechte.startsWith("d"));
    for (const t of ["darwin-arm64", "darwin-x64"]) {
      for (const b of ["pty.node", "spawn-helper"]) {
        const e = liste.find((x) => x.name === `glasscockpit/native/${t}/prebuilds/${t}/${b}`);
        expect(e?.rechte, `${t}/${b}`).toBe("-rwxr-xr-x");
      }
    }
    for (const e of liste.filter((x) => !/\/(pty\.node|spawn-helper)$/.test(x.name))) {
      expect(e.rechte, e.name).toBe("-rw-r--r--");
    }
  });

  it("entpackt gibt das ZIP dieselben Bytes wie die Quelle", () => {
    const wurzel = fakeWurzel();
    const zip = packRelease({ root: wurzel, ptyQuelle: PTY });
    const aus = mkdtempSync(join(tmpdir(), "glasscockpit-unzip-"));
    aufraeumen.push(aus);
    execFileSync("unzip", ["-q", zip, "-d", aus]);
    expect(readFileSync(join(aus, "glasscockpit", "main.js"), "utf8")).toBe("// main");
    const t = "darwin-x64";
    const a = readFileSync(join(aus, "glasscockpit", "native", t, "prebuilds", t, "pty.node"));
    expect(a.equals(readFileSync(join(PTY, "prebuilds", t, "pty.node")))).toBe(true);
  });

  it.each(["build/main.js", "build/styles.css", "manifest.json", "LICENSE", "THIRD-PARTY-NOTICES.md"])(
    "fehlt %s, bricht es ab und hinterlässt kein ZIP",
    (fehlt) => {
      const wurzel = fakeWurzel([fehlt]);
      expect(() => packRelease({ root: wurzel, ptyQuelle: PTY })).toThrow(fehlt);
      expect(existsSync(join(wurzel, "dist"))).toBe(false);
    },
  );

  it("Manifest-Version ungleich package.json bricht ab", () => {
    const wurzel = fakeWurzel([], "1.0.0");
    expect(() => packRelease({ root: wurzel, ptyQuelle: PTY })).toThrow("Version");
  });

  it("ein altes ZIP gleichen Namens wird ersetzt, nicht ergänzt", () => {
    const wurzel = fakeWurzel();
    const zip = packRelease({ root: wurzel, ptyQuelle: PTY });
    // Ein Rest im alten Archiv, der im neuen nicht mehr vorkommen darf
    writeFileSync(join(wurzel, "altlast.txt"), "alt");
    execFileSync("zip", ["-X", "-q", zip, "altlast.txt"], { cwd: wurzel });
    expect(zipListe(zip).map((e) => e.name)).toContain("altlast.txt");
    packRelease({ root: wurzel, ptyQuelle: PTY });
    expect(zipListe(zip).map((e) => e.name)).not.toContain("altlast.txt");
    expect(existsSync(join(wurzel, "dist", "glasscockpit"))).toBe(false);
  });
});

describe("Abend 26 (3): Release-Assets für Store, BRAT und Download", () => {
  const ZIELE = ["darwin-arm64", "darwin-x64"] as const;

  it("die Dateinamen der Native-ZIPs sind die, die das Plugin herunterlädt", () => {
    const wurzel = fakeWurzel();
    packRelease({ root: wurzel, ptyQuelle: PTY });
    for (const t of ZIELE) expect(existsSync(join(wurzel, "dist", nativeAssetName(t))), t).toBe(true);
  });

  it("legt main.js, manifest.json und styles.css einzeln neben die ZIPs in dist/", () => {
    const wurzel = fakeWurzel();
    packRelease({ root: wurzel, ptyQuelle: PTY });
    expect(readFileSync(join(wurzel, "dist", "main.js"), "utf8")).toBe("// main");
    expect(readFileSync(join(wurzel, "dist", "styles.css"), "utf8")).toBe("/* css */");
    expect(readFileSync(join(wurzel, "dist", "manifest.json"), "utf8")).toBe(readFileSync(join(wurzel, "manifest.json"), "utf8"));
  });

  it.each(ZIELE)("dist/glasscockpit-native-%s.zip hat die Dateien von native/%s/ direkt an der Wurzel", (t) => {
    const wurzel = fakeWurzel();
    packRelease({ root: wurzel, ptyQuelle: PTY });
    const zip = join(wurzel, "dist", `glasscockpit-native-${t}.zip`);
    const dateien = zipListe(zip).filter((e) => !e.rechte.startsWith("d")).map((e) => e.name).sort();
    expect(dateien).toEqual(Object.keys(NATIVE_CHECKSUMS[t]).sort());
    const fremd = ZIELE.find((z) => z !== t);
    expect(dateien.filter((n) => n.startsWith("native/") || n.startsWith("/") || n.includes(`prebuilds/${fremd}/`))).toEqual([]);
  });

  it.each(ZIELE)("%s: pty.node und spawn-helper 0755, die übrigen 0644", (t) => {
    const wurzel = fakeWurzel();
    packRelease({ root: wurzel, ptyQuelle: PTY });
    const liste = zipListe(join(wurzel, "dist", `glasscockpit-native-${t}.zip`)).filter((e) => !e.rechte.startsWith("d"));
    for (const e of liste) {
      const ausfuehrbar = /(^|\/)(pty\.node|spawn-helper)$/.test(e.name);
      expect(e.rechte, e.name).toBe(ausfuehrbar ? "-rwxr-xr-x" : "-rw-r--r--");
    }
  });

  it.each(ZIELE)("%s: entpackt besteht der Baum verifyNative gegen die eingecheckten Summen", (t) => {
    const wurzel = fakeWurzel();
    packRelease({ root: wurzel, ptyQuelle: PTY });
    const aus = mkdtempSync(join(tmpdir(), "glasscockpit-unzip-"));
    aufraeumen.push(aus);
    execFileSync("unzip", ["-q", join(wurzel, "dist", `glasscockpit-native-${t}.zip`), "-d", aus]);
    expect(verifyNative(NATIVE_CHECKSUMS[t], hashTree(aus))).toEqual({ ok: true });
  });

  it("passen die eingecheckten Summen nicht zum Paket, bricht es ab und legt dist/ nicht an", () => {
    const wurzel = fakeWurzel();
    const falsch = structuredClone(NATIVE_CHECKSUMS) as Record<string, Record<string, string>>;
    falsch["darwin-x64"]["package.json"] = "0".repeat(64);
    expect(() => packRelease({ root: wurzel, ptyQuelle: PTY, checksums: falsch })).toThrow(/darwin-x64.*package\.json/s);
    expect(existsSync(join(wurzel, "dist"))).toBe(false);
  });

  it("eine Summe, die im Paket gar nicht vorkommt (Datei fehlt im Paket), bricht ebenfalls ab", () => {
    const wurzel = fakeWurzel();
    const mehr = structuredClone(NATIVE_CHECKSUMS) as Record<string, Record<string, string>>;
    mehr["darwin-arm64"]["lib/gibt-es-nicht.js"] = "1".repeat(64);
    expect(() => packRelease({ root: wurzel, ptyQuelle: PTY, checksums: mehr })).toThrow("gibt-es-nicht.js");
    expect(existsSync(join(wurzel, "dist"))).toBe(false);
  });
});
