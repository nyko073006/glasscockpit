// pre-push-Wächter (vom Hook aufgerufen): sperrt einen Push nach main, wenn zur Version in manifest.json kein
// Release mit den Plugin-Dateien existiert. Nur Verkabelung, die Logik steht in lib/release-guard.ts.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pruefePush, RELEASE_JQ } from "./lib/release-guard.ts";

function liesConfig(schluessel) {
  try {
    return execFileSync("git", ["config", "--get", schluessel], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

// Jede Zeile jeder Meldung trägt das Präfix (auch mehrzeilige Fehlertexte).
function ausgeben(text) {
  for (const z of text.replace(/\s+$/, "").split(/\r?\n/)) console.error(`release-guard: ${z}`);
}

let stdin = "";
try {
  stdin = readFileSync(0, "utf8");
} catch (e) {
  // Lesefehler heißt unbekannter Push: sperren, nie als leeres stdin (Exit 0) durchlassen.
  ausgeben(`Push gesperrt: stdin nicht lesbar (${e instanceof Error ? e.message : String(e)}).`);
  ausgeben("Notausgang: git push --no-verify");
  process.exit(1);
}

const urteil = pruefePush({
  stdin,
  arg1: process.argv[2] ?? "",
  liesConfig,
  manifestAn: (sha) => execFileSync("git", ["show", `${sha}:manifest.json`], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }),
  releases: (repo) =>
    execFileSync(
      "gh",
      [
        "api",
        "--paginate",
        `repos/${repo}/releases?per_page=100`,
        "--jq",
        RELEASE_JQ,
      ],
      { encoding: "utf8", timeout: 30000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    ),
});
for (const m of urteil.meldungen) ausgeben(m);
process.exit(urteil.exitCode);
