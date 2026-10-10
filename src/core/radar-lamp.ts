import { localDayKey } from "./vault-state";

export type RadarFileLamp = "green" | "gray" | "red";

/**
 * Kontrollleuchte eines Radars (Einträge der Radar-Liste in den Einstellungen) nach seiner state.json: heute geschrieben grün, früher grau,
 * Datei fehlt (`mtime` null, nicht eingerichtet oder noch nicht angelegt) grau, Datei da, aber nicht lesbar oder kein JSON-Objekt (`parseOk` false) rot. „Heute“ ist das lokale Datum; eine Datei
 * aus der Zukunft (Uhrabweichung) gilt als heute geschrieben.
 */
export function radarLamp(mtime: Date | number | null, parseOk: boolean, now: Date | number): RadarFileLamp {
  if (mtime === null) return "gray";
  if (!parseOk) return "red";
  return localDayKey(mtime) >= localDayKey(now) ? "green" : "gray";
}

/** Lässt sich die state.json lesen? Ein JSON-Objekt, mehr prüft das Cockpit nicht (das Format gehört dem Radar). */
export function radarStateValid(text: string): boolean {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v);
  } catch {
    return false;
  }
}
