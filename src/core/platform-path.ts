// Pfadbausteine je Plattform (Abend 40). Rein: Die Plattform kommt als Parameter herein, diese Datei liest nie
// process.platform. Windows-Pfade laufen immer über path.win32, auch wenn der Code auf dem Mac getestet wird.
import { posix, win32 } from "node:path";

export type Platform = "darwin" | "win32";

/** Die Plattformen, für die es Binärdateien gibt; alles andere (linux, freebsd, …) ist null. */
export function asPlatform(value: string): Platform | null {
  return value === "darwin" || value === "win32" ? value : null;
}

/** Fügt Teile zu einem Pfad der Plattform: darwin mit "/", win32 mit "\\" (gemischte Trenner werden vereinheitlicht). */
export function joinPath(platform: Platform, ...parts: string[]): string {
  return (platform === "win32" ? win32 : posix).join(...parts);
}

/**
 * Pfad unter <SystemRoot>\System32. Ohne SystemRoot (nicht gesetzt oder leer) gilt C:\Windows.
 * Windows-Programme starten wir nur über so einen absoluten Pfad, nie über PATH.
 */
export function system32Path(systemRoot: string | undefined, ...parts: string[]): string {
  return win32.join(systemRoot || "C:\\Windows", "System32", ...parts);
}

type EnvLike = Readonly<Record<string, string | undefined>>;

/** PATH-Trenner der Plattform: unter Windows ";", sonst ":". */
export function pathDelimiter(platform: Platform): ":" | ";" {
  return platform === "win32" ? ";" : ":";
}

/** PATH-Wert in Ordner zerlegt; leere Einträge fallen weg. */
export function splitPathList(platform: Platform, value: string): string[] {
  return value.split(pathDelimiter(platform)).filter((dir) => dir !== "");
}

const isPathKey = (key: string): boolean => key.toLowerCase() === "path";

/**
 * Name der PATH-Variable. Unter Windows heißt sie in Obsidians Env meist "Path", Env-Namen sind dort ohne
 * Groß-/Kleinschreibung gleich: der vorhandene Schlüssel zählt, sonst "Path". Auf dem Mac immer "PATH".
 */
export function pathKey(env: EnvLike, platform: Platform): string {
  if (platform !== "win32") return "PATH";
  return Object.keys(env).find((key) => isPathKey(key) && env[key] !== undefined) ?? "Path";
}

/**
 * Kopie von env ohne undefined-Werte, PATH auf dirs gesetzt. Unter Windows bleibt genau ein path-Schlüssel
 * (die Schreibweise des Originals), alle anderen Schreibweisen fallen weg.
 */
export function withPathDirs(env: EnvLike, dirs: readonly string[], platform: Platform): Record<string, string> {
  const key = pathKey(env, platform);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (platform === "win32" && isPathKey(name)) continue;
    out[name] = value;
  }
  out[key] = dirs.join(pathDelimiter(platform));
  return out;
}

/**
 * Dateien, die in dir für das Programm name in Frage kommen, in Suchreihenfolge. Windows: .exe (direkt startbar)
 * vor .cmd (npm-Shim); weitere Endungen aus PATHEXT kann der Start nicht. Mac: der Name selbst, Schrägstrich am Ende des Ordners zählt nicht.
 */
export function programCandidates(platform: Platform, dir: string, name: string): string[] {
  if (platform === "win32") return [joinPath(platform, dir, `${name}.exe`), joinPath(platform, dir, `${name}.cmd`)];
  return [`${dir.replace(/\/+$/, "")}/${name}`];
}

/** Absoluter Pfad? darwin: beginnt mit "/". win32: Laufwerk mit Trenner ("C:\\x", "c:/x") oder UNC ("\\\\server\\share"). "C:x" und "\\x" sind nicht absolut. */
export function isAbsolutePath(platform: Platform, p: string): boolean {
  if (platform === "win32") return /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(p);
  return p.startsWith("/");
}

/** "~" und "~/x" (unter win32 auch "~\\x") werden zu Pfaden unter home; alles andere bleibt. darwin: home + p.slice(1), Backslash zählt nicht. */
export function expandHomePath(platform: Platform, p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return platform === "win32" ? joinPath(platform, home, p.slice(2)) : home + p.slice(1);
  if (platform === "win32" && p.startsWith("~\\")) return joinPath(platform, home, p.slice(2));
  return p;
}

/** Teile eines win32-Pfads an beiden Trennern, ohne leere Teile. Ein UNC-Pfad behält seinen Anfang als eigenes Teil. */
function winSegments(p: string): string[] {
  const parts = p.split(/[\\/]+/).filter((part) => part !== "");
  return /^[\\/]{2}[^\\/]/.test(p) ? ["\\\\", ...parts] : parts;
}

