// Reine Logik für die Aufgabenliste (Markdown-Checkboxen). Kein Import von obsidian.

export type ToggleResult = { ok: true; content: string; done: boolean } | { ok: false; reason: string };
export interface TaskItem { line: number; task: string | undefined; parent: number }
export interface HeadingItem { line: number; level: number; heading: string }
export type TaskRow =
  | { kind: "heading"; line: number; level: number; text: string }
  | { kind: "task"; line: number; text: string; done: boolean; depth: number };

/** Entfernt genau ein abschließendes \r (CRLF-Zeile). */
const bare = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);

// Einrückung, Bullet (- * + oder 1. / 1)), Leerraum, [c] mit genau einem Zeichen, dann Leerraum-Zeichen und Text.
const CHECKBOX = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([^\r\n])\](?: ([\s\S]*))?$/;

interface Box { markAt: number; mark: string; text: string }

function parseBox(line: string | undefined): Box | null {
  if (line === undefined) return null;
  const m = CHECKBOX.exec(bare(line));
  if (!m) return null;
  return { markAt: m[1].length, mark: m[2], text: m[3] ?? "" };
}

/** Gründe, wenn die Aufgabe schon im gewünschten Zustand ist (etwa der zweite Klick eines Doppelklicks): kein fremder Eingriff in die Datei. */
export const REASON_ALREADY_DONE = "Aufgabe ist schon abgehakt";
export const REASON_ALREADY_OPEN = "Aufgabe ist schon offen";

/** Maximaler Abstand (Zeilen) der Fenstersuche, wenn die Aufgabe sich verschoben hat. */
const SEARCH_WINDOW = 5;

/**
 * Schaltet die Checkbox an `zeile` um, wenn sie den erwarteten Text trägt. Sonst sucht sie im Abstand
 * 1 bis 5 Zeilen genau eine Checkbox mit diesem Text. Alles übrige (Zeilenenden, Einrückung ...) bleibt erhalten.
 * `erwartetErledigt` ist der Zustand, den die Anzeige zeigte (erledigt heißt: jedes Zeichen außer Leerzeichen in der Box, wie in
 * taskRows); hat die Datei inzwischen einen anderen, wird abgelehnt, damit eine abgehakte Aufgabe nicht zurückkippt (Abend 29).
 */
export function toggleTask(inhalt: string, zeile: number, erwarteterText: string, erwartetErledigt: boolean): ToggleResult {
  const lines = inhalt.split("\n");
  let target = -1;
  const direct = Number.isInteger(zeile) ? parseBox(lines[zeile]) : null;
  if (direct !== null && direct.text === erwarteterText) {
    target = zeile;
  } else {
    const hits: number[] = [];
    for (let d = 1; d <= SEARCH_WINDOW; d++) {
      for (const i of [zeile - d, zeile + d]) {
        if (i >= 0 && i < lines.length && parseBox(lines[i])?.text === erwarteterText) hits.push(i);
      }
    }
    if (hits.length === 0) return { ok: false, reason: "Aufgabe nicht gefunden" };
    if (hits.length > 1) return { ok: false, reason: "Aufgabe mehrdeutig (gleicher Text mehrfach in der Nähe)" };
    target = hits[0];
  }
  const box = parseBox(lines[target]) as Box;
  if ((box.mark !== " ") !== erwartetErledigt) {
    return { ok: false, reason: erwartetErledigt ? REASON_ALREADY_OPEN : REASON_ALREADY_DONE };
  }
  const done = box.mark === " ";
  const line = lines[target];
  lines[target] = line.slice(0, box.markAt) + (done ? "x" : " ") + line.slice(box.markAt + 1);
  return { ok: true, content: lines.join("\n"), done };
}

/** Zeilen der Anzeige in Dateireihenfolge. Cache-Einträge ohne Checkbox in der Zeile (veralteter Cache) entfallen. */
export function taskRows(inhalt: string, items: TaskItem[], headings: HeadingItem[]): { rows: TaskRow[]; done: number; total: number } {
  const lines = inhalt.split("\n");
  const byLine = new Map(items.map((i) => [i.line, i]));
  const depthOf = (item: TaskItem): number => {
    let depth = 0;
    let cur = item;
    for (let guard = 0; guard < 100 && cur.parent >= 0; guard++) {
      depth++;
      const up = byLine.get(cur.parent);
      if (up === undefined) break;
      cur = up;
    }
    return depth;
  };
  const rows: TaskRow[] = headings.map((h) => ({ kind: "heading", line: h.line, level: h.level, text: h.heading }));
  let done = 0;
  let total = 0;
  for (const item of items) {
    if (item.task === undefined) continue;
    const box = parseBox(lines[item.line]);
    if (box === null) continue;
    const isDone = box.mark !== " ";
    total++;
    if (isDone) done++;
    rows.push({ kind: "task", line: item.line, text: box.text, done: isDone, depth: depthOf(item) });
  }
  rows.sort((a, b) => a.line - b.line);
  return { rows, done, total };
}

/** Ein Stück Aufgabentext: Fließtext oder Wikilink (Ziel zum Öffnen, Anzeige zum Lesen). */
export type TextPart = { kind: "text"; text: string } | { kind: "link"; ziel: string; anzeige: string };

/**
 * Zerlegt einen Aufgabentext in Fließtext und Wikilinks: [[ziel]] hat Ziel und Anzeige ziel, [[ziel|alias]] die Anzeige alias,
 * ein Abschnitt ([[ziel#Abschnitt]]) bleibt im Ziel. Ein leeres Ziel ([[|alias]]) ist kein Link, es gibt nichts zu öffnen:
 * der Alias steht als Text da, ohne Alias ([[]]) bleibt die Klammer wie geschrieben. Keine leeren Textteile, Text neben Text
 * wird zusammengefasst; andere Markdown-Formate bleiben roh im Text.
 */
export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const addText = (t: string): void => {
    if (t === "") return;
    const last = parts[parts.length - 1];
    if (last?.kind === "text") last.text += t;
    else parts.push({ kind: "text", text: t });
  };
  let from = 0;
  for (const m of text.matchAll(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g)) {
    addText(text.slice(from, m.index));
    const ziel = m[1];
    const anzeige = m[2] ?? ziel;
    if (ziel !== "") parts.push({ kind: "link", ziel, anzeige });
    else addText(anzeige !== "" ? anzeige : m[0]);
    from = m.index + m[0].length;
  }
  addText(text.slice(from));
  return parts;
}

/** Anzeige: [[ziel|alias]] wird alias, [[ziel]] wird ziel. */
export function displayText(text: string): string {
  return textParts(text).map((p) => (p.kind === "text" ? p.text : p.anzeige)).join("");
}

export const TASKS_TEMPLATE = "# Glasscockpit Tasks\n\n## Heute\n\n- [ ] Erste Aufgabe\n\n## Später\n\n- [ ] Noch eine\n";

/** Elternordner eines vault-relativen Pfads, von außen nach innen: "a/b/c.md" ergibt ["a", "a/b"]. */
export function parentFolders(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}
