/**
 * Cockpit-Ansicht (Abend 15), reine Logik: Geometrie der Flächen im Hintergrundbild, Instrumentenwerte aus den
 * vorhandenen Datentypen der Karten und die Ampel. Kein Import von obsidian, kein DOM.
 *
 * Alle Maße sind am zugeschnittenen Bild `assets/cockpit-bg.jpg` (1536 × 1942) gemessen und stehen in Prozent
 * der vollen Bühne, auch in der Ansicht „zugeschnitten“: Der Ausschnitt `VIEW_CROP` ist ein Fenster darüber, kein neues Bild.
 * Die Polygone stehen in Prozent der jeweiligen Fläche (ihrer Umrandung) und schneiden den Inhalt
 * passend zu den schrägen Flächen zu; gemessen aus der grauen Maske (Deckung der Polygone mit der Maske über 98 %).
 */
import type { CockpitFeed } from "./cockpit-feed";
import { formatCount, topRepos } from "./day-stats";
import { EFFORT_STEPS, RADAR_SLOTS } from "./constants";
import type { EffortStep } from "./effort";
import { contextLevel, ringFill, tokensLevel } from "./gauges";
import { type GitStatus, countRepos, repoNeedsAttention } from "./git-status";
import type { PullSnapshot } from "./pull-state";
import { type ResearchCache, newIds, parseSearches, pruneSections } from "./research";
import type { CockpitCrop } from "./settings";
import { type RadarLamp, lampOf, radarRows } from "./session-radar";
import { type TaskRow, displayText } from "./tasks";
import { type UsageSnapshot, usageView } from "./usage";
import { UNSET_SETTING_LABEL, UNSET_SHORT, UNSET_TEXT, isUnset, radarShorts, unsetHint } from "./unset";
import { indexAgeDays, indexStale, localDayKey } from "./vault-state";

export const IMAGE_W = 1536;
export const IMAGE_H = 1942;

export type PanelId = "briefing" | "usage" | "tasks" | "research" | "system" | "lamp-pull" | "week" | "warnings";
/**
 * Welche volle Karte im Zoom erscheint; „pull“ ist der Kopf mit Pull-Status und „Jetzt pullen“. Die Skill-Karte (`skills`) steht in der
 * Listenansicht und im Regal der Bühne; seit 19b zoomt kein Panel mehr auf sie (Skills startet der Launcher).
 */
export type CardId = "briefing" | "usage" | "tasks" | "research" | "skills" | "pull";

export interface Rect { x: number; y: number; w: number; h: number }
export type Point = readonly [number, number];
/**
 * rect: Lage der Fläche in Prozent der Bühne; polygon: Umrandung in Prozent der Fläche (clip-path);
 * content: Rechteck in Prozent der Fläche, in dem Text sicher steht (liegt ganz im Polygon, nichts läuft über die Schräge).
 */
export interface PanelGeometry { id: PanelId; rect: Rect; polygon: readonly Point[]; content: Rect }

/** Rechteck aus Pixeln des Bilds in Prozent der Bühne, auf zwei Stellen. */
const pct = (x: number, y: number, w: number, h: number): Rect => ({
  x: round2((x / IMAGE_W) * 100),
  y: round2((y / IMAGE_H) * 100),
  w: round2((w / IMAGE_W) * 100),
  h: round2((h / IMAGE_H) * 100),
});
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Ausschnitt der Ansicht „zugeschnitten“ in Prozent der vollen Bühne (Bildpixel 76 bis 1460 in x, 85 bis 1772 in y, also 1384 × 1687).
 * Kanten aus einem Foto gemessen (links 59, rechts 1443, oben 85, unten 1585 px), auf Wunsch vom 06.10.2026 horizontal mittig bei gleicher Breite.
 * Unterkante am 07.10.2026 auf Wunsch nach unten geholt, bis der Ausschnitt das Hochformat der Pane 640 × 780 hat (1384 · 780 / 640 = 1687).
 */
export const VIEW_CROP: Rect = pct(76, 85, 1384, 1687);
/** Die ganze Bühne (Ansicht „voll“). */
const VIEW_FULL: Rect = { x: 0, y: 0, w: 100, h: 100 };

/** Ausschnitt der gewählten Ansicht in Prozent der vollen Bühne. */
export function viewRect(mode: CockpitCrop): Rect {
  return mode === "crop" ? VIEW_CROP : VIEW_FULL;
}

/** Seitenverhältnis (Breite durch Höhe) eines Ausschnitts, gerechnet in Bildpixeln. */
export function viewAspect(view: Rect): number {
  return (view.w * IMAGE_W) / (view.h * IMAGE_H);
}

/**
 * Lage der vollen Bühne im Fenster des Ausschnitts, alles in Prozent des Fensters: Das Fenster zeigt nur `view`, die Bühne ist also um den
 * Kehrwert des Breitenanteils größer und so nach links oben geschoben, dass `view` die Ecken des Fensters trifft. Die Höhe folgt dem Seitenverhältnis
 * der Bühne (die Prozentwerte aller Flächen bleiben die der vollen Bühne).
 */
