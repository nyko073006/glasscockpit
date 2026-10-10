import { describe, expect, it } from "vitest";
import { diffLines, hunks, MAX_DIFF_LINES, type DiffLine } from "../src/core/line-diff";

const ops = (lines: readonly DiffLine[]): string => lines.map((l) => (l.op === "same" ? " " : l.op === "add" ? "+" : "-") + l.text).join("|");
/** Aus dem Diff die neue (bzw. alte) Fassung zurückrechnen: Gegenprobe, dass nichts verloren geht. */
const rebuild = (lines: readonly DiffLine[], side: "old" | "new"): string[] =>
  lines.filter((l) => l.op === "same" || l.op === (side === "new" ? "add" : "del")).map((l) => l.text);

describe("diffLines, Grundfälle", () => {
  it("gleiche Texte: nur same, keine Änderung", () => {
    const r = diffLines("a\nb\n", "a\nb\n");
    expect(ops(r.lines)).toBe(" a| b");
    expect([r.added, r.removed]).toEqual([0, 0]);
  });
  it("eine geänderte Zeile: erst del, dann add, Nummern stimmen", () => {
    const r = diffLines("a\nb\nc\n", "a\nX\nc\n");
    expect(ops(r.lines)).toBe(" a|-b|+X| c");
    expect(r.lines.map((l) => [l.oldNo, l.newNo])).toEqual([[1, 1], [2, null], [null, 2], [3, 3]]);
    expect([r.added, r.removed]).toEqual([1, 1]);
  });
  it("eingefügte und gelöschte Zeilen", () => {
    expect(ops(diffLines("a\nc\n", "a\nb\nc\n").lines)).toBe(" a|+b| c");
    expect(ops(diffLines("a\nb\nc\n", "a\nc\n").lines)).toBe(" a|-b| c");
  });
  it("Wort ersetzt in einer Datei mit einer Zeile (die Probe-Datei)", () => {
    const r = diffLines("alt\n", "neu\n");
    expect(ops(r.lines)).toBe("-alt|+neu");
  });
  it("rechnet beide Seiten richtig zurück (Zufallsmischung)", () => {
    const a = ["x", "a", "b", "c", "d", "e", "f", "g"];
    const b = ["a", "c", "c2", "d", "e", "h", "g", "z"];
    const r = diffLines(`${a.join("\n")}\n`, `${b.join("\n")}\n`);
    expect(rebuild(r.lines, "old")).toEqual(a);
    expect(rebuild(r.lines, "new")).toEqual(b);
  });
  it("Myers findet die kurze Fassung (keine unnötigen Änderungen)", () => {
    const r = diffLines("a\nb\nc\nd\ne\n", "a\nc\nd\nX\ne\n");
    expect([r.added, r.removed]).toEqual([1, 1]);
  });
});

describe("diffLines, Grenzfälle", () => {
  it("leere alte Datei: alles hinzugefügt (kein Phantomzeile)", () => {
    const r = diffLines("", "a\nb\n");
    expect(ops(r.lines)).toBe("+a|+b");
    expect(r.isNew).toBe(false);
    expect(r.removed).toBe(0);
  });
  it("leere neue Datei: alles entfernt", () => {
    const r = diffLines("a\nb\n", "");
    expect(ops(r.lines)).toBe("-a|-b");
    expect(r.added).toBe(0);
  });
  it("beide leer: keine Zeilen", () => {
    expect(diffLines("", "").lines).toEqual([]);
  });
  it("neue Datei (alte Fassung fehlt): alles hinzugefügt, isNew", () => {
    const r = diffLines(null, "a\nb\n");
    expect(ops(r.lines)).toBe("+a|+b");
    expect(r.isNew).toBe(true);
  });
  it("nur ein Zeilenumbruch: eine leere Zeile", () => {
    expect(ops(diffLines("", "\n").lines)).toBe("+");
  });
  it("CRLF gegen CRLF: gleiche Zeilen, kein \\r im Text", () => {
    const r = diffLines("a\r\nb\r\n", "a\r\nX\r\n");
    expect(ops(r.lines)).toBe(" a|-b|+X");
    expect(r.eolChanged).toBe(false);
  });
  it("CRLF gegen LF mit gleichem Inhalt: keine Zeile geändert, aber eolChanged", () => {
    const r = diffLines("a\r\nb\r\n", "a\nb\n");
    expect(ops(r.lines)).toBe(" a| b");
    expect(r.eolChanged).toBe(true);
  });
  it("gleiche Zeilenenden: eolChanged ist falsch", () => {
    expect(diffLines("a\nb\n", "a\nc\n").eolChanged).toBe(false);
  });
  it("letzte Zeile ohne Umbruch gegen mit Umbruch: die Zeile gilt als geändert, die alte trägt noEol", () => {
    const r = diffLines("a\nb", "a\nb\n");
    expect(ops(r.lines)).toBe(" a|-b|+b");
    expect(r.lines[1].noEol).toBe(true);
    expect(r.lines[2].noEol).toBe(false);
  });
  it("letzte Zeile ohne Umbruch auf beiden Seiten und gleich: unverändert, noEol bleibt am Zeilenende", () => {
    const r = diffLines("a\nb", "a\nb");
    expect(ops(r.lines)).toBe(" a| b");
    expect(r.lines[1].noEol).toBe(true);
    expect([r.added, r.removed]).toEqual([0, 0]);
  });
  it("Zeile angehängt an eine Datei ohne Endumbruch", () => {
    const r = diffLines("a\nb", "a\nb\nc");
    expect(ops(r.lines)).toBe(" a|-b|+b|+c");
    expect(r.lines.map((l) => l.noEol)).toEqual([false, true, false, true]);
  });
  it("Zeile mit nur Leerzeichen am Ende zählt als Änderung", () => {
    expect(ops(diffLines("a \n", "a\n").lines)).toBe("-a |+a");
  });
});

