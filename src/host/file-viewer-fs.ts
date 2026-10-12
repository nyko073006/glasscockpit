import { statSync } from "node:fs";
import { chmod, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { exceedsLimit, looksBinary, saveDecision } from "../core/file-links";

// Datei-Viewer (Abend 27): Dateizugriff für das Fenster. Gelesen wird erst nach der Größenprüfung, gespeichert atomar.

export type LoadResult =
  | { kind: "text"; text: string; mtimeMs: number }
  | { kind: "tooLarge"; size: number }
  | { kind: "binary" }
  | { kind: "notUtf8" }
  | { kind: "error"; message: string };
export type SaveResult = { status: "saved"; mtimeMs: number } | { status: "changed" };

/** Existiert der Pfad als Datei (Symlinks folgend)? Ordner und Fehlendes sind kein Link. */
export function isFileSync(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Datei fürs Fenster: zu groß, binär (NUL in den ersten 8 KB) und ungültiges UTF-8 ergeben einen Hinweis statt Inhalt. */
export async function loadFile(path: string, maxMb: number): Promise<LoadResult> {
  try {
    const st = await stat(path);
    if (!st.isFile()) return { kind: "error", message: "keine Datei" };
    if (exceedsLimit(st.size, maxMb)) return { kind: "tooLarge", size: st.size };
    const bytes = await readFile(path);
    if (looksBinary(bytes)) return { kind: "binary" };
    let text: string;
    try {
      // fatal: Ungültige Bytes würden sonst still zu U+FFFD und beim Speichern zerstört.
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return { kind: "notUtf8" };
    }
    return { kind: "text", text, mtimeMs: st.mtimeMs };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Atomar speichern: Temp-Datei im selben Ordner mit den Rechten des Originals, dann rename. Hat sich die Datei seit dem
 * Öffnen geändert oder fehlt sie, kommt ohne force "changed" zurück und nichts wird geschrieben. Ein Symlink bleibt
 * Symlink, geschrieben wird sein Ziel. Fehler gehen an den Aufrufer, eine Temp-Datei bleibt nie liegen.
 */
export async function saveFile(path: string, text: string, openedMtimeMs: number, force: boolean): Promise<SaveResult> {
  const target = await realpath(path).catch(() => null);
  const st = target ? await stat(target).catch(() => null) : null;
  if (!force && saveDecision(openedMtimeMs, st?.mtimeMs ?? null) === "ask") return { status: "changed" };
  const real = target ?? path;
  const mode = st ? st.mode & 0o7777 : 0o644;
  const tmp = join(dirname(real), `.${basename(real)}.glasscockpit-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(tmp, text, { encoding: "utf8", mode, flag: "wx" });
    // mode beim Anlegen wirkt nur durch die umask hindurch.
    await chmod(tmp, mode);
    await rename(tmp, real);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
  return { status: "saved", mtimeMs: (await stat(real)).mtimeMs };
}
