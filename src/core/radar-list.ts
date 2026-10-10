import { RADAR_SLOTS } from "./constants";
import type { RadarEntry } from "./settings";

// Radar-Liste der Einstellungsseite (Abend 21.3): reine Listenoperationen, nie an der Eingabe verändern.
export const RADAR_FULL_HINT = `Es sind ${RADAR_SLOTS} Radare eingetragen, mehr passen nicht ins Bild. Erst einen entfernen.`;
export const RADAR_VISIBLE_HINT = "Im Cockpit erscheinen höchstens zwei Radare. Eine fehlende Datei zeigt die Lampe grau, eine kaputte oder unlesbare rot.";

export const canAddRadar = (list: readonly RadarEntry[]): boolean => list.length < RADAR_SLOTS;

export const addRadar = (list: readonly RadarEntry[]): RadarEntry[] =>
  canAddRadar(list) ? [...list, { name: "", stateFile: "" }] : [...list];

const inRange = (list: readonly RadarEntry[], index: number): boolean => Number.isInteger(index) && index >= 0 && index < list.length;

export const removeRadar = (list: readonly RadarEntry[], index: number): RadarEntry[] =>
  inRange(list, index) ? list.filter((_, i) => i !== index) : [...list];

const patch = (list: readonly RadarEntry[], index: number, change: Partial<RadarEntry>): RadarEntry[] =>
  list.map((e, i) => (i === index ? { ...e, ...change } : { ...e }));

export const renameRadar = (list: readonly RadarEntry[], index: number, name: string): RadarEntry[] => patch(list, index, { name });
export const setRadarFile = (list: readonly RadarEntry[], index: number, stateFile: string): RadarEntry[] => patch(list, index, { stateFile });
