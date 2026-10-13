import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { asError } from "../core/as-error";
import { GIT_STATUS_TIMEOUT_MS } from "../core/constants";
import { DAY_LOG_SEP } from "../core/day-stats";

/** Direkte Unterordner von `root`, die ein Git-Repo sind (`.git` als Ordner oder, in Worktrees, als Datei). Fehlt `root`: leer. */
export async function listGitRepos(root: string): Promise<Array<{ name: string; dir: string }>> {
  if (root.trim() === "") return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => ({ name: e.name, dir: join(root, e.name) }))
    .filter((r) => existsSync(join(r.dir, ".git")))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * `git status --porcelain=v2 --branch` im Ordner: kein Netz (kein fetch), kein Passwort-Prompt, Zeitlimit als execFile-Option
 * (den Befehl `timeout` gibt es auf macOS nicht). `--no-optional-locks`: Die Abfrage soll den Index nicht sperren, während
 * eine Sitzung im selben Repo arbeitet. Lehnt bei Fehler oder Zeitlimit ab; RepoScan macht daraus `status: null`.
 */
export function runGitStatus(dir: string, env: Record<string, string>, timeoutMs: number = GIT_STATUS_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      execFile(
        "git",
        ["--no-optional-locks", "status", "--porcelain=v2", "--branch"],
        { cwd: dir, timeout: timeoutMs, env: { ...env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => (err ? reject(asError(err)) : resolve(String(stdout))),
      );
    } catch (fehler) {
      reject(asError(fehler));
    }
  });
}

/**
 * Commits seit `since` (lokale Branches, ohne Merges) mit numstat, Kopfzeile je Commit `@@COMMIT@@<Hash> <Autor-Zeit>`;
 * Auswertung in core/day-stats. `--branches` statt `--all` (Abend 31): Remote-Branches (Squash-Merge mit stehengebliebenem
 * PR-Branch zählte doppelt), Stash, Tags und Notes zählen nicht. `--since` filtert nach Committer-Datum und ist nur Vorfilter,
 * der Autor-Filter steht in parseDayLog. Kein Netz, Zeitlimit und `--no-optional-locks` wie bei runGitStatus.
 * `-c core.quotepath=false` lässt Umlaute in Pfaden lesbar. Lehnt bei Fehler oder Zeitlimit ab; DayScan zählt das Repo dann als 0.
 */
export function runGitDayLog(dir: string, since: Date, env: Record<string, string>, timeoutMs: number = GIT_STATUS_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      execFile(
        "git",
        ["--no-optional-locks", "-c", "core.quotepath=false", "log", "--branches", "--no-merges", `--since=${since.toISOString().replace(/\.\d+Z$/, "Z")}`, "--numstat", `--format=${DAY_LOG_SEP}%H %at`],
        { cwd: dir, timeout: timeoutMs, env: { ...env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout) => (err ? reject(asError(err)) : resolve(String(stdout))),
      );
    } catch (fehler) {
      reject(asError(fehler));
    }
  });
}

/**
 * Gemeinsames Git-Verzeichnis des Repos oder Worktrees (absolut, symbolische Links aufgelöst) und ob `.git` ein Ordner ist
 * (Hauptrepo) statt einer Datei (Worktree). Für DayScan: Worktrees zählen mit ihrem Hauptrepo einmal.
 */
export function runGitIdentity(dir: string, env: Record<string, string>, timeoutMs: number = GIT_STATUS_TIMEOUT_MS): Promise<{ commonDir: string; isMain: boolean }> {
  return new Promise((resolve, reject) => {
    try {
      execFile(
        "git",
        ["--no-optional-locks", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd: dir, timeout: timeoutMs, env: { ...env, GIT_TERMINAL_PROMPT: "0" } },
        (err, stdout) => {
          if (err) return reject(asError(err));
          let isMain = false;
          try { isMain = statSync(join(dir, ".git")).isDirectory(); } catch { /* ohne .git kein Hauptrepo */ }
          resolve({ commonDir: String(stdout).trim(), isMain });
        },
      );
    } catch (fehler) {
      reject(asError(fehler));
    }
  });
}
