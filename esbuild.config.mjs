import esbuild from "esbuild";
import { EXTERNAL } from "./scripts/lib/externals.ts";

try {
  await Promise.all([
    esbuild.build({
      entryPoints: ["src/main.ts"],
      outfile: "build/main.js",
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "es2020",
      external: EXTERNAL,
      // Das Cockpit-Hintergrundbild steckt als Data-URL in main.js (Abend 15), der Deploy kopiert weiter nur main.js.
      loader: { ".jpg": "dataurl" },
      logLevel: "info",
    }),
    // xterm.css wird per @import in src/styles.css eingebettet.
    esbuild.build({
      entryPoints: ["src/styles.css"],
      outfile: "build/styles.css",
      bundle: true,
      logLevel: "info",
    }),
  ]);
} catch {
  // esbuild hat den Fehler schon ausgegeben.
  process.exit(1);
}
