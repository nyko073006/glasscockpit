import { accessSync, constants, statSync } from "fs";
import { homedir } from "os";
import { buildArgs, buildEnv, findBinary, notFoundMessage, tabTitle } from "../core/claude-launch";
import { type StartKind, planClaudeStart } from "../core/claude-start";
import { CLAUDE_BINARY, IDE_ENV_WAIT_MS, LOGIN_SHELL_TIMEOUT_MS, SHELL_FALLBACK } from "../core/constants";
import type { LaunchInfo } from "../core/diagnose";
import type { EffortStep } from "../core/effort";
import { fixedPaths, mergePath, windowsFixedPaths } from "../core/login-path";
import { type Platform, pathKey, splitPathList, system32Path } from "../core/platform-path";
import { hookSettings, windowsSettings } from "../core/attention";
import { CMD_LINE_LIMIT, cmdShimCommandLine } from "../core/cmd-shim";
import type { SessionMeta } from "../core/session-manager";
import { type SessionRecord, claudeIdOf } from "../core/session-model";
import { type ShellSpawn, buildShellSpawn } from "../core/shell";
import { readLoginShell } from "./login-shell";
import type { SettingsFiles } from "./settings-files";
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
  /** Einstellung windowsShell (Abend 41, nur Shell-Tabs unter Windows); fehlt sie, gilt leer (automatisch). */
  windowsShell?: string;
  /** Startnachricht nur für diesen Start (Abend 19h). */
  prompt?: string;
  /** Abend 33: Ausschluss für diese Sitzung (Regeln für --settings, graue Zeile); zum Startzeitpunkt berechnet, Shell-Tabs ignorieren ihn. */
  exclusion?: { settings: Record<string, unknown>; notice: string | null };
}

/** Variablen der IDE-Brücke für Claude-Sitzungen; null, wenn sie aus ist oder nicht läuft. */
export type IdeEnvSource = () => Record<string, string> | null | Promise<Record<string, string> | null>;

/** Plattform und Env, aus denen der Launcher PATH und Startumgebung bildet (Abend 41); Vorgabe darwin und process.env. */
export interface LauncherOptions {
  platform: Platform;
  env: () => Record<string, string | undefined>;
  /** Settings-Datei je Sitzung (nur Windows, Abend 41); fehlt sie, startet Claude dort nicht. */
  settingsFiles?: SettingsFiles;
  /** %SystemRoot% für cmd.exe; fehlt er, gilt C:\Windows. Der Host liest ihn aus process.env, src/core nie. */
  systemRoot?: string;
  /** Ob ein Programm ausführbar vorhanden ist; Vorgabe: Dateisystem (Tests reichen einen Fake herein). */
  exists?: (path: string) => boolean;
}

