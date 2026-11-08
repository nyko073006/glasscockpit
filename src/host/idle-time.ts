import { execFile } from "node:child_process";
import { IDLE_PROBE_TIMEOUT_MS } from "../core/constants";
import type { Platform } from "../core/platform-path";
import { electronRemote } from "./electron";
import { parseIdleSeconds } from "../core/telegram";

let warned = false;

/** `powerMonitor` des Hauptprozesses (über `@electron/remote`). */
export interface PowerMonitorLike { getSystemIdleTime(): number }

const remotePowerMonitor = (): PowerMonitorLike | null => electronRemote<{ powerMonitor?: PowerMonitorLike }>()?.powerMonitor ?? null;

function warnOnce(why: string): void {
  if (warned) return;
  warned = true;
  console.warn("Glasscockpit: Leerlaufzeit nicht messbar", why);
}

/**
 * Sekunden ohne Tastatur-/Mauseingabe; null, wenn die Messung scheitert (einmal in die Konsole). macOS: `ioreg -c IOHIDSystem`.
 * Windows: `powerMonitor.getSystemIdleTime()` über `@electron/remote`, ohne Prozess.
 */
export function readIdleSeconds(platform: Platform, remote: () => PowerMonitorLike | null = remotePowerMonitor): Promise<number | null> {
  if (platform === "win32") {
    try {
      const monitor = remote();
      if (!monitor) {
        warnOnce("powerMonitor nicht verfügbar");
        return Promise.resolve(null);
      }
      const sec = monitor.getSystemIdleTime();
      if (typeof sec === "number" && Number.isFinite(sec) && sec >= 0) return Promise.resolve(sec);
      warnOnce("ungültiger Wert");
    } catch (fehler) {
      warnOnce(String(fehler));
    }
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const fail = (why: string) => {
      if (!warned) {
        warned = true;
        console.warn("Glasscockpit: Leerlaufzeit nicht messbar (ioreg)", why);
      }
      resolve(null);
    };
    try {
      execFile("/usr/sbin/ioreg", ["-c", "IOHIDSystem"], { timeout: IDLE_PROBE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (fehler, stdout) => {
        if (fehler) return fail(fehler.message);
        const sec = parseIdleSeconds(stdout);
        if (sec === null) return fail("Feld HIDIdleTime fehlt");
        resolve(sec);
      });
    } catch (fehler) {
      fail(String(fehler));
    }
  });
}
