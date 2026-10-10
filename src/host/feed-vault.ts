import { parseFocus } from "../core/focus";
import { listBriefings } from "../core/briefings";
import { localDayKey, countInboxNotes, hasDailyNote, parseGeneratedAt } from "../core/vault-state";
import type { CockpitFeed } from "../core/cockpit-feed";
import type { CockpitSettings } from "../core/settings";
import { isUnset } from "../core/unset";

/** Was die Leser vom Vault brauchen (Teil von `app.vault`); kein Import von obsidian, damit es sich ohne Obsidian testen lässt. */
export interface VaultLike {
  getFolderByPath(path: string): { children: Array<{ name: string; path: string; extension?: string }> } | null;
  getFileByPath(path: string): { name: string; path: string } | null;
  cachedRead(file: { name: string; path: string }): Promise<string>;
}

type Dir = NonNullable<ReturnType<VaultLike["getFolderByPath"]>>;

/** Dateien (nicht Unterordner) eines Ordners: Obsidian-Dateien tragen `extension`, Ordner nicht. */
const filesOf = (dir: Dir | null) => (dir?.children ?? []).filter((c) => typeof c.extension === "string");

/**
 * Vault-Lage: Inbox-Notizen (Pfade), `generated_at` der Index-Datei, Daily Note von heute. Alles aus dem Cache der
 * Vault-API, nichts wird verändert. Fehlende Ordner und Dateien sind kein Fehler (leer bzw. null).
 */
export async function readVaultState(vault: VaultLike, s: Pick<CockpitSettings, "inboxDir" | "indexFile" | "dailyDir">, now: Date): Promise<NonNullable<CockpitFeed["vault"]>> {
  // Nicht eingerichtet (leer): nie lesen. getFolderByPath("") liefert in Obsidian die Vault-Wurzel, die Inbox zählte den ganzen Vault.
  const inbox = isUnset(s.inboxDir) ? [] : filesOf(vault.getFolderByPath(s.inboxDir)).filter((f) => countInboxNotes([f.name]) === 1).map((f) => f.path).sort();
  const daily = isUnset(s.dailyDir) ? [] : filesOf(vault.getFolderByPath(s.dailyDir)).map((f) => f.name);
  let indexGeneratedAt: number | null = null;
  const index = isUnset(s.indexFile) ? null : vault.getFileByPath(s.indexFile);
  if (index) {
    try {
      indexGeneratedAt = parseGeneratedAt(await vault.cachedRead(index))?.getTime() ?? null;
    } catch {
      indexGeneratedAt = null;
    }
  }
  return { inbox, indexGeneratedAt, dailyToday: hasDailyNote(daily, now) };
}

/**
 * Tagesfokus: die ersten Punkte unter `focusHeading` im Briefing von heute. Dieselbe Dateiwahl wie die Briefing-Karte
 * (`listBriefings` im Briefing-Ordner); gibt es kein Briefing von heute, bleibt der Fokus leer, nie das von gestern.
 */
export async function readFocus(vault: VaultLike, s: Pick<CockpitSettings, "briefingsDir" | "focusHeading">, now: Date): Promise<string[]> {
  if (isUnset(s.briefingsDir)) return [];
  const today = localDayKey(now);
  const days = listBriefings(filesOf(vault.getFolderByPath(s.briefingsDir)).map((f) => f.name));
  if (!days.includes(today)) return [];
  const file = vault.getFileByPath(`${s.briefingsDir}/${today}.md`);
  if (!file) return [];
  try {
    return parseFocus(await vault.cachedRead(file), s.focusHeading);
  } catch {
    return [];
  }
}
