// Kopiert node-pty (lib/ und Prebuilds beider Plattformen) in einen native/-Ordner.
// Gemeinsam genutzt von scripts/deploy.mjs und scripts/release.mjs; Typen entfernt Node selbst (ab 22.18).
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** Plattformen im Release; identisch zu NATIVE_TARGETS in src/core/shell.ts (Test prüft die Gleichheit). */
export const PTY_TARGETS = ["darwin-arm64", "darwin-x64"] as const;
export const PTY_BINARIES = ["pty.node", "spawn-helper"] as const;

/**
 * Pro Plattform: package.json, lib/ (ohne Tests und .map) und prebuilds/<ziel>/ in der Struktur des Pakets.
 * lib/ sucht das Binary relativ unter prebuilds/, spawn-helper muss neben pty.node liegen.
 * Vorher löschen statt überschreiben: Ein geladenes pty.node darf nicht an derselben Stelle verändert werden.
 * Liefert die Zahl der kopierten Dateien. Fehlt etwas im Paket, wirft die Funktion vor dem ersten Schreiben.
 */
export function copyNodePty(ptyQuelle: string, nativeZiel: string): number {
  for (const ziel of PTY_TARGETS) {
    const prebuilds = join("prebuilds", ziel);
    for (const datei of ["package.json", "lib/index.js", ...PTY_BINARIES.map((b) => join(prebuilds, b))]) {
      if (!existsSync(join(ptyQuelle, datei))) {
        throw new Error(`node-pty unvollständig, ${datei} fehlt: erst npm install`);
      }
    }
  }

  let anzahl = 0;
  const zaehle = (quelle: string) => {
    if (statSync(quelle).isFile()) anzahl += 1;
    return true;
  };
  for (const ziel of PTY_TARGETS) {
    const prebuilds = join("prebuilds", ziel);
    const archZiel = join(nativeZiel, ziel);
    rmSync(archZiel, { recursive: true, force: true });
    mkdirSync(archZiel, { recursive: true });

    copyFileSync(join(ptyQuelle, "package.json"), join(archZiel, "package.json"));
    anzahl += 1;
    cpSync(join(ptyQuelle, "lib"), join(archZiel, "lib"), {
      recursive: true,
      filter: (quelle) => !/\.test\.js$|\.map$/.test(quelle) && zaehle(quelle),
    });
    cpSync(join(ptyQuelle, prebuilds), join(archZiel, prebuilds), { recursive: true, filter: zaehle });
    for (const binary of PTY_BINARIES) {
      chmodSync(join(archZiel, prebuilds, binary), 0o755);
    }
  }
  return anzahl;
}
