import { parseGitStatus, type GitStatus } from "./git-status";

/** Eine Abfrage je Repo gleichzeitig höchstens so viele (Platte und CPU schonen, viele Repos unter projectsRoot). */
const CONCURRENCY = 4;

export interface RepoScanDeps {
  /** Git-Repos unter projectsRoot (frisch bei jedem Lauf). */
  list: () => Promise<Array<{ name: string; dir: string }>>;
  /** Ausgabe von `git status --porcelain=v2 --branch`; lehnt ab bei Fehler oder Zeitlimit. */
  status: (dir: string) => Promise<string>;
  log: (message: string) => void;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Repo-Ampel (Abend 18): Stand je Repo, gelaufen wird im Takt des Pulls (der Aufrufer entscheidet wann). Nie parallel
 * zu sich selbst, nie ein Wurf: Scheitert ein Repo, ist sein Status null (grau), scheitert schon die Liste, bleibt der alte Stand.
 */
export class RepoScan {
  private readonly deps: RepoScanDeps;
  private current: Array<{ name: string; status: GitStatus | null }> | null = null;
  private running: Promise<void> | null = null;
  private readonly subscribers = new Set<() => void>();

  constructor(deps: RepoScanDeps) {
    this.deps = deps;
  }

  /** null: noch nie gelaufen. */
  snapshot(): Array<{ name: string; status: GitStatus | null }> | null {
    return this.current;
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  /** Läuft schon einer, gibt es dessen Versprechen zurück. */
  run(): Promise<void> {
    this.running ??= this.scan().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async scan(): Promise<void> {
    try {
      const repos = await this.deps.list();
      const result: Array<{ name: string; status: GitStatus | null }> = repos.map((r) => ({ name: r.name, status: null }));
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < repos.length) {
          const i = next++;
          try {
            result[i].status = parseGitStatus(await this.deps.status(repos[i].dir));
          } catch (fehler) {
            this.deps.log(`Cockpit: git status in ${repos[i].name} gescheitert: ${errText(fehler)}`);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, repos.length) }, worker));
      this.current = result;
    } catch (fehler) {
      this.deps.log(`Cockpit: Repo-Liste nicht lesbar: ${errText(fehler)}`);
    }
    for (const cb of [...this.subscribers]) {
      try {
        cb();
      } catch (fehler) {
        this.deps.log(`Cockpit: Abonnent der Repo-Ampel gescheitert: ${errText(fehler)}`);
      }
    }
  }
}
