// Prüfung des heruntergeladenen node-pty-Pakets (Abend 26). Rein: bekommt die erwartete Liste und das Gefundene,
// liest selbst nichts. Zusammen mit den festen Summen in native-checksums.ts schützt sie davor, dass ein
// manipulierter oder kaputter Download in native/ landet.
// Nur der Typ: Die Release-Skripte laden diese Datei unter Node mit Typ-Entfernung, ein Laufzeit-Import bräuchte dort ".ts".
import type { Platform } from "./platform-path";

/**
 * Ziele des Downloads; gleich NATIVE_TARGETS in shell.ts (Test prüft die Gleichheit). Eigene Liste, damit
 * die Release-Skripte diese Datei ohne weitere Importe direkt unter Node laden können.
 */
export const DOWNLOAD_TARGETS = ["darwin-arm64", "darwin-x64", "win32-arm64", "win32-x64"] as const;

export type EntryKind = "file" | "symlink" | "dir" | "other";

/** Ein Eintrag im entpackten Baum; Pfad relativ zur Wurzel, mit "/" getrennt. Summe nur bei Dateien. */
export interface FoundEntry {
  path: string;
  kind: EntryKind;
  sha256?: string;
}

export type VerifyCode = "fehlt" | "zusatz" | "symlink" | "summe" | "pfad";
export type VerifyResult = { ok: true } | { ok: false; code: VerifyCode; reason: string };

/**
 * Release-Adresse. Fest im Code und keine Einstellung: Wer die Basis oder die Summen ändern könnte, könnte dem
 * Plugin beliebige Binärdateien unterschieben. Der Tag ist die Manifest-Version ohne "v".
 */
export const NATIVE_RELEASE_BASE = "https://github.com/nyko073006/glasscockpit/releases/download";

const VERSION = /^\d+\.\d+\.\d+$/;

export function nativeAssetName(target: string): string {
  if (!(DOWNLOAD_TARGETS as readonly string[]).includes(target)) throw new Error(`Unbekanntes Ziel: ${target}`);
  return `glasscockpit-native-${target}.zip`;
}

export function nativeAssetUrl(version: string, target: string): string {
  if (!VERSION.test(version)) throw new Error(`Ungültige Version für den Download: ${JSON.stringify(version)}`);
  return `${NATIVE_RELEASE_BASE}/${version}/${nativeAssetName(target)}`;
}

/** Statuszeile der Einstellungen. */
export function nativeStatusText(installed: boolean, target: string): string {
  return installed ? `Binärdateien vorhanden für ${target}.` : `Binärdateien fehlen für ${target}.`;
}

