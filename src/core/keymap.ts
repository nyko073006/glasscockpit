import { SHIFT_ENTER_SEQUENCE } from "./constants";
import type { Platform } from "./platform-path";

export interface KeyInput {
  key: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

// Cmd und Alt jeweils allein; Shift/Ctrl dazu gehört xterm.
const MAC_CMD: Record<string, string> = { Backspace: "\x15", ArrowLeft: "\x01", ArrowRight: "\x05" };
const MAC_ALT: Record<string, string> = { Backspace: "\x17", ArrowLeft: "\x1bb", ArrowRight: "\x1bf" };

// Windows (Abend 41): Ctrl allein für Wortsprung und Wort löschen. Alt+Zeichen und Ctrl+Alt (AltGr, z. B. @ auf der deutschen
// Tastatur) gehen an xterm; Alt+V (Bild einfügen in Claude) ebenso.
const WIN_CTRL: Record<string, string> = { Backspace: "\x17", ArrowLeft: "\x1bb", ArrowRight: "\x1bf" };

function windowsSequence(k: KeyInput): string | null {
  const { metaKey: win, altKey: alt, ctrlKey: ctrl, shiftKey: shift } = k;
  if (win || alt) return null;
  if (shift && !ctrl && k.key === "Enter") return SHIFT_ENTER_SEQUENCE;
  if (ctrl && !shift) return WIN_CTRL[k.key] ?? null;
  return null;
}

/** Mac- und Windows-Tastenkürzel in PTY-Bytes übersetzen; null heißt: xterm verarbeitet die Taste selbst (auch Escape). */
export function keyToSequence(k: KeyInput, platform: Platform): string | null {
  if (platform === "win32") return windowsSequence(k);
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

/**
 * Zwischenablage-Tasten unter Windows. Ctrl+C kopiert nur mit Auswahl, sonst geht ^C an das Programm; Ctrl+V und
 * Ctrl+Shift+V fügen ein; Ctrl+Shift+C kopiert mit Auswahl und tut ohne Auswahl nichts ("none": die Taste ist erledigt,
 * es geht kein ^C an Claude; wie im Windows Terminal). Alt und Win dazu (Alt+V, AltGr) gehören nicht hierher.
 */
export function windowsClipboardAction(k: KeyInput, hasSelection: boolean): "copy" | "paste" | "none" | null {
  if (!k.ctrlKey || k.altKey || k.metaKey) return null;
  switch (k.key.toLowerCase()) {
    case "c":
      if (hasSelection) return "copy";
      return k.shiftKey ? "none" : null;
    case "v":
      return "paste";
    default:
      return null;
  }
}

/** Name der Taste, die Datei-Links öffnet und in Texten genannt wird: Cmd auf dem Mac, Ctrl unter Windows. */
export function modKeyName(platform: Platform): "Cmd" | "Ctrl" {
  return platform === "win32" ? "Ctrl" : "Cmd";
}
