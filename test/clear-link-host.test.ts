import type { ILink } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import type { CellRow } from "../src/core/file-links";
import { ClearLinkProvider } from "../src/host/clear-link";

const rowOf = (text: string, isWrapped = false): CellRow => ({ cells: Array.from(text, (chars) => ({ chars, width: 1 })), isWrapped });
/** Zeile mit breiten Zeichen wie in xterm: das Zeichen belegt zwei Zellen, die zweite hat Breite 0 und keinen Inhalt. */
const rowWide = (text: string): CellRow => ({
  cells: Array.from(text).flatMap((chars) => (chars === "界" ? [{ chars, width: 2 }, { chars: "", width: 0 }] : [{ chars, width: 1 }])),
  isWrapped: false,
});

function setup(lines: CellRow[], opts: { enabled?: boolean; selection?: boolean } = {}) {
  const insert = vi.fn<() => void>();
  const row = vi.fn((y: number) => lines[y - 1] ?? null);
  const provider = new ClearLinkProvider({
    row,
    enabled: () => opts.enabled ?? true,
    hasSelection: () => opts.selection ?? false,
    insert,
  });
  const links = (y: number): ILink[] | undefined => {
    let result: ILink[] | undefined = [];
    provider.provideLinks(y, (l) => (result = l));
    return result;
  };
  return { links, insert, row };
}
/** Der erste Link; fehlt er, scheitert der Test hier an der Zusicherung statt später an einem Zugriff. */
const first = (found: ILink[] | undefined): ILink => {
  expect(found?.length ?? 0).toBeGreaterThan(0);
  return (found as ILink[])[0];
};
/** Mausereignis wie beim mouseup: linke Taste (button 0) ohne Ctrl, wenn nichts anderes verlangt ist. */
const click = (meta = false, extra: { button?: number; ctrlKey?: boolean; altKey?: boolean } = {}) =>
  ({ button: 0, ctrlKey: false, altKey: false, metaKey: meta, ...extra, preventDefault: vi.fn() }) as unknown as MouseEvent & { preventDefault: ReturnType<typeof vi.fn> };

describe("ClearLinkProvider: Erkennung", () => {
  it("freistehendes /clear wird Link mit Text und Bereich in Zellen", () => {
    const { links } = setup([rowOf("Jetzt mit /clear wipen.")]);
    expect(links(1)?.map((x) => [x.text, x.range])).toEqual([["/clear", { start: { x: 11, y: 1 }, end: { x: 16, y: 1 } }]]);
  });
  it("zwei Treffer in einer Zeile: zwei Links", () => {
    const { links } = setup([rowOf("/clear oder /clear")]);
    expect(links(1)?.map((x) => x.range)).toEqual([
      { start: { x: 1, y: 1 }, end: { x: 6, y: 1 } },
      { start: { x: 13, y: 1 }, end: { x: 18, y: 1 } },
    ]);
  });
  it("hinter einem breiten Zeichen zählen die Zellen, nicht die Zeichen", () => {
    // 界 belegt die Zellen 1 und 2, das Leerzeichen Zelle 3, /clear die Zellen 4 bis 9.
    const { links } = setup([rowWide("界 /clear")]);
    expect(links(1)?.map((x) => [x.text, x.range])).toEqual([["/clear", { start: { x: 4, y: 1 }, end: { x: 9, y: 1 } }]]);
  });
  it("über den Zeilenumbruch (isWrapped): ein Link über zwei Zeilen, von beiden Zeilen aus", () => {
    const lines = [rowOf("Jetzt /cle"), rowOf("ar wipen", true)];
    const { links } = setup(lines);
    const expected = [["/clear", { start: { x: 7, y: 1 }, end: { x: 2, y: 2 } }]];
    for (const y of [1, 2]) expect(links(y)?.map((x) => [x.text, x.range])).toEqual(expected);
  });
  it("Gegentest: Claudes eigener Umbruch (volle Zeile, keine isWrapped-Marke) fügt nichts zusammen", () => {
    // Anders als bei Pfaden kein hard: ein /clear, das am Rand abreißt, soll nicht aus zwei Zeilen geraten.
    const { links } = setup([rowOf("Jetzt /cle"), rowOf("ar wipen")]);
    expect(links(1)).toBeUndefined();
    expect(links(2)).toBeUndefined();
  });
  it("kein Treffer: undefined wie beim FileLinkProvider, nicht []", () => {
    const { links } = setup([rowOf("src/clear.ts und /clearable")]);
    expect(links(1)).toBeUndefined();
  });
  it("Zeile außerhalb des Puffers: undefined", () => {
    const { links } = setup([rowOf("/clear")]);
    expect(links(5)).toBeUndefined();
  });
  it("Einstellung aus (oder Shell): undefined, ohne die Zeile zu lesen", () => {
    const { links, row } = setup([rowOf("/clear")], { enabled: false });
    expect(links(1)).toBeUndefined();
    expect(row).not.toHaveBeenCalled();
  });
  it("der Link bringt keine eigene Dekoration mit: Unterstrich und Zeigefinger kommen aus der xterm-Vorgabe", () => {
    const { links } = setup([rowOf("/clear")]);
    expect(links(1)?.[0].decorations).toBeUndefined();
  });
});

