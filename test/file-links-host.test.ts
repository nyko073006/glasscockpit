import type { ILink } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import type { CellRow } from "../src/core/file-links";
import { FileLinkProvider, type LinkTarget, openTerminalPath } from "../src/host/file-links";

const rowOf = (text: string, isWrapped = false): CellRow => ({ cells: Array.from(text, (chars) => ({ chars, width: 1 })), isWrapped });
/** Zeile in voller Terminalbreite wie in xterm: leere Zellen bis zum Rand. */
const rowW = (text: string, width: number): CellRow => ({
  cells: Array.from(text.padEnd(width, "\0"), (ch) => (ch === "\0" ? { chars: "", width: 1 } : { chars: ch, width: 1 })),
  isWrapped: false,
});

function setup(lines: CellRow[], files: string[], opts: { enabled?: boolean; cwd?: string | null; claudeDirs?: boolean; bases?: string[] } = {}) {
  const open = vi.fn<(t: LinkTarget) => void>();
  const isFile = vi.fn((p: string) => files.includes(p));
  const bases = vi.fn(() => opts.bases ?? []);
  const provider = new FileLinkProvider({
    row: (y) => lines[y - 1] ?? null,
    cwd: () => (opts.cwd === undefined ? "/repo" : opts.cwd),
    home: "/Users/n",
    enabled: () => opts.enabled ?? true,
    isFile,
    claudeDirs: () => opts.claudeDirs ?? true,
    bases,
    open,
  });
  const links = (y: number): ILink[] | undefined => {
    let result: ILink[] | undefined;
    provider.provideLinks(y, (l) => (result = l));
    return result;
  };
  return { provider, links, open, isFile, bases };
}
/** Mausereignis wie beim mouseup: linke Taste (button 0) ohne Ctrl und Alt, wenn nichts anderes verlangt ist. */
const click = (meta: boolean, extra: { button?: number; ctrlKey?: boolean; altKey?: boolean } = {}) =>
  ({ button: 0, ctrlKey: false, altKey: false, metaKey: meta, ...extra, preventDefault: vi.fn() }) as unknown as MouseEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
  };

