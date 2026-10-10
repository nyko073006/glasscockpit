interface ElectronBits {
  clipboard?: { readText(): string; writeText(text: string): void };
}

/** Electron liegt im Obsidian-Renderer vor; sonst (Test, Mobil) null. */
function electron(): ElectronBits | null {
  try {
    return require("electron") as ElectronBits;
  } catch {
    return null;
  }
}

/** Zwischenablage lesen: Electron, Rückfall navigator.clipboard des übergebenen Fensters (Pop-out). */
export async function readClipboard(win: Window): Promise<string> {
  const clipboard = electron()?.clipboard;
  if (clipboard) return clipboard.readText();
  return win.navigator.clipboard.readText();
}

/** Zwischenablage schreiben, wirft bei Fehler. */
export async function writeClipboard(win: Window, text: string): Promise<void> {
  const clipboard = electron()?.clipboard;
  if (clipboard) clipboard.writeText(text);
  else await win.navigator.clipboard.writeText(text);
}
