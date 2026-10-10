// Baut das Release-ZIP dist/<id>-<version>.zip aus dem fertigen Build. Typen entfernt Node selbst (ab 22.18).
// Aufbau im ZIP: <id>/ mit main.js, manifest.json, styles.css, LICENSE, THIRD-PARTY-NOTICES.md und native/
// (darwin-arm64 und darwin-x64, Struktur des npm-Pakets). Rechte stammen aus dem Dateisystem (zip -X, kein Mac-Zusatz).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyNodePty } from "./native-copy.ts";

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
}

/** Packt das ZIP und liefert seinen Pfad. Bricht ab, bevor dist/ angelegt wird, wenn etwas fehlt. */
export function packRelease({ root, ptyQuelle }: PackOptionen): string {
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

    const dist = join(root, "dist");
    mkdirSync(dist, { recursive: true });
    const zip = join(dist, `${manifest.id}-${manifest.version}.zip`);
    rmSync(zip, { force: true });
    execFileSync("zip", ["-X", "-r", "-q", zip, manifest.id], { cwd: stage });
    return zip;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
