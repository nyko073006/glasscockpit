import { type App, FileSystemAdapter, type PluginManifest, requestUrl } from "obsidian";
import { NATIVE_DOWNLOAD_TIMEOUT_MS } from "../core/constants";
import { defaultClearQuarantine, defaultExtract, type DownloadDeps } from "./native-download";

/** Die einzige Stelle, die für den Binär-Download ins Netz geht: requestUrl mit Zeitlimit (nie fetch). */
async function fetchBytes(url: string): Promise<{ status: number; bytes: Uint8Array }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Zeitüberschreitung nach ${NATIVE_DOWNLOAD_TIMEOUT_MS / 1000} s`)), NATIVE_DOWNLOAD_TIMEOUT_MS);
    });
    const res = await Promise.race([requestUrl({ url, method: "GET", throw: false }), limit]);
    return { status: res.status, bytes: new Uint8Array(res.arrayBuffer) };
  } catch (fehler) {
    const msg = fehler instanceof Error ? fehler.message : String(fehler);
    throw new Error(msg.startsWith("Zeitüberschreitung") ? msg : `Kein Netz: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

export const REAL_DOWNLOAD_DEPS: DownloadDeps = {
  fetchBytes,
  extract: defaultExtract,
  clearQuarantine: defaultClearQuarantine,
};

/** Absoluter Plugin-Ordner, oder null, wenn der Vault nicht im Dateisystem liegt. */
export function pluginDirOf(app: App, manifest: PluginManifest): string | null {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter) || !manifest.dir) return null;
  return `${adapter.getBasePath()}/${manifest.dir}`;
}
