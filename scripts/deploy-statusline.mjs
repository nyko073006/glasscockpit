// Kopiert statusline/statusline-command.sh atomar nach ~/.claude/statusline-command.sh.
// Atomar, weil laufende Sitzungen das Skript alle 30 Sekunden starten: temporäre Datei im Zielordner,
// chmod 755, dann rename. Nie direkt in die Zieldatei schreiben.
// Optional: Zielpfad als erstes Argument (Tests); Vorgabe ist ~/.claude/statusline-command.sh.
import { chmodSync, copyFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const QUELLE = join(ROOT, "statusline", "statusline-command.sh");
const ZIEL = process.argv[2] ? resolve(process.argv[2]) : join(homedir(), ".claude", "statusline-command.sh");

const ordner = dirname(ZIEL);
mkdirSync(ordner, { recursive: true });
const tmp = join(ordner, `.statusline-command.sh.${process.pid}.tmp`);
try {
  copyFileSync(QUELLE, tmp);
  chmodSync(tmp, 0o755);
  renameSync(tmp, ZIEL);
} catch (e) {
  rmSync(tmp, { force: true });
  throw e;
}
console.log(`Statuszeile kopiert: ${QUELLE} -> ${ZIEL}`);