export function stagePlacement(view: Rect): { width: number; left: number; top: number } {
  // „0 -“ statt eines Minuszeichens: Ein Ausschnitt ohne Versatz soll +0 liefern, nicht -0.
  return { width: round4(10000 / view.w), left: round4(0 - (view.x / view.w) * 100), top: round4(0 - (view.y / view.h) * 100) };
}

const BOX: readonly Point[] = [[0, 0], [100, 0], [100, 100], [0, 100]];

/** Umrandung der Mini-Displays: oben schmal, links schräg (gemessen; das rechte Display gibt es seit 19d nicht mehr als Fläche). */
const LAMP_LEFT: readonly Point[] = [[94, 0], [100, 0], [100, 100], [0, 100], [0, 86], [38, 24], [53, 11]];

const MFD_CONTENT: Rect = { x: 6, y: 6, w: 88, h: 88 };
/** Das Licht sitzt in der breiten Hälfte des Mini-Displays. */
const LAMP_CONTENT: Rect = { x: 55, y: 35, w: 40, h: 55 };

export const PANELS: readonly PanelGeometry[] = [
  // Oben Mitte: unten schräg, Briefing links spitz nach rechts, Usage gespiegelt.
  { id: "briefing", rect: pct(359, 81, 369, 341), polygon: [[0, 0], [100, 0], [100, 86.5], [70, 92], [46, 99.7], [0, 1.2]], content: { x: 30, y: 5, w: 66, h: 50 } },
  { id: "usage", rect: pct(809, 81, 368, 341), polygon: [[0, 0], [100, 0], [54, 99.7], [29, 92], [0, 87]], content: { x: 4, y: 5, w: 64, h: 50 } },
  // Seitenscheiben: die innere Kante fällt schräg nach außen unten. Oben reichen sie bis 18 px unter die Rahmenkante (Abstand wie links),
  // die Schräge ist bis dorthin verlängert. Der Text hält seit 19b mindestens 10 px Abstand zum Rand des Ausschnitts, der die Scheiben je 9 px anschneidet
  // (Aufgaben: Text ab x 9 % statt 5 %, Research: bis 91 % statt 95 %).
  { id: "tasks", rect: pct(67, 209, 264, 577), polygon: [[0, 0], [36.78, 0], [100, 53.4], [72, 63.75], [47, 74.11], [24, 86.19], [3, 99.83], [0, 99.83]], content: { x: 9, y: 24.06, w: 54, h: 29.34 } },
  { id: "research", rect: pct(1205, 209, 264, 577), polygon: [[61.86, 0], [100, 0], [100, 99.83], [96, 99.83], [71, 83.61], [50, 73.24], [24, 62.03], [0, 53.4]], content: { x: 36, y: 24.06, w: 55, h: 29.34 } },
  // MFD rechts: Rechteck. Das linke MFD (früher Skills) ist seit 19b der Effort-Bildschirm, siehe FIELDS.
  { id: "system", rect: pct(940, 1094, 171, 182), polygon: BOX, content: MFD_CONTENT },
  // Mini-Displays: Kontrollleuchten.
  { id: "lamp-pull", rect: pct(478, 959, 121, 72), polygon: LAMP_LEFT, content: LAMP_CONTENT },
  // Querbalken über der Fokus-Tafel zwischen den Lampen: Wochenlimit. Kasten auf der rechten Seitenkonsole: Limit-Warnungen.
  { id: "week", rect: pct(620, 945, 296, 45), polygon: BOX, content: { x: 3, y: 5, w: 94, h: 90 } },
  { id: "warnings", rect: pct(1176, 1468, 117, 89), polygon: BOX, content: { x: 4, y: 7, w: 92, h: 86 } },
];

/**
 * Die Flächen aus Abend 18 (Cockpit füllen), am Bild nachgemessen mit `scripts/measure-fields.py` (Fläche = dunkle bzw. beim
 * Effort-Bildschirm graue Zusammenhangskomponente innerhalb der gezeichneten Kontur, Polygon = vereinfachte Kontur, Textrechteck =
 * größtes Rechteck im um 4 px verkleinerten Polygon). Eine eigene Liste neben `PANELS`; der Host zeichnet beide. Rect in Prozent der
 * Bühne, Polygon und Textrechteck in Prozent des Rects wie bei `PanelGeometry`. `coverage` ist die gemessene Deckung (Schnitt durch
 * Vereinigung von Polygon und Fläche im Bild), `circle` ist bei den Rundinstrumenten die Kreisform im Rect (Mitte und Radius in Prozent).
 */
export type FieldId = "radar" | "focus" | "gaugeLeft" | "gaugeRight" | "vault" | "repos" | "radars" | "effort" | "telegram" | "sound" | "loc" | "commits" | "newSession";
export interface FieldGeometry extends Omit<PanelGeometry, "id"> {
  id: FieldId;
  circle?: { cx: number; cy: number; r: number };
  coverage: number;
}

/** Regelmäßiges 48-Eck im Rect, Umkreis = Rect (bei 32 Ecken liegt die Deckung selbst bei exakter Passung nur bei etwa 98 %). */
function circlePolygon(n = 48): Point[] {
  return Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n;
    return [round2(50 + 50 * Math.cos(a)), round2(50 + 50 * Math.sin(a))] as const;
  });
}
/** Quadrat im Kreis mit Rand (die Ecken liegen bei etwa 83 % des Radius). */
const CIRCLE_CONTENT: Rect = { x: 21.6, y: 20, w: 56.8, h: 58.6 };

