// Portal-Linter in einer Wegwerf-Kopie außerhalb des Repos (das Plugin braucht TypeScript 6.0, das Repo hat 7).
// Kopie unter ~/.cache/glasscockpit-portal-lint; node_modules bleiben stehen, solange package-lock.json und die Linter-Versionen gleich sind.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLINT_CONFIG, LINT_PACKAGES, summarize, verdict } from "./lib/portal-lint.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(homedir(), ".cache", "glasscockpit-portal-lint");
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: DIR, stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0 && cmd !== "npx") { console.error(`Portal-Lint abgebrochen: ${cmd} ${args.join(" ")} endete mit ${r.status}`); process.exit(1); }
};

mkdirSync(DIR, { recursive: true });
const lock = readFileSync(join(ROOT, "package-lock.json"));
const hash = createHash("sha256").update(lock).update(LINT_PACKAGES.join(" ")).digest("hex");
const hashFile = join(DIR, ".lock-hash");
if (!existsSync(hashFile) || readFileSync(hashFile, "utf8") !== hash) {
  rmSync(join(DIR, "node_modules"), { recursive: true, force: true });
  cpSync(join(ROOT, "package.json"), join(DIR, "package.json"));
  cpSync(join(ROOT, "package-lock.json"), join(DIR, "package-lock.json"));
  run("npm", ["ci", "--ignore-scripts"]);
  run("npm", ["i", "-D", "--ignore-scripts", ...LINT_PACKAGES]);
  writeFileSync(hashFile, hash);
}
rmSync(join(DIR, "src"), { recursive: true, force: true });
cpSync(join(ROOT, "src"), join(DIR, "src"), { recursive: true });
cpSync(join(ROOT, "tsconfig.json"), join(DIR, "tsconfig.json"));
cpSync(join(ROOT, "manifest.json"), join(DIR, "manifest.json")); // das Plugin liest die manifest.json aus dem Arbeitsordner (isDesktopOnly), ohne sie fehlen Regeln und Globals
writeFileSync(join(DIR, "eslint.config.mjs"), ESLINT_CONFIG);
const out = join(DIR, "out.json");
rmSync(out, { force: true });
run("npx", ["eslint", "src", "-f", "json", "-o", out]);
if (!existsSync(out)) { console.error("Portal-Lint abgebrochen: eslint hat kein Ergebnis geschrieben"); process.exit(1); }
const s = summarize(JSON.parse(readFileSync(out, "utf8")));
console.log(`Portal-Lint: ${s.errors} Errors, ${s.warnings} Warnungen (ohne sentence-case)`);
for (const [rule, n] of Object.entries(s.byRule)) console.log(`  ${n}× ${rule}`);
for (const line of s.errorLines) console.error(`  ERROR ${line}`);
process.exit(verdict(s));
