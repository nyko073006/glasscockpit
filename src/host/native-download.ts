// Lädt die node-pty-Binärdateien auf Knopfdruck (Abend 26), damit das Plugin ohne ZIP aus dem Store laufen kann.
// Ablauf: Download in einen frischen Ordner im Plugin-Ordner, entpacken, den Baum OHNE Symlinks zu folgen lesen,
// gegen die festen Summen prüfen (src/core/native-verify.ts), erst bei ok tauschen. Jeder Fehler lässt native/ unverändert.
// Abhängigkeiten (Netz, Entpacken, Quarantäne, rename) sind injizierbar; der Obsidian-Teil steht in native-download-fetch.ts.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename as fsRename, rm, writeFile } from "node:fs/promises";
import { accessSync } from "node:fs";
import { join } from "node:path";
import { NATIVE_DOWNLOAD_MAX_BYTES } from "../core/constants";
import { NATIVE_CHECKSUMS } from "../core/native-checksums";
import { type FoundEntry, isSafeRelPath, nativeAssetUrl, verifyNative } from "../core/native-verify";
import { nativePaths } from "../core/shell";

export interface DownloadDeps {
  /** Lädt die Adresse (mit Zeitlimit). Wirft bei Netzfehler oder Zeitüberschreitung. */
  fetchBytes(url: string): Promise<{ status: number; bytes: Uint8Array }>;
  /** Entpackt das ZIP in einen Ordner. */
  extract(zipPath: string, destDir: string): Promise<void>;
  /** Entfernt das Quarantäne-Attribut rekursiv. Wirft bei Fehler. */
  clearQuarantine(dir: string): Promise<void>;
  /** Nur für Tests (Fehler beim Tausch). Vorgabe: fs.rename. */
  rename?: (von: string, nach: string) => Promise<void>;
}

export interface DownloadOptions {
  pluginDir: string;
  platform: string;
  arch: string;
  /** Manifest-Version; der Release-Tag ist dieselbe Zahl ohne "v". */
  version: string;
}

export type DownloadResult = { ok: true; files: number } | { ok: false; reason: string };

const BINARIES = ["pty.node", "spawn-helper"] as const;

function text(fehler: unknown): string {
  return fehler instanceof Error ? fehler.message : String(fehler);
}

function run(datei: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(datei, args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (fehler, stdout, stderr) => {
      if (fehler) reject(new Error(`${datei} fehlgeschlagen: ${stderr.trim() || fehler.message}`));
      else resolve(stdout);
    });
  });
}

/**
 * Entpackt mit dem Systemwerkzeug ditto (/usr/bin, auf jedem Mac vorhanden, fragt nie nach, übernimmt die Rechte).
 * Vorher listet unzip -Z1 die Namen: Ein Pfad nach außen (.., absolut) lehnt den ganzen Download ab, bevor etwas geschrieben wird.
 */
export async function defaultExtract(zipPath: string, destDir: string): Promise<void> {
  const namen = (await run("/usr/bin/unzip", ["-Z1", zipPath])).split("\n").filter((n) => n !== "");
  for (const name of namen) {
    if (!isSafeRelPath(name.replace(/\/$/, ""))) throw new Error(`Unzulässiger Pfad im ZIP: ${JSON.stringify(name)}`);
  }
  await mkdir(destDir, { recursive: true });
  await run("/usr/bin/ditto", ["-x", "-k", zipPath, destDir]);
}

export async function defaultClearQuarantine(dir: string): Promise<void> {
  await run("/usr/bin/xattr", ["-cr", dir]);
}

/** Liest den Baum mit lstat: Symlinks werden als Symlinks gemeldet und nie betreten oder gelesen. */
async function readTree(root: string): Promise<FoundEntry[]> {
  const liste: FoundEntry[] = [];
  const geh = async (abs: string, rel: string): Promise<void> => {
    for (const name of (await readdir(abs)).sort()) {
      const a = join(abs, name);
      const r = rel === "" ? name : `${rel}/${name}`;
      const st = await lstat(a);
      if (st.isSymbolicLink()) liste.push({ path: r, kind: "symlink" });
      else if (st.isDirectory()) {
        liste.push({ path: r, kind: "dir" });
        await geh(a, r);
      } else if (st.isFile()) {
        liste.push({ path: r, kind: "file", sha256: createHash("sha256").update(await readFile(a)).digest("hex") });
      } else liste.push({ path: r, kind: "other" });
    }
  };
  await geh(root, "");
  return liste;
}

