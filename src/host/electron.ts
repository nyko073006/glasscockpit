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
