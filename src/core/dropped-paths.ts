/** Braucht den Pfad die Anführungsform `@"…"`? Ja bei Leerzeichen (sonst endet das Wort dort) und Backslash. */
const NEEDS_QUOTES = /[ \\]/;

/** Abgelegte Pfade als @-Erwähnungen für den Claude-Prompt, mit Leerzeichen am Ende. */
export function formatDroppedPaths(paths: string[]): string {
  return paths
    .map((pfad) => (NEEDS_QUOTES.test(pfad) ? `@"${pfad}" ` : `@${pfad} `))
    .join("");
}

/**
 * Kann Claude diesen Pfad als @-Erwähnung lesen? Probe vom 12.10.2026 mit claude 2.1.296 (`-p` und echte PTY):
 * - `@x"y.txt` (`"` unmaskiert, ohne Anführungszeichen drumherum) liest Claude richtig; jede Maskierung (`\"`) scheitert.
 * - Die Anführungsform liest Claude mit `@"([^"]+)"`, also ohne Escape: Ein `"` im Namen beendet sie.
 * Ein Pfad mit `"` UND Leerzeichen bräuchte genau diese Form und ist in keiner geprobten Schreibweise lesbar.
 * `"` plus Backslash ist nicht geprobt: formatDroppedPaths nähme dafür die Anführungsform (NEEDS_QUOTES), und die verträgt kein `"`.
 * Der Pfad wird deshalb vorsorglich abgelehnt.
 */
function canMention(pfad: string): boolean {
  return !(pfad.includes('"') && NEEDS_QUOTES.test(pfad));
}

/** Trennt die lesbaren Pfade von denen, die abgelehnt werden. Reihenfolge bleibt. */
export function splitDroppedPaths(paths: string[]): { accepted: string[]; rejected: string[] } {
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const pfad of paths) (canMention(pfad) ? accepted : rejected).push(pfad);
  return { accepted, rejected };
}

/** Was ein Drop bewirkt: der Text für den Prompt (leer, wenn nichts einzufügen ist) und die Meldung für den Nutzer. */
export interface DropPlan {
  text: string;
  notice: string | null;
}

function fileName(pfad: string): string {
  return pfad.slice(pfad.lastIndexOf("/") + 1);
}

/** Meldung für abgelehnte Pfade, mit den Dateinamen. Nichts abgelehnt: null. */
function rejectedNotice(rejected: string[]): string | null {
  if (rejected.length === 0) return null;
  const namen = rejected.map(fileName).join(", ");
  return rejected.length === 1
    ? `Pfad mit " kann Claude nicht als @-Erwähnung lesen: ${namen}`
    : `Claude kann Pfade mit " nicht als @-Erwähnung lesen: ${namen}`;
}

/** Drop vorbereiten: lesbare Pfade als Text, die übrigen als Meldung. Ein abgelehnter Pfad hält die anderen nicht auf. */
export function planDrop(paths: string[]): DropPlan {
  const { accepted, rejected } = splitDroppedPaths(paths);
  return { text: formatDroppedPaths(accepted), notice: rejectedNotice(rejected) };
}
