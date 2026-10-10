import { BUILTIN_COMMANDS } from "./builtin-commands";
import { type YamlParse, readFrontmatter } from "./frontmatter";

/** Dateizugriff für die Suche. Der Host liefert node:fs, Tests ein Dateisystem im Speicher. */
export interface DiscoveryFs {
  /** Fehlt der Ordner: []. */
  readdir(dir: string): Promise<string[]>;
  /** Folgt Symlinks; fehlt der Pfad oder ist der Link kaputt: null. */
  stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean } | null>;
  /** Fehlt die Datei: null. */
  readFile(path: string): Promise<string | null>;
  realpath(path: string): Promise<string | null>;
}

export type LaunchKind = "skill" | "agent" | "command";
export type LaunchSource = "user" | "vault" | "project" | "plugin" | "builtin";

export interface LaunchEntry {
  kind: LaunchKind;
  name: string;
  description: string;
  source: LaunchSource;
  path?: string;
}

export interface DiscoveryRoots {
  home: string;
  vault: string;
  project?: string | null;
}

const MAX_DEPTH = 8;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Aktive Plugins: in settings.enabledPlugins genau `true`; Installation „user“ immer, „local“/„project“ nur für Vault oder Projekt. */
export function parsePlugins(
  installedJson: string | null,
  settingsJson: string | null,
  roots: DiscoveryRoots,
): { name: string; installPath: string }[] {
  const plugins = asRecord(asRecord(parseJson(installedJson))?.plugins);
  const enabled = asRecord(asRecord(parseJson(settingsJson))?.enabledPlugins);
  if (!plugins || !enabled) return [];
  const seen = new Set<string>();
  const result: { name: string; installPath: string }[] = [];
  for (const [key, installs] of Object.entries(plugins)) {
    if (enabled[key] !== true || !Array.isArray(installs)) continue;
    const at = key.indexOf("@");
    const name = at > 0 ? key.slice(0, at) : key;
    if (seen.has(name)) continue;
    for (const raw of installs) {
      const inst = asRecord(raw);
      if (!inst || typeof inst.installPath !== "string") continue;
      const scope = inst.scope;
      const mine =
        scope === "user" ||
        ((scope === "local" || scope === "project") &&
          typeof inst.projectPath === "string" &&
          (inst.projectPath === roots.vault || (!!roots.project && inst.projectPath === roots.project)));
      if (!mine) continue;
      seen.add(name);
      result.push({ name, installPath: inst.installPath });
      break;
    }
  }
  return result;
}

function oneLine(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function byName(a: LaunchEntry, b: LaunchEntry): number {
  return a.name.localeCompare(b.name);
}

/** Erster gewinnt: Einträge in Vorrang-Reihenfolge, doppelte Namen fallen weg, Ergebnis nach Name sortiert. */
function dedupe(entries: LaunchEntry[]): LaunchEntry[] {
  const seen = new Set<string>();
  const out: LaunchEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    out.push(entry);
  }
  return out.sort(byName);
}

async function skillsIn(
  fs: DiscoveryFs,
  parse: YamlParse,
  dir: string,
  source: LaunchSource,
  prefix = "",
): Promise<LaunchEntry[]> {
  const out: LaunchEntry[] = [];
  for (const entry of (await fs.readdir(dir)).sort()) {
    if (entry.startsWith(".") || entry.startsWith("_")) continue;
    const path = `${dir}/${entry}`;
    if (!(await fs.stat(path))?.isDirectory) continue;
    const skill = await readSkill(fs, parse, path, entry, source, prefix);
    if (skill) out.push(skill);
  }
  return out;
}

async function readSkill(
  fs: DiscoveryFs,
  parse: YamlParse,
  dir: string,
  fallbackName: string,
  source: LaunchSource,
  prefix: string,
): Promise<LaunchEntry | null> {
  const file = `${dir}/SKILL.md`;
  if (!(await fs.stat(file))?.isFile) return null;
  const text = await fs.readFile(file);
  if (text === null) return null;
  const { fields } = readFrontmatter(text, parse);
  if (fields["user-invocable"] === "false") return null;
  return {
    kind: "skill",
    name: `${prefix}${fields.name || fallbackName}`,
    description: oneLine(fields.description),
    source,
    path: file,
  };
}

