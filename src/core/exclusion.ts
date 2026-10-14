// Obsidians „Ausgeschlossene Dateien“ als Leseverbote für Claude-Sitzungen (Abend 33), rein: Liste, Pfade und Vault-Pfad kommen vom Host.
// Regeln wie Obsidian 1.14.4 (metadataCache.updateUserIgnoreFilters, gemessen 13.10.2026): Eintrag getrimmt, leere fallen weg;
// länger als 2 Zeichen mit "/" vorn und hinten = regulärer Ausdruck aus dem Inneren, sonst Pfadanfang; beides ohne Groß-/Kleinschreibung.
// Claude-Regeln: "//" = absoluter Pfad; Read-deny sperrt auch Edit/Write, Edit-Regel zusätzlich für NotebookEdit (code.claude.com permissions).
// Glob-Zeichen per Backslash maskiert (gemessen 13.10.2026, claude 2.1.296: "Akte \[alt\] \*/**" sperrt, unmaskiert nicht).
// Ausnahme "?": gemessen mit claude 2.1.296 trifft weder "\?" noch "[?]" ein wörtliches "?", das unmaskierte "?" schon.
// Es steht für genau ein Zeichen und kann deshalb höchstens zu viel sperren, nie zu wenig.

export type IgnoreFilter = { kind: "prefix" | "regex"; text: string; re: RegExp };
export interface VaultEntry { path: string; folder: boolean }
export interface ExclusionTargets { prefixes: string[]; folders: string[]; files: string[]; skipped: string[]; active: number }
export interface ExclusionInput { enabled: boolean; sandbox: boolean; raw: unknown; entries: readonly VaultEntry[]; vaultAbs: string; failure?: string | null }
export interface ExclusionPlan { settings: Record<string, unknown>; notice: string | null; filters: IgnoreFilter[] }

/** Mehr eigene Regeln je Eintrag sperren den Eintrag nicht (Startargument bleibt klein; Spec Abend 33, 13.10.2026). */
export const MAX_RULES_PER_FILTER = 500;

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const GLOB_SPECIAL = /[\\*[\]{}()!]/g;

export function parseIgnoreFilters(raw: unknown): { filters: IgnoreFilter[]; errors: string[] } {
  if (raw === undefined || raw === null) return { filters: [], errors: [] };
  if (!Array.isArray(raw)) return { filters: [], errors: ["Ausschlussliste ist keine Liste"] };
  const filters: IgnoreFilter[] = [];
  const errors: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      errors.push(`kein Text: ${JSON.stringify(item)}`);
      continue;
    }
    const text = item.trim();
    if (text.length === 0) continue;
    if (text.length > 2 && text.startsWith("/") && text.endsWith("/")) {
      try {
        filters.push({ kind: "regex", text, re: new RegExp(text.slice(1, -1), "i") });
      } catch {
        errors.push(`ungültiges Muster ${text}`);
      }
    } else {
      filters.push({ kind: "prefix", text, re: new RegExp("^" + text.replace(REGEX_SPECIAL, "\\$&"), "i") });
    }
  }
  return { filters, errors };
}

/** Liegt path echt unter einem der Ordner? Je Pfad ein Nachschlagen pro Ebene, unabhängig von der Ordneranzahl. */
function under(path: string, folders: ReadonlySet<string>): boolean {
  for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
    if (folders.has(path.slice(0, i))) return true;
  }
  return false;
}

/** Eine Ordnerregel deckt alles darunter: Ordner unter Ordnern und Dateien unter Ordnern fallen weg. */
function collapse(folders: Iterable<string>, files: Iterable<string>): { folders: string[]; files: string[] } {
  const all = new Set(folders);
  const roots = [...all].filter((p) => !under(p, all));
  const rootSet = new Set(roots);
  return { folders: roots, files: [...new Set(files)].filter((p) => !under(p, rootSet)) };
}

