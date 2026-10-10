import { RING_MAX_CHARS } from "./constants";

/**
 * Kürzt auf höchstens max Zeichen: ab Index länge minus max bis hinter das nächste \n,
 * ohne \n hart. Der Schnitt am \n kann in einer Escape-Sequenz liegen; ein Replay stimmt
 * dann erst nach dem nächsten Redraw.
 */
export function trimRing(text: string, max: number = RING_MAX_CHARS): string {
  if (text.length <= max) return text;
  const start = text.length - max;
  const newline = text.indexOf("\n", start);
  return text.slice(newline >= 0 ? newline + 1 : start);
}

/** Ausgabe-Puffer einer Sitzung für das Replay, roh mit ANSI. */
export class RingBuffer {
  private readonly max: number;
  private text = "";

  constructor(max: number = RING_MAX_CHARS) {
    this.max = max;
  }

  append(chunk: string): void {
    this.text = trimRing(this.text + chunk, this.max);
  }

  toString(): string {
    return this.text;
  }

  get length(): number {
    return this.text.length;
  }
}
