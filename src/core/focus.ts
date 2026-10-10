import { splitFrontmatter } from "./frontmatter";

const FOCUS_MAX = 2;
const HEADING = /^#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.*)$/;

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

/**
 * Die ersten zwei Listenpunkte unter der ersten Überschrift (Ebene 1 bis 6, getrimmter Vergleich), nur bis zur nächsten
 * Überschrift. Frontmatter und Codeblöcke zählen nicht; eingerückte Unterpunkte auch nicht. Fehlt die Überschrift oder
 * hat sie keine Punkte: leer.
 */
export function parseFocus(markdown: string, heading: string): string[] {
  const wanted = heading.trim();
  if (wanted === "") return [];
  const lines = splitFrontmatter(markdown).body.split(/\r?\n/);
  let fence: string | null = null;
  let inSection = false;
  let baseIndent: number | null = null;
  const out: string[] = [];
  for (const line of lines) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark !== undefined) {
      if (fence === null) fence = mark[0];
      else if (mark[0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = HEADING.exec(line);
    if (h) {
      if (inSection) break;
      inSection = h[1].trim() === wanted;
      continue;
    }
    if (!inSection) continue;
    const item = ITEM.exec(line);
    if (!item) continue;
    const indent = item[1].replace(/\t/g, "    ").length;
    if (baseIndent === null) baseIndent = indent;
    else if (indent > baseIndent) continue;
    const text = clean(item[2]);
    if (text === "") continue;
    out.push(text);
    if (out.length === FOCUS_MAX) break;
  }
  return out;
}
