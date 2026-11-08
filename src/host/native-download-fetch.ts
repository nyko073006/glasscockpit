import { type App, type PluginManifest, requestUrl } from "obsidian";
import { NATIVE_DOWNLOAD_TIMEOUT_MS } from "../core/constants";
import type { Platform } from "../core/platform-path";
import { vaultBasePath } from "./host-platform";
import { defaultClearQuarantine, defaultExtract, type DownloadDeps, windowsExtract } from "./native-download";

/** Die einzige Stelle, die für den Binär-Download ins Netz geht: requestUrl mit Zeitlimit (nie fetch). */
async function fetchBytes(url: string): Promise<{ status: number; bytes: Uint8Array }> {
  let timer: number | undefined;
  try {
    const limit = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`Zeitüberschreitung nach ${NATIVE_DOWNLOAD_TIMEOUT_MS / 1000} s`)), NATIVE_DOWNLOAD_TIMEOUT_MS);
    });
    const res = await Promise.race([requestUrl({ url, method: "GET", throw: false }), limit]);
    return { status: res.status, bytes: new Uint8Array(res.arrayBuffer) };
  } catch (fehler) {
    const msg = fehler instanceof Error ? fehler.message : String(fehler);
    throw new Error(msg.startsWith("Zeitüberschreitung") ? msg : `Kein Netz: ${msg}`);
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Die echten Abhängigkeiten des Downloads je Plattform. Mac: ditto und xattr. Windows: tar.exe und kein Quarantäne-Schritt
 * (es gibt dort kein xattr, und die Bytes schreibt das Plugin selbst, nicht ein Browser).
 */
export function realDownloadDeps(platform: Platform): DownloadDeps {
  if (platform === "win32") return { fetchBytes, extract: windowsExtract, clearQuarantine: async () => {} };
  return { fetchBytes, extract: defaultExtract, clearQuarantine: defaultClearQuarantine };
}

/** Absoluter Plugin-Ordner, oder null, wenn der Vault nicht im Dateisystem liegt. */
export function pluginDirOf(app: App, manifest: PluginManifest): string | null {
  const base = vaultBasePath(app);
  if (base === null || !manifest.dir) return null;
  return `${base}/${manifest.dir}`;
}
