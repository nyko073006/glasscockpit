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

/** Ein Token ohne :zeile[:spalte]: path, klickbarer text (mit Zeile, wenn eine da ist), Zeile und Spalte. */
interface ParsedToken { path: string; text: string; line: number | null; col: number | null }

/** Zerlegt ein Token (Satzzeichen hinten schon ab) in Pfad und :zeile[:spalte]; text ist immer ein Anfangsstück des Tokens. */
function parseToken(token: string): ParsedToken {
  const suffix = LINE_SUFFIX.exec(token);
  if (!suffix) return { path: token, text: token, line: null, col: null };
  const path = token.slice(0, suffix.index);
  const l = Number(suffix[1]);
  const c = suffix[2] === undefined ? 0 : Number(suffix[2]);
  if (l <= 0) return { path, text: path, line: null, col: null };
  const col = c > 0 ? c : null;
  return { path, text: col === null ? `${path}:${l}` : token, line: l, col };
}

/** Ein Pfad enthält einen Buchstaben und einen Schrägstrich oder Punkt (also auch `package.json`). */
const isPathLike = (path: string): boolean => LETTER.test(path) && /[/.]/.test(path);

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
    const { path, text, line: lineNo, col } = parseToken(token);
    if (!isPathLike(path)) continue;
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

// Pfade mit Leerzeichen (Abend 38): TOKEN trennt an Leerraum, ein Pfad wie `02 Projekte/x y.md` zerfiele in lauter Wörter, die es
// nicht gibt. Drei Hilfen, alle rein; ob ein Pfad existiert, fragen sie über eingespeiste Prüfungen (der host liefert statSync).

/** Wie viele Wörter ein Pfad ohne Anführungszeichen höchstens hat (Startwort eingerechnet). */
export const MAX_PATH_WORDS = 16;
/** Wie viele Datei- und Ordnerprüfungen die Verlängerung je Abfrage (provideLinks) höchstens macht; jede kostet ein statSync. */
export const MAX_PATH_PROBES = 200;
/** Wie viele Pufferzeilen über und unter der gefragten Zeile eine Wortnaht noch verbindet (wordLine). */
export const WORD_SEAM_ROWS = 2;

// Inhalt zwischen gleichen Anführungszeichen. Das einfache nur, wenn davor und dahinter kein Buchstabe und keine Ziffer steht:
// sonst klammerte der Apostroph in `it's … 'x'` ein Stück Prosa ein und verschöbe alle folgenden Paare.
const QUOTED = /"([^"\n]+)"|(?<![\p{L}\p{N}])'([^'\n]+)'(?![\p{L}\p{N}])|`([^`\n]+)`/gu;

/**
 * Zusätzliche Kandidaten aus Anführungszeichen: der ganze Inhalt zwischen `"…"`, `'…'` oder `` `…` `` ist ein Pfad, wenn er
 * Leerraum enthält (ohne Leerraum liefert pathCandidates ihn schon), keine URL ist und wie jeder Kandidat einen Buchstaben und
 * einen Schrägstrich oder Punkt hat. `:zeile[:spalte]` am Ende gilt; Satzzeichen im Inhalt werden nicht abgeschnitten, die
 * Anführung sagt, wo der Pfad endet. Ein `@` vor dem öffnenden Zeichen stört nicht, es liegt außerhalb.
 */
export function quotedCandidates(line: string): PathCandidate[] {
  const result: PathCandidate[] = [];
  for (const match of line.matchAll(QUOTED)) {
    const inner = match[1] ?? match[2] ?? match[3];
    if (!/\s/.test(inner) || inner.includes("://")) continue;
    const start = (match.index ?? 0) + 1;
    const { path, text, line: lineNo, col } = parseToken(inner);
    if (!isPathLike(path)) continue;
    result.push({ start, end: start + text.length, text, path, line: lineNo, col });
  }
  return result;
}

/** pathCandidates und quotedCandidates zusammen, nach start aufsteigend, bei gleichem start der längere zuerst (sonst gewänne ein Wort im Inneren). */
export function candidatesWithQuotes(line: string): PathCandidate[] {
  return [...pathCandidates(line), ...quotedCandidates(line)].sort((a, b) => a.start - b.start || b.end - a.end);
}

/**
 * Zählt die Datei- und Ordnerprüfungen einer Abfrage herunter und merkt sich ihre Antworten: Dieselbe Prüfung kostet nur einmal
 * (die Ordnerprüfung vor `a b` und vor `a b c` ist dieselbe). Ist das Budget leer, gibt probe undefined zurück.
 */
