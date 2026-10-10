/**
 * Rundinstrumente (Abend 18): Farbe und Füllung des Kontext- und des Token-Rings. Die Schwellen kommen aus den Einstellungen.
 */
export type Level = "green" | "yellow" | "red";

/**
 * Wie die Statuszeile (statusline/statusline-command.sh: `tok >= CTX_HANDOFF` rot, `tok >= CTX_WARN` gelb):
 * unter `warn` grün, ab `warn` gelb, ab `handoff` rot.
 */
export function contextLevel(tokens: number, warn: number, handoff: number): Level {
  if (tokens >= handoff) return "red";
  if (tokens >= warn) return "yellow";
  return "green";
}

/** Stufe des Token-Rings: viel Output ist gut, deshalb gibt es kein Rot. */
export type TokensLevel = "yellow" | "green" | "rainbow";

/**
 * Tageswert gegen Median und p90 (beide Grenzen inklusive): unter dem Median gelb, ab Median grün, ab p90 Regenbogen.
 * Kaputte Werte (NaN, negativ, NaN-Grenzen) erfüllen keinen Vergleich und landen wie bisher auf der untersten Stufe (gelb).
 */
export function tokensLevel(tokens: number, median: number, p90: number): TokensLevel {
  if (tokens >= p90) return "rainbow";
  if (tokens >= median) return "green";
  return "yellow";
}

/** Füllung des Rings 0 bis 1: Wert gegen die Grenze, geklemmt; kaputte Eingaben (NaN, Grenze <= 0) ergeben 0. */
export function ringFill(value: number, limit: number): number {
  if (Number.isNaN(value) || !(limit > 0)) return 0;
  return Math.min(1, Math.max(0, value / limit));
}

/**
 * Inhalt von ~/.claude/cockpit/thresholds.json: die Kontext-Schwellen für das Statuszeilen-Skript (Festlegung 1,
 * eine Quelle). Das Plugin schreibt die Datei atomar.
 */
export function thresholdsFileText(s: { contextWarn: number; contextHandoff: number }): string {
  return JSON.stringify({ context_warn: s.contextWarn, context_handoff: s.contextHandoff }) + "\n";
}