const NO_VAULT_DIR = "Unter Windows braucht Glasscockpit einen Vault-Ordner auf der Festplatte.";

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
  private readonly options: LauncherOptions;
  private env: Promise<LaunchEnv> | null = null;

  /** ideEnv: Variablen der IDE-Brücke für Claude-Sitzungen, null wenn sie aus ist oder nicht läuft (Shell bekommt sie nie). */
  constructor(
    onFallback: (reason: string) => void,
    ideEnv: IdeEnvSource = () => null,
    ideWaitMs: number = IDE_ENV_WAIT_MS,
    options: LauncherOptions,
  ) {
    this.onFallback = onFallback;
    this.ideEnv = ideEnv;
    this.ideWaitMs = ideWaitMs;
    this.options = options;
  }

  /** Einmal beim Laden: Die Login-Shell läuft im Hintergrund, das Ergebnis bleibt im Speicher. */
  start(): void {
    this.env ??= this.readEnv();
  }

  async plan(record: SessionRecord, start: StartContext): Promise<SpawnPlan> {
    if (record.kind === "shell") {
      const { platform } = this.options;
      const dirs = platform === "win32" ? (await this.environment()).dirs : [];
      const spawn = buildShellSpawn(this.options.env(), homedir(), platform, {
        shell: start.windowsShell ?? "", dirs, systemRoot: this.options.systemRoot, exists: this.options.exists ?? isExecutable,
      });
      if ("error" in spawn) return { ok: false, message: spawn.error };
      return {
        ok: true, spawn, meta: { kind: "shell", title: tabTitle(record.name, record.id) },
        notice: null, adoptClaudeId: null, release: () => undefined,
      };
    }
    if (!isDirectory(record.cwd)) return { ok: false, message: `Ordner fehlt: ${record.cwd}` };
    const env = await this.environment();
    const { platform } = this.options;
    const binary = findBinary(CLAUDE_BINARY, env.dirs, this.options.exists ?? isExecutable, platform);
    if (!binary) return { ok: false, message: notFoundMessage(CLAUDE_BINARY, env.dirs, platform) };
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
    // Unter Windows steht die Einstellung in einer Datei je Sitzung (--settings <datei>), auf dem Mac als JSON-Argument.
    let settings: string;
    if (platform === "win32") {
      let path: string | null;
      try {
        path = this.options.settingsFiles?.write(decision.claudeId, windowsSettings(start.exclusion?.settings ?? {}, system32Path(this.options.systemRoot, "WindowsPowerShell", "v1.0", "powershell.exe"))) ?? null;
      } catch (fehler) {
        return { ok: false, message: `Settings-Datei nicht geschrieben: ${fehler instanceof Error ? fehler.message : String(fehler)}` };
      }
      if (path === null) return { ok: false, message: NO_VAULT_DIR };
      settings = path;
    } else {
      settings = hookSettings(start.exclusion?.settings);
    }
    const args = buildArgs({
      sessionId: decision.claudeId,
      resume: decision.resume,
      name: record.name,
      agentName: record.kind === "agent" ? record.agentName : undefined,
      settings,
      effort: start.effort,
      skipPermissions: start.skipPermissions,
      prompt: start.prompt,
    });
    // Ein npm-Shim (claude.cmd) startet nur über cmd.exe, mit fertiger Befehlszeile; claude.exe bekommt das Array.
    const viaCmd = platform === "win32" && /\.cmd$/i.test(binary);
    const file = viaCmd ? system32Path(this.options.systemRoot, "cmd.exe") : binary;
    const spawnArgs = viaCmd ? cmdShimCommandLine(binary, args) : args;
    // cmd.exe verarbeitet höchstens CMD_LINE_LIMIT Zeichen; das doppelte Escaping bläht lange Startnachrichten auf.
    if (typeof spawnArgs === "string") {
      const length = `${file} ${spawnArgs}`.length;
      if (length > CMD_LINE_LIMIT) {
        this.options.settingsFiles?.remove(decision.claudeId);
        return { ok: false, message: `Befehlszeile für claude.cmd zu lang (${length} von ${CMD_LINE_LIMIT} Zeichen). Startnachricht kürzen oder claude.exe installieren.` };
      }
    }
    return {
      ok: true,
      spawn: {
        file,
        args: spawnArgs,
        cwd: record.cwd,
        env: buildEnv(this.options.env(), env.dirs, env.lang, ide ?? undefined, start.fullscreen, platform),
      },
      meta: { kind: "claude", title: tabTitle(record.name, decision.claudeId) },
      notice: [decision.notice, start.exclusion?.notice].filter((n): n is string => !!n).join("\n") || null,
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
      binary: findBinary(CLAUDE_BINARY, env.dirs, this.options.exists ?? isExecutable, this.options.platform),
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
    const { platform } = this.options;
    const env = this.options.env();
    if (platform === "win32") {
      // Kein Login-Shell-Aufruf: Obsidians PATH plus feste Liste ist unter Windows der Normalfall, also auch keine Meldung.
      const current = splitPathList(platform, env[pathKey(env, platform)] ?? "");
      return { dirs: mergePath([], windowsFixedPaths(env), current), lang: null, origin: "fest", reason: null };
    }
    const fixed = fixedPaths(homedir());
    const current = (env.PATH ?? "").split(":");
    const login = await readLoginShell(env.SHELL || SHELL_FALLBACK, LOGIN_SHELL_TIMEOUT_MS);
    if (login.ok) return { dirs: mergePath(login.dirs, fixed, current), lang: login.lang, origin: "login-shell", reason: null };
    this.onFallback(login.reason);
    return { dirs: mergePath([], fixed, current), lang: null, origin: "fest", reason: login.reason };
  }
}
