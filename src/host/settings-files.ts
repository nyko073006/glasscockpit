import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { win32 } from "node:path";

/** Die Dateisystem-Aufrufe, die SettingsFiles braucht (synchron); in Tests ein Fake. */
export interface SettingsFs {
  mkdirSync(path: string, opts: { recursive: true }): void;
  writeFileSync(path: string, data: string): void;
  renameSync(from: string, to: string): void;
  rmSync(path: string, opts: { force: true }): void;
  readdirSync(path: string): string[];
}

const REAL_FS: SettingsFs = {
  mkdirSync: (path, opts) => void mkdirSync(path, opts),
  writeFileSync: (path, data) => writeFileSync(path, data, "utf8"),
  renameSync,
  rmSync,
  readdirSync: (path) => readdirSync(path),
};

const SUBDIR = ".sessions";
const SUFFIX = ".settings.json";
/** Dateien dieser Klasse: <id>.settings.json und Reste einer abgebrochenen Schreibung (<id>.settings.json.<pid>.tmp). */
const OWN_FILE = /\.settings\.json(\.\d+\.tmp)?$/;

/**
 * Settings-Datei je Claude-Sitzung unter Windows (Abend 41): `<dir>\.sessions\<claudeId>.settings.json`, Pfade immer in
 * Windows-Schreibweise. Beim Start geschrieben (überschreibt), beim Stoppen gelöscht, beim Laden und Entladen ganz geleert.
 * dir null = kein Plugin-Ordner auf der Festplatte: write gibt null, remove und clear tun nichts.
 */
export class SettingsFiles {
  private readonly dir: string | null;
  private readonly fs: SettingsFs;

  constructor(dir: string | null, fs: SettingsFs = REAL_FS) {
    this.dir = dir;
    this.fs = fs;
  }

  private folder(): string | null {
    return this.dir === null ? null : win32.join(this.dir, SUBDIR);
  }

  /** Schreibt atomar (temporäre Datei, dann rename) und gibt den Pfad zurück; null ohne Ordner. Dateisystemfehler gehen an den Aufrufer. */
  write(claudeId: string, json: string): string | null {
    const folder = this.folder();
    if (folder === null) return null;
    const path = win32.join(folder, `${claudeId}${SUFFIX}`);
    const tmp = `${path}.${process.pid}.tmp`;
    this.fs.mkdirSync(folder, { recursive: true });
    try {
      this.fs.writeFileSync(tmp, json);
      this.fs.renameSync(tmp, path);
    } catch (fehler) {
      try {
        this.fs.rmSync(tmp, { force: true });
      } catch {
        // Aufräumen ist nur ein Versuch; der erste Fehler zählt.
      }
      throw fehler;
    }
    return path;
  }

  /** Löscht die Datei der Sitzung; fehlt sie oder scheitert das Löschen, passiert nichts. */
  remove(claudeId: string): void {
    const folder = this.folder();
    if (folder === null) return;
    try {
      this.fs.rmSync(win32.join(folder, `${claudeId}${SUFFIX}`), { force: true });
    } catch {
      // Eine liegen gebliebene Datei räumt clear() beim nächsten Laden weg.
    }
  }

  /** Löscht alle Settings-Dateien im Unterordner .sessions, sonst nichts. */
  clear(): void {
    const folder = this.folder();
    if (folder === null) return;
    let names: string[];
    try {
      names = this.fs.readdirSync(folder);
    } catch {
      return;
    }
    for (const name of names) {
      if (!OWN_FILE.test(name)) continue;
      try {
        this.fs.rmSync(win32.join(folder, name), { force: true });
      } catch {
        // weiter mit den anderen
      }
    }
  }
}