/** Relativer Pfad ohne Ausbruchsmöglichkeit: nicht leer, nicht absolut, keine Segmente "", ".", "..", kein "\\" oder NUL. */
export function isSafeRelPath(p: string): boolean {
  if (p === "" || p.startsWith("/") || /[\\\0]/.test(p)) return false;
  return p.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

/**
 * Prüft die Namensliste eines ZIPs (unzip -Z1 auf dem Mac, tar -t unter Windows) vor dem Entpacken: Jeder Name ohne
 * abschließendes "/" muss ein sicherer relativer Pfad sein, und kein Name darf einen Doppelpunkt enthalten (Laufwerk wie
 * "C:/Windows/x" oder "C:x", unter NTFS auch ein Datenstrom "datei:s"; die Pakete haben keine solchen Namen, und isSafeRelPath
 * lässt sie durch). Zeilen trennt "\n" oder "\r\n" (tar.exe schreibt CRLF), leere Zeilen zählen nicht. Liefert den Grund für
 * den ersten Verstoß, sonst null.
 */
export function zipListingProblem(stdout: string): string | null {
  for (const name of stdout.split(/\r?\n/)) {
    if (name === "") continue;
    if (name.includes(":") || !isSafeRelPath(name.replace(/\/$/, ""))) return `Unzulässiger Pfad im ZIP: ${JSON.stringify(name)}`;
  }
  return null;
}

/** Beschreibung unter dem Knopf „Binärdateien laden“, ab „Der Knopf lädt …“; die Statuszeile davor setzt der Aufrufer. */
export function nativeDownloadHint(platform: Platform, version: string): string {
  const rechner = platform === "win32" ? "diesen PC" : "diesen Mac";
  return `Der Knopf lädt einmalig die Dateien für ${rechner} von github.com/nyko073006/glasscockpit (Release ${version}) und prüft sie gegen feste SHA256-Summen im Plugin. Nichts anderes wird geladen.`;
}

/**
 * Meldung nach erfolgreichem Download. Unter Windows tauscht der Download sofort; ist node-pty in diesem Obsidian-Lauf
 * aber schon geladen, bleibt das alte Paket im Speicher und das neue gilt erst nach dem Neustart.
 */
export function downloadDoneText(files: number, platform: Platform, alreadyLoaded: boolean): string {
  if (platform === "win32" && alreadyLoaded) return `Binärdateien geladen (${files} Dateien). Obsidian neu starten, damit sie gelten.`;
  return `Binärdateien geladen (${files} Dateien). Neue Sitzungen starten jetzt.`;
}

const SHA256 = /^[0-9a-f]{64}$/;

function fail(code: VerifyCode, reason: string): VerifyResult {
  return { ok: false, code, reason };
}

/**
 * Die gefundene Dateimenge muss exakt der erwarteten Liste entsprechen: nichts fehlt, nichts kommt dazu, keine
 * Symlinks, jede Summe stimmt. Ordner sind nur erlaubt, wenn eine erwartete Datei darunter liegt.
 * Eine leere Erwartung ist nie ok, sonst bestünde ein leerer Download jede Prüfung.
 */
export function verifyNative(expected: Readonly<Record<string, string>>, found: readonly FoundEntry[]): VerifyResult {
  const erwartetePfade = Object.keys(expected);
  if (erwartetePfade.length === 0) return fail("fehlt", "Die Liste der erwarteten Dateien ist leer.");
  for (const p of erwartetePfade) {
    if (!isSafeRelPath(p)) return fail("pfad", `Ungültiger erwarteter Pfad: ${p}`);
    if (!SHA256.test(expected[p])) return fail("pfad", `Ungültige Prüfsumme in der Liste für ${p}`);
  }

  const gesehen = new Set<string>();
  for (const e of found) {
    if (!isSafeRelPath(e.path)) return fail("pfad", `Unzulässiger Pfad im Download: ${JSON.stringify(e.path)}`);
    if (gesehen.has(e.path)) return fail("pfad", `Pfad doppelt im Download: ${e.path}`);
    gesehen.add(e.path);
  }
  for (const e of found) {
    if (e.kind === "symlink") return fail("symlink", `Symlink im Download: ${e.path}`);
    if (e.kind === "other") return fail("zusatz", `Unerwarteter Dateityp im Download: ${e.path}`);
  }

  const ordnerOk = new Set<string>();
  for (const p of erwartetePfade) {
    const teile = p.split("/");
    for (let i = 1; i < teile.length; i++) ordnerOk.add(teile.slice(0, i).join("/"));
  }
  const dateien = new Map<string, FoundEntry>();
  for (const e of found) {
    if (e.kind === "dir") {
      if (!ordnerOk.has(e.path)) return fail("zusatz", `Zusätzlicher Ordner im Download: ${e.path}`);
    } else if (!Object.prototype.hasOwnProperty.call(expected, e.path)) {
      return fail("zusatz", `Zusätzliche Datei im Download: ${e.path}`);
    } else {
      dateien.set(e.path, e);
    }
  }
  for (const p of erwartetePfade) {
    const e = dateien.get(p);
    if (!e) return fail("fehlt", `Datei fehlt im Download: ${p}`);
    if (e.sha256 !== expected[p]) return fail("summe", `Prüfsumme stimmt nicht: ${p}`);
  }
  return { ok: true };
}
