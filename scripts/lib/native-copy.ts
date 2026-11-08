// Kopiert node-pty (lib/ und Prebuilds) in einen native/-Ordner, für macOS und Windows.
// Gemeinsam genutzt von scripts/deploy.mjs und scripts/release.mjs; Typen entfernt Node selbst (ab 22.18).
// Bleibt ohne Importe aus src/: Deploy und Release laden die Datei direkt unter Node.
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Ziele im Release; identisch zu NATIVE_TARGETS in src/core/shell.ts (Test prüft die Gleichheit). */
export const PTY_TARGETS = ["darwin-arm64", "darwin-x64", "win32-arm64", "win32-x64"] as const;
export const PTY_BINARIES = ["pty.node", "spawn-helper"] as const;
/** Aus prebuilds/<ziel>/ für Windows, relativ dazu. Kein pty.node und kein winpty (das Plugin nutzt nur ConPTY), keine .pdb. */
export const WIN32_PREBUILDS = ["conpty.node", "conpty_console_list.node", "conpty/conpty.dll", "conpty/OpenConsole.exe"] as const;

/** Das Original, das die Ersatzdatei ablöst: lib/windowsConoutConnection.js aus node-pty 1.1.0 (gemessen 18.10.2026). */
const CONOUT = "lib/windowsConoutConnection.js";
export const CONOUT_ORIGINAL_SHA256 = "1440f70908fb1f55911ac8e936a1230f68a9c00c03096fcef6788eac6aad9d62";
/** Ersatz ohne Worker-Thread (Obsidians Renderer startet keine Worker); nur in den win32-Zielen. */
const CONOUT_ERSATZ = fileURLToPath(new URL("./node-pty-windows/windowsConoutConnection.js", import.meta.url));

/**
 * Pro Ziel: package.json, lib/ (ohne Tests und .map) und prebuilds/<ziel>/ in der Struktur des Pakets.
 * macOS: ganzes prebuilds/<ziel>/, spawn-helper muss neben pty.node liegen und beide bekommen 0755.
 * Windows: nur WIN32_PREBUILDS und in lib/ statt des Originals die Ersatzdatei, ohne chmod.
 * lib/ sucht das Binary relativ unter prebuilds/.
 * Vorher löschen statt überschreiben: Ein geladenes Binary darf nicht an derselben Stelle verändert werden.
 * Liefert die Zahl der kopierten Dateien. Fehlt etwas im Paket oder passt das Original der Ersatzdatei nicht,
 * wirft die Funktion vor dem ersten Schreiben.
 */
export function copyNodePty(ptyQuelle: string, nativeZiel: string, targets: readonly string[] = PTY_TARGETS): number {
  for (const ziel of targets) {
    if (!(PTY_TARGETS as readonly string[]).includes(ziel)) throw new Error(`Unbekanntes Ziel: ${ziel}`);
    const prebuilds = join("prebuilds", ziel);
    const noetig = ziel.startsWith("win32-")
      ? ["package.json", "lib/index.js", CONOUT, ...WIN32_PREBUILDS.map((d) => join(prebuilds, d))]
      : ["package.json", "lib/index.js", ...PTY_BINARIES.map((b) => join(prebuilds, b))];
    for (const datei of noetig) {
      if (!existsSync(join(ptyQuelle, datei))) {
        throw new Error(`node-pty unvollständig, ${datei} fehlt: erst npm install`);
      }
    }
  }
  if (targets.some((ziel) => ziel.startsWith("win32-"))) {
    if (!existsSync(CONOUT_ERSATZ)) throw new Error(`Ersatzdatei fehlt: ${CONOUT_ERSATZ}`);
    const summe = createHash("sha256").update(readFileSync(join(ptyQuelle, CONOUT))).digest("hex");
    if (summe !== CONOUT_ORIGINAL_SHA256) {
      throw new Error(`node-pty geändert: ${CONOUT} passt nicht zur Ersatzdatei (gebaut für node-pty 1.1.0)`);
    }
  }

  let anzahl = 0;
  const zaehle = (quelle: string) => {
    if (statSync(quelle).isFile()) anzahl += 1;
    return true;
  };
  for (const ziel of targets) {
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
    if (ziel.startsWith("win32-")) {
      // Die Ersatzdatei liegt schon als Original da (mitgezählt) und wird durch sie ersetzt
      copyFileSync(CONOUT_ERSATZ, join(archZiel, CONOUT));
      for (const datei of WIN32_PREBUILDS) {
        mkdirSync(dirname(join(archZiel, prebuilds, datei)), { recursive: true });
        copyFileSync(join(ptyQuelle, prebuilds, datei), join(archZiel, prebuilds, datei));
        anzahl += 1;
      }
    } else {
      cpSync(join(ptyQuelle, prebuilds), join(archZiel, prebuilds), { recursive: true, filter: zaehle });
      for (const binary of PTY_BINARIES) {
        chmodSync(join(archZiel, prebuilds, binary), 0o755);
      }
    }
  }
  return anzahl;
}
