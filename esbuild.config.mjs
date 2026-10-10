import { builtinModules } from "node:module";
import esbuild from "esbuild";

// Node-Builtins jeweils mit und ohne node:-Präfix, dazu die Pakete, die Obsidian selbst mitbringt.
const builtins = builtinModules.map((name) => name.replace(/^node:/, ""));
const external = [
  "obsidian",
  "electron",
  "@codemirror/*",
  "@lezer/*",
  // ws: optionale native Zusätze, unbenutzt (ws fällt ohne sie auf reines JavaScript zurück).
  "bufferutil",
  "utf-8-validate",
  ...new Set([...builtins, ...builtins.map((name) => `node:${name}`)]),
];

try {
  await Promise.all([
    esbuild.build({
      entryPoints: ["src/main.ts"],
      outfile: "build/main.js",
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "es2020",
      external,
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