async function exists(pfad: string): Promise<boolean> {
  try {
    await lstat(pfad);
    return true;
  } catch {
    return false;
  }
}

/** Sind die Kerndateien für diese Plattform im Plugin-Ordner da? Prüft nur das Vorhandensein, nicht die Summen. */
export function nativeInstalled(pluginDir: string, platform: string, arch: string): boolean {
  try {
    const p = nativePaths(pluginDir, platform, arch);
    for (const datei of [p.indexJs, p.ptyNode, p.spawnHelper]) accessSync(datei);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lädt und installiert native/darwin-<arch>/. Wirft nie: Fehler kommen als Ergebnis mit deutschem Grund zurück.
 * Die Summen sind fest (NATIVE_CHECKSUMS) und nicht über Optionen änderbar.
 */
export async function downloadNative(
  opt: DownloadOptions,
  deps: DownloadDeps,
  report: (schritt: string) => void = () => {},
): Promise<DownloadResult> {
  const target = `${opt.platform}-${opt.arch}`;
  let url: string;
  try {
    url = nativeAssetUrl(opt.version, target);
  } catch (fehler) {
    return { ok: false, reason: text(fehler) };
  }
  const erwartet = (NATIVE_CHECKSUMS as Record<string, Readonly<Record<string, string>>>)[target];
  if (!erwartet) return { ok: false, reason: `Keine Prüfsummen für ${target}.` };

  const nativeRoot = join(opt.pluginDir, "native");
  const ziel = join(nativeRoot, target);
  const verschiebe = deps.rename ?? fsRename;
  // Im Plugin-Ordner statt im System-Temp: gleiches Volume, damit der Tausch ein rename bleibt.
  let temp: string | null = null;
  try {
    temp = await mkdtemp(join(opt.pluginDir, ".native-download-"));
    report("Lade Binärdateien …");
    const res = await deps.fetchBytes(url);
    if (res.status !== 200) return { ok: false, reason: `Download fehlgeschlagen: HTTP ${res.status} (${url})` };
    if (res.bytes.length === 0) return { ok: false, reason: "Download ist leer." };
    if (res.bytes.length > NATIVE_DOWNLOAD_MAX_BYTES) return { ok: false, reason: "Download ist zu groß, abgebrochen." };

    const zip = join(temp, "native.zip");
    const entpackt = join(temp, "entpackt");
    await writeFile(zip, res.bytes);
    report("Entpacke …");
    await deps.extract(zip, entpackt);

    report("Prüfe Prüfsummen …");
    const baum = await readTree(entpackt);
    const pruefung = verifyNative(erwartet, baum);
    if (!pruefung.ok) return { ok: false, reason: `Prüfung fehlgeschlagen, nichts installiert: ${pruefung.reason}` };

    // Vor dem Tausch: Rechte und Quarantäne am geprüften Baum. Scheitert das, bleibt native/ unberührt.
    for (const b of BINARIES) await chmod(join(entpackt, "prebuilds", target, b), 0o755);
    await deps.clearQuarantine(entpackt);

    report("Installiere …");
    await mkdir(nativeRoot, { recursive: true });
    const sicherung = join(temp, "alt");
    const hatAlt = await exists(ziel);
    if (hatAlt) await verschiebe(ziel, sicherung);
    try {
      await verschiebe(entpackt, ziel);
    } catch (fehler) {
      if (hatAlt) await verschiebe(sicherung, ziel);
      throw fehler;
    }
    return { ok: true, files: baum.filter((e) => e.kind === "file").length };
  } catch (fehler) {
    return { ok: false, reason: text(fehler) };
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
  }
}
