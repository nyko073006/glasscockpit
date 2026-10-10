// PATH aus der Login-Shell (Abend 5). Ein aus dem Dock gestartetes Obsidian erbt nur einen Minimal-PATH.

export const PATH_MARK_START = "__COCKPIT_PATH_START__";
export const PATH_MARK_END = "__COCKPIT_PATH_END__";
export const LANG_MARK_START = "__COCKPIT_LANG_START__";
export const LANG_MARK_END = "__COCKPIT_LANG_END__";

/** Rückfall-Verzeichnisse, ~ steht für das Home-Verzeichnis. */
export const FIXED_PATHS = [
  "~/.npm-global/bin",
  "~/.bun/bin",
  "~/.local/bin",
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
] as const;

/** Text zwischen dem ersten Startmarker und dem folgenden Endmarker, sonst null. */
export function parseMarked(stdout: string, start: string, end: string): string | null {
  const from = stdout.indexOf(start);
  if (from < 0) return null;
  const to = stdout.indexOf(end, from + start.length);
  if (to < 0) return null;
  return stdout.slice(from + start.length, to);
}

/** PATH-Verzeichnisse zwischen den Markern, Rauschen der Profile davor und danach zählt nicht. Ohne Marker null. */
export function parseMarkedPath(stdout: string): string[] | null {
  const path = parseMarked(stdout, PATH_MARK_START, PATH_MARK_END);
  return path === null ? null : path.split(":").filter((dir) => dir !== "");
}

export function fixedPaths(home: string): string[] {
  return FIXED_PATHS.map((dir) => (dir.startsWith("~/") ? `${home}${dir.slice(1)}` : dir));
}

/** Login, dann fest, dann aktuell. Jedes Verzeichnis nur beim ersten Auftreten. */
export function mergePath(login: readonly string[], fixed: readonly string[], current: readonly string[]): string[] {
  return [...new Set([...login, ...fixed, ...current])].filter((dir) => dir !== "");
}

/**
 * Für `$SHELL -i -l -c`. Die Marker entstehen erst beim Ausführen (printf setzt sie zusammen),
 * damit ein Echo des Befehls keinen Treffer vortäuscht.
 */
export function loginShellScript(): string {
  return `printf '__COCKPIT_%s_%s__%s__COCKPIT_%s_%s__' PATH START "$PATH" PATH END; ` +
    `printf '__COCKPIT_%s_%s__%s__COCKPIT_%s_%s__' LANG START "$LANG" LANG END`;
}
