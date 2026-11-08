import { win32 } from "node:path";
import type { SettingsFs } from "../../src/host/settings-files";

/** Dateisystem im Speicher für SettingsFiles; Pfade wie geschrieben (Windows-Schreibweise mit "\\"). */
export function fakeSettingsFs(): { fs: SettingsFs; files: Map<string, string>; dirs: Set<string>; calls: string[] } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const calls: string[] = [];
  const fs: SettingsFs = {
    mkdirSync(path) {
      calls.push(`mkdir ${path}`);
      dirs.add(path);
    },
    writeFileSync(path, data) {
      calls.push(`write ${path}`);
      files.set(path, data);
    },
    renameSync(from, to) {
      calls.push(`rename ${from} ${to}`);
      const data = files.get(from);
      if (data === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      files.delete(from);
      files.set(to, data);
    },
    rmSync(path) {
      calls.push(`rm ${path}`);
      files.delete(path);
    },
    readdirSync(path) {
      calls.push(`readdir ${path}`);
      if (!dirs.has(path) && ![...files.keys()].some((f) => win32.dirname(f) === path)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return [...files.keys()].filter((f) => win32.dirname(f) === path).map((f) => win32.basename(f));
    },
  };
  return { fs, files, dirs, calls };
}
