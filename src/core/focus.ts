import { splitFrontmatter } from "./frontmatter";
import { LIST_PREFIX, bare, checkboxRegex } from "./tasks";

const FOCUS_MAX = 2;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
/** Listenpunkt: Gruppe 1 Vorsatz (Einrückung, Aufzählungszeichen, Leerraum), Gruppe 2 Text. */
const ITEM = new RegExp(`^(${LIST_PREFIX})(.*)$`);
/** Checkbox wie in der Aufgabenliste, nach `]` aber auch ein Tab. */
const CHECKBOX = checkboxRegex(String.raw`[ \t]`);
/** Zaunzeile: Gruppe 1 Zaun, Gruppe 2 Rest (Info-String). */
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
/** Trennlinie: drei oder mehr gleiche Zeichen aus `-*_`, dazwischen nur Leerraum. */
export const RULE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/**
 * Zaunzustand nach `line` (ohne `\r`): neuer offener Zaun oder null, dazu ob die Zeile zum Codeblock gehört (Zaunzeilen
 * eingeschlossen). Ein Zaun schließt nur mit gleichem Zeichen, mindestens gleich lang, ohne Info-String.
 */
export function fenceStep(fence: string | null, line: string): { fence: string | null; code: boolean } {
  const f = FENCE.exec(line);
  if (fence !== null) {
    if (f && f[1][0] === fence[0] && f[1].length >= fence.length && f[2].trim() === "") return { fence: null, code: true };
    return { fence, code: true };
  }
  if (f) return { fence: f[1], code: true };
  return { fence: null, code: false };
}

/** ATX-Überschrift der Zeile (ohne `\r`): Ebene und Text getrimmt, sonst null. */
export function headingOf(line: string): { level: number; text: string } | null {
  const h = HEADING.exec(line);
  return h ? { level: h[1].length, text: h[2].trim() } : null;
}