export const FIELDS: readonly FieldGeometry[] = [
  // HUD-Rahmen in der Mitte: Fläche innerhalb der inneren Linie, oben beidseitig abgeschrägt, unten an das Querband des Armaturenbretts.
  { id: "radar", rect: pct(641.1, 668.1, 253.8, 254.8), polygon: [[26.01, 0.79], [0, 26.3], [4.73, 99.61], [94.88, 100], [100, 26.3], [72.41, 0], [27.59, 0]], content: { x: 6.65, y: 22.72, w: 86.7, h: 75.37 }, coverage: 0.9926 },
  // Fokus-Tafel: die ganze Tafel der Mittelkonsole zwischen Querbalken und Vault-Display, innen von der hellen Linie begrenzt (Trapez, unten leicht eingezogen). Die vier gezeichneten Tastenkästen darin sind eigene Komponenten und gehören zur Fläche (Löcher gefüllt, das Messskript füllt sie wie bei effort); die Fläche deckt sie mit dunklem Grund ab.
  { id: "focus", rect: pct(632.1, 994.1, 271.8, 201.8), polygon: [[0, 0], [4.42, 98.02], [5.52, 100], [95.22, 99.5], [96.32, 87.11], [100, 8.8], [100, 0]], content: { x: 6.58, y: 1.92, w: 87.21, h: 95.66 }, coverage: 0.995 },
  // Rundinstrumente: Kreis (Mitte und Radius aus der Fläche gemessen), Polygon aus 48 Ecken; die Mitte des rechten liegt bei x 1184, nicht bei der geschätzten 1198 (gespiegelt zum linken).
  { id: "gaugeLeft", rect: pct(322.5, 1293.4, 58, 58), polygon: circlePolygon(), content: CIRCLE_CONTENT, circle: { cx: 50, cy: 50, r: 50 }, coverage: 0.989 },
  { id: "gaugeRight", rect: pct(1155.4, 1293.4, 58, 58), polygon: circlePolygon(), content: CIRCLE_CONTENT, circle: { cx: 50, cy: 50, r: 50 }, coverage: 0.989 },
  // Unteres Mitteldisplay: die gerundete Tafel unter dem Querband, unten bei y 1488 gekappt (der Knauf des Schalthebels ragt ab y 1494 hinein).
  { id: "vault", rect: pct(655.1, 1277.1, 226.8, 211.8), polygon: [[1.32, 1.42], [0.44, 26.92], [0, 100], [100, 100], [98.68, 2.36], [97.35, 0.47], [3.09, 0]], content: { x: 3.03, y: 3.25, w: 93.5, h: 94.92 }, coverage: 0.9954 },
  // Konsole unter dem System-Display, rechts neben dem Vault-Display (19b): die breite Tafel links (Repos) und der schmale Streifen rechts davon (Radare), getrennt durch die dünne Linie bei x 1047 bis 1059. Beide unten bei y 1580 gekappt (Unterkante des Ausschnitts 1585, die Tafeln laufen im Bild weiter). Messung: scripts/measure-fields.py, Startpunkte (975, 1450) und (1100, 1450); zum Vault bleiben 18 px, zum Ring und zu LOC/COM 15 px frei. Die Textrechtecke sind unten um etwa 2 Prozent gekürzt (Abstand zur Unterkante des Ausschnitts mindestens 10 px).
  { id: "repos", rect: pct(900.1, 1324.1, 157.8, 256.8), polygon: [[7.61, 0.78], [2.54, 3.51], [0, 5.84], [1.27, 100], [93.03, 100], [100, 0], [10.78, 0], [9.35, 0.78]], content: { x: 4.36, y: 5.4, w: 86.21, h: 91 }, coverage: 0.9964 },
  { id: "radars", rect: pct(1048.1, 1324.1, 91.8, 256.8), polygon: [[13.08, 0], [0, 100], [100, 100], [92.37, 12.46], [68.39, 2.34], [58.58, 0.39]], content: { x: 15.12, y: 15.14, w: 73.02, h: 81 }, coverage: 0.9945 },
  // Effort-Bildschirm (19b): der graue Schirm links, der bis dahin den Skills-Schirm trug (Rect und Rechteck-Polygon übernommen; Deckung des Rechtecks am Grau 0,9969, Messskript, Startpunkt (510, 1185)). Sechs Stufen als Liste.
  { id: "effort", rect: pct(425, 1094, 171, 182), polygon: BOX, content: MFD_CONTENT, coverage: 0.9969 },
  // Kippschalter, linke Konsole: das schmale hohe Rechteck links neben dem Ton-Schalter.
  { id: "telegram", rect: pct(240.1, 1452.1, 52.8, 118.8), polygon: [[100, 0], [7.58, 1.68], [0, 100], [96.21, 97.47]], content: { x: 14.93, y: 4.95, w: 73.93, h: 89.26 }, coverage: 0.989 },
  // Knauf des Schalthebels in der Mitte (a18e), unter dem Vault: die dunkle Innenfläche des Kopfes (x 699 bis 815, y 1498 bis 1581), unten bei y 1580 gekappt (darunter der schmale Schaft); 20 Ecken, weil die gewellte Kontur mit 12 nur 96,6 % deckt. Trägt das grüne Plus „Neue Sitzung“.
  // Ton-Schalter, linke Konsole: das hohe Rechteck rechts neben dem Telegram-Schalter (x 312 bis 365, y 1404 bis 1563; zum Telegram-Schalter bleiben 19 px frei). Messung: scripts/measure-fields.py, Startpunkt (337, 1462).
  { id: "sound", rect: pct(312.1, 1404.1, 52.8, 158.8), polygon: [[100, 0], [5.69, 0.63], [0, 93.23], [1.9, 100], [100, 98.11]], content: { x: 13.03, y: 3.07, w: 79.62, h: 92.6 }, coverage: 0.9845 },
  // LOC und Commits heute, rechte Konsole über dem OUT-Ring: zwei kleine Schlitze übereinander (x 1157 bis 1198, y 1140 bis 1197 und x 1157 bis 1206, y 1212 bis 1273; zum Ring bleiben 20 px frei). Messung: scripts/measure-fields.py, Startpunkte (1178, 1170) und (1181, 1240).
  { id: "loc", rect: pct(1157.1, 1140.1, 40.8, 56.8), polygon: [[0, 0], [0, 100], [100, 100], [92.64, 38.77], [73.01, 12.33], [58.28, 0]], content: { x: 9.51, y: 20.93, w: 56.44, h: 72.25 }, coverage: 0.9918 },
  { id: "commits", rect: pct(1157.1, 1212.1, 48.8, 60.8), polygon: [[0, 0], [0, 96.71], [4.1, 100], [97.95, 100], [100, 82.3], [87.69, 1.65]], content: { x: 7.95, y: 8.02, w: 71.79, h: 82.3 }, coverage: 0.9851 },
  { id: "newSession", rect: pct(699.1, 1498.1, 115.8, 82.8), polygon: [[4.32, 27.79], [0, 49.55], [0.86, 64.95], [4.32, 75.83], [11.23, 83.08], [24.84, 89.12], [31.97, 100], [80.99, 100], [81.86, 88.22], [84.45, 79.76], [97.41, 62.54], [100, 54.08], [100, 31.42], [95.68, 16.92], [88.77, 7.25], [75.81, 1.21], [49.24, 0], [37.15, 3.63], [14.69, 15.71], [7.78, 21.75]], content: { x: 21.49, y: 17.98, w: 57.88, h: 64.05 }, coverage: 0.992 },
];

