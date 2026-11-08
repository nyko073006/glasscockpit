// Lädt die node-pty-Binärdateien auf Knopfdruck (Abend 26), damit das Plugin ohne ZIP aus dem Store laufen kann.
// Ablauf: Download in einen frischen Ordner im Plugin-Ordner, entpacken, den Baum OHNE Symlinks zu folgen lesen,
// gegen die festen Summen prüfen (src/core/native-verify.ts), erst bei ok tauschen. Jeder Fehler lässt native/ unverändert.
// Abhängigkeiten (Netz, Entpacken, Quarantäne, rename, Aufräumen) sind injizierbar; der Obsidian-Teil steht in native-download-fetch.ts.
// Abend 40: Unter Windows entpackt tar.exe, der Tausch ist derselbe rename wie auf dem Mac, und der Temp-Ordner mit dem alten
// Paket fällt nur, wenn sich zuerst alle seine .node-Dateien löschen lassen (siehe removeUnlessLoaded).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename as fsRename, rm, unlink, writeFile } from "node:fs/promises";
import { type Dirent, accessSync } from "node:fs";
import { join } from "node:path";
import { NATIVE_DOWNLOAD_MAX_BYTES } from "../core/constants";
import { NATIVE_CHECKSUMS } from "../core/native-checksums";
import { type FoundEntry, nativeAssetUrl, verifyNative, zipListingProblem } from "../core/native-verify";
import { system32Path } from "../core/platform-path";
import { nativeLayout, nativePaths } from "../core/shell";

export interface DownloadDeps {
  /** Lädt die Adresse (mit Zeitlimit). Wirft bei Netzfehler oder Zeitüberschreitung. */
  fetchBytes(url: string): Promise<{ status: number; bytes: Uint8Array }>;
  /** Entpackt das ZIP in einen Ordner. */
  extract(zipPath: string, destDir: string): Promise<void>;
  /** Entfernt das Quarantäne-Attribut rekursiv. Wirft bei Fehler. */
  clearQuarantine(dir: string): Promise<void>;
  /** Nur für Tests (Fehler beim Tausch). Vorgabe: fs.rename. */
  rename?: (von: string, nach: string) => Promise<void>;
  /** Nur für Tests (Aufräumen). Vorgabe: das echte Dateisystem. */
  cleanup?: CleanupFs;
}

export interface DownloadOptions {
  pluginDir: string;
  platform: string;
  arch: string;
  /** Manifest-Version; der Release-Tag ist dieselbe Zahl ohne "v". */
  version: string;
}

export type DownloadResult = { ok: true; files: number } | { ok: false; reason: string };

function text(fehler: unknown): string {
  return fehler instanceof Error ? fehler.message : String(fehler);
}

