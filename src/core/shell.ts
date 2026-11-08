import { PTY_FALLBACK_SIZE, SHELL_FALLBACK, WINDOWS_MIN_BUILD } from "./constants";
import { joinPath, type Platform, system32Path } from "./platform-path";
import type { Dimensions } from "./terminal-size";

export interface ShellSpawn {
  file: string;
  /** Array (ein Argument je Eintrag) oder ein fertiger String als Befehlszeile (Windows, .cmd über cmd.exe, Abend 41). */
  args: string[] | string;
  cwd: string;
  env: Record<string, string>;
}

/** Absolute Pfade des Ziels (nativePaths); Aufbau und Bedeutung wie NativeLayout. */
export interface NativePaths {
  nativeDir: string;
  targetDir: string;
  indexJs: string;
  binary: string;
  executables: string[];
  required: string[];
}

/** Windows-Angaben für die Shell: Einstellung „Shell unter Windows“, PATH-Ordner, %SystemRoot%, Existenzprüfung. */
export interface WindowsShellOptions {
  /** Einstellung windowsShell; leer = automatisch. */
  shell: string;
  dirs: readonly string[];
  systemRoot: string | undefined;
  exists: (path: string) => boolean;
}

/**
 * Darwin: Login-Shell aus $SHELL (Rückfall /bin/zsh) im Home-Ordner. Windows: die eingestellte Shell (ohne Argumente;
 * fehlt sie, { error }), sonst pwsh.exe aus den PATH-Ordnern, sonst Windows PowerShell aus System32, beide mit -NoLogo.
 * Env mit TERM und COLORTERM, auf beiden Plattformen.
 */
export function buildShellSpawn(env: Record<string, string | undefined>, home: string): ShellSpawn;
export function buildShellSpawn(
  env: Record<string, string | undefined>,
  home: string,
  platform?: Platform,
  windows?: WindowsShellOptions,
): ShellSpawn | { error: string };
export function buildShellSpawn(
  env: Record<string, string | undefined>,
  home: string,
  platform: Platform = "darwin",
  windows?: WindowsShellOptions,
): ShellSpawn | { error: string } {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) clean[key] = value;
  }
  clean.TERM = "xterm-256color";
  clean.COLORTERM = "truecolor";
  if (platform !== "win32") return { file: env.SHELL || SHELL_FALLBACK, args: ["-l"], cwd: home, env: clean };
  // „Als Pfad kopieren“ im Explorer liefert den Pfad in doppelten Anführungszeichen: ein umschließendes Paar fällt weg.
  const shell = (windows?.shell.trim() ?? "").replace(/^"(.*)"$/, "$1").trim();
  if (shell) {
    if (!windows?.exists(shell)) return { error: `Shell nicht gefunden: ${shell}` };
    return { file: shell, args: [], cwd: home, env: clean };
  }
  // Nur pwsh.exe: ein pwsh.cmd gibt es nicht, und der Start könnte es nicht.
  const pwsh = (windows?.dirs ?? []).map((dir) => joinPath(platform, dir, "pwsh.exe")).find((path) => windows?.exists(path));
  const file = pwsh ?? system32Path(windows?.systemRoot, "WindowsPowerShell", "v1.0", "powershell.exe");
  return { file, args: ["-NoLogo"], cwd: home, env: clean };
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
export const NATIVE_TARGETS = ["darwin-arm64", "darwin-x64", "win32-arm64", "win32-x64"] as const;
export type NativeTarget = (typeof NATIVE_TARGETS)[number];

/** Dateien eines Ziels in native/<ziel>/, relativ dazu und immer mit "/" geschrieben. */
export interface NativeLayout {
  target: NativeTarget;
  /** Die Datei, die der Lader zuerst lädt (der Loader von node-pty verdeckt dlopen-Fehler). */
  binary: string;
  /** Bekommen beim Laden und Entpacken chmod 755 (nur macOS). */
  executables: string[];
  /** Ohne diese Dateien gilt das Ziel als nicht installiert. */
  required: string[];
}

