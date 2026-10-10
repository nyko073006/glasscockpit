import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { GIT_PULL_TIMEOUT_MS } from "../core/constants";
import { isUnset } from "../core/unset";
import { type PullResult, PullState, pullDue, pullResultFromExec } from "../core/pull-state";

/** `git pull --ff-only` im Ordner. Wirft nie, alles kommt als Ergebnis. Kein Passwort-Prompt (hinge bis zum Timeout). */
export function runGitPull(dir: string, env: Record<string, string>): Promise<PullResult> {
  return new Promise((resolve) => {
    try {
      execFile(
        "git",
        ["pull", "--ff-only"],
        { cwd: dir, timeout: GIT_PULL_TIMEOUT_MS, env: { ...env, GIT_TERMINAL_PROMPT: "0" } },
        (err, _stdout, stderr) => resolve(pullResultFromExec(err, String(stderr ?? ""))),
      );
    } catch (fehler) {
      resolve({ ok: false, stderr: fehler instanceof Error ? fehler.message : String(fehler) });
    }
  });
}

export interface PullDeps {
  /** Vault-Basispfad, null wenn nicht ermittelbar. */
  vaultBase: () => string | null;
  /** Wirksame Einstellungen, bei jeder Nutzung frisch. */
  settings: () => { briefingsDir: string; pullIntervalMin: number };
  /** PATH-Ordner der Login-Shell (vom Launcher, nicht neu gelesen). */
  pathDirs: () => Promise<string[]>;
  now: () => number;
  /** Nach jedem Pull-Lauf (Knopf, Öffnen, Takt), auch wenn der Pull ausfällt: hier hängt die Repo-Ampel (Abend 18), kein zweiter Takt. */
  afterPull?: () => void;
}

/**
 * Pull-Zustand und Takt, eine Instanz im Plugin für alle Dashboards. Pull beim Öffnen, im Takt (nur bei
 * mindestens einem offenen Dashboard) und per Knopf. Löst kein Neuladen aus: das kommt über die Vault-Events.
 */
export class PullController {
  readonly state = new PullState();
  private readonly deps: PullDeps;
  private open = 0;
  private lastAttempt: number | null = null;

  constructor(deps: PullDeps) {
    this.deps = deps;
  }

  dashboardOpened(): void {
    this.open++;
    void this.pullNow();
  }

  dashboardClosed(): void {
    this.open = Math.max(0, this.open - 1);
  }

  /** Ist mindestens ein Dashboard offen? Wer nur dann arbeiten soll (Feed-Aktualisierung), fragt hier. */
  hasDashboard(): boolean {
    return this.open > 0;
  }

  /** Vom Plugin-Timer aufgerufen; die Einstellung wird hier frisch gelesen. */
  tick(): void {
    if (this.open === 0) return;
    if (pullDue(this.lastAttempt, this.deps.now(), this.deps.settings().pullIntervalMin)) void this.pullNow();
  }

  async pullNow(): Promise<void> {
    if (!this.state.tryStart(this.deps.now())) return;
    this.lastAttempt = this.deps.now();
    try {
      const base = this.deps.vaultBase();
      if (base === null) {
        this.state.finish({ ok: false, stderr: "Vault-Pfad unbekannt" }, this.deps.now());
        return;
      }
      const briefingsDir = this.deps.settings().briefingsDir;
      // Nicht eingerichtet: join(base, "") wäre der Vault selbst, der würde gepullt.
      if (isUnset(briefingsDir)) {
        this.state.setUnset(this.deps.now());
        return;
      }
      const dir = join(base, briefingsDir);
      // .git ist im Klon ein Ordner, in Worktrees und Submodulen eine Datei: beides zählt.
      if (!existsSync(join(dir, ".git"))) {
        this.state.setNoRepo(this.deps.now());
        return;
      }
      const dirs = await this.deps.pathDirs();
      const result = await runGitPull(dir, { ...(process.env as Record<string, string>), PATH: dirs.join(":") });
      this.state.finish(result, this.deps.now());
    } catch (fehler) {
      this.state.finish({ ok: false, stderr: fehler instanceof Error ? fehler.message : String(fehler) }, this.deps.now());
    } finally {
      try {
        this.deps.afterPull?.();
      } catch (fehler) {
        console.warn("Glasscockpit: Nachlauf des Pulls gescheitert", fehler);
      }
    }
  }
}