describe("diffLines, große Dateien", () => {
  const big = (n: number, f: (i: number) => string = (i) => `zeile ${i}`) => Array.from({ length: n }, (_, i) => f(i)).join("\n") + "\n";
  it("zwei Änderungen weit auseinander in 20000 Zeilen: genau, schnell", () => {
    const a = big(20000);
    const b = big(20000, (i) => (i === 10 ? "neu A" : i === 19990 ? "neu B" : `zeile ${i}`));
    const t = Date.now();
    const r = diffLines(a, b);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(r.coarse).toBe(false);
    expect([r.added, r.removed]).toEqual([2, 2]);
  });
  it("völlig verschiedene Dateien über der Grenze: Rückfall auf „ganze Datei ersetzt“, schnell, ohne Verlust", () => {
    const n = MAX_DIFF_LINES + 500;
    const a = big(n, (i) => `alt ${i}`);
    const b = big(n, (i) => `neu ${i}`);
    const t = Date.now();
    const r = diffLines(a, b);
    expect(Date.now() - t).toBeLessThan(3000);
    expect(r.coarse).toBe(true);
    expect([r.removed, r.added]).toEqual([n, n]);
    expect(rebuild(r.lines, "old").length).toBe(n);
    expect(rebuild(r.lines, "new")[n - 1]).toBe(`neu ${n - 1}`);
  });
  it("viele Unterschiede mitten in der Datei, aber unter der Zeilengrenze: Rückfall bei zu großem Abstand, trotzdem vollständig", () => {
    const a = big(6000, (i) => `alt ${i}`);
    const b = big(6000, (i) => `neu ${i}`);
    const r = diffLines(a, b);
    expect(rebuild(r.lines, "old").length).toBe(6000);
    expect(rebuild(r.lines, "new").length).toBe(6000);
  });
  it("kleine Dateien sind nie grob", () => {
    expect(diffLines("a\nb\n", "x\ny\n").coarse).toBe(false);
  });
});

describe("hunks", () => {
  const lines = (n: number, change: number[]): DiffLine[] => {
    const a = Array.from({ length: n }, (_, i) => `z${i + 1}`);
    const b = a.map((t, i) => (change.includes(i + 1) ? `${t}!` : t));
    return diffLines(`${a.join("\n")}\n`, `${b.join("\n")}\n`).lines;
  };
  it("keine Änderung: keine Hunks", () => {
    expect(hunks(lines(10, []), 3)).toEqual([]);
  });
  it("eine Änderung: drei Zeilen Kontext davor und danach, Kopfzahlen", () => {
    const h = hunks(lines(20, [10]), 3);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ oldStart: 7, oldCount: 7, newStart: 7, newCount: 7 });
    expect(h[0].lines[0].text).toBe("z7");
    expect(h[0].lines.at(-1)?.text).toBe("z13");
  });
  it("Änderung am Dateianfang: kein Kontext davor", () => {
    const h = hunks(lines(10, [1]), 3);
    expect(h[0]).toMatchObject({ oldStart: 1, newStart: 1 });
    expect(h[0].lines[0].op).toBe("del");
  });
  it("zwei nahe Änderungen werden ein Hunk, zwei ferne zwei Hunks", () => {
    expect(hunks(lines(30, [10, 14]), 3)).toHaveLength(1);
    expect(hunks(lines(30, [5, 25]), 3)).toHaveLength(2);
  });
  it("Kontext 0: nur die Änderungszeilen", () => {
    const h = hunks(lines(10, [5]), 0);
    expect(h[0].lines.map((l) => l.op)).toEqual(["del", "add"]);
  });
  it("neue Datei: ein Hunk ab Zeile 1, alte Zählung 0", () => {
    const h = hunks(diffLines(null, "a\nb\n").lines, 3);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2 });
  });
  it("jede Änderungszeile liegt in genau einem Hunk (nichts geht verloren)", () => {
    const all = lines(60, [3, 4, 30, 55]);
    const geaendert = all.filter((l) => l.op !== "same").length;
    const inHunks = hunks(all, 2).flatMap((h) => h.lines).filter((l) => l.op !== "same").length;
    expect(inHunks).toBe(geaendert);
  });
});
