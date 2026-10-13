import { accessSync, constants, statSync } from "fs";
import { homedir } from "os";
import { buildArgs, buildEnv, findBinary, notFoundMessage, tabTitle } from "../core/claude-launch";
import { type StartKind, planClaudeStart } from "../core/claude-start";
import { CLAUDE_BINARY, IDE_ENV_WAIT_MS, LOGIN_SHELL_TIMEOUT_MS, SHELL_FALLBACK } from "../core/constants";
import type { LaunchInfo } from "../core/diagnose";
import type { EffortStep } from "../core/effort";
import { fixedPaths, mergePath } from "../core/login-path";
import { hookSettings } from "../core/attention";
import type { SessionMeta } from "../core/session-manager";
import { type SessionRecord, claudeIdOf } from "../core/session-model";
import { type ShellSpawn, buildShellSpawn } from "../core/shell";
import { readLoginShell } from "./login-shell";
import { transcriptExists } from "./transcript-reader";

/**
 * notice: graue Zeile für die Pane vor der Claude-Ausgabe. adoptClaudeId: neue Claude-ID, die der Eintrag
 * bekommen muss (der Aufrufer speichert sie). release: gibt den Limit-Platz frei, sobald gespawnt ist oder der Start scheitert.
 */
export type SpawnPlan =
  | { ok: true; spawn: ShellSpawn; meta: SessionMeta; notice: string | null; adoptClaudeId: string | null; release: () => void }
  | { ok: false; message: string };

/** Wie die Sitzung gestartet wird (Abend 11): Startart, erzwungen frisch, Einstellung „Unterhaltung fortsetzen“. */
export interface StartContext {
  startKind: StartKind;
  fresh: boolean;
  resumeConversations: boolean;
  /** Eingabezeile fest (Einstellung fixedPrompt, Abend 19f): Claude im Vollbild. */
  fullscreen: boolean;
  /** Effort der nächsten Claude-Sitzung (Einstellung nextEffort, bei jedem Start frisch); aus = kein Flag. */
  effort: EffortStep;
  /** Rechteabfragen überspringen (Einstellung skipPermissions, Abend 20): zum Startzeitpunkt gelesen. */
  skipPermissions: boolean;
  /** Startnachricht nur für diesen Start (Abend 19h). */
  prompt?: string;
}

/** Variablen der IDE-Brücke für Claude-Sitzungen; null, wenn sie aus ist oder nicht läuft. */
export type IdeEnvSource = () => Record<string, string> | null | Promise<Record<string, string> | null>;

interface LaunchEnv {
  dirs: string[];
  lang: string | null;
  origin: LaunchInfo["origin"];
  reason: string | null;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Was eine View starten soll, bestimmt vom Sitzungseintrag: Shell oder claude ohne Shell
 * (PATH aus der Login-Shell, feste Liste als Rückfall). Was mit einem vorhandenen oder fehlenden Transkript geschieht,
 * entscheidet planClaudeStart.
 */
export class Launcher {
  private readonly onFallback: (reason: string) => void;
  private readonly ideEnv: IdeEnvSource;
  private readonly ideWaitMs: number;
  private env: Promise<LaunchEnv> | null = null;

  /** ideEnv: Variablen der IDE-Brücke für Claude-Sitzungen, null wenn sie aus ist oder nicht läuft (Shell bekommt sie nie). */
  constructor(onFallback: (reason: string) => void, ideEnv: IdeEnvSource = () => null, ideWaitMs: number = IDE_ENV_WAIT_MS) {
    this.onFallback = onFallback;
    this.ideEnv = ideEnv;
    this.ideWaitMs = ideWaitMs;
  }

  /** Einmal beim Laden: Die Login-Shell läuft im Hintergrund, das Ergebnis bleibt im Speicher. */
  start(): void {
    this.env ??= this.readEnv();
  }

  async plan(record: SessionRecord, start: StartContext): Promise<SpawnPlan> {
    if (record.kind === "shell") {
      return {
        ok: true, spawn: buildShellSpawn(process.env, homedir()), meta: { kind: "shell", title: tabTitle(record.name, record.id) },
        notice: null, adoptClaudeId: null, release: () => undefined,
      };
    }
    if (!isDirectory(record.cwd)) return { ok: false, message: `Ordner fehlt: ${record.cwd}` };
    const env = await this.environment();
    const binary = findBinary(CLAUDE_BINARY, env.dirs, isExecutable);
    if (!binary) return { ok: false, message: notFoundMessage(CLAUDE_BINARY, env.dirs) };
    const ide = await this.ideEnvWithin();
    // Ein zweites claude mit derselben --session-id bricht ab; die Entscheidung trifft planClaudeStart.
    const current = claudeIdOf(record);
    const decision = planClaudeStart({
      claudeId: current,
      transcriptExists: await transcriptExists(current),
      resumeConversations: start.resumeConversations,
      fresh: start.fresh,
      startKind: start.startKind,
      newId: () => crypto.randomUUID(),
    });
    return {
      ok: true,
      spawn: {
        file: binary,
        args: buildArgs({
          sessionId: decision.claudeId,
          resume: decision.resume,
          name: record.name,
          agentName: record.kind === "agent" ? record.agentName : undefined,
          settings: hookSettings(),
          effort: start.effort,
          skipPermissions: start.skipPermissions,
          prompt: start.prompt,
        }),
        cwd: record.cwd,
        env: buildEnv(process.env, env.dirs, env.lang, ide ?? undefined, start.fullscreen),
      },
      meta: { kind: "claude", title: tabTitle(record.name, decision.claudeId) },
      notice: decision.notice,
      adoptClaudeId: decision.adoptId,
      release: () => undefined,
    };
  }

  /** ideEnv höchstens ideWaitMs lang abwarten; bei Zeitüberschreitung oder Fehler null (Sitzung startet ohne die Variablen). */
  private async ideEnvWithin(): Promise<Record<string, string> | null> {
    let timer: number | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), this.ideWaitMs);
    });
    try {
      return await Promise.race([Promise.resolve().then(() => this.ideEnv()), timeout]);
    } catch (fehler) {
      console.warn("Glasscockpit, IDE-Brücke: Variablen nicht gelesen", fehler);
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  /** PATH-Ordner der Login-Shell (oder der feste Rückfall), ohne neu zu lesen. */
  async pathDirs(): Promise<string[]> {
    return (await this.environment()).dirs;
  }

  async info(): Promise<LaunchInfo> {
    const env = await this.environment();
    return {
      binary: findBinary(CLAUDE_BINARY, env.dirs, isExecutable),
      origin: env.origin,
      reason: env.reason,
      dirs: env.dirs,
    };
  }

  private environment(): Promise<LaunchEnv> {
    this.start();
    return this.env as Promise<LaunchEnv>;
  }

  private async readEnv(): Promise<LaunchEnv> {
    const fixed = fixedPaths(homedir());
    const current = (process.env.PATH ?? "").split(":");
    const login = await readLoginShell(process.env.SHELL || SHELL_FALLBACK, LOGIN_SHELL_TIMEOUT_MS);
    if (login.ok) return { dirs: mergePath(login.dirs, fixed, current), lang: login.lang, origin: "login-shell", reason: null };
    this.onFallback(login.reason);
    return { dirs: mergePath([], fixed, current), lang: null, origin: "fest", reason: login.reason };
  }
}
