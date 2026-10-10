import { thresholdsFileText } from "./gauges";

/**
 * Schwellen eine Quelle (Festlegung 1, Abend 18): Das Plugin schreibt contextWarn und contextHandoff nach thresholds.json,
 * das Statuszeilen-Skript liest sie. Geschrieben wird beim Laden und nur, wenn sich der Inhalt ändert. Ein Schreibfehler
 * geht ins Log und wird beim nächsten Aufruf erneut versucht; er wirft nie.
 */
export class ThresholdsSync {
  private readonly deps: { write: (text: string) => Promise<void>; log: (message: string) => void };
  private written: string | null = null;

  constructor(deps: { write: (text: string) => Promise<void>; log: (message: string) => void }) {
    this.deps = deps;
  }

  async sync(s: { contextWarn: number; contextHandoff: number }): Promise<void> {
    const text = thresholdsFileText(s);
    if (text === this.written) return;
    try {
      await this.deps.write(text);
      this.written = text;
    } catch (fehler) {
      this.deps.log(`Cockpit: thresholds.json nicht geschrieben: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
    }
  }
}
