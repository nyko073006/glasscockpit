// Abend 37: Terminal-Links gegen zwei Eigenheiten von xterm 6.0.0 (src/browser/Linkifier.ts) absichern. Rein, ohne DOM.

/** Bereich wie xterms IBufferRange (y ab 1, Ende einschließlich); hier zählt nur die Zeile. */
export interface RowRange { start: { y: number }; end: { y: number } }

/**
 * Berührt der Link Zeile y? xterm fragt provideLinks zeilenweise; _removeIntersectingLinks(y) rechnet einem Link, der vor y
 * beginnt, die Zellen ab 0 zu und einem, der nach y endet, die bis cols, auch wenn er Zeile y nicht berührt. Ein solcher Link
 * verdrängt dann jeden späteren Link der Zeile aus dem Zeilen-Cache.
 */
export function touchesRow(range: RowRange, y: number): boolean {
  return range.start.y <= y && y <= range.end.y;
}

/**
 * Läuft gerade ein Druck, der im Terminal begann? xterm löst activate beim mouseup aus, wenn der Link beim letzten mousedown
 * im Terminal derselbe war (_mouseDownLink), und setzt diesen Stand nie zurück: Ein Druck außerhalb, losgelassen über einem
 * früher angeklickten Link, löste ihn aus. Jeder Druck bekommt eine ID; nur das Ende derselben ID beendet ihn, damit das
 * verzögerte Ende eines Klicks den nächsten Druck (Doppelklick) nicht beendet.
 */
export class PressGuard {
  private current: number | null = null;
  private seq = 0;

  press(): number {
    this.current = ++this.seq;
    return this.current;
  }

  end(id: number): void {
    if (this.current === id) this.current = null;
  }

  active(): boolean {
    return this.current !== null;
  }
}
