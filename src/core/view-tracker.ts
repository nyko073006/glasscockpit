import { KILL_GRACE_MS } from "./constants";

/** Timer von außen, damit Tests ohne echte Zeit laufen. */
export interface TimerApi {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/**
 * Zählt Views je Sitzung. Schließt die letzte, läuft die Schonfrist; danach onExpire.
 * Öffnet in der Frist eine View (Obsidian baut Views beim Verschieben neu auf), fällt der Timer weg.
 */
export class ViewTracker {
  private readonly onExpire: (id: string) => void;
  private readonly timers: TimerApi;
  private readonly graceMs: number;
  private readonly counts = new Map<string, number>();
  private readonly pending = new Map<string, unknown>();
  private disposed = false;

  constructor(onExpire: (id: string) => void, timers: TimerApi, graceMs: number = KILL_GRACE_MS) {
    this.onExpire = onExpire;
    this.timers = timers;
    this.graceMs = graceMs;
  }

  open(id: string): void {
    if (this.disposed) return;
    this.cancel(id);
    this.counts.set(id, this.count(id) + 1);
  }

  close(id: string): void {
    if (this.disposed) return;
    const count = this.count(id);
    if (count === 0) return;
    if (count > 1) {
      this.counts.set(id, count - 1);
      return;
    }
    this.counts.delete(id);
    const handle = this.timers.set(() => {
      this.pending.delete(id);
      this.onExpire(id);
    }, this.graceMs);
    this.pending.set(id, handle);
  }

  count(id: string): number {
    return this.counts.get(id) ?? 0;
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.pending.keys()]) this.cancel(id);
    this.counts.clear();
  }

  private cancel(id: string): void {
    if (!this.pending.has(id)) return;
    this.timers.clear(this.pending.get(id));
    this.pending.delete(id);
  }
}
