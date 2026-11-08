import { describe, expect, it } from "vitest";
import { formatDroppedPaths, planDrop, splitDroppedPaths } from "../src/core/dropped-paths";

describe("formatDroppedPaths", () => {
  it("normaler Pfad", () => {
    expect(formatDroppedPaths(["/a/b.txt"])).toBe("@/a/b.txt ");
  });
  it("Pfad mit Leerzeichen wird gequotet", () => {
    expect(formatDroppedPaths(["/a/mein ordner/b.txt"])).toBe('@"/a/mein ordner/b.txt" ');
  });
  it("Pfad mit Backslash wird gequotet", () => {
    expect(formatDroppedPaths(["C:\\x\\y"])).toBe('@"C:\\x\\y" ');
  });
  it("mehrere Pfade, ein Leerzeichen dazwischen und am Ende", () => {
    expect(formatDroppedPaths(["/a", "/b c"])).toBe('@/a @"/b c" ');
  });
  it("leere Liste gibt leeren Text", () => {
    expect(formatDroppedPaths([])).toBe("");
  });
  // Probe vom 12.10.2026 mit claude 2.1.296: `@x"y.txt` liest Claude richtig (-p und echte PTY),
  // jede Maskierung (`\"`) scheitert, ein Name mit `"` UND Leerzeichen ist in keiner Schreibweise lesbar.
  it('Pfad mit " ohne Leerzeichen und Backslash bleibt unmaskiert (Probe: Maskierung bricht das Lesen)', () => {
    expect(formatDroppedPaths(['/Users/alex/x"y.txt'])).toBe('@/Users/alex/x"y.txt ');
  });
});

describe("formatDroppedPaths unter win32", () => {
  it("Backslash wird zu Schrägstrich, ohne Leerzeichen keine Anführungszeichen", () => {
    expect(formatDroppedPaths(["C:\\Users\\x\\a.md"], "win32")).toBe("@C:/Users/x/a.md ");
  });
  it("Leerzeichen und Umlaut: Anführungsform mit Schrägstrichen", () => {
    expect(formatDroppedPaths(["C:\\Users\\Jürgen Müller\\a b.md"], "win32")).toBe('@"C:/Users/Jürgen Müller/a b.md" ');
  });
  it("Umlaut, Leerzeichen, Klammern und # im Pfad bleiben unverändert (nur die Trenner ändern sich)", () => {
    expect(formatDroppedPaths(["C:\\Users\\Jürgen Müller\\Mein Ordner (alt)\\a #1.md"], "win32")).toBe('@"C:/Users/Jürgen Müller/Mein Ordner (alt)/a #1.md" ');
    expect(formatDroppedPaths(["C:\\x\\(alt)\\a#1.md"], "win32")).toBe("@C:/x/(alt)/a#1.md ");
  });
  it("UNC-Pfad behält die zwei Schrägstriche am Anfang", () => {
    expect(formatDroppedPaths(["\\\\srv\\s\\a.md"], "win32")).toBe("@//srv/s/a.md ");
  });
  it("mehrere Pfade und leere Liste", () => {
    expect(formatDroppedPaths(["C:\\a", "C:\\b c"], "win32")).toBe('@C:/a @"C:/b c" ');
    expect(formatDroppedPaths([], "win32")).toBe("");
  });
  it("darwin mit ausdrücklicher Angabe: Backslash weiter in Anführungsform", () => {
    expect(formatDroppedPaths(["C:\\x\\y"], "darwin")).toBe('@"C:\\x\\y" ');
  });
  it('planDrop: win32 mit " und Leerzeichen wird abgelehnt, die Meldung nennt den Namen', () => {
    expect(planDrop(['C:\\p\\a "b" c.txt', "C:\\p\\ok.txt"], "win32")).toEqual({
      text: "@C:/p/ok.txt ",
      notice: 'Pfad mit " kann Claude nicht als @-Erwähnung lesen: a "b" c.txt',
    });
  });
  it("planDrop: win32 mit \" ohne Leerzeichen geht durch (unmaskiert)", () => {
    expect(planDrop(['C:\\p\\x"y.txt'], "win32").text).toBe('@C:/p/x"y.txt ');
  });
  it("splitDroppedPaths: win32 ohne Leerzeichen hat keinen Backslash-Grund mehr", () => {
    expect(splitDroppedPaths(['C:\\p\\x"y.txt'], "win32")).toEqual({ accepted: ['C:\\p\\x"y.txt'], rejected: [] });
    expect(splitDroppedPaths(['C:\\p\\x "y.txt'], "win32")).toEqual({ accepted: [], rejected: ['C:\\p\\x "y.txt'] });
  });
});

