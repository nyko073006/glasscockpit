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

/** Maximaler Abstand (Zeilen) der Fenstersuche, wenn die Aufgabe sich verschoben hat. */
const SEARCH_WINDOW = 5;

/**
 * Schaltet die Checkbox an `zeile` um, wenn sie den erwarteten Text trägt. Sonst sucht sie im Abstand
 * 1 bis 5 Zeilen genau eine Checkbox mit diesem Text. Alles übrige (Zeilenenden, Einrückung ...) bleibt erhalten.
 */
export function toggleTask(inhalt: string, zeile: number, erwarteterText: string): ToggleResult {
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

/** Anzeige: [[ziel|alias]] wird alias, [[ziel]] wird ziel. */
export function displayText(text: string): string {
  return text.replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, ziel: string, alias: string | undefined) => alias ?? ziel);
}

export const TASKS_TEMPLATE = "# Glasscockpit Tasks\n\n## Heute\n\n- [ ] Erste Aufgabe\n\n## Später\n\n- [ ] Noch eine\n";

/** Elternordner eines vault-relativen Pfads, von außen nach innen: "a/b/c.md" ergibt ["a", "a/b"]. */
export function parentFolders(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}
