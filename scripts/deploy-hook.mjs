// Kopiert hooks/clearable-banner.py atomar nach ~/.claude/hooks/clearable-banner.py (Stop-Hook, Abend 26b).
// Atomar, weil laufende Sitzungen den Hook nach jeder Antwort starten: temporäre Datei im Zielordner,
// chmod 755, dann rename. Nie direkt in die Zieldatei schreiben.
// Optional: Zielpfad als erstes Argument (Tests); Vorgabe ist ~/.claude/hooks/clearable-banner.py.
import { chmodSync, copyFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const QUELLE = join(ROOT, "hooks", "clearable-banner.py");
const ZIEL = process.argv[2] ? resolve(process.argv[2]) : join(homedir(), ".claude", "hooks", "clearable-banner.py");

const ordner = dirname(ZIEL);
mkdirSync(ordner, { recursive: true });
const tmp = join(ordner, `.clearable-banner.py.${process.pid}.tmp`);
try {
  copyFileSync(QUELLE, tmp);
  chmodSync(tmp, 0o755);
  renameSync(tmp, ZIEL);
} catch (e) {
  rmSync(tmp, { force: true });
  throw e;
}
console.log(`Hook kopiert: ${QUELLE} -> ${ZIEL}`);
