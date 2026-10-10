import { readFile, stat } from "node:fs/promises";

// Diff-Ansicht (Abend 17): Die alte Fassung einer Datei, nur gelesen. Auch Dateien außerhalb des Vaults (Claude arbeitet in
// Repos), darum node:fs statt der Vault-API. Dieses Modul schreibt nie: Beim Annehmen schreibt Claude die Datei selbst aus
// der Antwort auf openDiff (gemessen, `scripts/ide-diff-probe.mjs`).

/** Feste Technik-Grenze: Größere alte Fassungen werden nicht gelesen und nicht diffed. */
export const MAX_OLD_FILE_BYTES = 8 * 1024 * 1024;

/** Inhalt als UTF-8; null, wenn es die Datei nicht gibt (neue Datei). Alle anderen Fehler (Ordner, Rechte, zu groß) werfen. */
export async function readOldFile(path: string): Promise<string | null> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw fehler;
  }
  if (size > MAX_OLD_FILE_BYTES) throw new Error(`Datei ist zu groß für die Diff-Ansicht (${Math.ceil(size / 1024 / 1024)} MB, Grenze ${MAX_OLD_FILE_BYTES / 1024 / 1024} MB)`);
  return readFile(path, "utf8");
}