/** Namen der neuen Flächen für Zoom-Titel und Beschriftung. */
export const FIELD_TITLES: Record<FieldId, string> = {
  radar: "Sitzungen",
  focus: "Tagesfokus",
  gaugeLeft: "Kontext",
  gaugeRight: "Tokens heute",
  vault: "Vault",
  repos: "Repos",
  radars: "Radare",
  effort: "Effort",
  telegram: "Telegram",
  sound: "Ton",
  loc: "LOC heute",
  commits: "Commits heute",
  newSession: "Neue Sitzung",
};

/** Namen der Flächen für Zoom-Titel und Beschriftung. */
export const PANEL_TITLES: Record<PanelId, string> = {
  briefing: "Briefing",
  usage: "Usage",
  tasks: "Aufgaben",
  research: "Research",
  system: "System",
  "lamp-pull": "Pull",
  week: "Woche",
  warnings: "Warnungen",
};

export function polygonCss(points: readonly Point[]): string {
  return `polygon(${points.map(([x, y]) => `${x}% ${y}%`).join(", ")})`;
}

export function zoomTargets(id: PanelId): CardId[] {
  switch (id) {
    case "briefing": return ["briefing"];
    case "usage": return ["usage"];
    case "tasks": return ["tasks"];
    case "research": return ["research"];
    case "system": return ["pull"];
    case "lamp-pull": return ["pull"];
    case "week": return ["usage"];
    case "warnings": return ["usage"];
  }
}

export type Ampel = "green" | "yellow" | "red" | "gray";
/** Wie die Statuszeile: unter 70 grün, unter 90 gelb, sonst rot; ohne Stand grau. */
export function ampel(percent: number | null | undefined): Ampel {
  if (percent === null || percent === undefined || Number.isNaN(percent)) return "gray";
  if (percent < 70) return "green";
  if (percent < 90) return "yellow";
  return "red";
}

export type Tone = Ampel | "plain";
/** `bar` (0 bis 100) zeichnet unter den Zeilen einen Fortschrittsbalken; `big` leer lässt die große Zahl weg. */
/** `hint`: voller Text für Tooltip und aria-label, wenn das Feld nur eine Kurzfassung zeigt (z. B. „aus“). */
export interface Instrument { big: string; lines: string[]; tone: Tone; bar?: number; hint?: string }
export interface PanelValues {
  briefing: Instrument;
  usage: Instrument;
  week: Instrument;
  warnings: Instrument;
  tasks: Instrument;
  research: Instrument;
  system: Instrument;
  lampPull: Ampel;
}