export class ProbeBudget {
  private left: number;
  private readonly seen = new Map<string, boolean>();

  constructor(max = MAX_PATH_PROBES) {
    this.left = max;
  }

  /** Antwort von fn für key: aus dem Gedächtnis (kostenlos) oder frisch (kostet eine Prüfung); undefined, wenn nichts mehr übrig ist. */
  probe(key: string, fn: () => boolean): boolean | undefined {
    const known = this.seen.get(key);
    if (known !== undefined) return known;
    if (this.left <= 0) return undefined;
    this.left--;
    const result = fn();
    this.seen.set(key, result);
    return result;
  }
}

export interface ExtendContext {
  home: string;
  /** Startordner der Sitzung; relative Pfade gelten nur gegen ihn (nie gegen Claudes Ordner), ohne ihn gibt es für sie nichts zu prüfen. */
  cwd: string | null;
  isFile: (abs: string) => boolean;
  isDir: (abs: string) => boolean;
  budget: ProbeBudget;
  /** Liegt der Textbereich [start, end) schon in einem Link? Dann entfällt der Start vor jeder Prüfung. */
  covered?: (start: number, end: number) => boolean;
  /** Starts ab diesem Textindex entfallen: Sie können die gefragte Zeile nicht mehr berühren. */
  until?: number;
}

/** Ein verlängerter Kandidat samt dem absoluten Pfad, dessen Existenz schon geprüft ist. */
export interface ExtendedCandidate extends PathCandidate { abs: string }

const DOTTED = /\.[\p{L}\p{N}]/u;
const ALNUM = /[\p{L}\p{N}]/u;

/**
 * Pfade mit Leerzeichen ohne Anführungszeichen. Jedes Wort ist ein Start; von dort wird über genau ein Leerzeichen zwischen zwei
 * Wörtern verlängert, höchstens MAX_PATH_WORDS Wörter, und der LÄNGSTE Pfad genommen, den es als Datei gibt (Text danach gehört
 * nicht dazu). Je Schritt gelten Satzzeichen hinten und :zeile[:spalte] am Ende des verlängerten Textes. Enthält der Text einen
 * Schrägstrich, muss sein Ordnerteil (bis zum letzten Schrägstrich) ein Ordner sein, sonst endet dieser Start: Jeder längere Text
 * hat diesen Ordnerteil als Vorfahren. Eine Datei wird geprüft, wenn ein Schrägstrich im Text steht oder (ohne) das letzte Wort
 * einen Punkt und danach Buchstabe oder Ziffer hat. Ob schon das Startwort allein eine Datei ist, prüft nicht diese Funktion: Der
 * host prüft zuerst die einzelnen Wörter, und was dort Link wurde, meldet covered. Ist das Budget leer, endet alles; was bis dahin
 * gefunden ist, bleibt.
 */
