// Prozessbaum unter Windows beenden (Abend 41). Es gibt dort keine Signale: Die erste Stufe ist pty.kill() ohne
// Signal (schließt die ConPTY), die zweite dieser taskkill-Aufruf mit /T (ganzer Baum) und /F (erzwingen).
import { execFile } from "node:child_process";
import { system32Path } from "../core/platform-path";

/**
 * taskkill /PID <pid> /T /F aus %SystemRoot%\System32, nie über PATH. Wirft nie und wartet nicht: Ist der Prozess
 * schon weg oder scheitert taskkill, gibt es nichts mehr zu tun (der Fehler im Rückruf ist erwartet).
 */
export function forceKillTree(pid: number, systemRoot?: string): void {
  try {
    execFile(system32Path(systemRoot, "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
  } catch {
    // Start von taskkill fehlgeschlagen: nichts weiter zu tun.
  }
}