/** Alle .md unter dir, rekursiv. `sub` sind die Unterordner bis zur Datei. Versteckte Einträge, Zyklen und Tiefe über 8 entfallen. */
async function markdownFiles(fs: DiscoveryFs, dir: string): Promise<{ path: string; file: string; sub: string[] }[]> {
  const visited = new Set<string>();
  const out: { path: string; file: string; sub: string[] }[] = [];
  const walk = async (current: string, sub: string[], depth: number): Promise<void> => {
    const real = (await fs.realpath(current)) ?? current;
    if (visited.has(real)) return;
    visited.add(real);
    for (const entry of (await fs.readdir(current)).sort()) {
      if (entry.startsWith(".")) continue;
      const path = `${current}/${entry}`;
      const st = await fs.stat(path);
      if (!st) continue;
      if (st.isDirectory) {
        if (depth < MAX_DEPTH) await walk(path, [...sub, entry], depth + 1);
      } else if (st.isFile && entry.endsWith(".md")) {
        out.push({ path, file: entry.slice(0, -3), sub });
      }
    }
  };
  await walk(dir, [], 0);
  return out;
}

async function agentsIn(
  fs: DiscoveryFs,
  parse: YamlParse,
  dir: string,
  source: LaunchSource,
  prefix?: string,
): Promise<LaunchEntry[]> {
  const out: LaunchEntry[] = [];
  for (const { path, file, sub } of await markdownFiles(fs, dir)) {
    const text = await fs.readFile(path);
    if (text === null) continue;
    const { fields } = readFrontmatter(text, parse);
    const base = fields.name || file;
    // Eigene Agents: der Ordner ist keine Namensraum. Plugin-Agents: plugin:ordner:name.
    const name = prefix === undefined ? base : [prefix, ...sub, base].join(":");
    out.push({ kind: "agent", name, description: oneLine(fields.description), source, path });
  }
  return out;
}

async function commandsIn(
  fs: DiscoveryFs,
  parse: YamlParse,
  dir: string,
  source: LaunchSource,
  flatPrefix?: string,
): Promise<LaunchEntry[]> {
  const out: LaunchEntry[] = [];
  for (const { path, file, sub } of await markdownFiles(fs, dir)) {
    if (flatPrefix !== undefined && sub.length > 0) continue;
    const text = await fs.readFile(path);
    if (text === null) continue;
    const { fields } = readFrontmatter(text, parse);
    const name = flatPrefix !== undefined ? `${flatPrefix}:${file}` : [...sub, file].join(":");
    out.push({ kind: "command", name, description: oneLine(fields.description), source, path });
  }
  return out;
}

/** Skills, Agents und Commands von der Platte, frisch bei jedem Aufruf. */
export async function discover(
  fs: DiscoveryFs,
  roots: DiscoveryRoots,
  parse: YamlParse,
): Promise<{ skills: LaunchEntry[]; agents: LaunchEntry[]; commands: LaunchEntry[] }> {
  const { home, vault } = roots;
  const project = roots.project && roots.project !== vault ? roots.project : null;
  const plugins = parsePlugins(
    await fs.readFile(`${home}/.claude/plugins/installed_plugins.json`),
    await fs.readFile(`${home}/.claude/settings.json`),
    roots,
  );

  const pluginSkills: LaunchEntry[] = [];
  const pluginAgents: LaunchEntry[] = [];
  const pluginCommands: LaunchEntry[] = [];
  for (const { name, installPath } of plugins) {
    const skillsDir = `${installPath}/skills`;
    if ((await fs.stat(skillsDir))?.isDirectory) {
      pluginSkills.push(...(await skillsIn(fs, parse, skillsDir, "plugin", `${name}:`)));
    } else {
      // Ohne skills/-Ordner, aber SKILL.md im Plugin-Root: ein einzelner Skill.
      const solo = await readSkill(fs, parse, installPath, name, "plugin", `${name}:`);
      if (solo) pluginSkills.push(solo);
    }
    pluginAgents.push(...(await agentsIn(fs, parse, `${installPath}/agents`, "plugin", name)));
    pluginCommands.push(...(await commandsIn(fs, parse, `${installPath}/commands`, "plugin", name)));
  }

  const skills = dedupe([
    ...(await skillsIn(fs, parse, `${home}/.claude/skills`, "user")),
    ...(await skillsIn(fs, parse, `${vault}/.claude/skills`, "vault")),
    ...(project ? await skillsIn(fs, parse, `${project}/.claude/skills`, "project") : []),
    ...pluginSkills,
  ]);

  const agents = dedupe([
    ...(project ? await agentsIn(fs, parse, `${project}/.claude/agents`, "project") : []),
    ...(await agentsIn(fs, parse, `${vault}/.claude/agents`, "vault")),
    ...(await agentsIn(fs, parse, `${home}/.claude/agents`, "user")),
    ...pluginAgents,
  ]);

  const builtin: LaunchEntry[] = BUILTIN_COMMANDS.map(([name, description]) => ({
    kind: "command",
    name,
    description: oneLine(description),
    source: "builtin",
  }));
  const commands = dedupe([
    ...(await commandsIn(fs, parse, `${home}/.claude/commands`, "user")),
    ...(await commandsIn(fs, parse, `${vault}/.claude/commands`, "vault")),
    ...pluginCommands,
    ...builtin,
  ]);

  return { skills, agents, commands };
}
