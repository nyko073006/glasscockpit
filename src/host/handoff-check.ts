// Übergabe-Lampe, Host-Seite: liest Dateizeiten und Git und ruft die reine Bewertung (src/core/handoff-check.ts).
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { asError } from "../core/as-error";
import { parseGitStatus } from "../core/git-status";
import { evaluateHandoffCheck, handoffPathCandidates, type GitClean, type HandoffCheck } from "../core/handoff-check";
import { isoDay } from "../core/handoffs";
import type { CurrentHandoff } from "../core/transcript-poll";
import { runGitStatus } from "./repo-status";

/** Git-Stand eines Ordners. LC_ALL=C, damit „not a git repository“ auch bei deutscher Git-Sprache erkannt wird. */
export async function gitClean(dir: string, env: Record<string, string>, run: typeof runGitStatus = runGitStatus): Promise<GitClean> {
  try {
    const text = await run(dir, { ...env, LC_ALL: "C", LANG: "C" });
    return parseGitStatus(text).dirty ? "dirty" : "clean";
  } catch (fehler) {
    return /not a git repository/i.test(asError(fehler).message) ? "none" : "unknown";
  }
}

export interface HandoffCheckDeps {
  current: CurrentHandoff | null;
  claudeId: string;
  cwd: string;
  prefix: string;
  home: string;
  vaultBase: string | null;
  dailyDir: string;
  now: Date;
  env: Record<string, string>;
  mtime?: (path: string) => Promise<number | null>;
  git?: (dir: string, env: Record<string, string>) => Promise<GitClean>;
}

async function dateiMtime(pfad: string): Promise<number | null> {
  try {
    return (await stat(pfad)).mtimeMs;
  } catch {
    return null;
  }
}

/** Liest Handoff-Datei, Daily Note von heute (lokaler Tag) und Git und bewertet. Lehnt nie ab. */
export async function readHandoffCheck(d: HandoffCheckDeps): Promise<HandoffCheck> {
  const mtime = d.mtime ?? dateiMtime;
  const git = d.git ?? ((dir, env) => gitClean(dir, env));
  const block = d.current !== null && d.current.claudeId === d.claudeId ? d.current.block : null;
  // Ohne gültigen Block ist die Lampe grau: weder Dateizeiten noch Git lesen.
  if (block === null) {
    return evaluateHandoffCheck({
      hasBlock: false, handoffPath: null, startedAtMs: null, handoffMtimeMs: null, dailyUnset: false, dailyMtimeMs: null, git: "clean",
    });
  }
  const kandidaten = handoffPathCandidates(block, d.prefix, d.home, d.vaultBase, d.cwd);
  const dailyUnset = d.dailyDir.trim() === "" || d.vaultBase === null;
  const dailyPath = dailyUnset || d.vaultBase === null ? null : join(d.vaultBase, d.dailyDir, `${isoDay(d.now)}.md`);
  const sicher = async (pfad: string | null): Promise<number | null> => {
    if (pfad === null) return null;
    try {
      return await mtime(pfad);
    } catch {
      return null;
    }
  };
  // Auch eine synchron werfende git-Abhängigkeit darf readHandoffCheck nicht ablehnen lassen.
  const gitSicher = async (): Promise<GitClean> => {
    try {
      return await git(d.cwd, d.env);
    } catch {
      return "unknown";
    }
  };
  // Erster Kandidat mit Zeit gewinnt; keiner da: der erste, Zeit null; keine Kandidaten: Pfad null.
  const handoffSuche = async (): Promise<{ pfad: string | null; mtime: number | null }> => {
    for (const k of kandidaten) {
      const zeit = await sicher(k);
      if (zeit !== null) return { pfad: k, mtime: zeit };
    }
    return { pfad: kandidaten[0] ?? null, mtime: null };
  };
  const [handoff, dailyMtimeMs, gitStand] = await Promise.all([
    handoffSuche(),
    sicher(dailyPath),
    gitSicher(),
  ]);
  return evaluateHandoffCheck({
    hasBlock: true, handoffPath: handoff.pfad, startedAtMs: d.current?.startedAtMs ?? null, handoffMtimeMs: handoff.mtime, dailyUnset, dailyMtimeMs, git: gitStand,
  });
}
