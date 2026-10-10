import { dayTotals, groupByCommonDir, parseDayLog, startOfLocalDay, type DayTotals, type RepoDay, type RepoIdentity } from "./day-stats";

/** Wie bei der Repo-Ampel: höchstens so viele Abfragen gleichzeitig. */
const CONCURRENCY = 4;

export interface DayScanDeps {
  /** Git-Repos unter projectsRoot (frisch bei jedem Lauf). */
  list: () => Promise<Array<{ name: string; dir: string }>>;
  /** Gemeinsames Git-Verzeichnis (absolut) und ob `.git` ein Ordner ist (Hauptrepo); lehnt ab bei Fehler. */
  identity: (dir: string) => Promise<{ commonDir: string; isMain: boolean }>;
  /** Ausgabe von `git log --all --no-merges --since=… --numstat`; lehnt ab bei Fehler oder Zeitlimit. */
  dayLog: (dir: string, since: Date) => Promise<string>;
  now: () => Date;
  log: (message: string) => void;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * LOC und Commits heute (Abend 19), im Takt des Pulls wie RepoScan (der Aufrufer entscheidet wann). Nie parallel zu sich
 * selbst, nie ein Wurf: Scheitert ein Repo, zählt es 0, scheitert die Liste, bleibt der alte Stand.
 */
export class DayScan {
  private readonly deps: DayScanDeps;
  private current: DayTotals | null = null;
  private running: Promise<void> | null = null;
  private readonly subscribers = new Set<() => void>();

  constructor(deps: DayScanDeps) {
    this.deps = deps;
  }

  /** null: noch nie gelaufen. */
  snapshot(): DayTotals | null {
    return this.current;
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  run(): Promise<void> {
    this.running ??= this.scan().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Höchstens CONCURRENCY Aufgaben gleichzeitig über die Indizes 0 bis n-1. */
  private async pool(n: number, task: (i: number) => Promise<void>): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < n) await task(next++);
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, n) }, worker));
  }

  private async scan(): Promise<void> {
    try {
      const listed = await this.deps.list();
      // Worktrees unter projectsRoot zählen mit ihrem Hauptrepo einmal; scheitert die Auskunft, steht das Repo für sich.
      const ids: RepoIdentity[] = listed.map((r) => ({ ...r, commonDir: `?${r.dir}`, isMain: false }));
      await this.pool(listed.length, async (i) => {
        try {
          Object.assign(ids[i], await this.deps.identity(listed[i].dir));
        } catch (fehler) {
          this.deps.log(`Cockpit: git-Verzeichnis von ${listed[i].name} nicht lesbar: ${errText(fehler)}`);
        }
      });
      const repos = groupByCommonDir(ids);
      const since = startOfLocalDay(this.deps.now());
      const result: RepoDay[] = repos.map((r) => ({ name: r.name, loc: 0, commits: 0 }));
      await this.pool(repos.length, async (i) => {
        try {
          Object.assign(result[i], parseDayLog(await this.deps.dayLog(repos[i].dir, since)));
        } catch (fehler) {
          this.deps.log(`Cockpit: git log in ${repos[i].name} gescheitert: ${errText(fehler)}`);
        }
      });
      this.current = dayTotals(result);
    } catch (fehler) {
      this.deps.log(`Cockpit: Repo-Liste nicht lesbar: ${errText(fehler)}`);
    }
    for (const cb of [...this.subscribers]) {
      try {
        cb();
      } catch (fehler) {
        this.deps.log(`Cockpit: Abonnent der Tageszahlen gescheitert: ${errText(fehler)}`);
      }
    }
  }
}
