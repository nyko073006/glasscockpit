// Auswahl für „Neue Sitzung“ (Abend 7).
import { lastSegment, joinPath, type Platform } from "./platform-path";
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
export function handoffChoices(items: readonly OpenHandoff[], vault: string, template: string, exists: (dir: string) => boolean, inFlight: ReadonlySet<string> = new Set(), platform: Platform = "darwin"): SessionChoice[] {
  return items.filter((h) => !inFlight.has(h.path)).map((h) => {
    const ok = h.repo !== null && exists(h.repo);
    const cwd = ok ? (h.repo as string) : vault;
    const base = `Weiter: ${h.project}${h.task ? `, ${h.task}` : ""}`;
    return {
      label: h.repo !== null && !ok ? `${base} (Repo fehlt, Start im Vault)` : base,
      cwd,
      baseName: lastSegment(platform, cwd) || "claude",
      handoff: { path: h.path, prompt: fillHandoffPrompt(template, { datei: h.path, auftrag: h.task }), repoMissing: h.repo !== null && !ok },
    };
  });
}

/** Einstellung „Ausgeblendete Ordner“ (Nachtrag Abend 41): an Kommas trennen, trimmen, leere Teile weg. */
export function parseHiddenDirs(text: string): string[] {
  return text.split(",").map((t) => t.trim()).filter((t) => t !== "");
}

/** Name des Claude-Projektordners unter ~/.claude/projects: jedes Zeichen außer A-Z, a-z, 0-9 wird zu „-“ (wie Claude Code). */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

/**
 * Vault, Home, dann jeder nicht versteckte Ordner aus dirs (deutsch sortiert) unter projectsRoot. Ordner, deren ganzer Name einem
 * Eintrag aus hidden gleicht (ohne Rücksicht auf Groß- und Kleinschreibung), fallen weg (Nachtrag Abend 41); Vault und Home nie. Mit lastUsed (Zeit je cwd,
 * je Ordner einmal gelesen) stehen benutzte Ordner absteigend nach Zeit vorn; Zeit ≤ 0 oder nicht endlich gilt als 0 und bleibt
 * alphabetisch hinter allen benutzten (Gleichstand ebenso, stabile Sortierung).
 */
export function sessionChoices(
  vault: string,
  home: string,
  projectsRoot: string,
  dirs: readonly string[],
  lastUsed?: (cwd: string) => number,
  hidden: readonly string[] = [],
  platform: Platform = "darwin",
): SessionChoice[] {
  const root = projectsRoot.replace(/\/+$/, "");
  const hide = new Set(hidden.map((h) => h.toLocaleLowerCase("de")));
  const alpha = dirs
    .filter((d) => !d.startsWith(".") && !hide.has(d.toLocaleLowerCase("de")))
    .sort((a, b) => a.localeCompare(b, "de"))
    .map((d) => ({ label: `claude in ${d}`, cwd: platform === "win32" ? joinPath(platform, projectsRoot, d) : `${root}/${d}`, baseName: d }));
  const projects = lastUsed
    ? alpha
        .map((p) => {
          const t = lastUsed(p.cwd);
          return { p, t: Number.isFinite(t) && t > 0 ? t : 0 };
        })
        .sort((a, b) => b.t - a.t)
        .map((x) => x.p)
    : alpha;
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
  platform: Platform = "darwin",
): ProjectDirs {
  const root = expandHome(projectsRoot, home, platform);
  if (isUnset(projectsRoot)) return { root, dirs: [] };
  try {
    return { root, dirs: read(root) };
  } catch (fehler) {
    return { root, dirs: [], error: fehler instanceof Error ? fehler.message : String(fehler) };
  }
}
