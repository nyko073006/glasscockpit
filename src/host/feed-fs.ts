import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { ownSessionFiles, sessionFilesToDelete } from "../core/feed-compose";
import { radarLamp, radarStateValid, type RadarFileLamp } from "../core/radar-lamp";
import { parseSessionFile, type SessionFile } from "../core/session-file";

/**
 * Sitzungsdateien der Statuszeile (`~/.claude/cockpit/sessions/*.json`) lesen: nur die der eigenen Claude-IDs kommen
 * zurück (die Statuszeile schreibt für jede Claude-Sitzung auf dem Mac), Dateien älter als 24 h werden weggeräumt.
 * Fehlt der Ordner oder eine Datei, ist das kein Fehler; geworfen wird nie.
 */
export async function readOwnSessionFiles(dir: string, ownClaudeIds: string[], nowMs: number): Promise<Map<string, SessionFile>> {
  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith(".json") && !e.name.startsWith(".")).map((e) => e.name);
  } catch {
    return new Map();
  }
  const parsed = new Map<string, SessionFile>();
  const entries: Array<{ name: string; writtenAt: number | null; mtimeMs: number }> = [];
  await Promise.all(names.map(async (name) => {
    const path = join(dir, name);
    try {
      const file = parseSessionFile(await readFile(path, "utf8"));
      if (file) parsed.set(name, file);
      entries.push({ name, writtenAt: file?.writtenAt ?? null, mtimeMs: file ? 0 : (await stat(path)).mtimeMs });
    } catch {
      // Zwischen readdir und Lesen verschwunden: nichts zu lesen, nichts wegzuräumen.
    }
  }));
  const stale = new Set(sessionFilesToDelete(entries, nowMs));
  await Promise.all([...stale].map((name) => rm(join(dir, name), { force: true }).catch(() => undefined)));
  const fresh = [...parsed].filter(([name]) => !stale.has(name)).map(([, file]) => file);
  return ownSessionFiles(fresh, ownClaudeIds);
}

/** Kontrollleuchte eines Radars: Änderungszeit und Lesbarkeit der state.json. Fehlt sie (ENOENT): grau; vorhanden, aber unlesbar oder kaputt: rot. */
export async function readRadarFile(path: string, nowMs: number): Promise<RadarFileLamp> {
  try {
    const [info, text] = await Promise.all([stat(path), readFile(path, "utf8")]);
    return radarLamp(info.mtimeMs, radarStateValid(text), nowMs);
  } catch (fehler) {
    return (fehler as NodeJS.ErrnoException).code === "ENOENT" ? radarLamp(null, true, nowMs) : "red";
  }
}
