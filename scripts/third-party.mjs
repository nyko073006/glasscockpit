// Erzeugt THIRD-PARTY-NOTICES.md aus den LICENSE-Dateien in node_modules.
// Aufnahme: alles, was in main.js, styles.css oder native/ landet (Prüfung gegen das esbuild-Bundle: test/third-party.test.ts).
//   - @xterm/xterm (inklusive xterm.css), @xterm/addon-fit, ws, @codemirror/legacy-modes (Sprachmodi des Datei-Viewers): von esbuild eingebettet
//   - node-pty: nicht eingebettet, der Deploy legt es nach native/
// yaml und alle anderen devDependencies landen nirgends im Plugin und stehen deshalb nicht drin.
// Aufruf: node scripts/third-party.mjs (schreibt die Datei) oder --stdout (nur ausgeben).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PAKETE = ["@codemirror/legacy-modes", "@xterm/addon-fit", "@xterm/xterm", "node-pty", "ws"];

const KOPF = `# Third-Party Notices

Glasscockpit ships the following third-party components. Their license texts are reproduced here in full, as the MIT License requires. This file is generated from \`node_modules\` with \`npm run third-party\`.
`;

const BILD = `## Background image assets/cockpit-bg.jpg

The image is AI-generated with Google Flow (Nano Banana Pro). It is not third-party material in the sense of a package license, and it is not covered by Glasscockpit's MIT License, which makes no statement about it.

On its origin, the Google Terms of Service (https://policies.google.com/terms), section "Your content", state: "Google won’t claim ownership over that content." No further license or freedom from third-party rights is granted here.
`;

function paket(name) {
  const dir = join(ROOT, "node_modules", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const text = readFileSync(join(dir, "LICENSE"), "utf8").replace(/\r\n/g, "\n").trim();
  const lizenz = typeof pkg.license === "string" ? pkg.license : "unbekannt";
  return `## ${name} ${pkg.version}\n\nLizenz: ${lizenz}\n\n\`\`\`text\n${text}\n\`\`\`\n`;
}

export function erzeuge() {
  const abschnitte = [...PAKETE].sort().map(paket);
  return [KOPF, ...abschnitte, BILD].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = erzeuge();
  if (process.argv.includes("--stdout")) process.stdout.write(text);
  else {
    writeFileSync(join(ROOT, "THIRD-PARTY-NOTICES.md"), text);
    console.log(`THIRD-PARTY-NOTICES.md geschrieben (${PAKETE.length} Pakete).`);
  }
}
