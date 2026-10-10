/**
 * Repo-Ampel (Abend 18): wertet `git status --porcelain=v2 --branch` aus. Die Ausgabe holt der Host je Repo (ohne Netz,
 * mit Zeitlimit); ein Repo, dessen Abruf scheitert, geht als `null` in countRepos und zählt als unbekannt (grau), nie als Absturz.
 */
export interface GitStatus { dirty: boolean; ahead: number; noUpstream: boolean }

export function parseGitStatus(text: string): GitStatus {
  let dirty = false;
  let ahead = 0;
  let upstream = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("# branch.upstream ")) upstream = true;
    else if (line.startsWith("# branch.ab ")) {
      const m = /^# branch\.ab \+(\d+) -\d+/.exec(line);
      if (m) ahead = Number(m[1]);
    } else if (line !== "" && !line.startsWith("#") && !line.startsWith("!")) dirty = true;
  }
  return { dirty, ahead, noUpstream: !upstream };
}

/** Ungesicherte Änderungen oder Commits ohne Push. Kein Upstream allein zählt nicht (es lässt sich nichts zählen). */
export function repoNeedsAttention(s: GitStatus): boolean {
  return s.dirty || s.ahead > 0;
}

export function countRepos(statuses: Array<GitStatus | null>): { total: number; attention: number; unknown: number } {
  let attention = 0;
  let unknown = 0;
  for (const s of statuses) {
    if (s === null) unknown++;
    else if (repoNeedsAttention(s)) attention++;
  }
  return { total: statuses.length, attention, unknown };
}
