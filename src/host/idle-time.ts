import { execFile } from "node:child_process";
import { IDLE_PROBE_TIMEOUT_MS } from "../core/constants";
import { parseIdleSeconds } from "../core/telegram";

let warned = false;

/** Sekunden ohne Tastatur-/Mauseingabe über `ioreg -c IOHIDSystem`; null, wenn die Messung scheitert (einmal in die Konsole). */
export function readIdleSeconds(): Promise<number | null> {
  return new Promise((resolve) => {
    const fail = (why: string) => {
      if (!warned) {
        warned = true;
        console.warn("Glasscockpit: Leerlaufzeit nicht messbar (ioreg)", why);
      }
      resolve(null);
    };
    try {
      execFile("/usr/sbin/ioreg", ["-c", "IOHIDSystem"], { timeout: IDLE_PROBE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (fehler, stdout) => {
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
