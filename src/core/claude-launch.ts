import { IDE_ENV_KEYS } from "./ide-protocol";
import { effortArgs, type EffortStep } from "./effort";
import { type Platform, programCandidates, relativeInside, withPathDirs } from "./platform-path";

// Start von Claude Code ohne Shell (Abend 5). Flags geprüft mit `claude --help` 2.1.289 am 04.10.2026.

export interface LaunchArgs {
  agentName?: string;
  sessionId?: string;
  name?: string;
  /** Einstellung skipPermissions (Abend 20): an = --dangerously-skip-permissions; ohne Angabe aus. */
  skipPermissions?: boolean;
  /** true: --resume <sessionId> statt --session-id <sessionId> (Transkript existiert schon). */
  resume?: boolean;
  /** --settings <json>, als eigenes Argument. */
  settings?: string;
  /** Effort der nächsten Sitzung (Abend 18): aus = kein Flag, sonst --effort <stufe>. */
  effort?: EffortStep;
  /** Startnachricht (Abend 19h): als letztes Positionsargument; claude startet interaktiv mit dieser ersten Nachricht. */
  prompt?: string;
}

/** Erster ausführbarer Treffer name in dirs, sonst null. exists kommt vom Host (fs). Unter Windows je Ordner .exe vor .cmd. */
export function findBinary(
  name: string,
  dirs: readonly string[],
  exists: (path: string) => boolean,
  platform: Platform = "darwin",
): string | null {
  for (const dir of dirs) {
    for (const candidate of programCandidates(platform, dir, name)) {
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Argumente für pty.spawn, jedes einzeln: kein Shell-Quoting nötig. Reihenfolge: --session-id|--resume, --name,
 * --agent, --settings, --effort, Rechte-Flag, Startnachricht (immer zuletzt). --resume nur mit sessionId (ein zweites claude mit derselben ID bricht ab).
 */
export function buildArgs(opts: LaunchArgs = {}): string[] {
  const args: string[] = [];
  if (opts.sessionId) args.push(opts.resume ? "--resume" : "--session-id", opts.sessionId);
  if (opts.name) args.push("--name", opts.name);
  const agent = opts.agentName?.trim();
  if (agent) args.push(`--agent=${agent}`);
  if (opts.settings) args.push("--settings", opts.settings);
  if (opts.effort) args.push(...effortArgs(opts.effort));
  if (opts.skipPermissions) args.push("--dangerously-skip-permissions");
  if (opts.prompt && opts.prompt.trim() !== "") {
    // Ein führendes "-" läse claude als Option (auch nach dem Einsetzen von {auftrag}); ein Leerzeichen davor macht es zur Nachricht.
    args.push(opts.prompt.trimStart().startsWith("-") ? " " + opts.prompt : opts.prompt);
  }
  return args;
}

/**
 * Variablen, mit denen eine laufende Claude-Sitzung ihre Kindprozesse kennzeichnet (Abend 41b, geprüft an 2.1.306 am
 * 21.10.2026). Startet eine Claude-Sitzung Obsidian neu, erbt jeder Tab sie: CLAUDE_CODE_CHILD_SESSION schaltet das
 * Transkript ab, die übrigen zeigen auf die fremde Sitzung (ID, Messaging, IDE-Port). Ein Tab ist keine Kind-Sitzung.
 * Nutzer-Einstellungen wie CLAUDE_CODE_SUBAGENT_MODEL stehen nicht hier.
 */
export const PARENT_SESSION_VARS = [
  "CLAUDECODE",
  "AI_AGENT",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_INVOKED_SKILLS",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  ...IDE_ENV_KEYS,
] as const;

/**
 * Env für claude: alle String-Werte aus base, dazu PATH, Scrollback (kein Alternate Screen),
 * Textauswahl (keine Maus), Farben. LANG nur, falls leer: Wert der Login-Shell, sonst en_US.UTF-8.
 * fullscreen (Abend 19f): Vollbild erzwingen; die beiden Sperren fallen weg, auch geerbte, weil
 * DISABLE_ALTERNATE_SCREEN laut code.claude.com/docs/en/fullscreen jede andere Wahl schlägt.
 * Geerbte Marker einer Elternsitzung (PARENT_SESSION_VARS) fallen weg, vor extra.
 */
export function buildEnv(
  base: Record<string, string | undefined>,
  path: readonly string[],
  loginLang: string | null = null,
  /** Zusätzliche Variablen, zuletzt gesetzt (IDE-Brücke, Abend 16). */
  extra: Readonly<Record<string, string>> = {},
  fullscreen = false,
  platform: Platform = "darwin",
): Record<string, string> {
  // Unter Windows genau ein Path-Schlüssel (Schreibweise des Originals), Trenner ";" (withPathDirs).
  const env = withPathDirs(base, path, platform);
  if (fullscreen) {
    delete env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN;
    delete env.CLAUDE_CODE_DISABLE_MOUSE;
    env.CLAUDE_CODE_NO_FLICKER = "1";
  } else {
    env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN = "1";
    env.CLAUDE_CODE_DISABLE_MOUSE = "1";
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  if (!env.LANG) env.LANG = loginLang || "en_US.UTF-8";
  for (const key of PARENT_SESSION_VARS) delete env[key];
  Object.assign(env, extra);
  return env;
}

/** Tab-Titel: Kurz-ID vorn, dann der Name („90ef2efe · claude 4“). Obsidian kürzt schmale Tabs vom Ende her, die ID soll stehen bleiben. */
export function tabTitle(name: string, sessionId: string): string {
  return `${sessionId.slice(0, 8)} · ${name.trim() || "Claude"}`;
}

export function notFoundMessage(name: string, dirs: readonly string[], platform: Platform = "darwin"): string {
  if (platform === "win32") return `${name}.exe oder ${name}.cmd nicht gefunden. Gesucht in: ${dirs.join("; ")}`;
  return [`${name} nicht gefunden. Durchsucht:`, ...dirs.map((dir) => `  ${dir}`)].join("\n");
}

/**
 * Ordner mit "~" statt Home-Präfix; nur ganze Pfadsegmente zählen. win32: beide Trenner, Groß-/Kleinschreibung egal,
 * der Rest mit Backslash ("~\\Projekt").
 */
export function shortPath(path: string, home: string, platform: Platform = "darwin"): string {
  if (platform === "win32") {
    const rest = relativeInside(platform, home, path);
    return rest === null ? path : rest === "" ? "~" : `~\\${rest.replace(/\//g, "\\")}`;
  }
  const base = home.replace(/\/+$/, "");
  if (!base) return path;
  if (path === base) return "~";
  return path.startsWith(`${base}/`) ? `~${path.slice(base.length)}` : path;
}

/** Kopfzeile und Tooltip der Terminal-View: ID, Name und Ordner („90ef2efe · claude 4 · ~/projekt“). */
export function headerTitle(name: string, sessionId: string, cwd: string, home: string, platform: Platform = "darwin"): string {
  return `${tabTitle(name, sessionId)} · ${shortPath(cwd, home, platform)}`;
}
