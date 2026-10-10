import type { TimerApi } from "./view-tracker";
import { KILL_ESCALATION_MS } from "./constants";

export type KillSignal = "SIGHUP" | "SIGKILL";

/** Alles von außen: Signalgeber, Lebenszeichen und Timer, damit Tests ohne echte Zeit und Prozesse laufen. */
export interface KillDeps extends TimerApi {
  send(signal: KillSignal): void;
  isAlive(): boolean;
}

export interface KillHandle {
  /** Der Prozess ist weg: Timer wegräumen, kein SIGKILL mehr. Mehrfach und nach dem SIGKILL harmlos. */
  processExited(): void;
}

/**
 * Beenden mit Eskalation: SIGHUP sofort, lebt der Prozess nach graceMs noch, SIGKILL (genau einmal).
 * onSettled kommt genau einmal, wenn nichts mehr ansteht (Prozess weg oder SIGKILL gesendet).
 */
export function escalateKill(deps: KillDeps, graceMs: number = KILL_ESCALATION_MS, onSettled?: () => void): KillHandle {
  let timer: unknown = null;
  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    if (timer !== null) {
      deps.clear(timer);
      timer = null;
    }
    onSettled?.();
  };

  if (!deps.isAlive()) {
    settle();
    return { processExited: settle };
  }
  try {
    deps.send("SIGHUP");
  } catch (fehler) {
    console.error("Glasscockpit: SIGHUP ließ sich nicht senden", fehler);
  }
  if (!deps.isAlive()) {
    settle();
    return { processExited: settle };
  }
  timer = deps.set(() => {
    timer = null;
    if (settled) return;
    if (deps.isAlive()) {
      try {
        deps.send("SIGKILL");
      } catch (fehler) {
        console.error("Glasscockpit: SIGKILL ließ sich nicht senden", fehler);
      }
    }
    settle();
  }, graceMs);
  return { processExited: settle };
}
