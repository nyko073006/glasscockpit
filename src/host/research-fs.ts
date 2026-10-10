import { readFile } from "node:fs/promises";
import { parseResearchCache, type ResearchCache, serializeResearchCache } from "../core/research";
import { writeFileAtomic } from "./usage-fs";

/** Zwischenspeicher lesen. Fehlt die Datei oder ist sie kaputt, ist das kein Fehler: leerer Stand. */
export async function readResearchCache(path: string): Promise<ResearchCache> {
  let text: string | null = null;
  try {
    text = await readFile(path, "utf8");
  } catch {
    // fehlt oder nicht lesbar: wie leer
  }
  return parseResearchCache(text);
}

// Eine Warteschlange auf Modulebene: Zwei Karten (zwei Dashboards) oder Lauf und Abhaken schreiben nie gleichzeitig,
// sonst überschriebe das eine das andere (lesen, ändern, schreiben ist keine unteilbare Handlung).
let queue: Promise<unknown> = Promise.resolve();

/**
 * Liest die Datei frisch, wendet `fn` an und schreibt atomar. Gibt den neuen Stand zurück. Ein Fehler in einem
 * Glied geht an dessen Aufrufer, hält die Kette aber nicht an: das nächste Glied läuft trotzdem.
 */
export function updateResearchCache(path: string, fn: (c: ResearchCache) => ResearchCache): Promise<ResearchCache> {
  const run = async (): Promise<ResearchCache> => {
    const next = fn(await readResearchCache(path));
    await writeFileAtomic(path, serializeResearchCache(next));
    return next;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
