import type { DiscoveryFs } from "../../src/core/discovery";

export interface FakeTree {
  files?: Record<string, string>;
  dirs?: string[];
  /** Symlink-Pfad -> Ziel (Datei oder Ordner, absolut). */
  links?: Record<string, string>;
}

/** Dateisystem im Speicher; Symlinks werden bei stat, readdir, readFile und realpath gefolgt. */
export function fakeFs(tree: FakeTree): DiscoveryFs {
  const files = tree.files ?? {};
  const links = tree.links ?? {};
  const dirs = new Set<string>(tree.dirs ?? []);
  for (const p of [...Object.keys(files), ...Object.keys(links)]) {
    for (let i = p.lastIndexOf("/"); i > 0; i = p.lastIndexOf("/", i - 1)) dirs.add(p.slice(0, i));
  }
  const resolve = (path: string): string | null => {
    let current = "";
    const rest = path.split("/").filter(Boolean);
    let hops = 0;
    while (rest.length > 0) {
      current = `${current}/${rest.shift()}`;
      while (links[current] !== undefined) {
        if (++hops > 40) return null; // Zyklus ohne Ende
        const target = links[current];
        current = "";
        rest.unshift(...target.split("/").filter(Boolean));
        break;
      }
    }
    return current || "/";
  };
  const exists = (r: string) => r in files || dirs.has(r);
  return {
    async readdir(dir) {
      const r = resolve(dir);
      if (r === null || !dirs.has(r)) return [];
      const names = new Set<string>();
      for (const p of [...Object.keys(files), ...Object.keys(links), ...dirs]) {
        const i = p.lastIndexOf("/");
        if (i >= 0 && p.slice(0, i) === r && p.length > i + 1) names.add(p.slice(i + 1));
      }
      return [...names];
    },
    async stat(path) {
      const r = resolve(path);
      if (r === null || !exists(r)) return null;
      return { isFile: r in files, isDirectory: dirs.has(r) };
    },
    async readFile(path) {
      const r = resolve(path);
      return r !== null && r in files ? files[r] : null;
    },
    async realpath(path) {
      const r = resolve(path);
      return r !== null && exists(r) ? r : null;
    },
  };
}