describe("FileLinkProvider", () => {
  it("existierende Datei wird Link mit Bereich in Zellen", () => {
    const { links } = setup([rowOf("siehe `src/main.ts:10` und docs")], ["/repo/src/main.ts"]);
    const l = links(1);
    expect(l?.map((x) => [x.text, x.range])).toEqual([["src/main.ts:10", { start: { x: 8, y: 1 }, end: { x: 21, y: 1 } }]]);
  });
  it("Gegentest: nicht existierender Pfad und Ordner werden kein Link", () => {
    const { links } = setup([rowOf("erfunden/datei.md und src")], ["/repo/anderes.md"]);
    expect(links(1) ?? []).toEqual([]);
  });
  it("Gegentest: Klick ohne Cmd öffnet nicht, mit Cmd schon (mit Zeile und Spalte)", () => {
    const { links, open } = setup([rowOf("~/a.md:3:2")], ["/Users/n/a.md"]);
    const link = links(1)?.[0];
    link?.activate(click(false), link.text);
    expect(open).not.toHaveBeenCalled();
    link?.activate(click(true), link.text);
    expect(open).toHaveBeenCalledWith({ path: "/Users/n/a.md", line: 3, col: 2 });
  });
  // xterm ruft activate bei jedem mouseup auf demselben Link (Linkifier._handleMouseUp), welche Taste auch gedrückt war.
  it.each([
    ["Cmd+Mittelklick", { button: 1 }],
    ["Cmd+Rechtsklick (Kontextmenü)", { button: 2 }],
    ["Cmd+Ctrl+Linksklick (auf dem Mac das Kontextmenü)", { button: 0, ctrlKey: true }],
    // Mit Alt schickt xterms SelectionService._handleMouseUp (altClickMovesCursor, Vorgabe an) nach dem mouseup Cursor-Sequenzen.
    ["Cmd+Alt+Linksklick", { button: 0, altKey: true }],
  ])("%s öffnet nicht und lässt das Ereignis unberührt", (_name, extra) => {
    const { links, open } = setup([rowOf("~/a.md:3:2")], ["/Users/n/a.md"]);
    const link = links(1)?.[0];
    expect(link).toBeDefined();
    const event = click(true, extra);
    link?.activate(event, link.text);
    expect(open).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it("umgebrochener Pfad ist auch aus der zweiten Zeile ganz klickbar", () => {
    const { links } = setup([rowOf("/abs/lan"), rowOf("g.md ok", true)], ["/abs/lang.md"]);
    expect(links(2)?.map((x) => [x.text, x.range])).toEqual([["/abs/lang.md", { start: { x: 1, y: 1 }, end: { x: 4, y: 2 } }]]);
  });
  it("von Claude selbst umgebrochener Pfad (volle Zeile, Einrückung) ist ganz klickbar", () => {
    const { links } = setup([rowW("  /abs/lan", 10), rowW("  g.md ok", 10)], ["/abs/lang.md"]);
    for (const y of [1, 2]) expect(links(y)?.map((x) => [x.text, x.range])).toEqual([["/abs/lang.md", { start: { x: 3, y: 1 }, end: { x: 6, y: 2 } }]]);
  });
  it("Pfad endet zufällig am Rand: gibt es den zusammengefügten nicht, gilt die Zeile allein", () => {
    const { links } = setup([rowW("x /abs/a.md", 11), rowW("  und mehr", 11)], ["/abs/a.md"]);
    expect(links(1)?.map((x) => [x.text, x.range])).toEqual([["/abs/a.md", { start: { x: 3, y: 1 }, end: { x: 11, y: 1 } }]]);
  });
  it("Einstellung aus: keine Links", () => {
    const { links } = setup([rowOf("/abs/a.md")], ["/abs/a.md"], { enabled: false });
    expect(links(1)).toBeUndefined();
  });
  // Nachgestellt nach xterm 6.0.0 (src/browser/Linkifier.ts, _handleNewLink): xterm liest decorations, ruft hover und
  // ersetzt link.decorations danach durch ein Objekt mit Settern. Nur Zuweisungen an dessen Eigenschaften kommen an.
  const xtermHover = (link: ILink, meta: boolean) => {
    const state = { underline: link.decorations?.underline ?? true, pointerCursor: link.decorations?.pointerCursor ?? true };
    link.hover?.(click(meta), link.text);
    const tracked = {} as ILink["decorations"] & object;
    Object.defineProperties(tracked, {
      underline: { get: () => state.underline, set: (v: boolean) => { state.underline = v; } },
      pointerCursor: { get: () => state.pointerCursor, set: (v: boolean) => { state.pointerCursor = v; } },
    });
    link.decorations = tracked;
    return state;
  };
  const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

  it("unterstrichen nur mit gedrückter Cmd-Taste, auch beim Drücken und Loslassen über dem Link", async () => {
    const { links, provider } = setup([rowOf("/abs/a.md")], ["/abs/a.md"]);
    const link = links(1)?.[0] as ILink;
    const state = xtermHover(link, true);
    await tick();
    expect(state).toEqual({ underline: true, pointerCursor: true });
    provider.setModifier(false);
    expect(state).toEqual({ underline: false, pointerCursor: false });
    provider.setModifier(true);
    expect(state).toEqual({ underline: true, pointerCursor: true });
    link.leave?.(click(true), link.text);
    provider.setModifier(false);
    expect(state).toEqual({ underline: true, pointerCursor: true });
  });
  it("ohne Cmd beim Überfahren nicht unterstrichen", async () => {
    const { links } = setup([rowOf("/abs/a.md")], ["/abs/a.md"]);
    const state = xtermHover(links(1)?.[0] as ILink, false);
    await tick();
    expect(state).toEqual({ underline: false, pointerCursor: false });
  });
  it("Cmd schon gedrückt, bevor die Maus kommt: sofort unterstrichen", () => {
    const { links, provider } = setup([rowOf("/abs/a.md")], ["/abs/a.md"]);
    provider.setModifier(true);
    const state = xtermHover(links(1)?.[0] as ILink, true);
    expect(state).toEqual({ underline: true, pointerCursor: true });
  });
});

describe("FileLinkProvider: relative Pfade über Claudes Ordner (Abend 27b)", () => {
  it("kein Treffer im Startordner, genau einer in einem Basisordner: Link auf diese Datei", () => {
    const { links, open } = setup([rowOf("siehe src/main.ts:10 dort")], ["/work/app/src/main.ts"], { bases: ["/work/lib", "/work/app"] });
    const l = links(1);
    expect(l?.map((x) => [x.text, x.range])).toEqual([["src/main.ts:10", { start: { x: 7, y: 1 }, end: { x: 20, y: 1 } }]]);
    l?.[0].activate(click(true), l[0].text);
    expect(open).toHaveBeenCalledWith({ path: "/work/app/src/main.ts", line: 10, col: null });
  });
  it("auch ohne Startordner der Sitzung", () => {
    const { links } = setup([rowOf("src/main.ts")], ["/work/app/src/main.ts"], { cwd: null, bases: ["/work/app"] });
    expect(links(1)?.map((x) => x.text)).toEqual(["src/main.ts"]);
  });
  it("Gegentest: zwei Basisordner haben die Datei, der neueste (vorn) gewinnt", () => {
    const { links, open } = setup([rowOf("src/main.ts")], ["/work/app/src/main.ts", "/work/other/src/main.ts"], { bases: ["/work/other", "/work/app"] });
    const l = links(1);
    l?.[0].activate(click(true), l[0].text);
    expect(open).toHaveBeenCalledWith({ path: "/work/other/src/main.ts", line: null, col: null });
  });
  it("Gegentest: Datei im Startordner und in genau einem Basisordner, der Startordner gewinnt", () => {
    const { links, open } = setup([rowOf("src/main.ts")], ["/repo/src/main.ts", "/work/app/src/main.ts"], { bases: ["/work/app"] });
    const l = links(1);
    l?.[0].activate(click(true), l[0].text);
    expect(open).toHaveBeenCalledWith({ path: "/repo/src/main.ts", line: null, col: null });
  });
  it("Datei im Startordner: die Basisordner werden gar nicht erst abgefragt", () => {
    const { links, bases } = setup([rowOf("src/main.ts")], ["/repo/src/main.ts"], { bases: ["/work/app"] });
    expect(links(1)?.length).toBe(1);
    expect(bases).not.toHaveBeenCalled();
  });
  it("Gegentest: Einstellung aus, kein Link über Basisordner und keine Abfrage der Basisordner", () => {
    const { links, bases } = setup([rowOf("src/main.ts")], ["/work/app/src/main.ts"], { claudeDirs: false, bases: ["/work/app"] });
    expect(links(1) ?? []).toEqual([]);
    expect(bases).not.toHaveBeenCalled();
  });
  it("Einstellung aus: Startordner und absolute Pfade gelten weiter", () => {
    const { links } = setup([rowOf("src/main.ts und /abs/a.md")], ["/repo/src/main.ts", "/abs/a.md"], { claudeDirs: false });
    expect(links(1)?.map((x) => x.text)).toEqual(["src/main.ts", "/abs/a.md"]);
  });
  it("absolute und ~/-Pfade, die es nicht gibt, fallen nicht auf Basisordner zurück", () => {
    const { links, bases, isFile } = setup([rowOf("/abs/fehlt.md und ~/fehlt.md")], ["/work/app/abs/fehlt.md", "/work/app/fehlt.md"], { bases: ["/work/app"] });
    expect(links(1) ?? []).toEqual([]);
    expect(bases).not.toHaveBeenCalled();
    expect(isFile.mock.calls.map((c) => c[0])).toEqual(["/abs/fehlt.md", "/Users/n/fehlt.md"]);
  });
  it("die Basisordner werden je provideLinks höchstens einmal abgefragt, auch bei mehreren Kandidaten und umgebrochenen Zeilen", () => {
    const { links, bases } = setup(
      [rowW("a/x.ts b/y.ts c/z.ts", 20), rowW("  noch/mehr.ts", 20)],
      ["/work/app/a/x.ts", "/work/app/b/y.ts"],
      { bases: ["/work/app"] },
    );
    expect(links(1)?.map((x) => x.text)).toEqual(["a/x.ts", "b/y.ts"]);
    expect(bases).toHaveBeenCalledTimes(1);
    links(2);
    expect(bases).toHaveBeenCalledTimes(2);
  });
  it("Überlappendes wird vor jedem statSync verworfen, auch bei der Suche über Basisordner", () => {
    // Claude bricht `src/main.ts` selbst um: Zusammengefügt ist es ein Link, die Zeile allein ergäbe das überlappende `src/main`.
    const { links, isFile } = setup([rowW("x src/main", 10), rowW("  .ts hier", 10)], ["/work/app/src/main.ts"], { bases: ["/work/app"] });
    expect(links(1)?.map((x) => x.text)).toEqual(["src/main.ts"]);
    expect(isFile.mock.calls.map((c) => c[0]).filter((p) => p.endsWith("/src/main"))).toEqual([]);
  });
});

describe("openTerminalPath: Vault-Datei als Tab, sonst Fenster", () => {
  const deps = (opened: boolean) => ({
    vaultBase: () => "/V",
    openInVault: vi.fn(async () => opened),
    openInModal: vi.fn(),
  });
  it("Gegentest: Vault-Datei landet im Tab, nicht im Fenster", async () => {
    const d = deps(true);
    await openTerminalPath({ path: "/V/Index.md", line: 4, col: null }, d);
    expect(d.openInVault).toHaveBeenCalledWith("Index.md", { path: "/V/Index.md", line: 4, col: null });
    expect(d.openInModal).not.toHaveBeenCalled();
  });
  it("Vault kann die Datei nicht als Tab zeigen: Fenster", async () => {
    const d = deps(false);
    await openTerminalPath({ path: "/V/.obsidian/app.json", line: null, col: null }, d);
    expect(d.openInModal).toHaveBeenCalled();
  });
  it("außerhalb des Vaults: Fenster, Vault wird nicht gefragt", async () => {
    const d = deps(true);
    await openTerminalPath({ path: "/repo/a.ts", line: null, col: null }, d);
    expect(d.openInVault).not.toHaveBeenCalled();
    expect(d.openInModal).toHaveBeenCalledWith({ path: "/repo/a.ts", line: null, col: null });
  });
});
