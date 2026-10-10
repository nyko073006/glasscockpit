import { execFile } from "child_process";
import { accessSync, chmodSync } from "fs";
import type * as NodePty from "node-pty";
import { type App, FileSystemAdapter, type PluginManifest } from "obsidian";
import { type ClassifiedLoadError, classifyLoadError } from "../core/load-error";
import { nativePaths } from "../core/shell";

export type PtyModule = typeof NodePty;

export type LoadResult =
  | { ok: true; pty: PtyModule }
  | { ok: false; error: ClassifiedLoadError; xattr: string | null };

type NodeRequire = (id: string) => unknown;

export function errorText(fehler: unknown): string {
  return fehler instanceof Error ? fehler.message : String(fehler);
}

/** Quarantäne-Attribut rekursiv entfernen. Liefert das Ergebnis als Text, wirft nie. */
function removeQuarantine(dir: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("xattr", ["-dr", "com.apple.quarantine", dir], (fehler, _stdout, stderr) => {
      resolve(fehler ? `xattr fehlgeschlagen: ${stderr.trim() || fehler.message}` : "xattr ok");
    });
  });
}

/**
 * Lädt node-pty aus native/ im Plugin-Ordner. Kein Dev-Fallback auf node_modules.
 * Ein Erfolg wird gemerkt, ein Fehler nicht: Nach npm run deploy klappt der nächste Versuch.
 */
export class NativeLoader {
  private readonly app: App;
  private readonly manifest: PluginManifest;
  private loaded: PtyModule | null = null;

  constructor(app: App, manifest: PluginManifest) {
    this.app = app;
    this.manifest = manifest;
  }

  async load(): Promise<LoadResult> {
    if (this.loaded) return { ok: true, pty: this.loaded };

    let xattr: string | null = null;
    try {
      const adapter = this.app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter)) {
        throw new Error("Der Vault liegt nicht im Dateisystem, node-pty braucht einen Plugin-Ordner auf der Platte.");
      }
      if (!this.manifest.dir) throw new Error("manifest.dir fehlt, der Plugin-Ordner ist unbekannt.");

      const paths = nativePaths(`${adapter.getBasePath()}/${this.manifest.dir}`, process.platform, process.arch);

      // Fehlt die Datei, wirft accessSync ENOENT mit dem vollen Pfad.
      accessSync(paths.indexJs);
      xattr = await removeQuarantine(paths.nativeDir);
      chmodSync(paths.ptyNode, 0o755);
      chmodSync(paths.spawnHelper, 0o755);

      const req = (window as unknown as { require: NodeRequire }).require;
      // Erst pty.node direkt: Der Loader von node-pty probiert danach ./prebuilds/ und meldet nur
      // „Cannot find module“, der echte dlopen-Fehler ginge verloren. Der Modul-Cache teilt das Binary.
      req(paths.ptyNode);
      this.loaded = req(paths.indexJs) as PtyModule;
      console.info(`Glasscockpit: node-pty geladen aus ${paths.nativeDir} (${xattr})`);
      return { ok: true, pty: this.loaded };
    } catch (fehler) {
      console.error("Glasscockpit: node-pty nicht geladen", fehler, xattr);
      return { ok: false, error: classifyLoadError(errorText(fehler)), xattr };
    }
  }
}
