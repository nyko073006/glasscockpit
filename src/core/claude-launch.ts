import { effortArgs, type EffortStep } from "./effort";

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

/** Erster ausführbarer Treffer name in dirs, sonst null. exists kommt vom Host (fs). */
export function findBinary(name: string, dirs: readonly string[], exists: (path: string) => boolean): string | null {
  for (const dir of dirs) {
    const candidate = `${dir.replace(/\/+$/, "")}/${name}`;
    if (exists(candidate)) return candidate;
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
 * Env für claude: alle String-Werte aus base, dazu PATH, Scrollback (kein Alternate Screen),
 * Textauswahl (keine Maus), Farben. LANG nur, falls leer: Wert der Login-Shell, sonst en_US.UTF-8.
 * fullscreen (Abend 19f): Vollbild erzwingen; die beiden Sperren fallen weg, auch geerbte, weil
 * DISABLE_ALTERNATE_SCREEN laut code.claude.com/docs/en/fullscreen jede andere Wahl schlägt.
 */
export function buildEnv(
  base: Record<string, string | undefined>,
  path: readonly string[],
  loginLang: string | null = null,
  /** Zusätzliche Variablen, zuletzt gesetzt (IDE-Brücke, Abend 16). */
  extra: Readonly<Record<string, string>> = {},
  fullscreen = false,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = value;
  }
  env.PATH = path.join(":");
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
  Object.assign(env, extra);
  return env;
}

/** Vorgabe für --name: Ordnername und Uhrzeit, etwa „Vault 09:05“. */
export function defaultSessionName(folder: string, now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${folder} ${two(now.getHours())}:${two(now.getMinutes())}`;
}

/** Tab-Titel: Name und Kurz-ID, nie nur „claude“. */
export function tabTitle(name: string, sessionId: string): string {
  return `${name.trim() || "Claude"} · ${sessionId.slice(0, 8)}`;
}

export function notFoundMessage(name: string, dirs: readonly string[]): string {
  return [`${name} nicht gefunden. Durchsucht:`, ...dirs.map((dir) => `  ${dir}`)].join("\n");
}

/** Ordner mit "~" statt Home-Präfix; nur ganze Pfadsegmente zählen. */
export function shortPath(path: string, home: string): string {
  const base = home.replace(/\/+$/, "");
  if (!base) return path;
  if (path === base) return "~";
  return path.startsWith(`${base}/`) ? `~${path.slice(base.length)}` : path;
}

/** Kopfzeile der Terminal-View: Tab-Titel und Ordner. */
export function headerTitle(name: string, sessionId: string, cwd: string, home: string): string {
  return `${tabTitle(name, sessionId)} · ${shortPath(cwd, home)}`;
}