/** Markdown-Reste weg: Häkchen am Anfang, Wikilinks (Alias gewinnt), Links, Fett, Code. */
function clean(text: string): string {
  return text
    .replace(/^\[[ xX]\][ \t]*/, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .trim();
}

export interface BriefingPoint {
  key: string;
  /** Roh ohne Checkbox-Vorsatz, Wikilinks bleiben. */
  text: string;
  /** Irgendeine Zeile des Schlüssels ist eine Checkbox mit anderem Zeichen als Leerzeichen. */
  fileDone: boolean;
  /** Irgendeine Zeile des Schlüssels ist ein Listenpunkt oberster Ebene unter der Überschrift. */
  underHeading: boolean;
}

export interface BriefingBox {
  /** Zeile in `markdown.split("\n")`, samt Frontmatter. */
  line: number;
  key: string;
  /** Die Zeile ist eine Checkbox mit anderem Zeichen als Leerzeichen; sie wird nie umgeschrieben. */
  locked: boolean;
}

export interface BriefingScan {
  points: BriefingPoint[];
  boxes: BriefingBox[];
}

/** Schlüssel eines Punkts: gesäubert, Leerraumfolgen zu einem Leerzeichen, getrimmt, Kleinbuchstaben. */
export function pointKey(text: string): string {
  return clean(text).replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Punkte des Briefings: Listenpunkte oberster Ebene unter der ersten Überschrift, die ohne Groß/Klein und Leerraum außen
 * `heading` gleicht (jede Ebene, Abschnitt bis zur nächsten Überschrift gleicher oder höherer Ebene), dazu jede
 * Checkbox-Zeile irgendwo. Leeres `heading`: nur Checkboxen. Frontmatter und Codeblöcke zählen nicht. Je Schlüssel ein
 * Punkt (erste Fundstelle gibt den Text), je Trefferzeile eine Box.
 */
export function scanBriefing(markdown: string, heading: string): BriefingScan {
  const { points, boxes } = scan(markdown, heading);
  return { points, boxes };
}

/** `scanBriefing` samt den Punkten unter der Überschrift in Zeilenfolge (je Schlüssel einmal, Text der Zeile dort). */
function scan(markdown: string, heading: string): BriefingScan & { section: { key: string; text: string }[] } {
  const wanted = heading.trim().toLowerCase();
  const body = splitFrontmatter(markdown).body;
  const lines = body.split("\n");
  const offset = markdown.split("\n").length - lines.length;
  const points: BriefingPoint[] = [];
  const byKey = new Map<string, BriefingPoint>();
  const boxes: BriefingBox[] = [];
  const section: { key: string; text: string }[] = [];
  let fence: string | null = null;
  let found = false;
  let sectionLevel: number | null = null;
  let baseIndent: number | null = null;
  lines.forEach((raw, i) => {
    const line = bare(raw);
    const step = fenceStep(fence, line);
    fence = step.fence;
    if (step.code) return;
    const h = headingOf(line);
    if (h) {
      const level = h.level;
      if (sectionLevel !== null && level <= sectionLevel) sectionLevel = null;
      if (!found && wanted !== "" && h.text.toLowerCase() === wanted) {
        found = true;
        sectionLevel = level;
      }
      return;
    }
    if (RULE.test(line)) return;
    const box = CHECKBOX.exec(line);
    const item = ITEM.exec(line);
    let under = false;
    if (sectionLevel !== null && item) {
      const indent = (/^[ \t]*/.exec(item[1]) as RegExpExecArray)[0].replace(/\t/g, "    ").length;
      if (baseIndent === null) baseIndent = indent;
      under = indent <= baseIndent;
    }
    if (!under && !box) return;
    const text = box ? (box[3] ?? "").trim() : (item as RegExpExecArray)[2].trim();
    const key = pointKey(text);
    if (key === "") {
      // Leere Checkbox bleibt als gesperrte Box (der Renderer zeigt sie), ein leerer Listenpunkt entfällt ganz.
      if (box) boxes.push({ line: offset + i, key, locked: true });
      return;
    }
    const locked = box !== null && box[2] !== " ";
    boxes.push({ line: offset + i, key, locked });
    if (under && !section.some((p) => p.key === key)) section.push({ key, text });
    const seen = byKey.get(key);
    if (seen) {
      seen.fileDone ||= locked;
      seen.underHeading ||= under;
    } else {
      const point = { key, text, fileDone: locked, underHeading: under };
      byKey.set(key, point);
      points.push(point);
    }
  });
  return { points, boxes, section };
}

/**
 * Schreibt je Box ihre Zeile um, sonst nichts: gesperrte Zeilen bleiben, Checkboxen bekommen `x` (Schlüssel in `done`)
 * oder ein Leerzeichen, Listenpunkte ohne Checkbox bekommen `[x] ` bzw. `[ ] ` hinter dem Aufzählungszeichen.
 * Zeilenenden bleiben.
 */
export function markBriefing(markdown: string, scan: BriefingScan, done: ReadonlySet<string>): string {
  const lines = markdown.split("\n");
  for (const box of scan.boxes) {
    const raw = lines[box.line];
    if (raw === undefined || box.locked) continue;
    const bom = box.line === 0 && raw.startsWith("\uFEFF") ? "\uFEFF" : "";
    const cr = raw.endsWith("\r") ? "\r" : "";
    const line = bare(raw).slice(bom.length);
    const sign = done.has(box.key) ? "x" : " ";
    const cb = CHECKBOX.exec(line);
    let next: string;
    if (cb) next = cb[1] + sign + line.slice(cb[1].length + 1);
    else {
      const item = ITEM.exec(line);
      if (item === null) continue;
      next = `${item[1]}[${sign}] ${item[2]}`;
    }
    lines[box.line] = bom + next + cr;
  }
  return lines.join("\n");
}

/** Die ersten zwei Punkte unter der Überschrift in Zeilenfolge (siehe `scanBriefing`), gesäubert. Fehlen sie: leer. */
export function parseFocus(markdown: string, heading: string): string[] {
  return scan(markdown, heading)
    .section.slice(0, FOCUS_MAX)
    .map((p) => clean(p.text));
}
