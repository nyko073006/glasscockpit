import type { App } from "obsidian";

/**
 * Öffnet Obsidians Einstellungsdialog auf dem Tab dieses Plugins. `app.setting` ist nicht in obsidian.d.ts, aber seit
 * Jahren die übliche Methode der Plugins; deshalb nur hier und mit Rückfall: fehlt openTabById, öffnet sich der Dialog ohne Tab,
 * fehlt auch `setting`, passiert nichts (kein Wurf, der Hinweis bleibt stehen).
 */
export function openCockpitSettings(app: App, pluginId: string): void {
  const setting = (app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } }).setting;
  if (!setting) return;
  if (typeof setting.open === "function") setting.open();
  if (typeof setting.openTabById === "function") setting.openTabById(pluginId);
}
