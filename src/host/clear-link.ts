import type { ILink, ILinkProvider } from "@xterm/xterm";
import { clearRanges } from "../core/clear-link";
import { type CellRow, logicalLine, plainLeftClick } from "../core/file-links";

// Abend 35: Ein freistehendes „/clear“ im Terminal einer Claude-Sitzung ist ein xterm-Link. xterm fragt provideLinks
// zeilenweise beim Hover ab; die Erkennung selbst ist rein (core/clear-link.ts).

export interface ClearLinkDeps {
  /** Pufferzeile y (ab 1) als Zellen, null außerhalb. */
  row: (y: number) => CellRow | null;
  /** Einstellung clearLink und Sitzungsart (nie Shell), bei jeder Abfrage frisch. */
  enabled: () => boolean;
  /** Gibt es gerade eine Auswahl im Terminal? Bei jedem Klick frisch gefragt. */
  hasSelection: () => boolean;
  /** Schreibt „/clear “ (ohne Enter) in die Eingabezeile der Sitzung dieser View und fokussiert das Terminal. */
  insert: () => void;
}

export class ClearLinkProvider implements ILinkProvider {
  private readonly deps: ClearLinkDeps;

  constructor(deps: ClearLinkDeps) {
    this.deps = deps;
  }

  provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    if (!this.deps.enabled()) return callback(undefined);
    // Nur Zeilen, die xterm selbst als umgebrochen markiert (isWrapped), nicht mit hard: Claudes eigener Umbruch soll kein
    // /clear aus zwei Zeilen zusammensetzen, das nie dasteht.
    const line = logicalLine(y, this.deps.row);
    if (!line) return callback(undefined);
    const links: ILink[] = [];
    for (const r of clearRanges(line.text)) {
      const start = line.positions[r.start];
      const end = line.positions[r.end - 1];
      if (!start || !end) continue;
      links.push({
        range: { start, end },
        text: line.text.slice(r.start, r.end),
        // Keine eigene decorations: Unterstrich und Zeigefinger beim Drüberfahren kommen aus der xterm-Vorgabe, auch ohne Cmd.
        activate: (event) => {
          // Nur die linke Taste ohne Ctrl und Alt (Gründe bei plainLeftClick). Cmd bleibt erlaubt.
          if (!plainLeftClick(event)) return;
          // xterm ruft activate beim mouseup, wenn mousedown und mouseup auf demselben Link liegen (Linkifier._handleMouseUp),
          // also auch nach dem Ziehen innerhalb des Worts. Dann hat der Nutzer markiert und nichts angeklickt.
          if (this.deps.hasSelection()) return;
          event.preventDefault();
          this.deps.insert();
        },
      });
    }
    callback(links.length > 0 ? links : undefined);
  }
}
