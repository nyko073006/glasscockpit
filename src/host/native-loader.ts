import { execFile } from "child_process";
import { accessSync, chmodSync } from "fs";
import { release } from "os";
import type * as NodePty from "node-pty";
import type { App, PluginManifest } from "obsidian";
import { type ClassifiedLoadError, classifyLoadError } from "../core/load-error";
import { nativePaths, windowsBuildProblem } from "../core/shell";
import { hostTarget, vaultBasePath } from "./host-platform";

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
    execFile("xattr", ["-dr", "com.apple.quarantine", dir], { windowsHide: true }, (fehler, _stdout, stderr) => {
      resolve(fehler ? `xattr fehlgeschlagen: ${stderr.trim() || fehler.message}` : "xattr ok");
    });
  });
}

/** Alles, was der Lader vom System liest oder tut; die Vorgaben stehen in defaultDeps, Tests speisen eigene ein. */
export interface LoaderDeps {
  platform: string;
  arch: string;
  /** os.release(): Unter Windows steht die Build-Nummer darin. */
  osRelease(): string;
  access(path: string): void;
  chmod(path: string, mode: number): void;
  quarantine(dir: string): Promise<string>;
  require(id: string): unknown;
}

function defaultDeps(): LoaderDeps {
  return {
    platform: hostTarget().platform,
    arch: hostTarget().arch,
    osRelease: release,
    access: accessSync,
    chmod: chmodSync,
    quarantine: removeQuarantine,
    require: (id) => (window as unknown as { require: NodeRequire }).require(id),
  };
}

/**
 * Lädt node-pty aus native/ im Plugin-Ordner. Kein Dev-Fallback auf node_modules.
 * Ein Erfolg wird gemerkt, ein Fehler nicht: Nach npm run deploy klappt der nächste Versuch.
 */
export class NativeLoader {
  private readonly app: App;
  private readonly manifest: PluginManifest;
  private readonly deps: LoaderDeps;
  private loaded: PtyModule | null = null;

  constructor(app: App, manifest: PluginManifest, deps: Partial<LoaderDeps> = {}) {
    this.app = app;
    this.manifest = manifest;
    this.deps = { ...defaultDeps(), ...deps };
  }

  /** Ist node-pty in diesem Obsidian-Lauf schon geladen? Dann gilt ein neu heruntergeladenes Paket erst nach dem Neustart. */
  isLoaded(): boolean {
    return this.loaded !== null;
  }

  async load(): Promise<LoadResult> {
    if (this.loaded) return { ok: true, pty: this.loaded };

    const { deps } = this;
    let xattr: string | null = null;
    try {
      const base = vaultBasePath(this.app);
      if (base === null) {
        throw new Error("Der Vault liegt nicht im Dateisystem, node-pty braucht einen Plugin-Ordner auf der Platte.");
      }
      if (!this.manifest.dir) throw new Error("manifest.dir fehlt, der Plugin-Ordner ist unbekannt.");

      const paths = nativePaths(`${base}/${this.manifest.dir}`, deps.platform, deps.arch);

      // Unter Windows zuerst die Version: node-pty fiele unter Build 18309 auf winpty zurück, das nicht mitkommt.
      if (deps.platform === "win32") {
        const problem = windowsBuildProblem(deps.osRelease());
        if (problem) throw new Error(problem);
      }

      // Fehlt die Datei, wirft access ENOENT mit dem vollen Pfad.
      deps.access(paths.indexJs);
      // Quarantäne und Ausführrecht gibt es nur auf dem Mac; Windows kennt weder xattr noch chmod.
      if (deps.platform === "darwin") {
        xattr = await deps.quarantine(paths.nativeDir);
        for (const datei of paths.executables) deps.chmod(datei, 0o755);
      }

      // Erst das Binary direkt (pty.node bzw. conpty.node): Der Loader von node-pty probiert danach ./prebuilds/ und meldet nur
      // „Cannot find module“, der echte dlopen-Fehler ginge verloren. Der Modul-Cache teilt das Binary.
      deps.require(paths.binary);
      this.loaded = deps.require(paths.indexJs) as PtyModule;
      console.debug(`Glasscockpit: node-pty geladen aus ${paths.nativeDir} (${xattr ?? "ohne xattr"})`);
      return { ok: true, pty: this.loaded };
    } catch (fehler) {
      console.error("Glasscockpit: node-pty nicht geladen", fehler, xattr);
      return { ok: false, error: classifyLoadError(errorText(fehler), deps.platform === "win32" ? "win32" : "darwin"), xattr };
    }
  }
}
