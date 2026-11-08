/**
 * Modul des Obsidian-Renderers über `window.require` wie der Loader von node-pty (`native-loader.ts`): Das Bundle
 * enthält kein `require()`. Null in Test und Mobil oder wenn das Modul fehlt oder beim Laden wirft.
 */
export function requireModule<T>(id: string): T | null {
  try {
    const req = (window as unknown as { require?: (id: string) => unknown }).require;
    return req ? (req(id) as T) : null;
  } catch {
    return null;
  }
}

/** Electron-Modul des Renderers, sonst null (Test, Mobil). Dasselbe Modul in allen Fenstern, auch im Pop-out. */
export function electronModule<T>(): T | null {
  return requireModule<T>("electron");
}

/** `@electron/remote`: Zugriff auf Klassen des Hauptprozesses (etwa Notification), sonst null. */
export function electronRemote<T>(): T | null {
  return requireModule<T>("@electron/remote");
}

/** Datei im Standardprogramm öffnen (Nachtrag 43c). null bei Erfolg, sonst die Meldung. */
export async function openWithDefaultApp(path: string): Promise<string | null> {
  const open = electronModule<{ shell?: { openPath?: (p: string) => Promise<string> } }>()?.shell?.openPath;
  if (!open) return "Standardprogramm nicht verfügbar";
  try {
    const msg = await open(path);
    return msg === "" ? null : msg;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
