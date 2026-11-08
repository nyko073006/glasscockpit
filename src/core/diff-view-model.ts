// Diff-Ansicht (Abend 17): Was die Ansicht zeigt, rein gerechnet: Zusammenfassung, Hinweise, Hunks (begrenzt), Pfade.
import { type Hunk, diffLines, hunks } from "./line-diff";
import { type Platform, lastSegment, relativeInside } from "./platform-path";

/** Feste Technik-Grenze: Mehr Zeilen malt die Ansicht nicht (das DOM wird sonst zäh); Annehmen übernimmt trotzdem alles. */
export const MAX_RENDER_ROWS = 2000;

export interface DiffViewModel {
  summary: string;
  notes: string[];
  hunks: Hunk[];
  /** Zeilen, die wegen MAX_RENDER_ROWS nicht gezeigt werden. */
  hiddenRows: number;
  /** NUL-Byte in einer der Fassungen: keine Zeilen, nur ein Hinweis. */
  binary: boolean;
}

const lines = (n: number): string => (n === 1 ? "1 Zeile" : `${n} Zeilen`);

export function buildDiffView(oldText: string | null, newText: string, context = 3): DiffViewModel {
  if (newText.includes("\0") || (oldText?.includes("\0") ?? false)) {
    return { summary: "Binärdatei", notes: ["Binärdatei, nur Annehmen oder Ablehnen"], hunks: [], hiddenRows: 0, binary: true };
  }
  const result = diffLines(oldText, newText);
  const all = hunks(result.lines, context);
  const notes: string[] = [];
  let summary: string;
  if (result.isNew) summary = result.added === 0 ? "Neue Datei, leer" : `Neue Datei, +${lines(result.added)}`;
  else if (result.added === 0 && result.removed === 0) summary = "Keine Änderung";
  else summary = `+${result.added} −${result.removed}`;
  if (result.eolChanged) notes.push("Zeilenenden ändern sich (CRLF und LF)");
  if (result.coarse) notes.push("Sehr große oder stark veränderte Datei: Der Bereich der Änderung ist als ganz ersetzt gezeigt");

  // Begrenzen: ganze Hunks, der letzte wird mittendrin abgeschnitten.
  const shown: Hunk[] = [];
  let budget = MAX_RENDER_ROWS;
  let total = 0;
  for (const h of all) {
    total += h.lines.length;
    if (budget <= 0) continue;
    if (h.lines.length <= budget) {
      shown.push(h);
      budget -= h.lines.length;
    } else {
      shown.push({ ...h, lines: h.lines.slice(0, budget) });
      budget = 0;
    }
  }
  const hiddenRows = total - shown.reduce((s, h) => s + h.lines.length, 0);
  if (hiddenRows > 0) notes.push(`… weitere Änderungen nicht gezeigt (${lines(hiddenRows)}); Annehmen übernimmt trotzdem alles`);
  return { summary, notes, hunks: shown, hiddenRows, binary: false };
}

/** Im Vault relativ zum Vault (mit "/"), sonst der absolute Pfad. Unter win32 ohne Rücksicht auf Schreibweise und Trenner. */
export function displayPath(path: string, vaultBase: string | null, platform: Platform = "darwin"): string {
  if (platform === "win32") return (vaultBase ? relativeInside(platform, vaultBase, path) : null) || path;
  const base = vaultBase?.replace(/\/+$/, "") ?? "";
  return base !== "" && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
}

/** Tab-Titel in Obsidian: Der Name von Claude (mit Sitzungs-Kürzel und Symbolen) ist zu lang, der Dateiname genügt. */
export function diffTabTitle(newFilePath: string, platform: Platform = "darwin"): string {
  return `Diff: ${platform === "win32" ? lastSegment(platform, newFilePath) : newFilePath.slice(newFilePath.lastIndexOf("/") + 1)}`;
}

export const hunkHeader = (h: Hunk): string => `@@ −${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`;
