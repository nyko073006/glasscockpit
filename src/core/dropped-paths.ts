import type { Platform } from "./platform-path";

/** Braucht der Pfad die Anführungsform `@"…"`? Ja bei Leerzeichen (sonst endet das Wort dort) und Backslash. */
const NEEDS_QUOTES = /[ \\]/;

/** Wie der Pfad in der Erwähnung steht: unter win32 mit Schrägstrichen (ein Backslash in Anführungszeichen könnte als Escape gelesen werden), sonst unverändert. */
const mentioned = (pfad: string, platform: Platform): string => (platform === "win32" ? pfad.replace(/\\/g, "/") : pfad);

/** Abgelegte Pfade als @-Erwähnungen für den Claude-Prompt, mit Leerzeichen am Ende. win32: Schrägstriche, Anführungsform nur bei Leerzeichen. */
export function formatDroppedPaths(paths: string[], platform: Platform = "darwin"): string {
  return paths
    .map((pfad) => {
      const text = mentioned(pfad, platform);
      return NEEDS_QUOTES.test(text) ? `@"${text}" ` : `@${text} `;
    })
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
function canMention(pfad: string, platform: Platform): boolean {
  const text = mentioned(pfad, platform);
  return !(text.includes('"') && NEEDS_QUOTES.test(text));
}

/** Trennt die lesbaren Pfade von denen, die abgelehnt werden. Reihenfolge bleibt. */
export function splitDroppedPaths(paths: string[], platform: Platform = "darwin"): { accepted: string[]; rejected: string[] } {
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const pfad of paths) (canMention(pfad, platform) ? accepted : rejected).push(pfad);
  return { accepted, rejected };
}

/** Was ein Drop bewirkt: der Text für den Prompt (leer, wenn nichts einzufügen ist) und die Meldung für den Nutzer. */
export interface DropPlan {
  text: string;
  notice: string | null;
}

/** Was die Meldung von einem abgelehnten Pfad nennt: den Pfad ab dem ersten Teil mit `"` (Ordner oder Dateiname), ohne `"` den Dateinamen. */
function shownPart(pfad: string, platform: Platform): string {
  const teile = pfad.split(platform === "win32" ? /[\\/]/ : "/");
  const i = teile.findIndex((teil) => teil.includes('"'));
  return teile.slice(i === -1 ? -1 : i).join("/");
}

/** Meldung für abgelehnte Pfade, je Pfad ab dem Teil mit `"` (steckt es in einem Ordner, steht der Ordner mit da). Nichts abgelehnt: null. */
function rejectedNotice(rejected: string[], platform: Platform): string | null {
  if (rejected.length === 0) return null;
  const namen = rejected.map((pfad) => shownPart(pfad, platform)).join(", ");
  return rejected.length === 1
    ? `Pfad mit " kann Claude nicht als @-Erwähnung lesen: ${namen}`
    : `Claude kann Pfade mit " nicht als @-Erwähnung lesen: ${namen}`;
}

/** Drop vorbereiten: lesbare Pfade als Text, die übrigen als Meldung. Ein abgelehnter Pfad hält die anderen nicht auf. */
export function planDrop(paths: string[], platform: Platform = "darwin"): DropPlan {
  const { accepted, rejected } = splitDroppedPaths(paths, platform);
  return { text: formatDroppedPaths(accepted, platform), notice: rejectedNotice(rejected, platform) };
}
