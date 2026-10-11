/** Ein macOS-Banner, wie es der Manager braucht: anzeigen, schließen, Klick melden. */
export interface BannerHandle { show(): void; close(): void; onClick(cb: () => void): void }
/** Zeitgeber, eingespeist (Test: Attrappe). */
export interface BannerTimers { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }

interface OpenBanner { handle: BannerHandle; timer: unknown }

/**
 * Hält je Schlüssel (Sitzungs-ID) höchstens ein offenes Banner. Ein neues ersetzt das alte (das wird vorher geschlossen),
 * jedes schließt sich nach der eingestellten Zeit selbst, und `closeAll` räumt beim Entladen des Plugins auf.
 */
export class BannerManager {
  private readonly open = new Map<string, OpenBanner>();

  private readonly make: (title: string, body: string) => BannerHandle;
  private readonly timers: BannerTimers;

  constructor(make: (title: string, body: string) => BannerHandle, timers: BannerTimers) {
    this.make = make;
    this.timers = timers;
  }

  show(key: string, title: string, body: string, onClick: () => void, seconds: number): void {
    this.close(key);
    const handle = this.make(title, body);
    const entry: OpenBanner = { handle, timer: null };
    handle.onClick(() => {
      this.forget(key, entry);
      onClick();
    });
    handle.show();
    entry.timer = this.timers.set(() => {
      if (this.open.get(key) === entry) this.close(key);
    }, seconds * 1000);
    this.open.set(key, entry);
  }

  /** Schließt das Banner dieses Schlüssels, falls offen. */
  close(key: string): void {
    const entry = this.open.get(key);
    if (!entry) return;
    this.open.delete(key);
    this.timers.clear(entry.timer);
    try {
      entry.handle.close();
    } catch (fehler) {
      console.warn("Glasscockpit: Banner nicht schließbar", fehler);
    }
  }

  closeAll(): void {
    for (const key of [...this.open.keys()]) this.close(key);
  }

  /** Klick: Das System hat das Banner schon weggenommen, nur Zeitgeber und Eintrag fallen. */
  private forget(key: string, entry: OpenBanner): void {
    if (this.open.get(key) !== entry) return;
    this.open.delete(key);
    this.timers.clear(entry.timer);
  }
}
