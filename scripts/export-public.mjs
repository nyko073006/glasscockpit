// npm run export-public -- <ziel> [--message "Text"]
// Kopiert den bereinigten Stand ins öffentliche Repo (Ziel muss ein git-Repo sein), prüft dort check:public
// und committet. Kein Push, keine Veröffentlichung.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exportPublic } from "./lib/export-public.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const mi = args.indexOf("--message");
const message = mi === -1 ? undefined : args[mi + 1];
if (mi !== -1) args.splice(mi, 2);
const ziel = args[0];
if (!ziel || args.length !== 1) {
  console.error('Aufruf: npm run export-public -- <ziel> [--message "Text"]');
  process.exit(1);
}

try {
  const r = exportPublic({ root: ROOT, target: resolve(ziel), message });
  console.log(`Export ok: ${r.files} Dateien -> ${resolve(ziel)} (${r.committed ? "committet" : "keine Änderung"})`);
} catch (fehler) {
  console.error(`Export abgebrochen: ${fehler instanceof Error ? fehler.message : fehler}`);
  process.exit(1);
}