describe("ClearLinkProvider: Klick", () => {
  it("normaler Klick ohne Auswahl: genau einmal einfügen, preventDefault", () => {
    const { links, insert } = setup([rowOf("/clear")]);
    const link = first(links(1));
    const event = click();
    link.activate(event, link.text);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });
  it("Klick mit Cmd fügt ebenfalls ein", () => {
    const { links, insert } = setup([rowOf("/clear")]);
    const link = first(links(1));
    link.activate(click(true), link.text);
    expect(insert).toHaveBeenCalledTimes(1);
  });
  // xterm ruft activate bei jedem mouseup auf demselben Link (Linkifier._handleMouseUp), welche Taste auch gedrückt war.
  it.each([
    ["Mittelklick", { button: 1 }],
    ["Rechtsklick (Kontextmenü)", { button: 2 }],
    ["Ctrl+Linksklick (auf dem Mac das Kontextmenü)", { button: 0, ctrlKey: true }],
    // Mit Alt schickt xterms SelectionService._handleMouseUp (altClickMovesCursor, Vorgabe an) nach dem mouseup Cursor-Sequenzen.
    ["Alt+Linksklick", { button: 0, altKey: true }],
  ])("%s fügt nichts ein und lässt das Ereignis unberührt", (_name, extra) => {
    const { links, insert } = setup([rowOf("/clear")]);
    const link = first(links(1));
    const event = click(false, extra);
    link.activate(event, link.text);
    expect(insert).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it("Linksklick mit Cmd und Ctrl zusammen: Ctrl gewinnt, nichts wird eingefügt", () => {
    const { links, insert } = setup([rowOf("/clear")]);
    const link = first(links(1));
    link.activate(click(true, { ctrlKey: true }), link.text);
    expect(insert).not.toHaveBeenCalled();
  });
  it("Ziehen fügt nichts ein: bei Auswahl bleibt insert ungerufen", () => {
    const { links, insert } = setup([rowOf("/clear")], { selection: true });
    const link = first(links(1));
    const event = click();
    link.activate(event, link.text);
    expect(insert).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it("die Auswahl wird beim Klick gelesen, nicht beim Anlegen des Links", () => {
    let selection = false;
    const insert = vi.fn<() => void>();
    const provider = new ClearLinkProvider({ row: (y) => (y === 1 ? rowOf("/clear") : null), enabled: () => true, hasSelection: () => selection, insert });
    let found: ILink[] | undefined;
    provider.provideLinks(1, (l) => (found = l));
    const link = first(found);
    selection = true;
    link.activate(click(), "/clear");
    expect(insert).not.toHaveBeenCalled();
    selection = false;
    link.activate(click(), "/clear");
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
