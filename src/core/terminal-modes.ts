// Terminal-Modi für die Wiedergabe (Abend 19f). Claude schickt ?1049h (Alternate Screen) und ?2004h nur einmal beim Start,
// die Maus-Modi nach jeder Größenänderung neu. Der gekürzte Ring verliert sie; eine neue View bekommt sie als Vorspann zurück.

/** Verfolgte DEC-Private-Modi, 1049 zuerst: Er wechselt den Puffer, alles danach gilt im neuen. */
export const TRACKED_MODES = [1049, 1000, 1002, 1003, 1006, 1004, 2004] as const;

const SEQUENCE = /\x1b\[\?([\d;]+)([hl])/g;
// Anfang einer Sequenz, die in der nächsten Portion weitergehen kann.
const OPEN_TAIL = /\x1b(\[(\?[\d;]*)?)?$/;

export class ModeTracker {
  private readonly on = new Set<number>();
  private carry = "";

  feed(chunk: string): void {
    const text = this.carry + chunk;
    for (const m of text.matchAll(SEQUENCE)) {
      for (const part of m[1].split(";")) {
        const mode = Number(part);
        if (!(TRACKED_MODES as readonly number[]).includes(mode)) continue;
        if (m[2] === "h") this.on.add(mode);
        else this.on.delete(mode);
      }
    }
    this.carry = OPEN_TAIL.exec(text)?.[0] ?? "";
  }

  /** Eingeschaltete Modi als Sequenzen, für eine frische xterm-Instanz (dort ist alles aus). */
  prelude(): string {
    return TRACKED_MODES.filter((mode) => this.on.has(mode)).map((mode) => `\x1b[?${mode}h`).join("");
  }
}
