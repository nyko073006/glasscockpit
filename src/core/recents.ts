import { RECENT_SKILLS_MAX } from "./constants";
import type { LaunchEntry } from "./discovery";

/** Name nach vorn, Dopplung entfernt, auf max gekürzt. Die Eingabe bleibt unverändert. */
export function pushRecent(list: readonly string[], name: string, max: number = RECENT_SKILLS_MAX): string[] {
  return [name, ...list.filter((n) => n !== name)].slice(0, max);
}

/** Zuletzt benutzte zuerst (nur, die es noch gibt), der Rest alphabetisch ohne Rücksicht auf Groß/Klein und Akzente. */
export function rankSkills(skills: LaunchEntry[], recents: string[]): LaunchEntry[] {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const used: LaunchEntry[] = [];
  const seen = new Set<string>();
  for (const name of recents) {
    const s = byName.get(name);
    if (s && !seen.has(name)) { used.push(s); seen.add(name); }
  }
  // Bei Gleichstand (apfel / Äpfel) entscheidet der genaue Vergleich, damit die Reihenfolge nicht von der Eingabe abhängt.
  const rest = skills
    .filter((s) => !seen.has(s.name))
    .sort((a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }) || a.name.localeCompare(b.name, "de"));
  return [...used, ...rest];
}

/** Teilstring in Name oder Beschreibung, ohne Groß/Klein; Reihenfolge bleibt. Leere Suche = alle. */
export function filterSkills(ranked: LaunchEntry[], query: string): LaunchEntry[] {
  const q = query.trim().toLowerCase();
  if (q === "") return ranked;
  return ranked.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
}
