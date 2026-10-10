import { limitReached } from "./session-model";

export type Reservation = { ok: true; release: () => void } | { ok: false };

/**
 * Sitzungslimit ohne Lücke: Zwischen Limitprüfung und Spawn liegen awaits (Login-Shell, Transkript-Suche).
 * Wer die Prüfung besteht, hält synchron einen Platz, bis seine PTY läuft oder der Start scheitert.
 */
export class StartSlots {
  private count = 0;

  /** running = Sitzungen, die schon laufen. Zählt die noch startenden dazu. */
  reserve(running: number, max: number): Reservation {
    if (limitReached(running + this.count, max)) return { ok: false };
    this.count++;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.count--;
      },
    };
  }

  pending(): number {
    return this.count;
  }
}
