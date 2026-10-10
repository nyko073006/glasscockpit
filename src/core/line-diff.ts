// Diff-Ansicht (Abend 17): zeilenweiser Diff nach Myers (O(ND)), rein und ohne Paket. Die Ansicht zeigt ihn als
// vereinheitlichten Diff mit Kontext; hier liegt nur die Rechnung.

export type DiffOp = "same" | "add" | "del";

export interface DiffLine {
  op: DiffOp;
  /** Zeilentext ohne Zeilenende (auch ohne \r). */
  text: string;
  /** Zeilennummern ab 1; null auf der Seite, auf der es die Zeile nicht gibt. */
  oldNo: number | null;
  newNo: number | null;
  /** Letzte Zeile der Datei ohne abschließenden Zeilenumbruch (wie „\ No newline at end of file“). */
  noEol: boolean;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** Die alte Fassung fehlt (neue Datei). Eine leere alte Datei ist keine neue. */
  isNew: boolean;
  /** Der Inhalt ist zeilenweise gleich, aber die Zeilenenden (CRLF gegen LF) unterscheiden sich. */
  eolChanged: boolean;
  /** Rückfall: Der Bereich der Änderung war zu groß, er gilt als „ganz ersetzt“ (alles gelöscht, alles neu). */
  coarse: boolean;
}

export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

/** Feste Technik-Grenzen, keine Einstellungen: Über ihnen wird der Mittelteil nicht mehr fein verglichen. */
export const MAX_DIFF_LINES = 50000;
export const MAX_EDIT_DISTANCE = 2000;

interface Row { text: string; key: string; noEol: boolean; crlf: boolean }

/** Zeilen einer Datei. Leer ergibt keine Zeile; ein Endumbruch erzeugt keine Phantomzeile. */
function rows(text: string): Row[] {
  if (text === "") return [];
  const parts = text.split("\n");
  const endsWithBreak = parts[parts.length - 1] === "";
  if (endsWithBreak) parts.pop();
  return parts.map((raw, i) => {
    const last = i === parts.length - 1;
    const lineHasBreak = !last || endsWithBreak;
    const crlf = lineHasBreak && raw.endsWith("\r");
    const content = crlf ? raw.slice(0, -1) : raw;
    const noEol = last && !endsWithBreak;
    // Der Schlüssel trägt das Fehlen des Umbruchs mit: „b“ ohne Umbruch ist nicht „b“ mit Umbruch.
    return { text: content, key: noEol ? `${content}\0` : content, noEol, crlf };
  });
}

type Edit = { op: DiffOp; a: number; b: number };

/** Myers: kürzeste Folge aus Löschen und Einfügen. null, wenn mehr als maxD Änderungen nötig wären. */
function myers(a: readonly string[], b: readonly string[], maxD: number): Edit[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxD);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    // Zustand vor der Runde d, nur der Streifen, den der Rückweg braucht.
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, offset, d);
    }
  }
  return null;
}

function backtrack(trace: readonly Int32Array[], a: readonly string[], b: readonly string[], offset: number, last: number): Edit[] {
  const out: Edit[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = last; d >= 0; d--) {
    const snap = trace[d];
    const base = offset - d - 1;
    const at = (k: number): number => snap[offset + k - base];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { out.push({ op: "same", a: x - 1, b: y - 1 }); x--; y--; }
    if (d > 0) {
      if (x === prevX) { out.push({ op: "add", a: -1, b: y - 1 }); y--; } else { out.push({ op: "del", a: x - 1, b: -1 }); x--; }
    }
  }
  return out.reverse();
}

/** Zeilenweiser Diff. oldText null: die Datei ist neu. */
export function diffLines(oldText: string | null, newText: string): DiffResult {
  const oldRows = rows(oldText ?? "");
  const newRows = rows(newText);
  let start = 0;
  while (start < oldRows.length && start < newRows.length && oldRows[start].key === newRows[start].key) start++;
  let endOld = oldRows.length;
  let endNew = newRows.length;
  while (endOld > start && endNew > start && oldRows[endOld - 1].key === newRows[endNew - 1].key) { endOld--; endNew--; }

  const midOld = oldRows.slice(start, endOld);
  const midNew = newRows.slice(start, endNew);
  let edits: Edit[] | null = null;
  if (midOld.length === 0 || midNew.length === 0) edits = coarseEdits(midOld.length, midNew.length);
  else if (midOld.length <= MAX_DIFF_LINES && midNew.length <= MAX_DIFF_LINES) {
    edits = myers(midOld.map((r) => r.key), midNew.map((r) => r.key), MAX_EDIT_DISTANCE);
  }
  const coarse = edits === null;
  if (edits === null) edits = coarseEdits(midOld.length, midNew.length);

  const lines: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  let eolChanged = false;
  const same = (o: Row, n: Row): void => {
    if (o.crlf !== n.crlf) eolChanged = true;
    lines.push({ op: "same", text: n.text, oldNo: oldNo++, newNo: newNo++, noEol: n.noEol });
  };
  for (let i = 0; i < start; i++) same(oldRows[i], newRows[i]);
  let added = 0;
  let removed = 0;
  for (const e of edits) {
    if (e.op === "same") same(midOld[e.a], midNew[e.b]);
    else if (e.op === "del") { removed++; lines.push({ op: "del", text: midOld[e.a].text, oldNo: oldNo++, newNo: null, noEol: midOld[e.a].noEol }); }
    else { added++; lines.push({ op: "add", text: midNew[e.b].text, oldNo: null, newNo: newNo++, noEol: midNew[e.b].noEol }); }
  }
  for (let i = 0; i < oldRows.length - endOld; i++) same(oldRows[endOld + i], newRows[endNew + i]);
  return { lines, added, removed, isNew: oldText === null, eolChanged, coarse };
}

/** „Ganz ersetzt“: erst alle alten Zeilen löschen, dann alle neuen einfügen. */
function coarseEdits(oldCount: number, newCount: number): Edit[] {
  const out: Edit[] = [];
  for (let i = 0; i < oldCount; i++) out.push({ op: "del", a: i, b: -1 });
  for (let i = 0; i < newCount; i++) out.push({ op: "add", a: -1, b: i });
  return out;
}

/** Änderungen mit `context` Zeilen Kontext; Gruppen, die sich berühren oder überlappen, werden ein Hunk. */
export function hunks(lines: readonly DiffLine[], context = 3): Hunk[] {
  const ranges: Array<[number, number]> = [];
  lines.forEach((line, i) => {
    if (line.op === "same") return;
    const from = Math.max(0, i - context);
    const to = Math.min(lines.length, i + context + 1);
    const prev = ranges[ranges.length - 1];
    if (prev && from <= prev[1]) prev[1] = Math.max(prev[1], to);
    else ranges.push([from, to]);
  });
  return ranges.map(([from, to]) => {
    const part = lines.slice(from, to);
    const before = lines.slice(0, from);
    const oldCount = part.filter((l) => l.oldNo !== null).length;
    const newCount = part.filter((l) => l.newNo !== null).length;
    const oldBefore = before.filter((l) => l.oldNo !== null).length;
    const newBefore = before.filter((l) => l.newNo !== null).length;
    return {
      oldStart: oldCount === 0 ? oldBefore : oldBefore + 1,
      oldCount,
      newStart: newCount === 0 ? newBefore : newBefore + 1,
      newCount,
      lines: part,
    };
  });
}