/**
 * Pfad von p unterhalb von base, mit "/" verbunden; "" bei gleichem Pfad; null, wenn p nicht in base liegt.
 * win32: beide Trenner, Groß-/Kleinschreibung egal, leere Teile fallen weg ("C:\\Vault2" liegt nicht in "C:\\Vault"). darwin: Zeichenvergleich.
 */
export function relativeInside(platform: Platform, base: string, p: string): string | null {
  if (platform === "win32") {
    const b = winSegments(base);
    const parts = winSegments(p);
    if (b.length === 0 || parts.length < b.length) return null;
    for (let i = 0; i < b.length; i++) if (b[i].toLowerCase() !== parts[i].toLowerCase()) return null;
    return parts.slice(b.length).join("/");
  }
  const root = base.replace(/\/+$/, "");
  if (p === root) return "";
  return p.startsWith(`${root}/`) ? p.slice(root.length + 1) : null;
}

/** Letzter Teil des Pfads ohne Trenner am Ende; "" bei der Wurzel. */
export function lastSegment(platform: Platform, p: string): string {
  const parts = p.split(platform === "win32" ? /[\\/]+/ : /\/+/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? "";
}

/** Trenner am Ende weg; die Wurzel ("/" oder "C:\\") bleibt. */
export function trimTrailingSep(platform: Platform, p: string): string {
  if (platform === "win32") {
    if (/^[A-Za-z]:[\\/]+$/.test(p)) return p.slice(0, 3);
    const trimmed = p.replace(/[\\/]+$/, "");
    return trimmed === "" ? p.slice(0, 1) : trimmed;
  }
  const trimmed = p.replace(/\/+$/, "");
  return trimmed === "" && p !== "" ? "/" : trimmed;
}

/** Windows: Laufwerk ohne Trenner ("C:x") ist weder absolut noch relativ; es gibt keinen Ort dafür ohne Arbeitsordner je Laufwerk. */
export const DRIVE_RELATIVE = /^[A-Za-z]:(?![\\/])/;

/** Wurzelrelativ (win32): genau ein Trenner am Anfang, danach ein Name ("\\x", "/x"). "\\\\x" und "//x" ohne vollständiges UNC zählen nicht. */
export const isRootRelative = (p: string): boolean => /^[\\/][^\\/]/.test(p);

/** Wurzel des Laufwerks (oder der Freigabe) einer absoluten win32-Basis, mit Backslash am Ende; null bei allem anderen. */
function winRootOf(base: string): string | null {
  const drive = /^([A-Za-z]:)[\\/]/.exec(base);
  if (drive) return `${drive[1]}\\`;
  const unc = /^[\\/]{2}([^\\/]+)[\\/]([^\\/]+)/.exec(base);
  return unc ? `\\\\${unc[1]}\\${unc[2]}\\` : null;
}

/**
 * Löst p gegen base auf. Absolut bleibt absolut (normalisiert). Der Rest gilt nur mit absoluter Basis, sonst null.
 * darwin: "/x" bleibt, Relatives wird an base gehängt. win32: wurzelrelativ ("\\x", "/x") hängt an der Wurzel des Laufwerks
 * (oder der UNC-Freigabe) der Basis, wie Windows selbst; "C:x" (Laufwerk ohne Trenner) ergibt null; Relatives wird verbunden.
 */
export function resolveAgainst(platform: Platform, base: string, p: string): string | null {
  if (platform === "win32") {
    if (DRIVE_RELATIVE.test(p)) return null;
    if (isAbsolutePath(platform, p)) return win32.normalize(p);
    const root = winRootOf(base);
    if (root === null) return null;
    if (isRootRelative(p)) return win32.join(root, p.slice(1));
    return /^[\\/]/.test(p) ? null : win32.join(base, p);
  }
  if (p.startsWith("/")) return posix.normalize(p);
  return posix.isAbsolute(base) ? posix.join(base, p) : null;
}

/**
 * Schreibweise aus Obsidians Dateiliste. win32: der erste Eintrag, der ohne Beachtung der Groß-/Kleinschreibung gleich rel ist
 * (das Dateisystem ist dort egal, Obsidian legt sonst eine zweite Datei an); sonst rel. darwin: immer rel.
 */
export function matchVaultCase(platform: Platform, rel: string, paths: readonly string[]): string {
  if (platform !== "win32") return rel;
  const lower = rel.toLowerCase();
  const exact = paths.find((p) => p.toLowerCase() === lower);
  if (exact !== undefined) return exact;
  // Neue Datei: das längste vorhandene Ordner-Präfix in der Schreibweise der Liste, der Rest bleibt.
  const parts = rel.split("/");
  for (let n = parts.length - 1; n >= 1; n--) {
    const prefix = parts.slice(0, n).join("/").toLowerCase();
    for (const p of paths) {
      const dirs = p.split("/").slice(0, -1);
      if (dirs.length >= n && dirs.slice(0, n).join("/").toLowerCase() === prefix) return [...dirs.slice(0, n), ...parts.slice(n)].join("/");
    }
  }
  return rel;
}
