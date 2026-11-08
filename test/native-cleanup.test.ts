import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CleanupFs, cleanupStaleDownloads, removeUnlessLoaded } from "../src/host/native-download";
import { ON_WINDOWS } from "./helpers/platform";

// Aufräumen alter Download-Ordner (Abend 40, Task 3): Ein Ordner wird nur gelöscht, wenn sich zuerst alle seine
// .node-Dateien löschen lassen. Eine geladene conpty.node lässt sich unter Windows nicht löschen; der alte Baum bleibt dann
// liegen. Gebraucht wird er nicht (conpty.node sucht conpty.dll im neuen native/<ziel>, abgeleitet aus conpty.cc); einzeln
// fallen nur die .node-Dateien, conpty.dll und OpenConsole.exe erst mit dem ganzen Ordner (vorsichtige Regel, unschädlich).
// Alle Pfade über join(): Der Test läuft auch unter Windows (Task 7).

const T = "win32-x64";
const eperm = (): Error => Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });

interface FakeOptionen {
  /** Dateien je Ordner, in der Reihenfolge, die `files` liefert (bewusst unsortiert). */
  files?: Record<string, string[]>;
  /** Dateien, deren unlink wirft (geladen). */
  geladen?: string[];
  rmTreeWirft?: boolean;
  listWirft?: boolean;
  list?: string[];
}

function fakeFs(opt: FakeOptionen = {}): { fs: CleanupFs; protokoll: string[] } {
  const protokoll: string[] = [];
  const fs: CleanupFs = {
    files: async (dir) => {
      protokoll.push(`files ${dir}`);
      return [...(opt.files?.[dir] ?? [])];
    },
    unlink: async (datei) => {
      protokoll.push(`unlink ${datei}`);
      if (opt.geladen?.includes(datei)) throw eperm();
    },
    rmTree: async (dir) => {
      protokoll.push(`rmTree ${dir}`);
      if (opt.rmTreeWirft) throw eperm();
    },
    list: async (dir) => {
      protokoll.push(`list ${dir}`);
      if (opt.listWirft) throw new Error("EACCES");
      return opt.list ?? [];
    },
  };
  return { fs, protokoll };
}

const DIR = join("/plugin", ".native-download-x");
const pfad = (...teile: string[]): string => join(DIR, ...teile);
const PB = ["alt", "prebuilds", T];
/** Der Baum eines alten win32-Pakets, dazu Dateien, die nur fast auf „.node“ enden. */
const BAUM = [
  pfad("alt", "lib", "index.js"),
  pfad(...PB, "conpty_console_list.node"),
  pfad(...PB, "conpty", "conpty.dll"),
  pfad(...PB, "conpty.node"),
  pfad(...PB, "conpty", "OpenConsole.exe"),
  pfad("alt", "lib", "node"),
  pfad("alt", "notizen.node.txt"),
  pfad("alt", "package.json"),
  pfad("native.zip"),
];

