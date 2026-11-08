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

// Die Windows-Teile von node-pty stehen nicht als eigenes Paket in node_modules: conpty.dll und OpenConsole.exe liegen in
// node_modules/node-pty/third_party/conpty/<Fassung>/ ohne Lizenzdatei. Der Text ist die LICENSE aus
// https://github.com/microsoft/terminal (geholt 18.10.2026, wörtlich, Zeilenenden LF); test/third-party.test.ts prüft die Fassung.
const WINDOWS = `## node-pty: Windows parts

Glasscockpit replaces \`lib/windowsConoutConnection.js\` of node-pty 1.1.0 with its own version that runs without a worker thread; it ships as \`native/win32-*/lib/windowsConoutConnection.js\`. It is released under the same license as node-pty (MIT, see above).

\`conpty.dll\` and \`OpenConsole.exe\` ship unchanged from the node-pty 1.1.0 prebuilds. They come from Microsoft Windows Terminal (ConPTY package 1.23.251008001, \`node_modules/node-pty/third_party/conpty/\`) and are licensed under the MIT License:

\`\`\`text
Copyright (c) Microsoft Corporation. All rights reserved.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
\`\`\`
`;

// Das Escaping von Argumenten an cmd.exe (src/core/cmd-shim.ts) folgt dem Verfahren von cross-spawn (lib/util/escape.js). Der Code
// ist selbst nachgeschrieben, cross-spawn ist keine Abhängigkeit und steht nicht in node_modules. Lizenztext wörtlich aus
// https://github.com/moxystudio/node-cross-spawn (LICENSE, geholt 21.10.2026, Zeilenenden LF).
const CROSS_SPAWN = `## cross-spawn (MIT): method for escaping arguments to cmd.exe

Glasscockpit starts \`claude.cmd\` (the npm shim of Claude Code) through \`cmd.exe\`. The method for escaping the arguments follows cross-spawn (\`lib/util/escape.js\`); it is rewritten in \`src/core/cmd-shim.ts\`, no cross-spawn code is shipped. cross-spawn is licensed under the MIT License:

\`\`\`text
The MIT License (MIT)

Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
\`\`\`
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
  return [KOPF, ...abschnitte, WINDOWS, CROSS_SPAWN, BILD].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = erzeuge();
  if (process.argv.includes("--stdout")) process.stdout.write(text);
  else {
    writeFileSync(join(ROOT, "THIRD-PARTY-NOTICES.md"), text);
    console.log(`THIRD-PARTY-NOTICES.md geschrieben (${PAKETE.length} Pakete).`);
  }
}
