import type { IBufferRange, ILink, ILinkDecorations, ILinkProvider } from "@xterm/xterm";
import {
  type BufferPos, type CellRow, isRelativePath, type LogicalLine, logicalLine, opensOnClick, pathCandidates, resolveCandidatePath, resolveViaBases,
  vaultRelative,
} from "../core/file-links";

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
  open: (target: LinkTarget) => void;
}

/** Höchstzahl geprüfter Kandidaten je logischer Zeile (je einer kostet ein statSync). */
const MAX_CANDIDATES = 40;

const decorations = (on: boolean): ILinkDecorations => ({ underline: on, pointerCursor: on });
const before = (a: BufferPos, b: BufferPos): boolean => a.y < b.y || (a.y === b.y && a.x < b.x);
/** Überlappen sich zwei Zellbereiche (Ende jeweils einschließlich)? */
const overlaps = (a: IBufferRange, b: IBufferRange): boolean => !(before(a.end, b.start) || before(b.end, a.start));

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
    // Erst über Claudes eigene Umbrüche hinweg (volle Zeile + Einrückung), dann ohne sie: Ein Pfad, der zufällig genau am
    // Rand endet, ergäbe zusammengefügt mit dem nächsten Wort keine Datei und soll trotzdem Link bleiben.
    const joined = logicalLine(y, this.deps.row, true);
    const plain = logicalLine(y, this.deps.row);
    if (!joined || !plain) return callback(undefined);
    const links: ILink[] = [];
    // Claudes Ordner ändern sich mit dem Transkript: je Abfrage frisch, aber nur einmal und nur, wenn ein Pfad sie braucht.
    let bases: string[] | null = null;
    const getBases = (): string[] => (bases ??= this.deps.bases());
    for (const line of joined.text === plain.text ? [joined] : [joined, plain]) this.collect(line, links, getBases);
    callback(links.length > 0 ? links : undefined);
  }

  /** Datei zum Pfad: erst der Startordner, nur wenn dort keine Datei liegt und der Pfad relativ ist, Claudes Ordner (der neueste mit Treffer). */
  private locate(raw: string, getBases: () => string[]): string | null {
    const path = resolveCandidatePath(raw, { home: this.deps.home, cwd: this.deps.cwd() });
    if (path && this.deps.isFile(path)) return path;
    if (!isRelativePath(raw) || !this.deps.claudeDirs()) return null;
    return resolveViaBases(raw, getBases(), this.deps.isFile);
  }

  /** Existierende Pfade der Zeile als Links anhängen; was einen schon gefundenen Link überlappt, entfällt (vor jedem statSync). */
  private collect(line: LogicalLine, links: ILink[], getBases: () => string[]): void {
    for (const c of pathCandidates(line.text).slice(0, MAX_CANDIDATES)) {
      const start = line.positions[c.start];
      const end = line.positions[c.end - 1];
      if (!start || !end || links.some((l) => overlaps(l.range, { start, end }))) continue;
      const path = this.locate(c.path, getBases);
      if (!path) continue;
      const target: LinkTarget = { path, line: c.line, col: c.col };
      const link: ILink = {
        range: { start, end },
        text: c.text,
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
      links.push(link);
    }
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
