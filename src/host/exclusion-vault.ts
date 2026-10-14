import { TFolder } from "obsidian";
import { planExclusion, type ExclusionPlan, type VaultEntry } from "../core/exclusion";

// Abend 33: Obsidians ausgeschlossene Dateien aus <configDir>/app.json (Schlüssel userIgnoreFilters) und alle Vault-Pfade,
// beim Start jeder Claude-Sitzung frisch gelesen. Unlesbar: Sitzung startet trotzdem, ohne Regeln, mit Warnzeile.

export interface ExclusionVaultLike {
  configDir: string;
  adapter: { exists(path: string): Promise<boolean>; read(path: string): Promise<string> };
  getAllLoadedFiles(): Array<{ path: string }>;
}

export async function readExclusion(
  vault: ExclusionVaultLike,
  vaultAbs: string,
  s: { claudeExclusion: boolean; claudeExclusionSandbox: boolean },
): Promise<ExclusionPlan> {
  if (!s.claudeExclusion) return planExclusion({ enabled: false, sandbox: false, raw: undefined, entries: [], vaultAbs });
  const configPath = `${vault.configDir}/app.json`;
  let raw: unknown;
  let failure: string | null = null;
  try {
    if (await vault.adapter.exists(configPath)) {
      const parsed = JSON.parse(await vault.adapter.read(configPath)) as { userIgnoreFilters?: unknown } | null;
      if (parsed === null || typeof parsed !== "object") throw new Error("kein Objekt");
      raw = parsed.userIgnoreFilters;
    }
  } catch (fehler) {
    failure = fehler instanceof Error ? fehler.message : String(fehler);
  }
  // Die Wurzel ("/") bleibt drin: Ein Pfadanfang trifft "//" nie mit eigener Regel, Muster prüfen nur Dateien.
  const entries: VaultEntry[] = vault.getAllLoadedFiles().map((f) => ({ path: f.path, folder: f instanceof TFolder }));
  return planExclusion({ enabled: true, sandbox: s.claudeExclusionSandbox, raw, entries, vaultAbs, failure });
}
