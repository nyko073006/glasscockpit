/**
 * Kleiner abonnierbarer Datenstand (Abend 15): Eine Karte hält ihren Stand hier, die Karte selbst und das
 * Instrument der Cockpit-Ansicht lesen ihn von dort. So gibt es eine Quelle und keinen zweiten Lader.
 */
export class Observable<T> {
  private value: T;
  private readonly subscribers = new Set<(v: T) => void>();
  private readonly onError: (fehler: unknown) => void;

  constructor(initial: T, onError: (fehler: unknown) => void = () => undefined) {
    this.value = initial;
    this.onError = onError;
  }

  get(): T {
    return this.value;
  }

  /** Setzt den Wert und meldet ihn jedem Abonnenten (auch bei gleichem Wert: Karten ersetzen ihren Stand ohnehin). */
  set(value: T): void {
    this.value = value;
    for (const cb of [...this.subscribers]) {
      // Wer sich während der Meldung abgemeldet hat, bekommt sie nicht mehr.
      if (!this.subscribers.has(cb)) continue;
      try {
        cb(value);
      } catch (fehler) {
        this.onError(fehler);
      }
    }
  }

  subscribe(cb: (v: T) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }
}
