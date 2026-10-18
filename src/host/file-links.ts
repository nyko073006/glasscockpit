import type { IBufferRange, ILink, ILinkDecorations, ILinkProvider } from "@xterm/xterm";
import {
  type BufferPos, candidatesWithQuotes, type CellRow, extendCandidates, isRelativePath, type LogicalLine, logicalLine, MAX_PATH_PROBES, opensOnClick,
  pathCandidates, ProbeBudget, resolveCandidatePath, resolveViaBases, vaultRelative, wordLine,
} from "../core/file-links";
import { touchesRow } from "../core/link-guard";

// Datei-Viewer (Abend 27): Pfade im Terminal als xterm-Links. xterm fragt provideLinks zeilenweise beim Hover ab,
// deshalb prüft statSync nur die Kandidaten der Zeile unter der Maus.

/** Was geöffnet wird: absoluter Pfad, optional Zeile und Spalte (ab 1). */
export interface LinkTarget { path: string; line: number | null; col: number | null }

export interface FileLinkDeps {
  /** Pufferzeile y (ab 1) als Zellen, null außerhalb. */
  row: (y: number) => CellRow | null;
  /** Startordner der Sitzung für relative Pfade, null ohne Sitzung. */
  cwd: () => string | null;
  home: string;
  /** Einstellung fileLinks, bei jeder Abfrage frisch. */
  enabled: () => boolean;
  isFile: (path: string) => boolean;
  /** Einstellung fileLinksClaudeDirs, bei jeder Abfrage frisch. */
  claudeDirs: () => boolean;
  /** Basisordner aus Claudes Werkzeugaufrufen dieser Sitzung (TranscriptReader.linkBases), neueste zuerst. */
  bases: () => string[];
  /** Existiert der Pfad als Ordner (Symlinks folgend)? Nur für die Verlängerung von Pfaden mit Leerzeichen (Abend 38). */
  isDir: (path: string) => boolean;
  /** Einstellung fileLinksSpaces, bei jeder Abfrage frisch. */
  spaces: () => boolean;
  open: (target: LinkTarget) => void;
}

/** Pfade mit Leerzeichen (Abend 38) für eine Abfrage: die gefragte Zeile und das gemeinsame Budget der Prüfungen. */
interface SpaceMode { y: number; budget: ProbeBudget }

/** Höchstzahl geprüfter Kandidaten je logischer Zeile (je einer kostet ein statSync). */
const MAX_CANDIDATES = 40;

const decorations = (on: boolean): ILinkDecorations => ({ underline: on, pointerCursor: on });
const before = (a: BufferPos, b: BufferPos): boolean => a.y < b.y || (a.y === b.y && a.x < b.x);
/** Überlappen sich zwei Zellbereiche (Ende jeweils einschließlich)? */
const overlaps = (a: IBufferRange, b: IBufferRange): boolean => !(before(a.end, b.start) || before(b.end, a.start));
/** Liegt inner ganz in outer und beginnt strikt nach dessen Anfang (Ende jeweils einschließlich)? */
const strictlyInside = (inner: IBufferRange, outer: IBufferRange): boolean => before(outer.start, inner.start) && !before(outer.end, inner.end);

export class FileLinkProvider implements ILinkProvider {
  private readonly deps: FileLinkDeps;
  /** Link unter der Maus: Drücken oder Loslassen von Cmd schaltet seine Unterstreichung. */
  private hovered: ILink | null = null;
  /** Zuletzt gesehener Zustand der Cmd-Taste (keydown/keyup an der Pane, metaKey beim Überfahren). */
  private meta = false;

  constructor(deps: FileLinkDeps) {
    this.deps = deps;
  }

  provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    if (!this.deps.enabled()) return callback(undefined);
    const spaces = this.deps.spaces();
    const row = this.deps.row;
    // Erst über Claudes eigene Umbrüche hinweg (volle Zeile + Einrückung), dann ohne sie: Ein Pfad, der zufällig genau am
    // Rand endet, ergäbe zusammengefügt mit dem nächsten Wort keine Datei und soll trotzdem Link bleiben.
    // Mit Pfaden mit Leerzeichen (Abend 38) tritt die Wortzeile an die Stelle der ersten Zeile, dazu kommt ihre Fassung, in der
    // eine volle Zeile ein Leerzeichen bedeutet (ein Pfad mit Leerzeichen, der genau am Rand umbricht).
    const variants = spaces
      ? [wordLine(y, row), wordLine(y, row, true), logicalLine(y, row)]
      : [logicalLine(y, row, true), logicalLine(y, row)];
    const lines: LogicalLine[] = [];
    for (const line of variants) if (line && !lines.some((l) => l.text === line.text)) lines.push(line);
    if (lines.length === 0) return callback(undefined);
    const links: ILink[] = [];
    // Claudes Ordner ändern sich mit dem Transkript: je Abfrage frisch, aber nur einmal und nur, wenn ein Pfad sie braucht.
    let bases: string[] | null = null;
    const getBases = (): string[] => (bases ??= this.deps.bases());
    // Die Prüfungen der Verlängerung teilen sich ein Budget je Abfrage (jede kostet ein statSync).
    const mode: SpaceMode | null = spaces ? { y, budget: new ProbeBudget(MAX_PATH_PROBES) } : null;
    for (const line of lines) this.collect(line, links, getBases, mode);
    callback(links.length > 0 ? links : undefined);
  }

  /** Datei zum Pfad: erst der Startordner, nur wenn dort keine Datei liegt und der Pfad relativ ist, Claudes Ordner (der neueste mit Treffer). */
  private locate(raw: string, getBases: () => string[]): string | null {
    const path = resolveCandidatePath(raw, { home: this.deps.home, cwd: this.deps.cwd() });
    if (path && this.deps.isFile(path)) return path;
    if (!isRelativePath(raw) || !this.deps.claudeDirs()) return null;
    return resolveViaBases(raw, getBases(), this.deps.isFile);
  }

  /**
   * Existierende Pfade der Zeile als Links anhängen; was einen schon gefundenen Link überlappt, entfällt (vor jedem statSync).
   * Mit mode (Pfade mit Leerzeichen, Abend 38) kommen Kandidaten in Anführungszeichen dazu, was die Zeile y nicht berühren kann
   * entfällt vor jedem statSync und zählt nicht gegen MAX_CANDIDATES, und danach verlängert extend einzelne Wörter über
   * Leerzeichen. Ohne mode ist es genau das Verhalten von vor Abend 38.
   */
  private collect(line: LogicalLine, links: ILink[], getBases: () => string[], mode: SpaceMode | null): void {
    const candidates = mode ? candidatesWithQuotes(line.text) : pathCandidates(line.text).slice(0, MAX_CANDIDATES);
    let probed = 0;
    for (const c of candidates) {
      const start = line.positions[c.start];
      const end = line.positions[c.end - 1];
      if (!start || !end || links.some((l) => overlaps(l.range, { start, end }))) continue;
      if (mode && (!touchesRow({ start, end }, mode.y) || ++probed > MAX_CANDIDATES)) continue;
      const path = this.locate(c.path, getBases);
      if (!path) continue;
      links.push(this.makeLink({ start, end }, c.text, { path, line: c.line, col: c.col }));
    }
    if (mode) this.extend(line, links, mode);
  }

  /**
   * Pfade mit Leerzeichen ohne Anführungszeichen (Abend 38), nur gegen den Startordner der Sitzung, nie gegen Claudes Ordner: Jeder
   * Ordner mehr kostete für jedes Wort der Zeile Prüfungen. Bekannte Grenze, siehe CLAUDE.md. Vorrang: Ein Start, der selbst Link
   * ist, verlängert nicht (covered); Einzelwort-Links, die ganz im verlängerten Pfad liegen und nach dessen Anfang beginnen, weichen.
   */
  private extend(line: LogicalLine, links: ILink[], mode: SpaceMode): void {
    const reach = line.positions.findIndex((p) => p.y > mode.y);
    const found = extendCandidates(line.text, {
      home: this.deps.home,
      cwd: this.deps.cwd(),
      isFile: this.deps.isFile,
      isDir: this.deps.isDir,
      budget: mode.budget,
      covered: (s, e) => {
        const start = line.positions[s];
        const end = line.positions[e - 1];
        return !!start && !!end && links.some((l) => overlaps(l.range, { start, end }));
      },
      until: reach < 0 ? undefined : reach,
    });
    for (const c of found) {
      const start = line.positions[c.start];
      const end = line.positions[c.end - 1];
      if (!start || !end || !touchesRow({ start, end }, mode.y)) continue;
      const range = { start, end };
      // Die Verlängerung hat den ganzen Pfad als Datei geprüft. Einzelwort-Links, die ganz in ihm liegen und nach seinem Anfang
      // beginnen (das Endwort `Index.md` eines Pfads `… Projekt Index.md`, das es auch in der Wurzel gibt), weichen ihm. Überlappt
      // sie einen Link nur teilweise oder einen, der am selben Anfang oder davor beginnt, bleibt der Link und sie entfällt.
      const hit = links.filter((l) => overlaps(l.range, range));
      if (!hit.every((l) => strictlyInside(l.range, range))) continue;
      for (const l of hit) links.splice(links.indexOf(l), 1);
      links.push(this.makeLink(range, c.text, { path: c.abs, line: c.line, col: c.col }));
    }
  }

  private makeLink(range: IBufferRange, text: string, target: LinkTarget): ILink {
    const link: ILink = {
      range,
      text,
      // Unterstrichen nur mit gedrückter Cmd-Taste, wie in Editoren üblich; ohne Cmd bleibt es Text zum Markieren.
      decorations: decorations(this.meta),
      activate: (event) => {
        if (!opensOnClick(event)) return;
        event.preventDefault();
        this.deps.open(target);
      },
      hover: (event) => {
        this.hovered = link;
        this.meta = event.metaKey;
        // xterm liest decorations vor hover und ersetzt das Objekt direkt danach durch eines mit Settern
        // (Linkifier._handleNewLink); erst dessen Eigenschaften setzen wirkt, also nach diesem Aufruf.
        queueMicrotask(() => this.decorate(link));
      },
      leave: () => {
        if (this.hovered === link) this.hovered = null;
      },
    };
    return link;
  }

  /** Cmd gedrückt oder losgelassen (keydown/keyup an der Pane): Link unter der Maus neu dekorieren. */
  setModifier(meta: boolean): void {
    this.meta = meta;
    if (this.hovered) this.decorate(this.hovered);
  }

  /** Eigenschaften setzen, nie das Objekt tauschen: Nur so meldet xterm die Änderung an die Darstellung. */
  private decorate(link: ILink): void {
    const d = link.decorations;
    if (!d) return;
    d.underline = this.meta;
    d.pointerCursor = this.meta;
  }
}

export interface OpenPathDeps {
  vaultBase: () => string | null;
  /** Als Obsidian-Tab öffnen; false, wenn der Vault die Datei nicht als Tab zeigen kann (unbekannter Typ, .obsidian/). */
  openInVault: (rel: string, target: LinkTarget) => Promise<boolean>;
  openInModal: (target: LinkTarget) => void;
}

/** Vault-Dateien als Tab, alles andere (und was der Vault nicht zeigen kann) im Fenster. */
export async function openTerminalPath(target: LinkTarget, deps: OpenPathDeps): Promise<void> {
  const rel = vaultRelative(target.path, deps.vaultBase());
  if (rel !== null && (await deps.openInVault(rel, target))) return;
  deps.openInModal(target);
}
