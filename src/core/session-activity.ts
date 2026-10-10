// Aktivität je Sitzung (Abend 18): letztes cockpit:-Signal mit Zeit und „angesehen“. Rein, ohne Obsidian.
// Quelle für das Sitzungsradar (RadarInput); Typen und Radar selbst in src/core/session-radar.ts.

import type { ActivitySignal, RadarInput } from "./session-radar";
export type { ActivitySignal, RadarInput };

export interface Activity {
  signal: ActivitySignal;
  /** Zeitpunkt des Signals in ms. */
  signalAt: number;
  /** nach done oder question schon angesehen; busy setzt es auf true. */
  seen: boolean;
}

export class SessionActivity {
  private readonly map = new Map<string, Activity>();

  /** Neues Signal überschreibt das alte. busy gilt als gesehen, done und question nicht. */
  record(id: string, signal: ActivitySignal, now: number): void {
    this.map.set(id, { signal, signalAt: now, seen: signal === "busy" });
  }

  /** Der Nutzer hat die Sitzung angesehen. Ohne Eintrag: nichts. */
  markSeen(id: string): void {
    const a = this.map.get(id);
    if (a) a.seen = true;
  }

  forget(id: string): void {
    this.map.delete(id);
  }

  get(id: string): Activity | undefined {
    const a = this.map.get(id);
    return a ? { ...a } : undefined;
  }
}

export interface SessionSnapshot {
  id: string;
  name: string;
  cwd: string;
  running: boolean;
  /** Exit-Code des beendeten Prozesses; null, solange er läuft oder unbekannt. */
  exitCode: number | null;
}

/** RadarInput je Sitzung, in der Reihenfolge der Eingabe. failed nur bei beendetem Prozess mit Exit-Code != 0. */
export function radarInputs(sessions: readonly SessionSnapshot[], activity: SessionActivity): RadarInput[] {
  return sessions.map((s) => {
    const a = activity.get(s.id);
    return {
      id: s.id,
      name: s.name,
      cwd: s.cwd,
      running: s.running,
      failed: !s.running && s.exitCode !== null && s.exitCode !== 0,
      signal: a?.signal ?? null,
      signalAt: a?.signalAt ?? null,
      seen: a?.seen ?? false,
    };
  });
}
