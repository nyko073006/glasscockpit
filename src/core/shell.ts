import { PTY_FALLBACK_SIZE, SHELL_FALLBACK } from "./constants";
import type { Dimensions } from "./terminal-size";

export interface ShellSpawn {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface NativePaths {
  nativeDir: string;
  indexJs: string;
  ptyNode: string;
  spawnHelper: string;
}

/** Login-Shell aus $SHELL (Rückfall /bin/zsh) im Home-Ordner, Env mit TERM und COLORTERM. */
export function buildShellSpawn(env: Record<string, string | undefined>, home: string): ShellSpawn {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) clean[key] = value;
  }
  clean.TERM = "xterm-256color";
  clean.COLORTERM = "truecolor";
  return { file: env.SHELL || SHELL_FALLBACK, args: ["-l"], cwd: home, env: clean };
}

/** Startgröße der PTY: Maße der Pane, sonst der Rückfall. */
export function startSize(fitted: Dimensions | null): Dimensions {
  return fitted ?? { ...PTY_FALLBACK_SIZE };
}

/** pty.resize nur mit positiven, endlichen Werten. */
export function canResize(cols: number, rows: number): boolean {
  return Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0;
}

export function sessionEndedLine(exitCode: number): string {
  return `\r\n[Sitzung beendet, Exit ${exitCode}]\r\n`;
}

/** Zeile für „Beenden“: kill entfernt die Abonnenten, onExit kommt nicht an. */
export function stoppedLine(): string {
  return "\r\n[Sitzung beendet. Tab-Menü → Neu starten]\r\n";
}

/** Text rot fürs Terminal, Zeilenenden als CRLF (convertEol ist aus). */
export function redTerminalText(text: string): string {
  return `\x1b[31m${text.replace(/\r?\n/g, "\r\n")}\x1b[0m\r\n`;
}

/** Plattformen, für die das Release-ZIP ein Binary mitbringt (Ordnername in native/). */
export const NATIVE_TARGETS = ["darwin-arm64", "darwin-x64"] as const;

/**
 * Pfade in native/, Struktur wie im npm-Paket: lib/ sucht das Binary relativ unter prebuilds/.
 * Wirft bei allem außer macOS arm64/x64, statt einen Pfad zu erfinden, den es nicht gibt.
 */
export function nativePaths(pluginDir: string, platform: string, arch: string): NativePaths {
  const nativeDir = `${pluginDir.replace(/\/+$/, "")}/native`;
  const target = `${platform}-${arch}`;
  if (!(NATIVE_TARGETS as readonly string[]).includes(target)) {
    throw new Error(`Glasscockpit unterstützt nur macOS arm64/x64 (hier: ${target}).`);
  }
  const prebuilds = `${nativeDir}/${target}/prebuilds/${target}`;
  return {
    nativeDir,
    indexJs: `${nativeDir}/${target}/lib/index.js`,
    ptyNode: `${prebuilds}/pty.node`,
    spawnHelper: `${prebuilds}/spawn-helper`,
  };
}

/** Hinweiszeile der Pane in Grau, Zeilenenden als CRLF (convertEol ist aus). */
export function grayLine(text: string): string {
  return `\r\n\x1b[90m${text.replace(/\r?\n/g, "\r\n")}\x1b[0m\r\n`;
}
