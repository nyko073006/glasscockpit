// Baut die Release-Dateien in dist/ aus dem fertigen Build: <id>-<version>.zip (Komplettpaket), je Plattform
// <id>-native-<ziel>.zip (nur native/<ziel>/, Download-Knopf des Plugins) und main.js, manifest.json, styles.css einzeln (Store, BRAT). Typen entfernt Node selbst (ab 22.18).
// Aufbau im ZIP: <id>/ mit main.js, manifest.json, styles.css, LICENSE, THIRD-PARTY-NOTICES.md und native/
// (darwin-arm64 und darwin-x64, Struktur des npm-Pakets). Rechte stammen aus dem Dateisystem (zip -X, kein Mac-Zusatz).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NATIVE_CHECKSUMS } from "../../src/core/native-checksums.ts";
import { verifyNative } from "../../src/core/native-verify.ts";
import { hashTree } from "./native-checksums.ts";
import { PTY_TARGETS, copyNodePty } from "./native-copy.ts";

/** Quelle (relativ zur Repo-Wurzel) und Dateiname im ZIP. */
export const RELEASE_DATEIEN: ReadonlyArray<readonly [string, string]> = [
  ["build/main.js", "main.js"],
  ["manifest.json", "manifest.json"],
  ["build/styles.css", "styles.css"],
  ["LICENSE", "LICENSE"],
  ["THIRD-PARTY-NOTICES.md", "THIRD-PARTY-NOTICES.md"],
];

export interface PackOptionen {
  /** Repo-Wurzel (oder eine Wurzel mit derselben Aufteilung). */
  root: string;
  /** node_modules/node-pty. */
  ptyQuelle: string;
  /** Nur für Tests: Summen, gegen die das Paket geprüft wird. Vorgabe sind die eingecheckten. */
  checksums?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Einzelne Dateien für Store und BRAT (Quelle, Name in dist/). */
const EINZELDATEIEN: ReadonlyArray<readonly [string, string]> = [
  ["build/main.js", "main.js"],
  ["manifest.json", "manifest.json"],
  ["build/styles.css", "styles.css"],
];

/** Packt das ZIP und liefert seinen Pfad. Bricht ab, bevor dist/ angelegt wird, wenn etwas fehlt. */
export function packRelease({ root, ptyQuelle, checksums = NATIVE_CHECKSUMS }: PackOptionen): string {
  for (const [quelle] of RELEASE_DATEIEN) {
    if (!existsSync(join(root, quelle))) throw new Error(`${quelle} fehlt, erst npm run build ausführen`);
  }
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as { id: string; version: string };
  const paket = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
  if (manifest.version !== paket.version) {
    throw new Error(`Version in manifest.json (${manifest.version}) und package.json (${paket.version}) weichen ab`);
  }

  // Aufbau außerhalb von dist/, damit nie ein halber Ordner dort liegen bleibt.
  const stage = mkdtempSync(join(tmpdir(), "glasscockpit-stage-"));
  try {
    const ordner = join(stage, manifest.id);
    mkdirSync(ordner);
    for (const [quelle, name] of RELEASE_DATEIEN) copyFileSync(join(root, quelle), join(ordner, name));
    copyNodePty(ptyQuelle, join(ordner, "native"));
    // Keine Quarantäne- oder Finder-Attribute ins Archiv
    execFileSync("xattr", ["-cr", ordner]);

    // Der Download im Plugin prüft gegen native-checksums.ts: Passt das Paket nicht dazu, würde jeder Download scheitern.
    for (const ziel of PTY_TARGETS) {
      const r = verifyNative(checksums[ziel] ?? {}, hashTree(join(ordner, "native", ziel)));
      if (!r.ok) {
        throw new Error(`native-checksums.ts passt nicht zum Paket (${ziel}): ${r.reason}. Erst npm run native-checksums ausführen.`);
      }
    }

    const dist = join(root, "dist");
    mkdirSync(dist, { recursive: true });
    for (const [quelle, name] of EINZELDATEIEN) copyFileSync(join(root, quelle), join(dist, name));
    // Eine ZIP je Plattform, Inhalt von native/<ziel>/ direkt an der Wurzel (Rechte stammen aus dem Dateisystem)
    for (const ziel of PTY_TARGETS) {
      const nativeZip = join(dist, `${manifest.id}-native-${ziel}.zip`);
      rmSync(nativeZip, { force: true });
      execFileSync("zip", ["-X", "-r", "-q", nativeZip, "."], { cwd: join(ordner, "native", ziel) });
    }
    const zip = join(dist, `${manifest.id}-${manifest.version}.zip`);
    rmSync(zip, { force: true });
    execFileSync("zip", ["-X", "-r", "-q", zip, manifest.id], { cwd: stage });
    return zip;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
