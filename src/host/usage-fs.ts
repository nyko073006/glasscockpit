import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TranscriptFile, TranscriptFs } from "../core/usage";

export type SnapshotRead = { kind: "missing" } | { kind: "ok"; text: string } | { kind: "error"; message: string };

/** Schnappschuss der Statuszeile lesen. Fehlt die Datei, ist das kein Fehler: es gab noch keine Antwort. */
export async function readSnapshotFile(path: string): Promise<SnapshotRead> {
  try {
    return { kind: "ok", text: await readFile(path, "utf8") };
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    return { kind: "error", message: fehler instanceof Error ? fehler.message : String(fehler) };
  }
}

/** Alle *.jsonl unter dir, rekursiv (Sub-Agents liegen in <sitzung>/subagents/…). Symlinks werden nicht verfolgt. */
async function walk(dir: string, out: TranscriptFile[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries.map(async (e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return walk(path, out);
    if (!e.isFile() || !e.name.endsWith(".jsonl")) return;
    try {
      const s = await stat(path);
      out.push({ path, size: s.size, mtimeMs: s.mtimeMs });
    } catch {
      // Zwischen readdir und stat verschwunden: nichts zu zählen.
    }
  }));
}

/** TranscriptFs über node:fs/promises; jeder Lesefehler heißt „nicht da“. */
export function transcriptFs(root: string): TranscriptFs {
  return {
    async list() {
      const out: TranscriptFile[] = [];
      await walk(root, out);
      return out;
    },
    async read(path, from, to) {
      let handle;
      try {
        handle = await open(path, "r");
        const buf = Buffer.alloc(to - from);
        const { bytesRead } = await handle.read(buf, 0, buf.length, from);
        return buf.subarray(0, bytesRead);
      } catch {
        return null;
      } finally {
        await handle?.close().catch(() => undefined);
      }
    },
  };
}

/**
 * Atomar schreiben: temporäre Datei im selben Ordner, dann rename. Fehlende Ordner werden angelegt.
 * Scheitert etwas, bleibt keine temporäre Datei liegen; der Fehler geht an den Aufrufer.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, path);
  } catch (fehler) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw fehler;
  }
}