export type BriefingInput = { kind: "missing" } | { kind: "unset" } | { kind: "ok"; date: string | null };
export type TasksInput = { kind: "missing" } | { kind: "ok"; rows: TaskRow[] };
/** Alles, was die Instrumente brauchen; jeweils der Stand, den auch die vollen Karten halten (null = lädt noch). */
export interface CockpitInputs {
  now: number;
  briefing: BriefingInput | null;
  /** Nur der Schnappschuss der Limits: Die Tokens heute zeigt der OUT-Ring aus dem Feed, nicht diese Fläche. */
  usage: { snapshot: UsageSnapshot | null };
  tasks: TasksInput | null;
  research: ResearchCache | null;
  pull: PullSnapshot;
}

/** Wenig und kurz: Die Flächen sind schräg, was über die Schräge läuft, wird abgeschnitten. */
export const LINE_MAX = 24;
const LIST_MAX = 3;
const REPOS_MAX = 2;

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** JJJJ-MM-TT wird TT.MM.; alles andere bleibt. */
export function shortDate(day: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[2]}.${m[1]}.` : day;
}

const remainingClock = (sec: number): string => {
  const min = Math.floor(sec / 60);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
};

/** Restzeit der Woche kurz für den schmalen Balken: ab einem Tag „3 T 4 Std“, darunter wie die 5h-Uhr „h:mm“. */
const weekClock = (sec: number): string => {
  if (sec < 86400) return remainingClock(sec);
  const std = Math.floor(sec / 3600);
  return `${Math.floor(std / 24)} T ${std % 24} Std`;
};

const plain = (big: string, lines: string[], tone: Tone = "plain"): Instrument => ({ big, lines, tone });
/** Voller Hinweis für „aus“ bei leerem Briefing-Ordner (Tooltip). */
const unsetBriefingsHint = (): string => `${UNSET_TEXT}: Einstellung „${UNSET_SETTING_LABEL.briefingsDir}“`;
const loading = (): Instrument => plain("…", ["wird gelesen"], "gray");

/** Nur das Datum (die Inhalte zeigt der Tagesfokus); gelb, wenn es nicht von heute ist, das Briefing also nicht frisch. */
function briefingValues(b: BriefingInput | null, now: number): Instrument {
  if (b === null) return loading();
  if (b.kind === "unset") return { ...plain(UNSET_SHORT, [], "gray"), hint: unsetBriefingsHint() };
  if (b.kind === "missing") return plain("–", ["Ordner fehlt"], "gray");
  if (b.date === null) return plain("–", ["keine Briefings"], "gray");
  return plain(shortDate(b.date), [], b.date === localDayKey(now) ? "plain" : "yellow");
}

/** Nur das 5h-Fenster: Prozent groß als Ampel und die Restzeit. Die Woche zeigt der Balken, die Tokens heute der OUT-Ring. */
function usageValues(u: CockpitInputs["usage"], now: number): Instrument {
  const gray = (line: string) => plain("–", [line], "gray");
  if (u.snapshot === null) return gray("kein Stand");
  const five = usageView(u.snapshot, now).rows.find((r) => r.key === "five_hour");
  if (five === undefined) return gray("kein 5h-Stand");
  if (five.expired || five.percent === null) return gray("zurückgesetzt");
  return plain(`${five.percent} %`, [`noch ${remainingClock(five.remainingSec ?? 0)}`], ampel(five.percent));
}

/** Wochenlimit als Zahl, Restzeit und Balken; ohne Stand grau und leer. */
function weekValues(u: CockpitInputs["usage"], now: number): Instrument {
  const empty = (line: string): Instrument => ({ big: "–", lines: [line], tone: "gray", bar: 0 });
  if (u.snapshot === null) return empty("kein Stand");
  const row = usageView(u.snapshot, now).rows.find((r) => r.key === "seven_day");
  if (row === undefined) return empty("kein Wochenstand");
  if (row.expired || row.percent === null) return empty("zurückgesetzt");
  return { big: `${row.percent} %`, lines: [`Reset ${weekClock(row.remainingSec ?? 0)}`], tone: ampel(row.percent), bar: row.percent };
}

const WARN_WINDOWS: ReadonlyArray<[string, string]> = [["five_hour", "5h"], ["seven_day", "Woche"]];

/**
 * Fenster ab der gelben Schwelle der Ampel (nicht doppelt festgelegt); der schlimmste Ton gewinnt. Kritisch (rot): „!“ als big.
 * Die Zeile nennt die Folge („5h knapp“), nicht die Prozent: Die Zahlen stehen im Zoom, in der Usage-Karte.
 */
function warningValues(u: CockpitInputs["usage"], now: number): Instrument {
  if (u.snapshot === null) return plain("", ["kein Stand"], "gray");
  const rows = usageView(u.snapshot, now).rows;
  const lines: string[] = [];
  let tone: Tone = "green";
  for (const [key, short] of WARN_WINDOWS) {
    const row = rows.find((r) => r.key === key);
    if (row === undefined || row.expired || row.percent === null) continue;
    const a = ampel(row.percent);
    if (a === "green") continue;
    lines.push(`${short} knapp`);
    if (a === "red" || tone === "green") tone = a;
  }
  return lines.length === 0 ? plain("", ["keine"], "green") : plain(tone === "red" ? "!" : "", lines, tone);
}

function tasksValues(t: TasksInput | null): Instrument {
  if (t === null) return loading();
  if (t.kind === "missing") return { ...plain("–", ["fehlt"], "gray"), hint: "Aufgabenliste fehlt" };
  const tasks = t.rows.flatMap((r) => (r.kind === "task" ? [r] : []));
  const open = tasks.filter((r) => !r.done);
  if (open.length === 0) return plain("0", [tasks.length === 0 ? "keine Aufgaben" : "alles erledigt"]);
  return plain(String(open.length), open.slice(0, LIST_MAX).map((r) => clip(displayText(r.text), LINE_MAX)));
}

function researchValues(c: ResearchCache | null): Instrument {
  if (c === null) return loading();
  if (c.sections.length === 0) return plain("–", ["kein Stand"], "gray");
  const fresh = newIds(c);
  if (fresh.size === 0) return plain("0", ["nichts neu"]);
  const names: string[] = [];
  const taken = new Set<number>();
  for (const s of c.sections) {
    for (const i of s.items) {
      if (!fresh.has(i.id) || taken.has(i.id)) continue;
      taken.add(i.id);
      if (names.length < REPOS_MAX) names.push(clip(i.full_name.slice(i.full_name.indexOf("/") + 1), LINE_MAX));
    }
  }
  return plain(String(fresh.size), names);
}

const clockOf = (s: PullSnapshot, clock: (ms: number) => string): string => (s.at === null ? "" : clock(s.at));

/** Pull-Zustand mit Zeit; die Zahl der Sitzungen zeigt der Radar. */
function systemValues(pull: PullSnapshot, clock: (ms: number) => string): { instrument: Instrument; lamp: Ampel } {
  switch (pull.status) {
    case "ok": return { instrument: plain("OK", [`Pull ${clockOf(pull, clock)}`], "green"), lamp: "green" };
    case "error": return { instrument: plain("FEHLER", [`Pull ${clockOf(pull, clock)}`], "red"), lamp: "red" };
    case "running": return { instrument: plain("…", ["pullt"], "gray"), lamp: "gray" };
    case "no-repo": return { instrument: plain("KEIN REPO", [], "gray"), lamp: "gray" };
    case "unset": return { instrument: { ...plain(UNSET_SHORT, [], "gray"), hint: unsetBriefingsHint() }, lamp: "gray" };
    case "idle": return { instrument: plain("–", ["noch nicht gepullt"], "gray"), lamp: "gray" };
  }
}

/** Werte aller Instrumente. `clock` formatiert die Pull-Zeit (Zeitzone und Sprache gehören dem Aufrufer). */
export function panelValues(i: CockpitInputs, clock: (ms: number) => string): PanelValues {
  const system = systemValues(i.pull, clock);
  return {
    briefing: briefingValues(i.briefing, i.now),
    usage: usageValues(i.usage, i.now),
    week: weekValues(i.usage, i.now),
    warnings: warningValues(i.usage, i.now),
    tasks: tasksValues(i.tasks),
    research: researchValues(i.research),
    system: system.instrument,
    lampPull: system.lamp,
  };
}

/** Stand der Research-Karte für das Instrument: nur Abschnitte der Suchen aus den Einstellungen, wie die Karte selbst. */
export function researchForPanel(cache: ResearchCache | null, searchesText: string): ResearchCache | null {
  return cache === null ? null : pruneSections(cache, parseSearches(searchesText).searches);
}

// ---- Neue Flächen (Abend 18): Werte aus dem CockpitFeed ----

export interface RadarLine { id: string; name: string; lamp: RadarLamp }
/** Zeile im Zoom „Sitzungen“: voller Name, Ordner, Lampentext und Alter des letzten Signals (null: kein Signal). */
export interface SessionDetail { id: string; name: string; cwd: string; lamp: RadarLamp; lampText: string; ageText: string | null }
/** Rundinstrument: `fill` 0 bis 1, `tooltip` mit der Zahl, `lines` für den Zoom, `pulse` nur bei rot (Kontext). */
/** Ring-Farbe: Ampel oder, nur beim Token-Ring ab p90, „rainbow“. */
export type RingTone = Ampel | "rainbow";
export interface RingValue { fill: number; tone: RingTone; tooltip: string; pulse: boolean; lines: string[] }
/** `hint`: nur gesetzt, wenn die Quelle nicht eingerichtet ist (welche Einstellung fehlt). */
export interface VaultLine { label: string; value: string; tone: Tone; hint?: string }
export interface RepoLine { name: string; state: string; tone: Ampel }
export interface RadarLampValue { id: string; label: string; short: string; tone: Ampel; text: string }
/** LOC oder Commits heute: große Zahl („–“ ohne Daten) und Tooltip mit den stärksten Repos. */
export interface DayField { big: string; tooltip: string; hint?: string }
export interface FieldValues {
  radar: { rows: RadarLine[]; more: string | null; sessions: SessionDetail[] };
  focus: string[];
  /** Briefing-Ordner nicht eingerichtet: welche Einstellung fehlt, sonst null. */
  focusHint: string | null;
  gaugeLeft: RingValue;
  gaugeRight: RingValue;
  vault: { lines: VaultLine[]; inbox: string[]; lint: boolean };
  repos: { big: string; tone: Ampel; list: RepoLine[]; hint?: string };
  /** `hint`: keine Radare eingerichtet (Einstellung „Radare“), sonst null. */
  radars: { lamps: RadarLampValue[]; hint: string | null };
  /** Die gewählte Stufe und alle Stufen in der Reihenfolge der Liste (max oben bis aus unten). */
  effort: { step: EffortStep; steps: readonly EffortStep[] };
  telegram: { on: boolean };
  sound: { on: boolean };
  loc: DayField;
  commits: DayField;
  /** Feld „Neue Sitzung“: `hint` = „<n> offen“ (offene Handoffs), leer bei 0. */
  newSession: { hint: string };
}
export type FieldSettings = { contextWarn: number; contextHandoff: number; tokensDayMedian: number; tokensDayP90: number; lintAfterDays: number; lintCommand: string };

const FOCUS_LINES = 2;
/** Zwei Punkte à etwa 120 Zeichen passen auf die Fokus-Tafel (umbrechend); erst darüber Auslassung. */
const FOCUS_MAX = 160;
export const LAMP_TEXT: Record<RadarLamp, string> = {
  busy: "arbeitet", question: "wartet auf dich", unseen: "fertig, ungesehen", idle: "ruht", dead: "beendet",
};

const num = (n: number): string => n.toLocaleString("de-DE");

/** „vor 5 Min.“; weniger als eine Minute (oder Zukunft) „gerade eben“. */
export function ageText(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  return `vor ${Math.floor(h / 24)} T`;
}

function contextRing(feed: CockpitFeed, s: FieldSettings, now: number): RingValue {
  const file = feed.active?.file ?? null;
  if (feed.active === null || file === null) {
    return { fill: 0, tone: "gray", tooltip: "Kontext: kein Stand", pulse: false, lines: ["Kein Stand der aktiven Sitzung."] };
  }
  const tone = contextLevel(file.contextTokens, s.contextWarn, s.contextHandoff);
  return {
    fill: ringFill(file.contextTokens, s.contextHandoff),
    tone,
    tooltip: `Kontext: ${num(file.contextTokens)} Tokens (${feed.active.name})`,
    pulse: tone === "red",
    lines: [
      `Aktuell: ${num(file.contextTokens)} Tokens`,
      `Gelb ab ${num(s.contextWarn)}, rot ab ${num(s.contextHandoff)}`,
      `Sitzung: ${feed.active.name}`,
      `Stand der Datei: ${ageText(now - file.writtenAt * 1000)}`,
    ],
  };
}

/** Voller Ring bei p90 (nicht beim Median), damit gelb und grün im Ring sichtbar bleiben; ab p90 läuft der Regenbogen. */
function tokensRing(feed: CockpitFeed, s: FieldSettings, now: number): RingValue {
  const t = feed.tokensToday;
  if (t === null) return { fill: 0, tone: "gray", tooltip: "Tokens heute: kein Stand", pulse: false, lines: ["Kein Stand des Tageszählers."] };
  return {
    fill: ringFill(t.tokens, s.tokensDayP90),
    tone: tokensLevel(t.tokens, s.tokensDayMedian, s.tokensDayP90),
    tooltip: `Tokens heute: ${num(t.tokens)} Output-Tokens`,
    pulse: false,
    lines: [
      `Heute: ${num(t.tokens)} Output-Tokens`,
      `Gelb unter Mediantag ${num(s.tokensDayMedian)}, grün ab Median, Regenbogen ab p90 ${num(s.tokensDayP90)}`,
      `Stand: ${ageText(now - t.asOf)}`,
    ],
  };
}

function vaultValues(v: CockpitFeed["vault"], unset: CockpitFeed["unset"], s: FieldSettings, now: number): FieldValues["vault"] {
  const missing = (label: string, key: "inboxDir" | "indexFile" | "dailyDir"): VaultLine => ({ label, value: UNSET_SHORT, tone: "gray", hint: unsetHint(key) });
  const inbox: VaultLine = unset.inbox ? missing("Inbox", "inboxDir")
    : v === null ? { label: "Inbox", value: "–", tone: "gray" } : { label: "Inbox", value: String(v.inbox.length), tone: "plain" };
  let index: VaultLine;
  if (unset.index) index = missing("Index", "indexFile");
  else if (v === null) index = { label: "Index", value: "–", tone: "gray" };
  else if (v.indexGeneratedAt === null) index = { label: "Index", value: "?", tone: "gray" };
  else {
    const age = indexAgeDays(new Date(v.indexGeneratedAt), new Date(now));
    index = { label: "Index", value: age === 0 ? "heute" : `${age} T`, tone: indexStale(age, s.lintAfterDays) ? "yellow" : "plain" };
  }
  const daily: VaultLine = unset.daily ? missing("Daily", "dailyDir")
    : v === null ? { label: "Daily", value: "–", tone: "gray" } : { label: "Daily", value: v.dailyToday ? "ja" : "nein", tone: v.dailyToday ? "green" : "gray" };
  return { lines: [inbox, index, daily], inbox: v === null || unset.inbox ? [] : [...v.inbox], lint: !isUnset(s.lintCommand) };
}

function repoState(s: GitStatus | null): { state: string; tone: Ampel; rank: number } {
  if (s === null) return { state: "unbekannt", tone: "gray", rank: 2 };
  if (!repoNeedsAttention(s)) return { state: s.noUpstream ? "sauber, kein Upstream" : "sauber", tone: "green", rank: 1 };
  const parts: string[] = [];
  if (s.dirty) parts.push("geändert");
  if (s.ahead > 0) parts.push(`${s.ahead} ${s.ahead === 1 ? "Commit" : "Commits"} ohne Push`);
  return { state: parts.join(", "), tone: "yellow", rank: 0 };
}

function reposValues(repos: CockpitFeed["repos"], unset: boolean): FieldValues["repos"] {
  if (unset) return { big: UNSET_SHORT, tone: "gray", list: [], hint: unsetHint("projectsRoot") };
  if (repos === null || repos.length === 0) return { big: "–", tone: "gray", list: [] };
  const c = countRepos(repos.map((r) => r.status));
  const list = repos
    .map((r) => ({ name: r.name, ...repoState(r.status) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ name, state, tone }) => ({ name, state, tone }));
  if (c.unknown === c.total) return { big: "–", tone: "gray", list };
  return { big: String(c.attention), tone: c.attention >= 1 ? "yellow" : c.unknown > 0 ? "gray" : "green", list };
}

function dayField(day: CockpitFeed["day"], key: "loc" | "commits", unset: boolean): DayField {
  if (unset) return { big: UNSET_SHORT, tooltip: unsetHint("projectsRoot"), hint: unsetHint("projectsRoot") };
  if (day === null) return { big: "–", tooltip: "Noch keine Abfrage." };
  const lines = topRepos(day.repos, key);
  return { big: formatCount(day[key]), tooltip: lines.length === 0 ? "Heute noch keine Commits." : lines.join("\n") };
}

const RADAR_TEXT: Record<"green" | "gray" | "red", string> = {
  green: "heute geschrieben", gray: "heute nicht geschrieben", red: "state.json fehlt oder ist kaputt",
};

/** Lampen aus der Liste des Feeds, höchstens RADAR_SLOTS; „unset“ (leerer Pfad) ist grau und sagt, welche Einstellung fehlt. */
function radarValues(radars: CockpitFeed["radars"]): FieldValues["radars"] {
  const shown = radars.slice(0, RADAR_SLOTS);
  const shorts = radarShorts(shown.map((r) => r.name));
  const lamps = shown.map((r, i): RadarLampValue => {
    const base = { id: `radar${i}`, label: r.name, short: shorts[i] };
    if (r.lamp === "unset") return { ...base, tone: "gray", text: `${UNSET_TEXT}: Einstellung „Radare“` };
    return { ...base, tone: r.lamp, text: RADAR_TEXT[r.lamp] };
  });
  return { lamps, hint: lamps.length === 0 ? unsetHint("radars") : null };
}

/** Effort-Liste auf dem Bildschirm wie ein Schubhebel: max oben, aus unten (Abnahme 19b, 07.10.2026). EFFORT_STEPS bleibt aufsteigend. */
const EFFORT_LIST: readonly EffortStep[] = [...EFFORT_STEPS].reverse();

/** Werte der Flächen aus dem Feed; `now` in ms. */
export function fieldValues(feed: CockpitFeed, settings: FieldSettings, now: number): FieldValues {
  const top = radarRows(feed.sessions);
  const ordered = radarRows(feed.sessions, feed.sessions.length).rows;
  const byId = new Map(feed.sessions.map((x) => [x.id, x]));
  return {
    radar: {
      rows: top.rows,
      more: top.more > 0 ? `+${top.more}` : null,
      sessions: ordered.map((r) => {
        const input = byId.get(r.id)!;
        return {
          id: r.id, name: input.name, cwd: input.cwd, lamp: lampOf(input), lampText: LAMP_TEXT[lampOf(input)],
          ageText: input.signalAt === null ? null : ageText(now - input.signalAt),
        };
      }),
    },
    focus: feed.unset.briefings ? [] : feed.focus.slice(0, FOCUS_LINES).map((l) => clip(l, FOCUS_MAX)),
    focusHint: feed.unset.briefings ? unsetHint("briefingsDir") : null,
    gaugeLeft: contextRing(feed, settings, now),
    gaugeRight: tokensRing(feed, settings, now),
    vault: vaultValues(feed.vault, feed.unset, settings, now),
    repos: reposValues(feed.repos, feed.unset.projects),
    radars: radarValues(feed.radars),
    effort: { step: feed.effort, steps: EFFORT_LIST },
    telegram: { on: feed.telegramOn },
    sound: { on: feed.soundOn },
    loc: dayField(feed.day, "loc", feed.unset.projects),
    commits: dayField(feed.day, "commits", feed.unset.projects),
    newSession: { hint: feed.handoffs.length > 0 ? `${feed.handoffs.length} offen` : "" },
  };
}
