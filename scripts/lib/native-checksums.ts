// Prüfsummen von node-pty für den Download (Abend 26). Erzeugt die Liste „Pfad -> SHA256“ je Ziel aus
// node_modules/node-pty, über denselben Weg wie Deploy und Release (copyNodePty), damit die Pfade exakt stimmen.
// Typen entfernt Node selbst (ab 22.18); deshalb Importe mit .ts-Endung.
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FoundEntry } from "../../src/core/native-verify.ts";
import { PTY_TARGETS, copyNodePty } from "./native-copy.ts";

export type NativeChecksums = Record<string, Record<string, string>>;

/** Liest einen Baum ohne Symlinks zu folgen (lstat). Pfade relativ zu dir, mit "/" getrennt. */
export function hashTree(dir: string): FoundEntry[] {
  const liste: FoundEntry[] = [];
  const geh = (abs: string, rel: string) => {
    for (const name of readdirSync(abs).sort()) {
      const a = join(abs, name);
      const r = rel === "" ? name : `${rel}/${name}`;
      const st = lstatSync(a);
      if (st.isSymbolicLink()) liste.push({ path: r, kind: "symlink" });
      else if (st.isDirectory()) {
        liste.push({ path: r, kind: "dir" });
        geh(a, r);
      } else if (st.isFile()) {
        liste.push({ path: r, kind: "file", sha256: createHash("sha256").update(readFileSync(a)).digest("hex") });
      } else liste.push({ path: r, kind: "other" });
    }
  };
  geh(dir, "");
  return liste;
}

/** Summen aller Dateien, wie copyNodePty sie in native/<ziel>/ anlegt, nach Pfad sortiert. */
export function computeNativeChecksums(ptyQuelle: string): NativeChecksums {
  const temp = mkdtempSync(join(tmpdir(), "glasscockpit-checksums-"));
  try {
    copyNodePty(ptyQuelle, temp);
    const aus: NativeChecksums = {};
    for (const ziel of PTY_TARGETS) {
      const eintraege: Record<string, string> = {};
      for (const e of hashTree(join(temp, ziel))) {
        if (e.kind === "file" && e.sha256) eintraege[e.path] = e.sha256;
        else if (e.kind !== "dir") throw new Error(`Unerwarteter Eintrag in ${ziel}: ${e.path} (${e.kind})`);
      }
      aus[ziel] = Object.fromEntries(Object.entries(eintraege).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return aus;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Text der erzeugten Datei src/core/native-checksums.ts (stabil, damit der Wächter byte-genau vergleichen kann). */
export function renderChecksumsModule(c: NativeChecksums): string {
  const ziele = Object.keys(c)
    .sort()
    .map((ziel) => {
      const zeilen = Object.entries(c[ziel]).map(([p, h]) => `    ${JSON.stringify(p)}: ${JSON.stringify(h)},`);
      return `  ${JSON.stringify(ziel)}: {\n${zeilen.join("\n")}\n  },`;
    });
  return `// ERZEUGT mit npm run native-checksums aus node_modules/node-pty (1.1.0), nicht von Hand ändern.
// Pfad relativ zu native/<ziel>/ -> SHA256 jeder Datei, exakt so, wie copyNodePty sie anlegt (scripts/lib/native-copy.ts).
// Fest im Plugin und keine Einstellung: Diese Summen entscheiden, ob ein Download als node-pty gilt (src/core/native-verify.ts).
// Der Wächter-Test test/native-checksums.test.ts wird rot, wenn node-pty oder copyNodePty sich ändern.
export const NATIVE_CHECKSUMS: Readonly<Record<"darwin-arm64" | "darwin-x64", Readonly<Record<string, string>>>> = {
${ziele.join("\n")}
};
`;
}
