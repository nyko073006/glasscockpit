// Schreibt src/core/native-checksums.ts neu aus node_modules/node-pty. Aufruf: npm run native-checksums
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeNativeChecksums, renderChecksumsModule } from "./lib/native-checksums.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  const summen = computeNativeChecksums(join(ROOT, "node_modules", "node-pty"));
  const ziel = join(ROOT, "src", "core", "native-checksums.ts");
  writeFileSync(ziel, renderChecksumsModule(summen));
  for (const [t, e] of Object.entries(summen)) console.log(`${t}: ${Object.keys(e).length} Dateien`);
  console.log(`geschrieben: ${ziel}`);
} catch (fehler) {
  console.error(`native-checksums abgebrochen: ${fehler instanceof Error ? fehler.message : fehler}`);
  process.exit(1);
}
