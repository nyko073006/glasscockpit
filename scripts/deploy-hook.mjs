// Kopiert die Hooks atomar nach ~/.claude/hooks/: clearable-banner.py (Stop-Hook, Abend 26b) und clear-sicherung.py
// (SessionEnd-Hook, Nachtrag 43i). Atomar, weil laufende Sitzungen die Hooks starten: temporäre Datei im Zielordner,
// chmod 755, dann rename. Nie direkt in die Zieldatei schreiben.
// Optional: Zielpfad des Banner-Hooks als erstes Argument (Tests); die übrigen Hooks landen im selben Ordner.
// Eingetragen werden die Hooks in ~/.claude/settings.json von Hand (siehe docs/module.md, Übergabe-Signal).
import { chmodSync, copyFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BANNER = process.argv[2] ? resolve(process.argv[2]) : join(homedir(), ".claude", "hooks", "clearable-banner.py");
const ordner = dirname(BANNER);
const ZIELE = [
  [join(ROOT, "hooks", "clearable-banner.py"), BANNER],
  [join(ROOT, "hooks", "clear-sicherung.py"), join(ordner, "clear-sicherung.py")],
];

mkdirSync(ordner, { recursive: true });
for (const [quelle, ziel] of ZIELE) {
  const tmp = join(ordner, `.${basename(ziel)}.${process.pid}.tmp`);
  try {
    copyFileSync(quelle, tmp);
    chmodSync(tmp, 0o755);
    renameSync(tmp, ziel);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  console.log(`Hook kopiert: ${quelle} -> ${ziel}`);
}