describe("Abend 40 (3): removeUnlessLoaded", () => {
  it("(a) alles löschbar: nur die .node-Dateien einzeln in Pfadreihenfolge, dann der ganze Baum", async () => {
    const { fs, protokoll } = fakeFs({ files: { [DIR]: BAUM } });
    await expect(removeUnlessLoaded(DIR, fs)).resolves.toBe("entfernt");
    expect(protokoll).toEqual([
      `files ${DIR}`,
      `unlink ${pfad(...PB, "conpty.node")}`,
      `unlink ${pfad(...PB, "conpty_console_list.node")}`,
      `rmTree ${DIR}`,
    ]);
  });

  it("(a) die Endung zählt ohne Groß-/Kleinschreibung", async () => {
    const gross = pfad("alt", "PTY.NODE");
    const { fs, protokoll } = fakeFs({ files: { [DIR]: [pfad("alt", "x.dll"), gross] } });
    await expect(removeUnlessLoaded(DIR, fs)).resolves.toBe("entfernt");
    expect(protokoll).toEqual([`files ${DIR}`, `unlink ${gross}`, `rmTree ${DIR}`]);
  });

  it("(a) ein Ordner ohne .node-Dateien wird einfach entfernt", async () => {
    const { fs, protokoll } = fakeFs({ files: { [DIR]: [pfad("native.zip")] } });
    await expect(removeUnlessLoaded(DIR, fs)).resolves.toBe("entfernt");
    expect(protokoll).toEqual([`files ${DIR}`, `rmTree ${DIR}`]);
  });

  it("(b) die geladene conpty.node lässt sich nicht löschen: in-benutzung, danach wird nichts mehr angefasst", async () => {
    const geladen = pfad(...PB, "conpty.node");
    const { fs, protokoll } = fakeFs({ files: { [DIR]: BAUM }, geladen: [geladen] });
    await expect(removeUnlessLoaded(DIR, fs)).resolves.toBe("in-benutzung");
    // Genau ein unlink (der gescheiterte), kein weiterer, kein rmTree.
    expect(protokoll).toEqual([`files ${DIR}`, `unlink ${geladen}`]);
    // conpty.dll und OpenConsole.exe werden nie genannt: Einzeln fallen nur die .node-Dateien, der Rest erst mit dem Ordner.
    expect(protokoll.join("\n")).not.toMatch(/\.(dll|exe)\b/i);
  });

  it("(b) scheitert erst die zweite .node, bleibt der Ordner liegen und rmTree läuft nicht", async () => {
    const zweite = pfad(...PB, "conpty_console_list.node");
    const { fs, protokoll } = fakeFs({ files: { [DIR]: BAUM }, geladen: [zweite] });
    await expect(removeUnlessLoaded(DIR, fs)).resolves.toBe("in-benutzung");
    expect(protokoll.some((p) => p.startsWith("rmTree"))).toBe(false);
  });

  it("(c) wirft rmTree, ist das Ergebnis in-benutzung und nichts wirft", async () => {
    const { fs, protokoll } = fakeFs({ files: { [DIR]: BAUM }, rmTreeWirft: true });
    await expect(removeUnlessLoaded(DIR, fs)).resolves.toBe("in-benutzung");
    expect(protokoll.at(-1)).toBe(`rmTree ${DIR}`);
  });

  it("wirft auch files, ist das Ergebnis in-benutzung und der Ordner bleibt unberührt", async () => {
    const protokoll: string[] = [];
    const fs: CleanupFs = {
      files: async () => {
        throw new Error("EACCES");
      },
      unlink: async (d) => void protokoll.push(`unlink ${d}`),
      rmTree: async (d) => void protokoll.push(`rmTree ${d}`),
      list: async () => [],
    };
    await expect(removeUnlessLoaded(DIR, fs)).resolves.toBe("in-benutzung");
    expect(protokoll).toEqual([]);
  });
});

describe("Abend 40 (3): cleanupStaleDownloads", () => {
  const PLUGIN = "/plugin";
  const A = join(PLUGIN, ".native-download-a");
  const B = join(PLUGIN, ".native-download-b");
  const nodeA = join(A, "alt", "conpty.node");
  const nodeB = join(B, "alt", "conpty.node");

  it("(d) räumt nur .native-download-* direkt im Plugin-Ordner auf und zählt beide Ausgänge", async () => {
    const { fs, protokoll } = fakeFs({
      list: [".native-download-a", ".native-download-b", "native", "main.js"],
      files: { [A]: [nodeA], [B]: [nodeB] },
      geladen: [nodeB],
    });
    await expect(cleanupStaleDownloads(PLUGIN, fs)).resolves.toEqual({ entfernt: 1, inBenutzung: 1 });
    expect(protokoll).toEqual([
      `list ${PLUGIN}`,
      `files ${A}`,
      `unlink ${nodeA}`,
      `rmTree ${A}`,
      `files ${B}`,
      `unlink ${nodeB}`,
    ]);
    // native/ und main.js bleiben unberührt
    expect(protokoll.join("\n")).not.toContain(join(PLUGIN, "native"));
    expect(protokoll.join("\n")).not.toContain("main.js");
  });

  it("(d) ein Eintrag, dessen Name nur etwas Ähnliches enthält, zählt nicht", async () => {
    const { fs, protokoll } = fakeFs({ list: ["native-download-a", "x.native-download-b", ".native-download"] });
    await expect(cleanupStaleDownloads(PLUGIN, fs)).resolves.toEqual({ entfernt: 0, inBenutzung: 0 });
    expect(protokoll).toEqual([`list ${PLUGIN}`]);
  });

  it("(d) ohne Reste nichts zu tun", async () => {
    const { fs } = fakeFs({ list: ["native", "main.js", "manifest.json"] });
    await expect(cleanupStaleDownloads(PLUGIN, fs)).resolves.toEqual({ entfernt: 0, inBenutzung: 0 });
  });

  it("(d) ein Lesefehler im Plugin-Ordner ergibt 0 und 0, ohne zu werfen", async () => {
    const { fs, protokoll } = fakeFs({ listWirft: true });
    await expect(cleanupStaleDownloads(PLUGIN, fs)).resolves.toEqual({ entfernt: 0, inBenutzung: 0 });
    expect(protokoll).toEqual([`list ${PLUGIN}`]);
  });
});