describe("splitDroppedPaths", () => {
  it('Pfad mit " ohne Leerzeichen und Backslash geht durch', () => {
    expect(splitDroppedPaths(['/Users/alex/x"y.txt'])).toEqual({ accepted: ['/Users/alex/x"y.txt'], rejected: [] });
  });
  it('Pfad mit " und Leerzeichen wird abgelehnt (Anführungsform kennt kein Escape)', () => {
    expect(splitDroppedPaths(['/Users/alex/a "b" c.txt'])).toEqual({ accepted: [], rejected: ['/Users/alex/a "b" c.txt'] });
  });
  it('Pfad mit " und Backslash wird abgelehnt', () => {
    expect(splitDroppedPaths(['/Users/alex/x\\"y.txt'])).toEqual({ accepted: [], rejected: ['/Users/alex/x\\"y.txt'] });
  });
  it("Pfad mit Leerzeichen ohne Anführungszeichen geht durch", () => {
    expect(splitDroppedPaths(["/Users/alex/a b.txt"])).toEqual({ accepted: ["/Users/alex/a b.txt"], rejected: [] });
  });
  it("Reihenfolge bleibt, Gutes und Abgelehntes werden getrennt", () => {
    const r = splitDroppedPaths(["/a/1.txt", '/a/x "y".txt', '/a/z"z.txt', "/a/2 b.txt"]);
    expect(r.accepted).toEqual(["/a/1.txt", '/a/z"z.txt', "/a/2 b.txt"]);
    expect(r.rejected).toEqual(['/a/x "y".txt']);
  });
  it("leere Liste", () => {
    expect(splitDroppedPaths([])).toEqual({ accepted: [], rejected: [] });
  });
});

describe("planDrop", () => {
  it("nur gute Pfade: Text wie formatDroppedPaths, keine Meldung", () => {
    expect(planDrop(["/a", "/b c"])).toEqual({ text: '@/a @"/b c" ', notice: null });
  });
  it("ein abgelehneter Pfad: die übrigen werden eingefügt, die Meldung nennt den Dateinamen", () => {
    expect(planDrop(["/a/ok.txt", '/a/ordner/a "b" c.txt', '/a/x"y.txt'])).toEqual({
      text: '@/a/ok.txt @/a/x"y.txt ',
      notice: 'Pfad mit " kann Claude nicht als @-Erwähnung lesen: a "b" c.txt',
    });
  });
  it("steckt das \" in einem Ordner, nennt die Meldung den Pfad ab diesem Ordner (Abend 30)", () => {
    expect(planDrop(['/Users/n/Desktop/a"b c/x.txt'])).toEqual({
      text: "",
      notice: 'Pfad mit " kann Claude nicht als @-Erwähnung lesen: a"b c/x.txt',
    });
    expect(planDrop(['/v/a"b/c d/e"f/x.txt', "/v/ok.txt"])).toEqual({
      text: "@/v/ok.txt ",
      notice: 'Pfad mit " kann Claude nicht als @-Erwähnung lesen: a"b/c d/e"f/x.txt',
    });
    expect(planDrop(['/v/a"b/x y.txt', '/v/c d/e"f.txt'])).toEqual({
      text: "",
      notice: 'Claude kann Pfade mit " nicht als @-Erwähnung lesen: a"b/x y.txt, e"f.txt',
    });
  });
  it("alle abgelehnt: kein Text, die Meldung nennt alle Dateinamen", () => {
    expect(planDrop(['/a/a "b" c.txt', '/b/d "e" f.txt'])).toEqual({
      text: "",
      notice: 'Claude kann Pfade mit " nicht als @-Erwähnung lesen: a "b" c.txt, d "e" f.txt',
    });
  });
  it("leere Liste: nichts einzufügen, keine Meldung", () => {
    expect(planDrop([])).toEqual({ text: "", notice: null });
  });
});
