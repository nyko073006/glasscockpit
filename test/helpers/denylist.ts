import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseDenylist } from "../../src/core/public-check";

/**
 * Persönliche Begriffe aus der lokalen Sperrliste (Env COCKPIT_PUBLIC_DENYLIST oder
 * ~/.config/cockpit/public-denylist.txt). Ohne Liste leer; die Begriffe stehen nie im Repo.
 */
export function personalTerms(): string[] {
  const env = process.env.COCKPIT_PUBLIC_DENYLIST;
  const pfad = env && env.trim() !== "" ? env : join(homedir(), ".config", "cockpit", "public-denylist.txt");
  if (!existsSync(pfad)) return [];
  return parseDenylist(readFileSync(pfad, "utf8")).terms;
}
