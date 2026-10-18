import { posix } from "node:path";
import type { ILink } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import { type CellRow, MAX_PATH_PROBES } from "../src/core/file-links";
import { FileLinkProvider, type LinkTarget, openTerminalPath } from "../src/host/file-links";
import { guardLinkProvider } from "../src/host/link-guard";

const rowOf = (text: string, isWrapped = false): CellRow => ({ cells: Array.from(text, (chars) => ({ chars, width: 1 })), isWrapped });
/** Zeile in voller Terminalbreite wie in xterm: leere Zellen bis zum Rand. */
const rowW = (text: string, width: number): CellRow => ({
  cells: Array.from(text.padEnd(width, "\0"), (ch) => (ch === "\0" ? { chars: "", width: 1 } : { chars: ch, width: 1 })),
  isWrapped: false,
});

/** Alle Ordner über den Dateien, so sieht die Ordnerprüfung eines echten Dateisystems aus (die Wurzel eingeschlossen). */
const dirsOf = (...files: string[]): Set<string> => {
  const dirs = new Set<string>(["/"]);
  for (const file of files) for (let d = posix.dirname(file); d !== "/" && !dirs.has(d); d = posix.dirname(d)) dirs.add(d);
  return dirs;
};

function setup(
  lines: CellRow[],
  files: string[],
  opts: { enabled?: boolean; cwd?: string | null; claudeDirs?: boolean; bases?: string[]; spaces?: boolean; dirs?: string[] } = {},
) {
  const open = vi.fn<(t: LinkTarget) => void>();
  const isFile = vi.fn((p: string) => files.includes(p));
  const dirSet = dirsOf(...files);
  for (const d of opts.dirs ?? []) dirSet.add(d);
  const isDir = vi.fn((p: string) => dirSet.has(p));
  const bases = vi.fn(() => opts.bases ?? []);
  const provider = new FileLinkProvider({
    row: (y) => lines[y - 1] ?? null,
    cwd: () => (opts.cwd === undefined ? "/repo" : opts.cwd),
    home: "/Users/n",
    enabled: () => opts.enabled ?? true,
    isFile,
    claudeDirs: () => opts.claudeDirs ?? true,
    bases,
    isDir,
    spaces: () => opts.spaces ?? false,
    open,
  });
  const links = (y: number): ILink[] | undefined => {
    let result: ILink[] | undefined;
    provider.provideLinks(y, (l) => (result = l));
    return result;
  };
  return { provider, links, open, isFile, isDir, bases };
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

// Abend 38: Pfade mit Leerzeichen. Startordner der Sitzung ist der Vault (/V), wie in einer Vault-Sitzung.
describe("FileLinkProvider: Pfade mit Leerzeichen (Abend 38)", () => {
  const REPORTED = "/V/02 Projekte/Beispiel-Projekt-App/assets/2026-10-16 Kostenvoranschlag Etappe 1a.pdf";
  const sp = (lines: CellRow[], files: string[], opts: Parameters<typeof setup>[2] = {}) => setup(lines, files, { cwd: "/V", spaces: true, ...opts });
  /** Bereich und Text aller Links der Zeile y. */
  const shape = (found: ILink[] | undefined) => found?.map((l) => [l.text, l.range]);

  it("Abnahme 1: Pfad mit Leerzeichen ohne Anführungszeichen, ganz unterstrichbar, Text davor und danach gehört nicht dazu", () => {
    const line = `Datei: ${REPORTED} und dann`;
    const { links, open } = sp([rowOf(line)], [REPORTED]);
    const found = links(1);
    expect(shape(found)).toEqual([[REPORTED, { start: { x: 8, y: 1 }, end: { x: 7 + REPORTED.length, y: 1 } }]]);
    found?.[0].activate(click(true), REPORTED);
    expect(open).toHaveBeenCalledWith({ path: REPORTED, line: null, col: null });
  });
  it("Abnahme 2: Pfad in Anführungszeichen (`open \"…\"`, `@\"…\"`, einfach, Backtick), relativ zum Startordner", () => {
    const file = "/V/02 Projekte/x y.md";
    for (const line of ['open "02 Projekte/x y.md" jetzt', "open '02 Projekte/x y.md' jetzt", "open `02 Projekte/x y.md` jetzt", 'siehe @"02 Projekte/x y.md"']) {
      const { links } = sp([rowOf(line)], [file]);
      expect(links(1)?.map((l) => l.text), line).toEqual(["02 Projekte/x y.md"]);
    }
    const { links } = sp([rowOf('open "02 Projekte/x y.md" jetzt')], [file]);
    expect(links(1)?.[0].range).toEqual({ start: { x: 7, y: 1 }, end: { x: 24, y: 1 } });
  });
  it("Anführungszeichen tragen auch, was die Verlängerung nicht kann: Klammern im Namen und Claudes Ordner", () => {
    const named = "/V/02 Projekte/Bericht (2026) Mai.pdf";
    const paren = sp([rowOf('open "02 Projekte/Bericht (2026) Mai.pdf" jetzt')], [named]);
    expect(paren.links(1)?.map((l) => l.text)).toEqual(["02 Projekte/Bericht (2026) Mai.pdf"]);
    const viaBases = sp([rowOf('open "src/my dir/a.ts:7" jetzt')], ["/work/app/src/my dir/a.ts"], { bases: ["/work/app"] });
    const l = viaBases.links(1);
    expect(l?.map((x) => x.text)).toEqual(["src/my dir/a.ts:7"]);
    l?.[0].activate(click(true), l[0].text);
    expect(viaBases.open).toHaveBeenCalledWith({ path: "/work/app/src/my dir/a.ts", line: 7, col: null });
  });
  it("Abnahme 3: Pfad, den Claude über zwei Zeilen an einem Leerzeichen umbricht, ist von beiden Zeilen aus ein Link über beide", () => {
    const rows = [rowW("● Datei: 02 Projekte/Beispiel-Projekt-App/assets/2026-10-16", 64), rowW("  Kostenvoranschlag Etappe 1a.pdf liegt dort", 64)];
    const { links } = sp(rows, [REPORTED]);
    for (const y of [1, 2]) {
      expect(shape(links(y)), `y=${y}`).toEqual([
        ["02 Projekte/Beispiel-Projekt-App/assets/2026-10-16 Kostenvoranschlag Etappe 1a.pdf", { start: { x: 10, y: 1 }, end: { x: 33, y: 2 } }],
      ]);
    }
  });
  it("Abnahme 3b: im schmalen Terminal über drei Zeilen, von jeder der drei Zeilen aus", () => {
    const rows = [rowW("Datei 02 Projekte/Mein Ordner", 40), rowW("  Neu/Kosten Etappe", 40), rowW("  1a.pdf und dann", 40)];
    const { links } = sp(rows, ["/V/02 Projekte/Mein Ordner Neu/Kosten Etappe 1a.pdf"]);
    for (const y of [1, 2, 3]) expect(links(y)?.map((l) => l.range), `y=${y}`).toEqual([{ start: { x: 7, y: 1 }, end: { x: 8, y: 3 } }]);
  });
  it("volle Zeile genau am Leerzeichen: die Fassung mit Leerzeichen findet den Pfad, ein langes Wort ohne Leerzeichen bleibt Link wie zuvor", () => {
    const rows = [rowW("Datei 02 Projekte/Beispiel-Projekt", 34), rowW("  App/x y.md ok", 40)];
    const { links } = sp(rows, ["/V/02 Projekte/Beispiel-Projekt App/x y.md"]);
    expect(shape(links(1))).toEqual([["02 Projekte/Beispiel-Projekt App/x y.md", { start: { x: 7, y: 1 }, end: { x: 12, y: 2 } }]]);
    const broken = [rowW("  /abs/lan", 10), rowW("  g.md ok", 10)];
    const again = sp(broken, ["/abs/lang.md"]);
    for (const y of [1, 2]) expect(again.links(y)?.map((l) => l.text)).toEqual(["/abs/lang.md"]);
  });
  it("Abnahme 4 / Review (b): `… 1a.pdf und dann.` und `… 1a.pdf.` enden bei .pdf", () => {
    for (const tail of [" und dann.", ".", ",", " und dann"]) {
      const { links } = sp([rowOf(`Siehe ${REPORTED}${tail}`)], [REPORTED]);
      expect(links(1)?.map((l) => l.text), tail).toEqual([REPORTED]);
      expect(links(1)?.[0].range.end.x, tail).toBe(6 + REPORTED.length);
    }
  });
  it("`:12` hinter einem Pfad mit Leerzeichen springt in die Zeile", () => {
    const { links, open } = sp([rowOf(`${REPORTED}:12`)], [REPORTED]);
    const l = links(1);
    expect(l?.[0].text).toBe(`${REPORTED}:12`);
    l?.[0].activate(click(true), l[0].text);
    expect(open).toHaveBeenCalledWith({ path: REPORTED, line: 12, col: null });
  });
  it("Abnahme 5: Pfade ohne Leerzeichen funktionieren wie bisher, auch mit der Einstellung an", () => {
    const { links } = sp([rowOf("siehe `src/main.ts:10` und /abs/a.md")], ["/V/src/main.ts", "/abs/a.md"]);
    expect(links(1)?.map((l) => l.text)).toEqual(["src/main.ts:10", "/abs/a.md"]);
  });
  it("Review (a): Prosa vor dem Pfad gehört nicht zum Link", () => {
    const line = "Die Datei 03 Bereiche/Claude Code/x.md steht dort";
    const { links, open } = sp([rowOf(line)], ["/V/03 Bereiche/Claude Code/x.md"]);
    const found = links(1);
    expect(shape(found)).toEqual([["03 Bereiche/Claude Code/x.md", { start: { x: 11, y: 1 }, end: { x: 38, y: 1 } }]]);
    // Geöffnet wird der absolute Pfad (Startordner + relativer Pfad), nicht der Text der Zeile.
    found?.[0].activate(click(true), found[0].text);
    expect(open).toHaveBeenCalledWith({ path: "/V/03 Bereiche/Claude Code/x.md", line: null, col: null });
  });
  it("Review (c): zwei Pfade mit Leerzeichen in einer Zeile sind zwei Links", () => {
    const a = "/V/02 Projekte/A B/x y.md";
    const b = "/V/03 Bereiche/C D/z w.md";
    const { links } = sp([rowOf("02 Projekte/A B/x y.md und 03 Bereiche/C D/z w.md")], [a, b]);
    expect(links(1)?.map((l) => l.text)).toEqual(["02 Projekte/A B/x y.md", "03 Bereiche/C D/z w.md"]);
  });
  it("Review (c): eine Liste von Pfaden über mehrere Zeilen: jede Zeile hat genau ihren Link, nichts verschmilzt", () => {
    const files = ["/V/02 Projekte/A/x y.md", "/V/03 Bereiche/B/z w.md", "/V/04 Ressourcen/C/u v.md"];
    const rows = [rowW("- 02 Projekte/A/x y.md", 50), rowW("- 03 Bereiche/B/z w.md", 50), rowW("- 04 Ressourcen/C/u v.md", 50)];
    const { links } = sp(rows, files);
    expect(links(1)?.map((l) => [l.text, l.range.start.y, l.range.end.y])).toEqual([["02 Projekte/A/x y.md", 1, 1]]);
    expect(links(2)?.map((l) => [l.text, l.range.start.y, l.range.end.y])).toEqual([["03 Bereiche/B/z w.md", 2, 2]]);
    expect(links(3)?.map((l) => [l.text, l.range.start.y, l.range.end.y])).toEqual([["04 Ressourcen/C/u v.md", 3, 3]]);
  });
  it("Review (d): ein erwähnter Ordner mit Leerzeichen ist kein Link, und die Prüfungen bleiben im Budget", () => {
    const { links, isFile, isDir } = sp([rowOf("Siehe 02 Projekte/Beispiel-Projekt-App/assets und weiter")], [], {
      dirs: ["/V/02 Projekte/Beispiel-Projekt-App/assets"],
    });
    expect(links(1)).toBeUndefined();
    expect(isFile.mock.calls.length + isDir.mock.calls.length).toBeLessThanOrEqual(MAX_PATH_PROBES);
  });
  it("Review (e): dichte Prosa in einer Vault-Sitzung bleibt weit unter dem Budget (Dateien und Ordner zusammen, je Abfrage gezählt)", () => {
    const prose =
      "Ich habe die Notiz 03 Bereiche/Claude Code/Plan 38.md angelegt und config.json, package-lock.json sowie docs/api.v2/spec.md geprüft; " +
      "danach lief npm run build erfolgreich, und test/file-links.test.ts, test/file-links-host.test.ts und src/core/file-links.ts blieben grün. " +
      "Außerdem: siehe README.md, CLAUDE.md, handoffs/HANDOFF-2026-10-16.md oder ~/Documents/Notizen/Idee.md für Details zum weiteren Vorgehen.";
    const rows = prose.match(/.{1,60}(\s|$)/g)?.map((r) => rowW(r.trimEnd(), 64)) ?? [];
    expect(rows.length).toBeGreaterThan(5);
    const { links, isFile, isDir } = sp(rows, []);
    const calls = (): number => isFile.mock.calls.length + isDir.mock.calls.length;
    for (let y = 1; y <= rows.length; y++) {
      const before = calls();
      links(y);
      // Gemessen 16.10.2026: 3 bis 29 Prüfungen je Abfrage (ohne die Einstellung 0 bis 3); die Grenze ist großzügig, das Budget 200.
      expect(calls() - before, `y=${y}`).toBeLessThanOrEqual(60);
    }
  });
  it("Budget erschöpft: Einzelwörter und die schon gefundenen Links bleiben", () => {
    const noise = Array.from({ length: 400 }, (_, i) => `${i}/${i + 1}`).join(" ");
    const { links, isDir, isFile } = sp([rowOf(`${noise} /abs/real.md`)], ["/abs/real.md"]);
    expect(links(1)?.map((l) => l.text)).toEqual(["/abs/real.md"]);
    expect(isDir.mock.calls.length + isFile.mock.calls.length).toBeLessThanOrEqual(MAX_PATH_PROBES + 40);
  });
  it("Kandidaten und Starts, die Zeile y nicht berühren können, kosten keine Prüfung", () => {
    const rows = [rowW("nichts hier", 30), rowW("/abs/a.md und /abs/b c.md", 30)];
    const { links, isFile, isDir } = sp(rows, ["/abs/a.md", "/abs/b c.md"]);
    expect(links(1)).toBeUndefined();
    expect(isFile).not.toHaveBeenCalled();
    // Nur die beiden Starts in Zeile 1 prüfen (je einen Ordnerteil); die Starts und Einzelwörter aus Zeile 2 kosten nichts.
    expect(isDir.mock.calls.map((c) => c[0])).toEqual(["/V/nichts hier /abs", "/V/hier /abs"]);
    expect(links(2)?.map((l) => l.text)).toEqual(["/abs/a.md", "/abs/b c.md"]);
  });
  it("höchstens 40 Einzelwörter je Zeile werden geprüft (je ein statSync), mit und ohne die Einstellung", () => {
    const line = Array.from({ length: 60 }, (_, i) => `a${i}/b.ts`).join(" ");
    for (const spaces of [false, true]) {
      const { links, isFile } = sp([rowOf(line)], [], { spaces });
      expect(links(1), `spaces=${spaces}`).toBeUndefined();
      expect(isFile.mock.calls.length, `spaces=${spaces}`).toBe(40);
    }
  });
  it("relative Pfade mit Leerzeichen gelten nur gegen den Startordner, nicht gegen Claudes Ordner (bekannte Grenze)", () => {
    const { links } = sp([rowOf("02 Projekte/x y.md")], ["/work/app/02 Projekte/x y.md"], { bases: ["/work/app"] });
    expect(links(1)).toBeUndefined();
    const absolute = sp([rowOf("/work/app/02 Projekte/x y.md")], ["/work/app/02 Projekte/x y.md"], { bases: [] });
    expect(absolute.links(1)?.map((l) => l.text)).toEqual(["/work/app/02 Projekte/x y.md"]);
  });
  it("ein Wort, das schon als Einzelpfad existiert, bleibt der Link (wie heute), auch wenn ein längerer Pfad existierte", () => {
    const { links, isFile } = sp([rowOf("/d/Mein Bericht.md")], ["/d/Mein", "/d/Mein Bericht.md"]);
    expect(links(1)?.map((l) => l.text)).toEqual(["/d/Mein"]);
    // Der Start liegt schon in einem Link: Die Verlängerung prüft ihn gar nicht erst.
    expect(isFile.mock.calls.map((c) => c[0])).not.toContain("/d/Mein Bericht.md");
  });
  // Abschlussreview Befund 2: Das ENDwort eines Pfads mit Leerzeichen ist selbst eine Datei. Die Verlängerung hat den ganzen Pfad
  // als Datei geprüft und gewinnt über die Einzelwort-Links, die ganz in ihr liegen und nach ihrem Anfang beginnen.
  it("Review Befund 2: das letzte Wort ist selbst eine Datei (`Index.md` in der Wurzel): der ganze Pfad ist der einzige Link", () => {
    const full = "04 Ressourcen/Research/Projekt Index.md";
    const { links, open } = sp([rowOf(`Siehe ${full} dazu`)], ["/V/Index.md", `/V/${full}`]);
    const found = links(1);
    expect(shape(found)).toEqual([[full, { start: { x: 7, y: 1 }, end: { x: 6 + full.length, y: 1 } }]]);
    found?.[0].activate(click(true), full);
    expect(open).toHaveBeenCalledWith({ path: `/V/${full}`, line: null, col: null });
  });
  it("Review Befund 2: Gegentest Einstellung aus, es bleibt bei dem Link, den es vor Abend 38 gab (`Index.md`)", () => {
    const full = "04 Ressourcen/Research/Projekt Index.md";
    const { links } = setup([rowOf(`Siehe ${full} dazu`)], ["/V/Index.md", `/V/${full}`], { cwd: "/V", spaces: false });
    const x = 6 + full.length - "Index.md".length + 1;
    expect(shape(links(1))).toEqual([["Index.md", { start: { x, y: 1 }, end: { x: x + 7, y: 1 } }]]);
  });
  it("Review Befund 2: `Bild 1.png`: `1.png` gibt es in einem Ordner Claudes (anderes Projekt), der ganze Pfad im Startordner gewinnt", () => {
    const own = "02 Projekte/X/assets/Bild 1.png";
    const files = [`/V/${own}`, "/V/02 Projekte/Y/assets/1.png"];
    const bases = ["/V/02 Projekte/Y/assets"];
    const on = sp([rowOf(`Bild: ${own}`)], files, { bases });
    const found = on.links(1);
    expect(shape(found)).toEqual([[own, { start: { x: 7, y: 1 }, end: { x: 6 + own.length, y: 1 } }]]);
    found?.[0].activate(click(true), own);
    expect(on.open).toHaveBeenCalledWith({ path: `/V/${own}`, line: null, col: null });
    // Ohne die Einstellung bleibt es beim Link von vor Abend 38: dem Einzelwort aus dem Ordner Claudes.
    const off = setup([rowOf(`Bild: ${own}`)], files, { cwd: "/V", bases, spaces: false });
    expect(off.links(1)?.map((l) => l.text)).toEqual(["1.png"]);
  });
  it("Review Befund 2 / Task-2-Minor: ein Endwort-Link in der Verlängerung hinterlässt nie zwei überlappende Links", () => {
    const { links } = sp([rowOf("siehe A B/x.md ok")], ["/V/B/x.md", "/V/A B/x.md"]);
    expect(shape(links(1))).toEqual([["A B/x.md", { start: { x: 7, y: 1 }, end: { x: 14, y: 1 } }]]);
  });
  it("Review Befund 2: überlappt die Verlängerung einen Link nur teilweise, bleibt der Link und die Verlängerung entfällt", () => {
    // Zeile 1 ist voll: Mit Claudes Umbruch ohne Zeichen ist `B/xy` ein Wort (Link), mit Leerzeichen wäre `A B/x` ein Pfad.
    // `B/xy` ragt über das Ende von `A B/x` hinaus, liegt also nicht ganz in der Verlängerung: nichts überlappt, der Link bleibt.
    const rows = [rowW("Siehe A B/x", 11), rowW("y ok", 11)];
    const { links } = sp(rows, ["/V/B/xy", "/V/A B/x"]);
    for (const y of [1, 2]) expect(shape(links(y)), `y=${y}`).toEqual([["B/xy", { start: { x: 9, y: 1 }, end: { x: 1, y: 2 } }]]);
  });
  it("die Hülle aus Abend 37 lässt den Pfad über drei Zeilen in jeder der drei Zeilen durch (dasselbe Objekt, Zeilenfilter)", () => {
    const rows = [rowW("Datei 02 Projekte/Mein Ordner", 40), rowW("  Neu/Kosten Etappe", 40), rowW("  1a.pdf und dann", 40)];
    const { provider } = sp(rows, ["/V/02 Projekte/Mein Ordner Neu/Kosten Etappe 1a.pdf"]);
    const guarded = guardLinkProvider(provider, () => true);
    for (const y of [1, 2, 3]) {
      let got: ILink[] | undefined;
      guarded.provideLinks(y, (l) => (got = l));
      expect(got?.length, `y=${y}`).toBe(1);
    }
  });
  it("bisherige Fälle mit der Einstellung an: weich umgebrochener Pfad und ein Pfad, der zufällig am Rand endet", () => {
    const soft = sp([rowOf("/abs/lan"), rowOf("g.md ok", true)], ["/abs/lang.md"]);
    expect(soft.links(2)?.map((x) => [x.text, x.range])).toEqual([["/abs/lang.md", { start: { x: 1, y: 1 }, end: { x: 4, y: 2 } }]]);
    const edge = sp([rowW("x /abs/a.md", 11), rowW("  und mehr", 11)], ["/abs/a.md"]);
    expect(edge.links(1)?.map((x) => [x.text, x.range])).toEqual([["/abs/a.md", { start: { x: 3, y: 1 }, end: { x: 11, y: 1 } }]]);
  });
  it("Gegentest Einstellung aus: genau das Verhalten von vor Abend 38, kein Ordner wird je geprüft", () => {
    const { links, isFile, isDir } = setup([rowOf("Datei: /V/02 Projekte/x y.md und open \"02 Projekte/a b.md\"")], ["/V/02 Projekte/x y.md", "/repo/02 Projekte/a b.md"]);
    expect(links(1)).toBeUndefined();
    expect(isDir).not.toHaveBeenCalled();
    expect(isFile.mock.calls.map((c) => c[0])).toEqual(["/V/02", "/repo/Projekte/x", "/repo/y.md", "/repo/Projekte/a", "/repo/b.md"]);
  });
  it("Einstellung wird bei jeder Abfrage frisch gelesen", () => {
    let on = false;
    const provider = new FileLinkProvider({
      row: () => rowOf("/d/a b.md"), cwd: () => "/", home: "/h", enabled: () => true, isFile: (p) => p === "/d/a b.md", claudeDirs: () => false,
      bases: () => [], isDir: (p) => p === "/d" || p === "/", spaces: () => on, open: () => undefined,
    });
    const ask = () => { let r: ILink[] | undefined; provider.provideLinks(1, (l) => (r = l)); return r?.length ?? 0; };
    expect(ask()).toBe(0);
    on = true;
    expect(ask()).toBe(1);
    on = false;
    expect(ask()).toBe(0);
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