/**
 * Welche Dateien ein Ziel braucht: macOS pty.node plus spawn-helper, Windows conpty.node plus die ConPTY-DLL und
 * OpenConsole.exe (conpty.node sucht sie bei der nächsten Sitzung neben sich). Struktur wie im npm-Paket: lib/
 * sucht das Binary relativ unter prebuilds/. Wirft bei allem außer macOS und Windows, jeweils arm64/x64, statt
 * einen Pfad zu erfinden, den es nicht gibt.
 */
export function nativeLayout(platform: string, arch: string): NativeLayout {
  const target = `${platform}-${arch}`;
  if (!(NATIVE_TARGETS as readonly string[]).includes(target)) {
    throw new Error(`Glasscockpit unterstützt nur macOS und Windows, jeweils arm64 und x64 (hier: ${target}).`);
  }
  const prebuilds = `prebuilds/${target}`;
  if (platform === "win32") {
    const binary = `${prebuilds}/conpty.node`;
    return {
      target: target as NativeTarget,
      binary,
      executables: [],
      required: ["lib/index.js", binary, `${prebuilds}/conpty/conpty.dll`, `${prebuilds}/conpty/OpenConsole.exe`],
    };
  }
  const binary = `${prebuilds}/pty.node`;
  const helper = `${prebuilds}/spawn-helper`;
  return { target: target as NativeTarget, binary, executables: [binary, helper], required: ["lib/index.js", binary, helper] };
}

/**
 * Absolute Pfade in native/, nach der Plattform getrennt geschrieben: Der Lader übergibt den Plugin-Ordner über
 * vaultBasePath, also als Langname (kann Leerzeichen, Umlaute und Klammern enthalten), manifest.dir trägt aber
 * Schrägstriche; daraus wird ein reiner Windows-Pfad. Wirft wie nativeLayout.
 */
export function nativePaths(pluginDir: string, platform: string, arch: string): NativePaths {
  const layout = nativeLayout(platform, arch);
  const os = platform === "win32" ? "win32" : "darwin";
  const nativeDir = joinPath(os, pluginDir, "native");
  const targetDir = joinPath(os, nativeDir, layout.target);
  const abs = (rel: string) => joinPath(os, targetDir, ...rel.split("/"));
  return {
    nativeDir,
    targetDir,
    indexJs: abs("lib/index.js"),
    binary: abs(layout.binary),
    executables: layout.executables.map(abs),
    required: layout.required.map(abs),
  };
}

/**
 * Meldung, wenn Windows für ConPTY zu alt ist, sonst null. Die Build-Nummer liest sie wie node-pty (windowsPtyAgent.js:38)
 * als dritte Zahl aus os.release(); darunter fiele node-pty auf winpty zurück, das nicht mitkommt. Ohne lesbare Nummer
 * steht der Rohtext in der Meldung. Das Release reicht der Host herein (src/core liest os.release() nie).
 */
export function windowsBuildProblem(osRelease: string): string | null {
  const treffer = /(\d+)\.(\d+)\.(\d+)/.exec(osRelease);
  const build = treffer ? parseInt(treffer[3], 10) : null;
  if (build !== null && build >= WINDOWS_MIN_BUILD) return null;
  return `Glasscockpit braucht unter Windows mindestens Windows 10 Version 1903 (hier: ${build === null ? osRelease : `Build ${build}`}).`;
}

/** Zusatzoptionen für pty.spawn: Unter Windows die mitgelieferte ConPTY-DLL (conpty/conpty.dll), sonst nichts. */
export function ptyPlatformOptions(platform: Platform | null): { useConptyDll?: true } {
  return platform === "win32" ? { useConptyDll: true } : {};
}

/** Hinweiszeile der Pane in Grau, Zeilenenden als CRLF (convertEol ist aus). */
export function grayLine(text: string): string {
  return `\r\n\x1b[90m${text.replace(/\r?\n/g, "\r\n")}\x1b[0m\r\n`;
}
