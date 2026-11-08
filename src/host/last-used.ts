import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeProjectDirName } from "../core/new-session";

/** Claude Code kürzt längere Ordnernamen; das wird nicht nachgebaut, ein solcher Ordner gilt als unbenutzt. */
const MAX_DIR_NAME = 200;

/**
 * Leser für „zuletzt benutzt“: jüngste mtime (ms) einer Datei `*.jsonl` direkt im Claude-Projektordner zu cwd, sonst 0.
 * Jeder Lesefehler ergibt 0. Ergebnisse stehen je zurückgegebener Funktion im Zwischenspeicher.
 */
export function createLastUsed(root: string = join(homedir(), ".claude", "projects")): (cwd: string) => number {
  const cache = new Map<string, number>();
  const read = (cwd: string): number => {
    const name = claudeProjectDirName(cwd);
    if (name.length > MAX_DIR_NAME) return 0;
    const dir = join(root, name);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    let newest = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      try {
        const t = statSync(join(dir, entry.name)).mtimeMs;
        if (t > newest) newest = t;
      } catch {
        // verschwundene Datei: übrige zählen weiter
      }
    }
    return newest;
  };
  return (cwd) => {
    const hit = cache.get(cwd);
    if (hit !== undefined) return hit;
    const value = read(cwd);
    cache.set(cwd, value);
    return value;
  };
}
