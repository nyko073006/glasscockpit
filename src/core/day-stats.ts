/**
 * Tageszahlen der Git-Repos (Abend 19): LOC und Commits seit lokaler Mitternacht, rein. Gelesen wird in day-scan und
 * host/repo-status; hier nur Parser, Summen und Anzeigeformat. Die Uhrzeit kommt immer von außen.
 */

/** Beginn der Kopfzeile je Commit in `git log --format=`; so verwechselt kein Dateiname sie mit einer numstat-Zeile. */
export const DAY_LOG_SEP = "@@COMMIT@@";

export interface DayCounts { commits: number; loc: number }
export interface RepoDay extends DayCounts { name: string }
export interface DayTotals extends DayCounts { repos: RepoDay[] }

const SKIP_EXT = new Set([".md", ".txt"]);
const SKIP_NAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Package.resolved"]);

/** Pfad aus numstat; bei Umbenennungen (`a => b`, `dir/{a => b}/x`) gilt der neue Name. */
function finalPath(path: string): string {
  if (path.includes("{")) return path.replace(/\{[^{}]* => ([^{}]*)\}/g, "$1").replace(/\/{2,}/g, "/");
  const i = path.lastIndexOf(" => ");
  return i >= 0 ? path.slice(i + 4) : path;
}

/** Code-Datei im Sinn der LOC-Zahl: nicht `.md`/`.txt`, keine Lockdatei. */
export function countsAsCode(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (SKIP_NAMES.has(name)) return false;
  const dot = name.lastIndexOf(".");
  return dot < 0 || !SKIP_EXT.has(name.slice(dot).toLowerCase());
}

/**
 * Ausgabe von `git log --numstat --format=@@COMMIT@@%H %at`: Commits (je Hash einmal) und LOC (hinzugefügt minus gelöscht über
 * Code-Dateien, Binärzeilen `-` zählen nicht). Ein doppelter Hash wird samt seiner Zeilen übersprungen, ebenso ein Commit,
 * dessen Autor-Zeit vor `since` liegt oder fehlt (Abend 31): Rebase, Amend und Cherry-Pick setzen nur das Committer-Datum
 * neu, nach dem `--since` filtert.
 */
export function parseDayLog(output: string, since: Date): DayCounts {
  const sinceSec = since.getTime() / 1000;
  const seen = new Set<string>();
  let loc = 0;
  let skipping = false;
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith(DAY_LOG_SEP)) {
      const [hash, at] = line.slice(DAY_LOG_SEP.length).trim().split(" ");
      const today = /^\d+$/.test(at ?? "") && Number(at) >= sinceSec;
      skipping = !today || seen.has(hash);
      if (!skipping) seen.add(hash);
      continue;
    }
    if (skipping || line === "") continue;
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m || m[1] === "-" || m[2] === "-") continue;
    if (!countsAsCode(finalPath(m[3]))) continue;
    loc += Number(m[1]) - Number(m[2]);
  }
  return { commits: seen.size, loc };
}

export interface RepoIdentity { name: string; dir: string; commonDir: string; isMain: boolean }

/**
 * Worktrees teilen sich das Git-Verzeichnis mit ihrem Hauptrepo und sehen dieselben Commits (`--branches`). Je gemeinsamem
 * Verzeichnis bleibt eine Zeile: das Hauptrepo (`.git` ist ein Ordner), fehlt es, die erste in der Liste. Reihenfolge
 * nach dem ersten Auftreten der Gruppe.
 */
export function groupByCommonDir(repos: RepoIdentity[]): Array<{ name: string; dir: string }> {
  const groups = new Map<string, RepoIdentity>();
  for (const r of repos) {
    const cur = groups.get(r.commonDir);
    if (!cur) groups.set(r.commonDir, r);
    else if (!cur.isMain && r.isMain) groups.set(r.commonDir, r);
  }
  return [...groups.values()].map(({ name, dir }) => ({ name, dir }));
}

/** Lokale Mitternacht des Tages von `now`. */
export function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

export function dayTotals(repos: RepoDay[]): DayTotals {
  return { loc: repos.reduce((s, r) => s + r.loc, 0), commits: repos.reduce((s, r) => s + r.commits, 0), repos };
}

/** „1,2k“ ab 1000 (eine Nachkommastelle, deutsches Komma), darunter die ganze Zahl; negativ mit Minus. */
export function formatCount(n: number): string {
  const abs = Math.abs(n);
  const text = abs >= 1000 ? `${(abs / 1000).toFixed(1).replace(".", ",")}k` : String(abs);
  return n < 0 ? `-${text}` : text;
}

/** Tooltip-Zeilen „Name: Wert“: bis zu fünf Repos mit Commits heute, höchster Wert zuerst, bei Gleichstand nach Name. */
export function topRepos(repos: RepoDay[], key: "loc" | "commits"): string[] {
  return repos
    .filter((r) => r.commits > 0)
    .sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map((r) => `${r.name}: ${r[key]}`);
}