export function extendCandidates(line: string, ctx: ExtendContext): ExtendedCandidate[] {
  const words = [...line.matchAll(TOKEN)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const result: ExtendedCandidate[] = [];
  const taken = (s: number, e: number): boolean => result.some((r) => s < r.end && e > r.start) || (ctx.covered?.(s, e) ?? false);
  const resolveCtx = { home: ctx.home, cwd: ctx.cwd };
  const until = ctx.until ?? Infinity;
  let stopped = false;
  for (let i = 0; i < words.length - 1 && !stopped; i++) {
    let s = words[i].start;
    while (s < words[i].end && line[s] === "@") s++;
    if (s >= until) break;
    const first = line.slice(s, words[i].end);
    if (!ALNUM.test(first) || first.includes("://") || taken(s, words[i].end)) continue;
    let best: ExtendedCandidate | null = null;
    for (let k = i + 1; k < words.length && k - i < MAX_PATH_WORDS; k++) {
      if (line.slice(words[k - 1].end, words[k].start) !== " ") break;
      const { path, text, line: lineNo, col } = parseToken(line.slice(s, words[k].end).replace(TRAILING, ""));
      if (path.includes("/")) {
        const cut = path.lastIndexOf("/");
        const dir = cut === 0 ? "/" : path.slice(0, cut);
        const absDir = dir === "~" ? ctx.home : resolveCandidatePath(dir, resolveCtx);
        if (!absDir) break;
        const isDir = ctx.budget.probe(`d:${absDir}`, () => ctx.isDir(absDir));
        if (isDir === undefined) stopped = true;
        if (!isDir) break;
      } else if (!DOTTED.test(line.slice(words[k].start, words[k].end))) continue;
      const abs = resolveCandidatePath(path, resolveCtx);
      if (!abs) continue;
      const isFile = ctx.budget.probe(`f:${abs}`, () => ctx.isFile(abs));
      if (isFile === undefined) stopped = true;
      if (isFile) best = { start: s, end: s + text.length, text, path, line: lineNo, col, abs };
      if (stopped) break;
    }
    if (best) result.push(best);
  }
  return result;
}

/** Naht zwischen zwei Pufferzeilen für wordLine: soft (xterm hat umgebrochen), hard (obere Zeile voll), word (obere Zeile endet vor dem Rand, beide haben Text). */
function wordSeam(upper: CellRow | null, lower: CellRow | null): "soft" | "hard" | "word" | null {
  if (!upper || !lower) return null;
  if (lower.isWrapped) return "soft";
  const hasText = (r: CellRow): boolean => r.cells.some((c) => c.chars.trim() !== "");
  if (!hasText(upper) || !hasText(lower)) return null;
  return rowIsFull(upper) ? "hard" : "word";
}

/**
 * Logische Zeile für Pfade mit Leerzeichen. Wie logicalLine mit hard (xterm-Umbruch ohne Zeichen, volle Zeile ohne Zeichen und
 * ohne Einrückung der unteren), dazu die Wortnaht: Claude Code bricht Prosa selbst an Leerzeichen um (echter Zeilenumbruch plus
 * Einrückung, xterm setzt kein isWrapped). Eine Wortnaht verbindet mit genau einem Leerzeichen, die obere Zeile ohne Leerzeichen
 * am Ende, die untere ohne Einrückung, nur bis WORD_SEAM_ROWS Zeilen über und unter y; leere Zeilen verbinden nie. Das Leerzeichen
 * bekommt die Zelle hinter dem letzten Zeichen der oberen Zeile (höchstens die letzte Spalte) und ist nie Anfang oder Ende eines
 * Links. Xterm-Umbrüche und volle Zeilen verbinden unbegrenzt (bis MAX_WRAPPED_ROWS wie bei logicalLine), sonst gehörte ein weich
 * umgebrochener Absatz nur halb dazu. Eine volle Zeile ist mehrdeutig: Hat Claude ein zu langes Wort selbst gebrochen, fehlt kein
 * Zeichen; ist ein Wort zufällig genau bis zum Rand gegangen und das Leerzeichen dahinter dem Umbruch zum Opfer gefallen, fehlt
 * eins. Mit fullAsSpace gilt Letzteres; der host fragt beide Fassungen.
 */
export function wordLine(y: number, row: (y: number) => CellRow | null, fullAsSpace = false): LogicalLine | null {
  const cache = new Map<number, CellRow | null>();
  const get = (r: number): CellRow | null => {
    if (!cache.has(r)) cache.set(r, row(r));
    return cache.get(r) ?? null;
  };
  if (!get(y)) return null;
  const seamAbove = (r: number) => wordSeam(get(r - 1), get(r));
  let top = y;
  while (top > 1 && y - top < MAX_WRAPPED_ROWS) {
    const kind = seamAbove(top);
    if (kind === null || (kind === "word" && y - (top - 1) > WORD_SEAM_ROWS)) break;
    top--;
  }
  let bottom = y;
  while (bottom - top < MAX_WRAPPED_ROWS) {
    const kind = seamAbove(bottom + 1);
    if (kind === null || (kind === "word" && bottom + 1 - y > WORD_SEAM_ROWS)) break;
    bottom++;
  }
  let text = "";
  const positions: BufferPos[] = [];
  for (let ry = top; ry <= bottom; ry++) {
    const cells = get(ry)?.cells ?? [];
    const above = ry > top ? seamAbove(ry) : null;
    const below = ry < bottom ? seamAbove(ry + 1) : null;
    const spaceBelow = below === "word" || (fullAsSpace && below === "hard");
    let last = cells.length - 1;
    if (spaceBelow) while (last >= 0 && (cells[last].width === 0 || cells[last].chars.trim() === "")) last--;
    let skipIndent = above === "hard" || above === "word";
    for (let i = 0; i <= last; i++) {
      const cell = cells[i];
      if (cell.width === 0) continue;
      const chars = cell.chars === "" ? " " : cell.chars;
      if (skipIndent && chars.trim() === "") continue;
      skipIndent = false;
      text += chars;
      for (let k = 0; k < chars.length; k++) positions.push({ x: i + 1, y: ry });
    }
    if (spaceBelow) {
      text += " ";
      positions.push({ x: Math.min(last + (cells[last]?.width ?? 1) + 1, cells.length), y: ry });
    }
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
