// Auswahl für „Neue Sitzung“ (Abend 7).
import { expandHome } from "./settings";
import { fillHandoffPrompt, type OpenHandoff } from "./handoffs";
import { isUnset } from "./unset";

export interface SessionChoice {
  label: string;
  cwd: string;
  baseName: string;
  /** Abend 19h: Start aus einem Handoff. */
  handoff?: { path: string; prompt: string; repoMissing: boolean };
}

/** Menüeinträge „Weiter: …“ (Abend 19h). Fehlt repo oder der Ordner, startet die Sitzung im Vault. Pfade in inFlight (gerade aufgenommen) erscheinen nicht. */
export function handoffChoices(items: readonly OpenHandoff[], vault: string, template: string, exists: (dir: string) => boolean, inFlight: ReadonlySet<string> = new Set()): SessionChoice[] {
  return items.filter((h) => !inFlight.has(h.path)).map((h) => {
    const ok = h.repo !== null && exists(h.repo);
    const cwd = ok ? (h.repo as string) : vault;
    const base = `Weiter: ${h.project}${h.task ? `, ${h.task}` : ""}`;
    return {
      label: h.repo !== null && !ok ? `${base} (Repo fehlt, Start im Vault)` : base,
      cwd,
      baseName: cwd.split("/").filter(Boolean).pop() ?? "claude",
      handoff: { path: h.path, prompt: fillHandoffPrompt(template, { datei: h.path, auftrag: h.task }), repoMissing: h.repo !== null && !ok },
    };
  });
}

/** Vault, Home, dann jeder nicht versteckte Ordner aus dirs (deutsch sortiert) unter projectsRoot. */
export function sessionChoices(
  vault: string,
  home: string,
  projectsRoot: string,
  dirs: readonly string[],
): SessionChoice[] {
  const root = projectsRoot.replace(/\/+$/, "");
  const projects = dirs
    .filter((d) => !d.startsWith("."))
    .sort((a, b) => a.localeCompare(b, "de"))
    .map((d) => ({ label: `claude in ${d}`, cwd: `${root}/${d}`, baseName: d }));
  return [
    { label: "claude (Vault)", cwd: vault, baseName: "claude" },
    { label: "claude (Home)", cwd: home, baseName: "claude" },
    ...projects,
  ];
}

/**
 * Der Vault steht bei jeder Eingabe ganz oben (bei Gleichstand wie „claude“ entscheidet sonst die Fuzzy-Wertung), der Rest
 * behält seine Reihenfolge. Fehlt der Vault in der Liste (Eingabe passt nicht), bleibt alles, wie es ist. Neue Liste.
 */
export function vaultFirst<T>(list: readonly T[], vault: string, cwdOf: (item: T) => string): T[] {
  return [...list.filter((i) => cwdOf(i) === vault), ...list.filter((i) => cwdOf(i) !== vault)];
}

export interface ProjectDirs {
  root: string;
  dirs: string[];
  /** Fehlertext, wenn die Lesung scheiterte; sonst undefined. */
  error?: string;
}

/**
 * Ordnernamen unter dem Projekte-Ordner. Nicht eingerichtet (leer): es wird nicht gelesen (read nie aufgerufen), kein Fehler,
 * denn `readdirSync("")` wirft und würde bei frischer Installation bei jedem Öffnen eine Notice auslösen.
 */
export function loadProjectDirs(
  projectsRoot: string,
  home: string,
  read: (root: string) => string[],
): ProjectDirs {
  const root = expandHome(projectsRoot, home);
  if (isUnset(projectsRoot)) return { root, dirs: [] };
  try {
    return { root, dirs: read(root) };
  } catch (fehler) {
    return { root, dirs: [], error: fehler instanceof Error ? fehler.message : String(fehler) };
  }
}
