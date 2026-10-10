import { RADAR_MAX_ROWS, RADAR_NAME_MAX } from "./constants";

/**
 * Sitzungsradar (Abend 18): reines Modell der Zeilen im HUD-Rahmen. Die Rohdaten liefern Session-Manager und
 * Aufmerksamkeitssignal (`session-activity.ts`); hier wird nur entschieden, welche Lampe leuchtet und in welcher Reihenfolge.
 */
export type ActivitySignal = "busy" | "done" | "question";

export interface RadarInput {
  id: string; name: string; cwd: string;
  /** PTY lebt. */
  running: boolean;
  /** Beendet mit Fehler oder Exit != 0. */
  failed: boolean;
  /** Letztes cockpit:-Signal und sein Zeitpunkt (ms). */
  signal: ActivitySignal | null; signalAt: number | null;
  /** Nach done oder question schon angesehen. */
  seen: boolean;
}

export type RadarLamp = "busy" | "question" | "unseen" | "idle" | "dead";
export interface RadarRow { id: string; name: string; lamp: RadarLamp }

/** Reihenfolge der Zeilen: wer etwas von dir will, steht oben. */
const LAMP_ORDER: readonly RadarLamp[] = ["question", "unseen", "busy", "idle", "dead"];

/** `failed` ändert nichts: eine beendete Sitzung ist tot, ob mit oder ohne Fehler. */
export function lampOf(input: RadarInput): RadarLamp {
  if (!input.running) return "dead";
  if (input.signal === "question" && !input.seen) return "question";
  if (input.signal === "done" && !input.seen) return "unseen";
  if (input.signal === "busy") return "busy";
  return "idle";
}

/** Kürzt nach Zeichen (nicht nach UTF-16-Einheiten) auf RADAR_NAME_MAX, das letzte davon ist „…“. */
function shorten(name: string): string {
  const chars = Array.from(name);
  return chars.length <= RADAR_NAME_MAX ? name : chars.slice(0, RADAR_NAME_MAX - 1).join("") + "…";
}

/** Zeilen in der Reihenfolge des Plans, höchstens `max`; `more` ist der Rest für „+n“. */
export function radarRows(inputs: RadarInput[], max: number = RADAR_MAX_ROWS): { rows: RadarRow[]; more: number } {
  const limit = Math.max(0, Math.floor(max));
  const sorted = inputs
    .map((input) => ({ input, lamp: lampOf(input) }))
    .sort((a, b) => {
      const byLamp = LAMP_ORDER.indexOf(a.lamp) - LAMP_ORDER.indexOf(b.lamp);
      if (byLamp !== 0) return byLamp;
      const at = a.input.signalAt;
      const bt = b.input.signalAt;
      if (at !== bt) {
        if (at === null) return 1;
        if (bt === null) return -1;
        return bt - at;
      }
      return a.input.name.localeCompare(b.input.name) || (a.input.id < b.input.id ? -1 : a.input.id > b.input.id ? 1 : 0);
    });
  return {
    rows: sorted.slice(0, limit).map(({ input, lamp }) => ({ id: input.id, name: shorten(input.name), lamp })),
    more: Math.max(0, sorted.length - limit),
  };
}
