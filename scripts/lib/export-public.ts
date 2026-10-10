// Exportiert den bereinigten Stand des privaten Repos in das öffentliche Repo. Typen entfernt Node selbst (ab 22.18).
// Nimmt nur getrackte Dateien (git ls-files), ohne handoffs/, CLAUDE.local.md, .publicignore und die Einträge aus
// .publicignore, prüft das Ziel mit scripts/check-public.mjs und committet erst danach.
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

/** Immer draußen: Pfade (Ordner mit / am Ende) und die Ausschlussdatei selbst. */
export const FESTE_AUSSCHLUESSE = ["handoffs/", "CLAUDE.local.md", ".publicignore"];

export interface ExportOptionen {
  /** Wurzel des privaten Repos. */
  root: string;
  /** Wurzel des öffentlichen Repos; muss schon ein git-Repo sein (git init). */
  target: string;
  /** Commit-Nachricht; sonst „Export aus dem privaten Repo (<Kurz-Hash>)“. */
  message?: string;
}

export interface ExportErgebnis {
  files: number;
  committed: boolean;
}

/** Zeilen aus .publicignore: leere und #-Zeilen entfallen. */
export function parseIgnore(text: string): string[] {
  return text
    .split("\n")
    .map((z) => z.trim())
    .filter((z) => z !== "" && !z.startsWith("#"));
}

/** Passt der Pfad (mit / getrennt) auf einen Eintrag? „ordner/“ = Präfix, sonst Muster mit * (ohne /) und ** (mit /). */
export function istAusgeschlossen(pfad: string, eintraege: readonly string[]): boolean {
  return eintraege.some((e) => {
    if (e.endsWith("/")) return pfad.startsWith(e);
    const muster = e
      .split("**")
      .map((teil) => teil.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
      .join(".*");
    return new RegExp(`^${muster}$`).test(pfad);
  });
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function alleDateien(dir: string, basis = dir, aus: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (dir === basis && name === ".git") continue;
    const voll = join(dir, name);
    if (lstatSync(voll).isDirectory()) alleDateien(voll, basis, aus);
    else aus.push(relative(basis, voll).split("\\").join("/"));
  }
  return aus;
}

function leereOrdnerEntfernen(dir: string, basis: string) {
  for (const name of readdirSync(dir)) {
    if (dir === basis && name === ".git") continue;
    const voll = join(dir, name);
    if (lstatSync(voll).isDirectory()) {
      leereOrdnerEntfernen(voll, basis);
      if (readdirSync(voll).length === 0) rmdirSync(voll);
    }
  }
}

export function exportPublic({ root, target, message }: ExportOptionen): ExportErgebnis {
  if (!existsSync(join(target, ".git"))) {
    throw new Error(`Ziel ist kein git-Repo (${target}): erst git init, dann exportieren`);
  }
  if (realpathSync(target) === realpathSync(root)) {
    throw new Error("Ziel und Quell-Repo sind derselbe Ordner");
  }

  const ignorePfad = join(root, ".publicignore");
  const eintraege = [...FESTE_AUSSCHLUESSE, ...(existsSync(ignorePfad) ? parseIgnore(readFileSync(ignorePfad, "utf8")) : [])];
  const dateien = git(root, ["ls-files", "-z"])
    .split("\0")
    .filter((p) => p !== "" && !istAusgeschlossen(p, eintraege));

  // Erst prüfen, dann schreiben: Symlinks und fehlende Dateien gehören nicht in den Export.
  for (const p of dateien) {
    const info = lstatSync(join(root, p), { throwIfNoEntry: false });
    if (!info) throw new Error(`${p} ist getrackt, fehlt aber im Arbeitsbaum`);
    if (info.isSymbolicLink()) throw new Error(`${p} ist ein Symlink, der Export kopiert nur Dateien`);
  }

  // Altes entfernen, was nicht mehr dazugehört
  const soll = new Set(dateien);
  for (const p of alleDateien(target)) {
    if (!soll.has(p)) rmSync(join(target, p), { force: true });
  }
  for (const p of dateien) {
    mkdirSync(dirname(join(target, p)), { recursive: true });
    copyFileSync(join(root, p), join(target, p));
  }
  leereOrdnerEntfernen(target, target);

  git(target, ["add", "-A"]);

  const wachter = join(target, "scripts", "check-public.mjs");
  if (!existsSync(wachter)) throw new Error("check:public: scripts/check-public.mjs fehlt im Export");
  const pruefung = spawnSync(process.execPath, [wachter], { cwd: target, encoding: "utf8" });
  if (pruefung.status !== 0) {
    const ausgabe = `${pruefung.stdout}${pruefung.stderr}`.trim().split("\n").slice(-15).join("\n");
    throw new Error(`check:public im Export fehlgeschlagen (Exit-Code ${pruefung.status}), kein Commit:\n${ausgabe}`);
  }

  const geaendert = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: target }).status !== 0;
  if (!geaendert) return { files: dateien.length, committed: false };

  const kurz = git(root, ["rev-parse", "--short", "HEAD"]).trim();
  git(target, ["commit", "-q", "-m", message ?? `Export aus dem privaten Repo (${kurz})`]);
  return { files: dateien.length, committed: true };
}
