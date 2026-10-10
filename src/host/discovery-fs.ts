import { readFile, readdir, realpath, stat } from "node:fs/promises";
import type { DiscoveryFs } from "../core/discovery";

/** DiscoveryFs über node:fs. stat folgt Symlinks; jeder Fehler heißt „nicht da“. */
export const nodeDiscoveryFs: DiscoveryFs = {
  async readdir(dir) {
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  },
  async stat(path) {
    try {
      const s = await stat(path);
      return { isFile: s.isFile(), isDirectory: s.isDirectory() };
    } catch {
      return null;
    }
  },
  async readFile(path) {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  },
  async realpath(path) {
    try {
      return await realpath(path);
    } catch {
      return null;
    }
  },
};
