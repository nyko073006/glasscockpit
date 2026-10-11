import { execFile } from "node:child_process";
import { BannerManager, type BannerHandle } from "../core/banner-manager";
import { electronRemote } from "./electron";

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

/** Notification des Electron-Hauptprozesses (über `@electron/remote`): Nur sie lässt sich per close() wirklich wegnehmen. */
interface MainNotification {
  show(): void; close(): void; on(event: "click", cb: () => void): void;
}
type MainNotificationCtor = new (opts: { title: string; body: string; silent: boolean }) => MainNotification;

/** Banner über den Hauptprozess; null, wenn `@electron/remote` fehlt oder die Klasse nicht da ist. */
function remoteHandle(title: string, body: string): BannerHandle | null {
  const Ctor = electronRemote<{ Notification?: MainNotificationCtor }>()?.Notification;
  if (!Ctor) return null;
  // silent: Den Ton spielt playSound, sonst klingt es doppelt.
  const n = new Ctor({ title, body, silent: true });
  return { show: () => n.show(), close: () => n.close(), onClick: (cb) => n.on("click", cb) };
}

/** Rückfall: Web-Notification des Fensters. Ein close() wirkt hier nicht zuverlässig, das Banner kann stehen bleiben. */
function webHandle(win: Window, title: string, body: string): BannerHandle {
  const Ctor = (win as Window & { Notification?: typeof Notification }).Notification;
  if (!Ctor) throw new Error("Notification im Fenster nicht verfügbar");
  let banner: Notification | null = null;
  let click: () => void = () => undefined;
  return {
    show: () => {
      banner = new Ctor(title, { body, silent: true });
      banner.onclick = () => click();
    },
    close: () => banner?.close(),
    onClick: (cb) => { click = cb; },
  };
}

let currentWin: Window | null = null;
const banners = new BannerManager(
  (title, body) => {
    try {
      const handle = remoteHandle(title, body);
      if (handle) return handle;
    } catch (fehler) {
      console.warn("Glasscockpit: Hauptprozess-Banner nicht möglich, Rückfall auf die Web-Notification", fehler);
    }
    if (!currentWin) throw new Error("kein Fenster");
    return webHandle(currentWin, title, body);
  },
  { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
);

/**
 * macOS-Banner mit Klick (onClick) und Selbstschluss nach `seconds`. Je Schlüssel (Sitzung) höchstens eines: Ein neues
 * schließt das alte. Nie ein Absturz; Fehler nur als Warnung.
 */
export function showBanner(win: Window, key: string, title: string, body: string, onClick: () => void, seconds: number): void {
  currentWin = win;
  try {
    banners.show(key, title, body, onClick, seconds);
  } catch (fehler) {
    console.warn("Glasscockpit: Banner nicht anzeigbar", fehler);
  }
}

/** Beim Entladen des Plugins: alle offenen Banner schließen. */
export function closeAllBanners(): void {
  banners.closeAll();
}
