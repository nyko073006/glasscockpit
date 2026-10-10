// Wächter vor der Veröffentlichung: prüft Pfade und Inhalte gegen die Sperrliste, und zwar nicht nur den
// Arbeitsbaum, sondern auch Index und HEAD, soweit sie vom Arbeitsbaum abweichen.
// Liste: Env COCKPIT_PUBLIC_DENYLIST, sonst ~/.config/cockpit/public-denylist.txt.
// Ausgegeben werden nur Pfad (Treffer maskiert), Zeile und Herkunft, nie der Treffertext.
// Importiert den TS-Kern direkt (Node ab 22.18), wie scripts/deploy.mjs.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBytes, parseDenylist } from "../src/core/public-check.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPfad = process.env.COCKPIT_PUBLIC_DENYLIST;
const listePfad = envPfad && envPfad.trim() !== "" ? envPfad : join(homedir(), ".config", "cockpit", "public-denylist.txt");

if (!existsSync(listePfad)) {
  console.error(`check:public: Sperrliste fehlt (${listePfad}). Pfad per COCKPIT_PUBLIC_DENYLIST setzen oder die Datei anlegen.`);
  process.exit(1);
}
const liste = parseDenylist(readFileSync(listePfad, "utf8"));
if (liste.terms.length === 0) {
  console.error(`check:public: Sperrliste ohne Begriffe (${listePfad}). Ohne Begriffe wäre die Prüfung wirkungslos.`);
  process.exit(1);
}

const MAX = 256 * 1024 * 1024;
const git = (args, input) => {
  const r = spawnSync("git", args, { cwd: ROOT, maxBuffer: MAX, input });
  return r.status === 0 ? r.stdout : null;
};

// Index: Pfad -> { mode, sha }
const index = new Map();
for (const eintrag of execFileSync("git", ["ls-files", "-s", "-z"], { cwd: ROOT, maxBuffer: MAX }).toString("utf8").split("\0").filter(Boolean)) {
  const m = /^(\d+) ([0-9a-f]+) (\d)\t([\s\S]*)$/.exec(eintrag);
  if (m && m[1] !== "160000") index.set(m[4], { mode: m[1], sha: m[2] });
}

// HEAD: Pfad -> sha; ohne HEAD (leeres Repo) still überspringen
const head = new Map();
const baum = git(["rev-parse", "--verify", "-q", "HEAD"]) === null ? null : git(["ls-tree", "-r", "-z", "HEAD"]);
if (baum) {
  for (const eintrag of baum.toString("utf8").split("\0").filter(Boolean)) {
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]*)$/.exec(eintrag);
    if (m && m[2] === "blob") head.set(m[4], m[3]);
  }
}

const pfade = [...new Set([...index.keys(), ...head.keys()])];

// Arbeitsbaum: Inhalt lesen und Blob-Hash bilden (ohne Filter), um Abweichungen zu erkennen
const arbeit = new Map(); // Pfad -> bytes
for (const p of pfade) {
  if (index.get(p)?.mode === "120000") continue;
  const voll = join(ROOT, p);
  try {
    if (lstatSync(voll).isFile()) arbeit.set(p, readFileSync(voll));
  } catch {
    // fehlt im Arbeitsbaum
  }
}
const mitArbeit = [...arbeit.keys()];
const hashAusgabe = mitArbeit.length
  ? git(["hash-object", "--no-filters", "--stdin-paths"], mitArbeit.join("\n") + "\n")?.toString("utf8").split("\n") ?? []
  : [];
const arbeitSha = new Map(mitArbeit.map((p, i) => [p, hashAusgabe[i]]));

// Abweichende Blobs aus Index und HEAD
const zuLesen = []; // { pfad, sha, note }
for (const p of pfade) {
  const aSha = arbeitSha.get(p);
  const sehen = new Set();
  for (const [sha, note] of [[index.get(p)?.sha, "Index"], [head.get(p), "HEAD"]]) {
    if (!sha || sha === aSha || sehen.has(sha)) continue;
    sehen.add(sha);
    zuLesen.push({ pfad: p, sha, note: sha === head.get(p) ? "HEAD" : note });
  }
}

const blobs = new Map(); // sha -> bytes
if (zuLesen.length) {
  const shas = [...new Set(zuLesen.map((z) => z.sha))];
  const roh = git(["cat-file", "--batch"], shas.join("\n") + "\n");
  if (roh) {
    let pos = 0;
    while (pos < roh.length) {
      const ende = roh.indexOf(10, pos);
      if (ende === -1) break;
      const kopf = roh.subarray(pos, ende).toString("utf8").split(" ");
      if (kopf[1] === "missing") {
        pos = ende + 1;
        continue;
      }
      const groesse = Number(kopf[2]);
      blobs.set(kopf[0], roh.subarray(ende + 1, ende + 1 + groesse));
      pos = ende + 1 + groesse + 1;
    }
  }
}

const treffer = [];
for (const [p, bytes] of arbeit) treffer.push(...checkBytes(p, bytes, liste));
for (const z of zuLesen) {
  const bytes = blobs.get(z.sha);
  if (bytes) treffer.push(...checkBytes(z.pfad, bytes, liste, z.note));
}

for (const t of treffer) console.log(`${t.file}:${t.line}${t.note ? ` (${t.note})` : ""}`);
console.log(`check:public: ${treffer.length} Treffer in ${new Set(treffer.map((t) => t.file)).size} Dateien (${pfade.length} geprüft)`);
process.exit(treffer.length > 0 ? 1 : 0);
