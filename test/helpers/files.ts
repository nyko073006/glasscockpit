import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo-Wurzel (test/helpers/ liegt zwei Ebenen darunter). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Alle Dateien unterhalb von dir, rekursiv, als absolute Pfade, sortiert.
 * Fehlt dir, wirft das einen Fehler: ein fehlender Ordner darf nicht still als leer gelten.
 */
export function listFilesRecursive(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFilesRecursive(full));
    } else {
      result.push(full);
    }
  }
  return result.sort();
}

/** Pfad relativ zur Repo-Wurzel, für lesbare Trefferlisten. */
export function relativeToRoot(path: string): string {
  return relative(ROOT, path);
}