describe("Abend 40 (3): das echte Dateisystem hinter dem Aufräumen", () => {
  const angelegt: string[] = [];
  const gesperrt: string[] = [];
  function temp(): string {
    const d = mkdtempSync(join(tmpdir(), "glasscockpit-cleanup-"));
    angelegt.push(d);
    return d;
  }
  function datei(wurzel: string, ...teile: string[]): string {
    const p = join(wurzel, ...teile);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "x");
    return p;
  }
  afterEach(() => {
    for (const d of gesperrt.splice(0)) chmodSync(d, 0o755);
    for (const d of angelegt.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  // Unter Windows gibt es keine Ordnerrechte wie hier, und als root sperrt chmod nichts.
  const rechte = process.platform !== "win32" && process.getuid?.() !== 0;

  it("entfernt einen ganzen Baum samt Unterordnern und .node-Dateien", async () => {
    const dir = join(temp(), ".native-download-x");
    datei(dir, "alt", "prebuilds", T, "conpty.node");
    datei(dir, "alt", "prebuilds", T, "conpty", "conpty.dll");
    datei(dir, "alt", "lib", "index.js");
    datei(dir, "native.zip");
    await expect(removeUnlessLoaded(dir)).resolves.toBe("entfernt");
    expect(existsSync(dir)).toBe(false);
  });

  it("ein Ordner, den es nicht gibt, ist nichts zu tun", async () => {
    await expect(removeUnlessLoaded(join(temp(), "gibt-es-nicht"))).resolves.toBe("entfernt");
  });

  // Windows: Symlink anlegen (neuer Test aus Abend 40, Task 3, ohne Inventur-ID)
  it.skipIf(ON_WINDOWS)("folgt keinem Symlink: Dateien außerhalb bleiben", async () => {
    const wurzel = temp();
    const draussen = join(wurzel, "draussen");
    const fremd = datei(draussen, "fremd.node");
    const dir = join(wurzel, ".native-download-x");
    datei(dir, "alt", "x.txt");
    symlinkSync(draussen, join(dir, "alt", "link"));
    await expect(removeUnlessLoaded(dir)).resolves.toBe("entfernt");
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(fremd)).toBe(true);
  });

  it.skipIf(!rechte)("eine .node, die sich nicht löschen lässt: in-benutzung, und alles Übrige bleibt unversehrt", async () => {
    const dir = join(temp(), ".native-download-x");
    // Die .node liegt in einem gesperrten Ordner neben conpty/ (nicht darin): Ein bloßes rm -r würde conpty.dll und
    // OpenConsole.exe trotzdem löschen und erst danach an der .node scheitern. Das Aufräumen darf sie nie anfassen.
    const knoten = datei(dir, "alt", "prebuilds", "gesperrt", "conpty.node");
    const dll = datei(dir, "alt", "prebuilds", "conpty", "conpty.dll");
    const exe = datei(dir, "alt", "prebuilds", "conpty", "OpenConsole.exe");
    const gesperrterOrdner = dirname(knoten);
    chmodSync(gesperrterOrdner, 0o555);
    gesperrt.push(gesperrterOrdner);
    await expect(removeUnlessLoaded(dir)).resolves.toBe("in-benutzung");
    for (const p of [knoten, dll, exe]) expect(existsSync(p), p).toBe(true);
  });

  it("cleanupStaleDownloads: räumt nur .native-download-* weg, native/ und main.js bleiben", async () => {
    const plugin = temp();
    datei(plugin, ".native-download-a", "alt", "pty.node");
    datei(plugin, ".native-download-b", "native.zip");
    datei(plugin, "native", T, "lib", "index.js");
    datei(plugin, "main.js");
    await expect(cleanupStaleDownloads(plugin)).resolves.toEqual({ entfernt: 2, inBenutzung: 0 });
    expect(readdirSync(plugin).sort()).toEqual(["main.js", "native"]);
    expect(existsSync(join(plugin, "native", T, "lib", "index.js"))).toBe(true);
  });

  it("cleanupStaleDownloads: ein Plugin-Ordner, den es nicht gibt, ergibt 0 und 0", async () => {
    await expect(cleanupStaleDownloads(join(temp(), "gibt-es-nicht"))).resolves.toEqual({ entfernt: 0, inBenutzung: 0 });
  });
});
