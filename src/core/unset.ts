/**
 * „Nicht eingerichtet“ (Abend 21): Kein Vorgabewert setzt ein bestimmtes Vault voraus. Ein leerer Pfad (auch nur Leerzeichen)
 * schaltet die Funktion ab; sie liefert dann diesen Zustand statt eines Fehlers, und die Karte sagt, was einzustellen ist.
 * Wichtig für die Leser: Ein leerer Ordnerpfad darf nie gelesen werden, `vault.getFolderByPath("")` liefert in Obsidian
 * die Wurzel des ganzen Vaults.
 */

/** Kurztext des Zustands. */
export const UNSET_TEXT = "nicht eingerichtet";

/** Einstellungen, die „nicht eingerichtet“ sein können, mit dem Namen auf der Einstellungsseite. */
export const UNSET_SETTING_LABEL = {
  projectsRoot: "Projektordner",
  briefingsDir: "Briefing-Ordner",
  inboxDir: "Inbox-Ordner",
  hubsDir: "Projekt-Ordner (Vault)",
  handoffsDir: "Handoff-Unterordner",
  indexFile: "Index-Datei",
  dailyDir: "Ordner der Daily Notes",
  lintCommand: "Lint-Befehl",
  radars: "Radare",
} as const;

export type UnsetKey = keyof typeof UNSET_SETTING_LABEL;

/** Leer oder nur Leerzeichen. */
export function isUnset(path: string): boolean {
  return path.trim() === "";
}

/** Hinweis für die Karte: welche Einstellung fehlt. */
export function unsetHint(key: UnsetKey): string {
  return `Nicht eingerichtet: Einstellung „${UNSET_SETTING_LABEL[key]}“ ausfüllen.`;
}

/** Kürzel für die Lampe: die ersten zwei Buchstaben des Namens groß; ohne Namen „··“. */
export function radarShort(name: string): string {
  const letters = Array.from(name.trim()).slice(0, 2).join("").toLocaleUpperCase("de");
  return letters === "" ? "··" : letters;
}

/** Kürzel aller sichtbaren Radare, innerhalb der Liste eindeutig: bei Gleichstand erster Buchstabe plus letztes Zeichen („R1“, „R2“), dann plus laufende Nummer. */
export function radarShorts(names: string[]): string[] {
  const base = names.map(radarShort);
  const first = (n: string) => Array.from(n.trim())[0]?.toLocaleUpperCase("de") ?? "·";
  const last = (n: string) => Array.from(n.trim()).slice(-1)[0]?.toLocaleUpperCase("de") ?? "·";
  const count = (list: string[], v: string) => list.filter((x) => x === v).length;
  const second = base.map((b, i) => (count(base, b) > 1 ? `${first(names[i])}${last(names[i])}` : b));
  return second.map((b, i) => (count(second, b) > 1 ? `${first(names[i])}${i + 1}` : b));
}

/** Text des Knopfes, der in die Einstellungen führt. */
export const OPEN_SETTINGS_TEXT = "Einstellungen öffnen";
/** Kurzfassung für kleine Felder; der volle Hinweis (welche Einstellung fehlt) steht im Tooltip und im Zoom. */
export const UNSET_SHORT = "aus";
