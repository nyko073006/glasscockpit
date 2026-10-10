import { SHIFT_ENTER_SEQUENCE } from "./constants";

export interface KeyInput {
  key: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}
export type Platform = "darwin" | "win32" | "linux" | string;

// Cmd und Alt jeweils allein; Shift/Ctrl dazu gehört xterm.
const MAC_CMD: Record<string, string> = { Backspace: "\x15", ArrowLeft: "\x01", ArrowRight: "\x05" };
const MAC_ALT: Record<string, string> = { Backspace: "\x17", ArrowLeft: "\x1bb", ArrowRight: "\x1bf" };

/** Mac-Tastenkürzel in PTY-Bytes übersetzen; null heißt: xterm verarbeitet die Taste selbst (auch Escape). */
export function keyToSequence(k: KeyInput, platform: Platform): string | null {
  if (platform !== "darwin") return null;
  const { metaKey: cmd, altKey: alt, ctrlKey: ctrl, shiftKey: shift } = k;
  if (cmd && !alt && !ctrl && !shift) return MAC_CMD[k.key] ?? null;
  if (alt && !cmd && !ctrl && !shift && k.key in MAC_ALT) return MAC_ALT[k.key];
  // Option(+Shift)+Taste mit genau einem Zeichen (@, \, |, [ …): selbst senden. xterm erkennt in Obsidian
  // keinen Mac ("title" in process) und schickte sonst ESC+Buchstabe. Tote Tasten heißen "Dead".
  if (alt && !cmd && !ctrl && [...k.key].length === 1) return k.key;
  if (shift && !cmd && !alt && !ctrl && k.key === "Enter") return SHIFT_ENTER_SEQUENCE;
  return null;
}
