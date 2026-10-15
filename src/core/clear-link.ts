// Abend 35: Ein freistehendes „/clear“ im Terminal einer Claude-Sitzung ist ein Link. Hier nur die reine Erkennung;
// den Klick, die Unterstreichung und das Schreiben in die Eingabezeile übernimmt der host.

/** Was ein Klick in Claudes Eingabezeile schreibt. Technik-Invariante: Das Leerzeichen hinten wie beim Command „Slash-Befehl einfügen“ (`insert-slash`), damit Claudes Vorschlagsliste zu ist und Enter den Befehl ausführt. */
export const CLEAR_INSERT = "/clear ";

/** Ein Treffer: start inklusiv, end exklusiv (Index im Text, wie bei den Pfadkandidaten). */
export interface ClearRange { start: number; end: number }

// Davor: Textanfang oder ein Zeichen, das weder Buchstabe noch Ziffer ist und auch kein _ . / ~ @ - \ (sonst wäre es
// Teil eines Pfads oder Wortes: `src/clear.ts`, `x/clear`, `~/clear`, `a\/clear`).
// Dahinter: Textende oder ein Zeichen, das weder Buchstabe noch Ziffer ist und kein _ / - \ (`/clearable`, `/clear/x`,
// `/clear-foo`); ein Punkt direkt vor Buchstabe oder Ziffer (`/clear.ts`) gehört zu einem Dateinamen, ein Punkt am
// Satzende nicht. Groß und klein zählt: nur genau `/clear`.
const CLEAR = /(?<![\p{L}\p{N}_./~@\\-])\/clear(?![\p{L}\p{N}_/\\-])(?!\.[\p{L}\p{N}])/gu;

/**
 * Alle freistehenden Vorkommen von `/clear` im Text, aufsteigend; start inklusiv, end exklusiv (Index im Text).
 * Reine Zeichenfolge-Erkennung, ob die Sitzung gerade eine Eingabezeile zeigt, entscheidet der host.
 */
export function clearRanges(text: string): ClearRange[] {
  const result: ClearRange[] = [];
  for (const match of text.matchAll(CLEAR)) {
    const start = match.index ?? 0;
    result.push({ start, end: start + match[0].length });
  }
  return result;
}