// windowsHide: Obsidian ist ein GUI-Prozess; ohne die Option öffnet Windows für tar.exe ein eigenes Konsolenfenster. Auf dem Mac ohne Wirkung.
function run(datei: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(datei, args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (fehler, stdout, stderr) => {
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
  const problem = zipListingProblem(await run("/usr/bin/unzip", ["-Z1", zipPath]));
  if (problem) throw new Error(problem);
  await mkdir(destDir, { recursive: true });
  await run("/usr/bin/ditto", ["-x", "-k", zipPath, destDir]);
}

/**
 * Entpackt unter Windows mit tar.exe (bsdtar, seit Windows 10 1803 unter System32), aufgerufen über den absoluten Pfad
 * <SystemRoot>\System32\tar.exe, nie über PATH. Wie auf dem Mac listet es vorher (tar -t) und lehnt den ganzen Download bei einem
 * Pfad nach außen ab, bevor etwas geschrieben wird. tar.exe trennt die Zeilen mit CRLF; das Listing prüft zipListingProblem.
 * systemRoot und run sind nur für Tests herausgeführt.
 */
export async function windowsExtract(
  zipPath: string,
  destDir: string,
  systemRoot: string | undefined = process.env.SystemRoot,
  runner: (file: string, args: string[]) => Promise<string> = run,
): Promise<void> {
  const tar = system32Path(systemRoot, "tar.exe");
  const problem = zipListingProblem(await runner(tar, ["-t", "-f", zipPath]));
  if (problem) throw new Error(problem);
  await mkdir(destDir, { recursive: true });
  await runner(tar, ["-x", "-f", zipPath, "-C", destDir]);
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
    for (const datei of p.required) accessSync(datei);
    return true;
  } catch {
    return false;
  }
}

/** Das Dateisystem des Aufräumens; Tests speisen eine Attrappe mit Protokoll ein. */
export interface CleanupFs {
  /** Alle Dateien unter dir, absolut, rekursiv; Symlinks werden nicht betreten. Ein fehlender Ordner ergibt []. */
  files(dir: string): Promise<string[]>;
  unlink(file: string): Promise<void>;
  /** Löscht den Ordner samt Inhalt (ein fehlender Ordner ist kein Fehler). */
  rmTree(dir: string): Promise<void>;
  /** Namen direkt in dir. */
  list(dir: string): Promise<string[]>;
}

function isNotFound(fehler: unknown): boolean {
  return typeof fehler === "object" && fehler !== null && (fehler as { code?: unknown }).code === "ENOENT";
}

const realCleanupFs: CleanupFs = {
  async files(dir) {
    const liste: string[] = [];
    const geh = async (abs: string): Promise<void> => {
      let eintraege: Dirent[];
      try {
        eintraege = await readdir(abs, { withFileTypes: true });
      } catch (fehler) {
        if (isNotFound(fehler)) return;
        throw fehler;
      }
      // Dirent folgt keinem Symlink: Ein Link auf einen Ordner zählt als Eintrag, nicht als Ordner.
      for (const e of eintraege) {
        if (e.isDirectory()) await geh(join(abs, e.name));
        else liste.push(join(abs, e.name));
      }
    };
    await geh(dir);
    return liste;
  },
  unlink: (datei) => unlink(datei),
  rmTree: (dir) => rm(dir, { recursive: true, force: true }),
  list: (dir) => readdir(dir),
};

/** Rest eines Downloads im Plugin-Ordner; mkdtemp hängt den Zufallsanteil an. */
const TEMP_PREFIX = ".native-download-";

/**
 * Räumt einen Download-Ordner weg, aber nur, wenn keine seiner .node-Dateien noch geladen ist. Unter Windows lässt sich eine
 * geladene .node nicht löschen; der alte Baum bleibt dann liegen. Gebraucht wird er nicht: conpty.node sucht conpty\conpty.dll
 * bei jedem Start, Resize und Kill unter dem beim Laden gemerkten Pfad, also im neuen native/<ziel> (conpty.cc, LoadConptyDll;
 * abgeleitet, nicht gemessen). Die Regel ist vorsichtig: Zuerst fallen alle .node-Dateien einzeln (nach Pfad sortiert); scheitert
 * eine, wird nichts weiter gelöscht ("in-benutzung"). Erst danach geht der ganze Ordner. Wirft nie; "in-benutzung" heißt: beim
 * nächsten Laden noch einmal versuchen. Auf dem Mac lässt sich auch eine geladene .node löschen, dort ist das Ergebnis "entfernt".
 */
export async function removeUnlessLoaded(dir: string, fs: CleanupFs = realCleanupFs): Promise<"entfernt" | "in-benutzung"> {
  try {
    const knoten = (await fs.files(dir)).filter((datei) => /\.node$/i.test(datei)).sort();
    for (const datei of knoten) await fs.unlink(datei);
    await fs.rmTree(dir);
    return "entfernt";
  } catch {
    return "in-benutzung";
  }
}

/**
 * Entfernt Reste früherer Downloads (.native-download-* direkt im Plugin-Ordner), beim Laden des Plugins. Auf dem Mac bleiben
 * sie nur nach einem Absturz mitten im Download, unter Windows auch, wenn beim Tausch node-pty geladen war. Wirft nie; ein
 * Lesefehler im Plugin-Ordner ergibt 0 und 0.
 */
export async function cleanupStaleDownloads(
  pluginDir: string,
  fs: CleanupFs = realCleanupFs,
): Promise<{ entfernt: number; inBenutzung: number }> {
  let namen: string[];
  try {
    namen = await fs.list(pluginDir);
  } catch {
    return { entfernt: 0, inBenutzung: 0 };
  }
  let entfernt = 0;
  let inBenutzung = 0;
  for (const name of namen.filter((n) => n.startsWith(TEMP_PREFIX))) {
    if ((await removeUnlessLoaded(join(pluginDir, name), fs)) === "entfernt") entfernt += 1;
    else inBenutzung += 1;
  }
  return { entfernt, inBenutzung };
}

/**
 * Lädt und installiert native/<ziel>/ (darwin-<arch> oder win32-<arch>). Wirft nie: Fehler kommen als Ergebnis mit deutschem Grund zurück.
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
    temp = await mkdtemp(join(opt.pluginDir, TEMP_PREFIX));
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
    for (const datei of nativeLayout(opt.platform, opt.arch).executables) await chmod(join(entpackt, datei), 0o755);
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
    if (temp) await removeUnlessLoaded(temp, deps.cleanup);
  }
}