export function excludedTargets(filters: readonly IgnoreFilter[], entries: readonly VaultEntry[]): ExclusionTargets {
  const prefixes: string[] = [];
  const folders = new Set<string>();
  const files = new Set<string>();
  const skipped: string[] = [];
  let active = 0;
  for (const f of filters) {
    const ownFolders: string[] = [];
    const ownFiles: string[] = [];
    for (const entry of entries) {
      if (f.kind === "prefix") {
        const subject = entry.folder ? entry.path + "/" : entry.path;
        // In der eingetragenen Schreibweise deckt die Musterregel den Treffer; eigene Regel nur bei anderer Groß-/Kleinschreibung.
        if (!f.re.test(subject) || subject.startsWith(f.text)) continue;
        (entry.folder ? ownFolders : ownFiles).push(entry.path);
      } else if (!entry.folder && f.re.test(entry.path)) {
        ownFiles.push(entry.path);
      }
    }
    // Gezählt wird, was nach dem Zusammenfassen als eigene Regel bleibt (Spec: höchstens 500 eigene Regeln je Eintrag).
    const own = collapse(ownFolders, ownFiles);
    const count = own.folders.length + own.files.length;
    if (count > MAX_RULES_PER_FILTER) {
      skipped.push(`${f.text} (${count} Einzelpfade)`);
      continue;
    }
    active++;
    if (f.kind === "prefix") prefixes.push(f.text);
    for (const p of own.folders) folders.add(p);
    for (const p of own.files) files.add(p);
  }
  // Einträge untereinander: Ordner eines Eintrags verdecken Pfade eines anderen.
  const kept = collapse(folders, files);
  return { prefixes: [...new Set(prefixes)].sort(), folders: kept.folders.sort(), files: kept.files.sort(), skipped, active };
}

export function escapeGlob(s: string): string {
  return s.replace(GLOB_SPECIAL, "\\$&");
}

export function exclusionRules(vaultAbs: string, t: ExclusionTargets): string[] {
  const root = vaultAbs.replace(/\/+$/, "");
  const abs = (rel: string) => escapeGlob(`${root}/${rel}`);
  const patterns: string[] = [];
  for (const p of t.prefixes) {
    if (p.endsWith("/")) patterns.push(`${abs(p)}**`);
    else patterns.push(`${abs(p)}*`, `${abs(p)}*/**`);
  }
  for (const f of t.folders) patterns.push(`${abs(f)}/**`);
  for (const f of t.files) patterns.push(abs(f));
  // abs beginnt mit "/", "Read(/" davor ergibt "//" = absoluter Pfad.
  const rules = patterns.flatMap((x) => [`Read(/${x})`, `Edit(/${x})`]);
  return [...new Set(rules)].sort();
}

export function exclusionSettings(rules: readonly string[], sandbox: boolean): Record<string, unknown> {
  if (rules.length === 0) return {};
  const out: Record<string, unknown> = { permissions: { deny: [...rules] } };
  // Ohne allowUnsandboxedCommands: false könnte Claude per dangerouslyDisableSandbox außerhalb der Sandbox weiterlaufen.
  if (sandbox) out.sandbox = { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false };
  return out;
}

export function exclusionNotice(s: { active: number; skipped: readonly string[]; errors: readonly string[]; sandbox: boolean; failure?: string | null }): string | null {
  if (s.failure) return `Ausschluss NICHT aktiv: app.json nicht lesbar (${s.failure}).`;
  if (s.active === 0 && s.skipped.length === 0 && s.errors.length === 0) return null;
  const parts: string[] = [];
  if (s.active > 0) {
    const n = s.active === 1 ? "1 Eintrag" : `${s.active} Einträge`;
    parts.push(`Ausschluss aktiv: ${n} gesperrt, ${s.sandbox ? "auch Shell-Befehle (Sandbox an)." : "Shell-Befehle wie grep -r nicht (Sandbox aus)."}`);
  } else {
    parts.push("Ausschluss: nichts gesperrt.");
  }
  if (s.skipped.length > 0) parts.push(`Nicht gesperrt: ${s.skipped.join(", ")}.`);
  if (s.errors.length > 0) parts.push(`Fehler in der Ausschlussliste: ${s.errors.join("; ")}.`);
  return parts.join(" ");
}

export function isExcluded(filters: readonly IgnoreFilter[], path: string): boolean {
  return filters.some((f) => f.re.test(path));
}

export function planExclusion(i: ExclusionInput): ExclusionPlan {
  if (!i.enabled) return { settings: {}, notice: null, filters: [] };
  if (i.failure) return { settings: {}, notice: exclusionNotice({ active: 0, skipped: [], errors: [], sandbox: false, failure: i.failure }), filters: [] };
  const { filters, errors } = parseIgnoreFilters(i.raw);
  const targets = excludedTargets(filters, i.entries);
  const rules = exclusionRules(i.vaultAbs, targets);
  const sandbox = i.sandbox && rules.length > 0;
  return {
    settings: exclusionSettings(rules, sandbox),
    notice: exclusionNotice({ active: targets.active, skipped: targets.skipped, errors, sandbox }),
    filters,
  };
}
