// Release-Dateien bauen: erst Build, dann check:public, dann packen nach dist/ (Komplett-ZIP, zwei Native-ZIPs, Einzeldateien).
// Keine Veröffentlichung: Tag und GitHub-Release macht ein Mensch nach der Abnahme.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packRelease } from "./lib/release.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const skript of ["build", "check:public"]) {
  const r = spawnSync("npm", ["run", skript], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`Release abgebrochen: npm run ${skript} endete mit Exit-Code ${r.status}`);
    process.exit(1);
  }
}

try {
  const zip = packRelease({ root: ROOT, ptyQuelle: join(ROOT, "node_modules", "node-pty") });
  console.log(`Release ok: ${zip} (Native-ZIPs und Einzeldateien daneben in dist/)`);
} catch (fehler) {
  console.error(`Release abgebrochen: ${fehler instanceof Error ? fehler.message : fehler}`);
  process.exit(1);
}
