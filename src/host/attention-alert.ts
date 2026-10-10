import { execFile } from "node:child_process";

/** Ton über macOS `afplay`. Fehler (Datei fehlt, kein afplay) nur als Warnung, nie als Absturz. */
export function playSound(path: string): void {
  try {
    execFile("afplay", [path], (fehler) => {
      if (fehler) console.warn("Glasscockpit: Ton nicht abspielbar", fehler.message);
    });
  } catch (fehler) {
    console.warn("Glasscockpit: Ton nicht abspielbar", fehler);
  }
}

/** macOS-Banner über den Notification-Konstruktor des Fensters der View. Ein Klick ruft onClick. */
export function showBanner(win: Window, title: string, body: string, onClick: () => void): void {
  const Ctor = (win as Window & { Notification?: typeof Notification }).Notification;
  if (!Ctor) {
    console.warn("Glasscockpit: Notification im Fenster nicht verfügbar, kein Banner");
    return;
  }
  try {
    // silent: Den Ton spielt playSound, sonst klingt es doppelt.
    const banner = new Ctor(title, { body, silent: true });
    banner.onclick = () => onClick();
  } catch (fehler) {
    console.warn("Glasscockpit: Banner nicht anzeigbar", fehler);
  }
}
