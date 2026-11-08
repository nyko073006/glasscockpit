// Die einzige Stelle im Plugin, die process.platform und getBasePath() liest (Abend 42, M4). Der Kern bekommt die
// Plattform und den Vault-Pfad als Parameter; test/platform-source.test.ts hält das fest.
import { realpathSync } from "node:fs";
import { type App, FileSystemAdapter } from "obsidian";
import { asPlatform, type Platform } from "../core/platform-path";

/** Plattform dieses Rechners; alles außer win32 und darwin zählt als darwin (wie bisher). */
export function hostPlatform(): Platform {
  return asPlatform(process.platform) ?? "darwin";
}

/** Plattform und Architektur roh, wie process sie liefert (für nativeInstalled und nativeLayout, die auch "linux" kennen müssen). */
export function hostTarget(): { platform: string; arch: string } {
  return { platform: process.platform, arch: process.arch };
}

/**
 * Basispfad des Vaults, null wenn der Vault nicht im Dateisystem liegt. getBasePath() liefert unter Windows 8.3-Kurznamen
 * (C:\Users\JRGENM~1\…), Terminal, Claude und homedir() aber Langnamen: unter win32 also realpath.native, bei Fehler der
 * Rohwert. Auf dem Mac der Rohwert ohne Aufruf.
 */
export function vaultBasePath(
  app: App,
  platform: Platform = hostPlatform(),
  realpath: (p: string) => string = realpathSync.native,
): string | null {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  const raw = adapter.getBasePath();
  if (platform !== "win32") return raw;
  try {
    const real = realpath(raw);
    return keepsDrive(raw, real) ? real : raw;
  } catch (fehler) {
    // Gewollt: der Rohwert gilt weiter. Aber nicht ohne Spur, sonst bliebe ein 8.3-Kurzname im Pfad unerklärt.
    console.warn(`Glasscockpit: Vault-Pfad nicht aufgelöst, der Rohwert gilt (${raw}): ${fehler instanceof Error ? fehler.message : String(fehler)}`);
    return raw;
  }
}

/**
 * realpath.native macht aus einem gemappten Laufwerk (Z:\V) den Netzwerkpfad (\\srv\share\V), Claude sieht aber Z:\…, und nur
 * Laufwerkspfade bekommen Ausschluss-Regeln. Beginnt der Rohwert mit einem Laufwerksbuchstaben, muss das Ergebnis denselben
 * tragen (Groß-/Kleinschreibung egal), sonst bleibt der Rohwert. Der 8.3-Kurzname wird so weiter zum Langnamen (gleiche Wurzel).
 */
function keepsDrive(raw: string, real: string): boolean {
  const drive = /^([A-Za-z]):/.exec(raw);
  if (!drive) return true;
  const after = /^([A-Za-z]):/.exec(real);
  return after !== null && after[1].toLowerCase() === drive[1].toLowerCase();
}
