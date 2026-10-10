import { readFrontmatter, type YamlParse } from "../core/frontmatter";
import { expandHome, newestOpen, sortHandoffs, type HandoffSource, type OpenHandoff } from "../core/handoffs";
import { isUnset } from "../core/unset";

type Entry = { name: string; path: string; extension?: string };
export interface HandoffVaultLike {
  getFolderByPath(path: string): { children: Entry[] } | null;
  cachedRead(file: { name: string; path: string }): Promise<string>;
}

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Offene Handoffs aller Projekte unter hubsDir (Abend 19h). Leere Einstellung: nichts lesen (leerer Pfad = Vault-Wurzel). */
export async function readOpenHandoffs(vault: HandoffVaultLike, s: { hubsDir: string; handoffsDir: string; hubSuffix: string }, parse: YamlParse, home: string): Promise<{ items: OpenHandoff[]; errors: string[] }> {
  if (isUnset(s.hubsDir) || isUnset(s.handoffsDir)) return { items: [], errors: [] };
  const items: OpenHandoff[] = [];
  const errors: string[] = [];
  for (const folder of vault.getFolderByPath(s.hubsDir)?.children ?? []) {
    if (folder.extension !== undefined) continue;
    const children = vault.getFolderByPath(folder.path)?.children ?? [];
    const hub = children.find((c) => c.extension === "md" && c.name.endsWith(s.hubSuffix));
    if (!hub) continue;
    let repoRaw = "";
    try { repoRaw = readFrontmatter(await vault.cachedRead(hub), parse).fields.repo ?? ""; }
    catch (e) { errors.push(`HUB nicht lesbar: ${hub.path} (${describe(e)})`); continue; }
    const repo = repoRaw.trim() === "" ? null : expandHome(repoRaw.trim(), home);
    const files: HandoffSource[] = [];
    for (const f of vault.getFolderByPath(`${folder.path}/${s.handoffsDir.trim()}`)?.children ?? []) {
      if (f.extension !== "md") continue;
      try { files.push({ path: f.path, name: f.name, text: await vault.cachedRead(f) }); }
      catch (e) { errors.push(`Handoff nicht lesbar: ${f.path} (${describe(e)})`); }
    }
    const r = newestOpen(folder.name, repo, files, parse);
    errors.push(...r.errors);
    if (r.item) items.push(r.item);
  }
  return { items: sortHandoffs(items), errors };
}
