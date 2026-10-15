import { posix } from "node:path";

// Datei-Viewer (Abend 27): Pfade in Terminalzeilen erkennen, auflösen und einordnen. Alles rein; ob ein Pfad als
// Datei existiert, prüft der host (statSync), und zwar nur für die Zeile unter der Maus.

/** Ein Pfad in einer Zeile: start/end sind Textpositionen (end exklusiv), text der klickbare Ausschnitt samt :zeile[:spalte]. */
export interface PathCandidate { start: number; end: number; text: string; path: string; line: number | null; col: number | null }
/** Eine Terminalzelle: Zeichen und Breite (2 = breites Zeichen, 0 = dessen zweite Hälfte). */
export interface Cell { chars: string; width: number }
/** Eine Pufferzeile; isWrapped heißt, sie setzt die Zeile davor fort (xterm). */
export interface CellRow { cells: Cell[]; isWrapped: boolean }
/** Zellposition wie in xterms IBufferRange: x und y ab 1. */
export interface BufferPos { x: number; y: number }
/** Eine logische Zeile über alle umgebrochenen Teile; positions[i] ist die Zelle des Zeichens text[i]. */
export interface LogicalLine { text: string; positions: BufferPos[] }

// Wörter getrennt an Leerraum, Anführungszeichen, Backticks, Klammern und senkrechtem Strich.
const TOKEN = /[^\s"'`()[\]{}<>|]+/g;
const TRAILING = /[.,;:!?]+$/;
const LINE_SUFFIX = /:(\d+)(?::(\d+))?$/;
const LETTER = /\p{L}/u;
/** Höchstzahl umgebrochener Teilzeilen, die zu einer logischen Zeile zusammengefügt werden. */
const MAX_WRAPPED_ROWS = 50;

/**
 * Pfadkandidaten einer Zeile, in Reihenfolge. Ein Kandidat enthält einen Buchstaben und einen Schrägstrich oder Punkt
 * (also auch `package.json`), ist keine URL; ein `@` vorn (Erwähnung) und Satzzeichen hinten gehören nicht dazu.
 * Ob er existiert, entscheidet erst der host.
 */
export function pathCandidates(line: string): PathCandidate[] {
  const result: PathCandidate[] = [];
  for (const match of line.matchAll(TOKEN)) {
    let start = match.index ?? 0;
    let token = match[0];
    if (token.includes("://")) continue;
    while (token.startsWith("@")) {
      token = token.slice(1);
      start++;
    }
    token = token.replace(TRAILING, "");
    let path = token;
    let text = token;
    let lineNo: number | null = null;
    let col: number | null = null;
    const suffix = LINE_SUFFIX.exec(token);
    if (suffix) {
      path = token.slice(0, suffix.index);
      const l = Number(suffix[1]);
      const c = suffix[2] === undefined ? 0 : Number(suffix[2]);
      if (l > 0) {
        lineNo = l;
        col = c > 0 ? c : null;
        text = col === null ? `${path}:${l}` : token;
      } else text = path;
    }
    if (!LETTER.test(path) || !/[/.]/.test(path)) continue;
    result.push({ start, end: start + text.length, text, path, line: lineNo, col });
  }
  return result;
}

/**
 * Absoluter, normalisierter Pfad: absolut bleibt, `~/` gegen home, sonst relativ zum Startordner der Sitzung.
 * null für `~` allein, `~benutzer/…` und relative Pfade ohne (absoluten) Startordner.
 */
export function resolveCandidatePath(path: string, ctx: { home: string; cwd: string | null }): string | null {
  if (path.startsWith("~/")) return posix.normalize(ctx.home + path.slice(1));
  if (path.startsWith("~")) return null;
  if (path.startsWith("/")) return posix.normalize(path);
  if (!ctx.cwd) return null;
  const cwd = ctx.cwd === "~" ? ctx.home : ctx.cwd.startsWith("~/") ? ctx.home + ctx.cwd.slice(1) : ctx.cwd;
  return posix.isAbsolute(cwd) ? posix.join(cwd, path) : null;
}

// Relative Pfade über Claudes Ordner (Abend 27b): Steht ein relativer Pfad im Startordner nicht, gilt er gegen Ordner aus Claudes
// Werkzeugaufrufen im Transkript. Rein; ob eine Datei existiert, prüft der host.

/** Relativ heißt: nicht leer und weder mit `/` noch mit `~` am Anfang. */
export function isRelativePath(path: string): boolean {
  return path !== "" && !path.startsWith("/") && !path.startsWith("~");
}

// cd am Anfang oder hinter einem Verknüpfer; das Ziel in Anführungszeichen (Leerzeichen bleiben) oder bis Leerraum und ; & | ).
// Hinter cd nur Leerzeichen und Tabs, damit ein cd ohne Ziel nicht die nächste Zeile als Ziel nimmt.
const CD_TARGET = /(?:^|&&|\|\||[;|(\n])\s*cd[ \t]+(?:--[ \t]+)?(?:"([^"]*)"|'([^']*)'|([^\s;&|)]+))/g;

/** Rohe cd-Ziele eines Shell-Befehls in Reihenfolge, ohne Anführungszeichen; `echo "cd /x"` und `cdk` zählen nicht. */
export function cdTargets(command: string): string[] {
  const targets: string[] = [];
  for (const m of command.matchAll(CD_TARGET)) {
    const target = m[1] ?? m[2] ?? m[3];
    if (target) targets.push(target);
  }
  return targets;
}

const withoutTrailingSlash = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, "") || "/" : path);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Absolute Pfade aus der Eingabe eines Werkzeugaufrufs (Ordner, in dem Claude gearbeitet hat). */
function inputPaths(input: Record<string, unknown>, home: string, cwd: string | null): string[] {
  const out: string[] = [];
  const add = (path: string | null): void => {
    if (path) out.push(withoutTrailingSlash(path));
  };
  // Nur absolute und ~/-Pfade; ein relativer Pfad hätte ohne bekannten Ordner keinen Halt.
  const absolute = (value: unknown): string | null =>
    typeof value === "string" && !isRelativePath(value) ? resolveCandidatePath(value, { home, cwd: null }) : null;
  for (const key of ["file_path", "notebook_path"]) {
    const file = absolute(input[key]);
    if (file) add(posix.dirname(file));
  }
  add(absolute(input.path));
  if (typeof input.command === "string") {
    for (const target of cdTargets(input.command)) {
      // Variablen und Befehlsersetzung lassen sich ohne Shell nicht auflösen; `cd -` meint den vorigen Ordner.
      if (/[$`]/.test(target) || target === "-") continue;
      add(target === "~" ? home : resolveCandidatePath(target, { home, cwd }));
    }
    for (const c of pathCandidates(input.command)) add(absolute(c.path));
  }
  return out;
}

/**
 * Absolute, normalisierte Pfade aus den Werkzeugaufrufen (tool_use) der Antworten eines Transkripts, in Dateireihenfolge:
 * Ordner von file_path und notebook_path, path selbst, jedes cd-Ziel und jeder absolute oder ~/-Pfad im Befehl. Fließtext,
 * Ergebnisse und alle anderen Felder zählen nicht: Dort steht, was Claude erwähnt, nicht, wo es gearbeitet hat.
 */
export function toolPaths(jsonl: string, home: string): string[] {
  const out: string[] = [];
  for (const line of jsonl.split("\n")) {
    // Das meiste Transkript sind Text und Ergebnisse; nur Zeilen mit Werkzeugaufruf werden gelesen.
    if (!line.includes('"tool_use"')) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // die erste Zeile des gelesenen Endes ist meist abgeschnitten
    }
    if (!isRecord(entry) || entry.type !== "assistant" || !isRecord(entry.message) || !Array.isArray(entry.message.content)) continue;
    const cwd = typeof entry.cwd === "string" ? entry.cwd : null;
    for (const item of entry.message.content) {
      if (isRecord(item) && item.type === "tool_use" && isRecord(item.input)) out.push(...inputPaths(item.input, home, cwd));
    }
  }
  return out;
}

/**
 * Basisordner für relative Pfade: jeder Pfad und alle seine Elternordner, neueste zuerst (paths ist chronologisch, der Pfad
 * kommt vor seinen Eltern), ohne Dubletten, höchstens max. Nie home, nie ein Vorfahre von home und nie ein Ordner mit weniger
 * als zwei Stufen (`/`, `/tmp`): Dort läge fast jeder Dateiname, und der Link wäre geraten.
 */
export function linkBases(paths: string[], home: string, max: number): string[] {
  const homeDir = withoutTrailingSlash(posix.normalize(home));
  const bases: string[] = [];
  const seen = new Set<string>();
  const usable = (dir: string): boolean =>
    dir.split("/").filter(Boolean).length >= 2 && dir !== homeDir && !homeDir.startsWith(`${dir}/`) && !seen.has(dir);
  for (let i = paths.length - 1; i >= 0 && bases.length < max; i--) {
    let dir = withoutTrailingSlash(paths[i]);
    if (!dir.startsWith("/")) continue;
    for (; dir !== "/" && bases.length < max; dir = posix.dirname(dir)) {
      if (!usable(dir)) continue;
      seen.add(dir);
      bases.push(dir);
    }
  }
  return bases;
}

/**
 * Relativer Pfad gegen die Basisordner: die Datei im vordersten Basisordner, der sie hat (bases ist neueste zuerst), sonst null.
 * Absolute und ~-Pfade bleiben außen vor. Mehrere Treffer sind der Normalfall mit Worktree neben dem Haupt-Checkout (gemessen
 * 11.10.2026); gemeint ist dann die Kopie, in der Claude zuletzt gearbeitet hat. Welche aufging, zeigt der Fenstertitel.
 */
export function resolveViaBases(rel: string, bases: string[], isFile: (path: string) => boolean): string | null {
  if (!isRelativePath(rel)) return null;
  for (const base of bases) {
    const candidate = posix.join(base, rel);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/**
 * Funde über Polls sammeln: chronologisch, ein erneut gesehener Pfad wandert ans Ende, höchstens cap (die ältesten fallen vorn
 * raus). Was aus dem gelesenen Ende des Transkripts fällt, bleibt so erhalten. Gibt ein neues Array zurück.
 */
export function mergeRecent(prev: string[], next: string[], cap: number): string[] {
  const order = new Set<string>();
  for (const path of [...prev, ...next]) {
    order.delete(path);
    order.add(path);
  }
  return cap <= 0 ? [] : [...order].slice(-cap);
}

/** Vault-relativer Pfad, wenn abs im Vault liegt (nicht der Vault selbst), sonst null. */
export function vaultRelative(abs: string, vaultBase: string | null): string | null {
  if (!vaultBase) return null;
  const base = vaultBase.replace(/\/+$/, "");
  if (!abs.startsWith(`${base}/`)) return null;
  const rel = abs.slice(base.length + 1);
  return rel === "" ? null : rel;
}

/** Was bufferRowOf von einer xterm-Pufferzeile (IBufferLine) braucht. */
export interface BufferLineLike {
  length: number;
  isWrapped: boolean;
  getCell(x: number): { getChars(): string; getWidth(): number } | undefined;
}

/**
 * Pufferzeile als Zellen, höchstens so viele, wie das Terminal Spalten hat. xterm kürzt die Zeilen des alternativen Puffers
 * beim Verkleinern nicht (gemessen 11.10.2026: 57 Spalten, jede Zeile 75 Zellen). Ohne Kürzen sähe rowIsFull nie eine volle
 * Zeile, und unsichtbare Reste von vor dem Verkleinern würden zu Pfadkandidaten.
 */
export function bufferRowOf(line: BufferLineLike, cols: number): CellRow {
  const cells: Cell[] = [];
  for (let x = 0; x < Math.min(line.length, cols); x++) {
    const cell = line.getCell(x);
    cells.push({ chars: cell?.getChars() ?? "", width: cell?.getWidth() ?? 1 });
  }
  return { cells, isWrapped: line.isWrapped };
}

/** Reicht die Zeile bis in die letzte Spalte (letzte Zelle, bei breiten Zeichen deren erste Hälfte, ist kein Leerraum)? */
function rowIsFull(row: CellRow): boolean {
  let i = row.cells.length - 1;
  if (i > 0 && row.cells[i].width === 0) i--;
  const chars = row.cells[i]?.chars ?? "";
  return chars !== "" && chars.trim() !== "";
}

/** Naht zwischen zwei Pufferzeilen: soft (xterm hat umgebrochen), hard (volle Zeile, Claude hat selbst umgebrochen) oder keine. */
function seam(upper: CellRow | null, lower: CellRow | null, hard: boolean): "soft" | "hard" | null {
  if (!upper || !lower) return null;
  if (lower.isWrapped) return "soft";
  const hasText = lower.cells.some((c) => c.chars.trim() !== "");
  return hard && hasText && rowIsFull(upper) ? "hard" : null;
}

/**
 * Die logische Zeile um Pufferzeile y (ab 1). Zellen mit Breite 0 (zweite Hälfte breiter Zeichen) entfallen, leere Zellen
 * werden Leerzeichen. Verbunden wird, was xterm als umgebrochen markiert (isWrapped). Mit hard zusätzlich jede Zeile, die bis
 * in die letzte Spalte reicht, mit der nächsten: Claude bricht Wörter, die länger als die Zeile sind, selbst um, mit echtem
 * Zeilenumbruch und Einrückung, die dann entfällt. Ob das ein Pfad war, entscheidet die Existenzprüfung im host.
 */
export function logicalLine(y: number, row: (y: number) => CellRow | null, hard = false): LogicalLine | null {
  if (!row(y)) return null;
  let top = y;
  while (top > 1 && y - top < MAX_WRAPPED_ROWS && seam(row(top - 1), row(top), hard)) top--;
  let bottom = y;
  while (bottom - top < MAX_WRAPPED_ROWS && seam(row(bottom), row(bottom + 1), hard)) bottom++;
  let text = "";
  const positions: BufferPos[] = [];
  for (let ry = top; ry <= bottom; ry++) {
    const cells = row(ry)?.cells ?? [];
    let skipIndent = ry > top && seam(row(ry - 1), row(ry), hard) === "hard";
    cells.forEach((cell, i) => {
      if (cell.width === 0) return;
      const chars = cell.chars === "" ? " " : cell.chars;
      if (skipIndent && chars.trim() === "") return;
      skipIndent = false;
      text += chars;
      for (let k = 0; k < chars.length; k++) positions.push({ x: i + 1, y: ry });
    });
  }
  return { text, positions };
}

/** Binär, wenn in den ersten 8 KB ein NUL-Byte steht. */
export function looksBinary(head: Uint8Array): boolean {
  return head.subarray(0, 8192).includes(0);
}

/** Größer als die Höchstgröße (MB, Einstellung fileViewerMaxMb)? */
export function exceedsLimit(size: number, maxMb: number): boolean {
  return size > maxMb * 1024 * 1024;
}

/** Vor dem Speichern: Hat sich die Datei seit dem Öffnen geändert (mtime) oder ist sie weg (null), wird gefragt. */
export function saveDecision(openedMtimeMs: number, currentMtimeMs: number | null): "write" | "ask" {
  return currentMtimeMs === openedMtimeMs ? "write" : "ask";
}

export interface ClickKeys {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/**
 * Linke Taste ohne Ctrl und Alt. xterm ruft activate eines Links bei jedem mouseup auf demselben Link
 * (Linkifier._handleMouseUp), auch bei Mittel- und Rechtsklick; Ctrl+Klick ist auf dem Mac das Kontextmenü; mit Alt schickt
 * xterms SelectionService._handleMouseUp (altClickMovesCursor, Vorgabe an) nach dem mouseup Cursor-Sequenzen in die PTY.
 */
export function plainLeftClick(event: ClickKeys): boolean {
  return event.button === 0 && !event.ctrlKey && !event.altKey;
}

/** Nur Cmd+Linksklick öffnet; ein einfacher Klick markiert weiter Text. Die Taste selbst prüfen (xterm hält Obsidian nicht für Mac). */
export function opensOnClick(event: ClickKeys): boolean {
  return plainLeftClick(event) && event.metaKey;
}

/** Zeilenende der Datei, damit Speichern CRLF nicht still in LF verwandelt. */
export function lineSeparatorOf(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}
