import { describe, expect, it } from "vitest";
import { checkBytes, checkFile, maskPath, parseDenylist } from "../src/core/public-check";

const LISTE = ["# Kommentar", "", "geheimwort", "  Zweitbegriff  ", "!geheimwort-erlaubt", ""].join("\n");

describe("parseDenylist", () => {
  it("trennt Sperrbegriffe und Ausnahmen, ignoriert Kommentare und Leerzeilen", () => {
    expect(parseDenylist(LISTE)).toEqual({
      terms: ["geheimwort", "zweitbegriff"],
      exceptions: ["geheimwort-erlaubt"],
    });
  });

  it("leerer Text und reine Kommentare ergeben keine Begriffe", () => {
    expect(parseDenylist("").terms).toEqual([]);
    expect(parseDenylist("# nur\n\n  \n").terms).toEqual([]);
  });

  it("Ausnahmen allein zählen nicht als Sperrbegriff", () => {
    expect(parseDenylist("!nur-ausnahme").terms).toEqual([]);
  });

  it("verträgt CRLF", () => {
    expect(parseDenylist("geheimwort\r\n!ok\r\n")).toEqual({ terms: ["geheimwort"], exceptions: ["ok"] });
  });
});

describe("checkFile", () => {
  const liste = parseDenylist(LISTE);

  it("meldet Treffer mit Zeilennummer, ohne den Treffertext", () => {
    const r = checkFile("src/a.ts", "eins\nzwei geheimwort drei\nvier", liste);
    expect(r).toEqual([{ file: "src/a.ts", line: 2 }]);
    expect(JSON.stringify(r)).not.toContain("geheimwort");
  });

  it("ignoriert Groß/klein", () => {
    expect(checkFile("a.ts", "GeheimWort", liste)).toEqual([{ file: "a.ts", line: 1 }]);
    expect(checkFile("a.ts", "ZWEITBEGRIFF", liste)).toEqual([{ file: "a.ts", line: 1 }]);
  });

  it("Ausnahme erlaubt die Stelle, ein weiterer Treffer in derselben Zeile bleibt", () => {
    expect(checkFile("a.ts", "x GEHEIMWORT-erlaubt y", liste)).toEqual([]);
    expect(checkFile("a.ts", "geheimwort-erlaubt und geheimwort", liste)).toEqual([{ file: "a.ts", line: 1 }]);
  });

  it("meldet Treffer im Dateinamen mit Zeile 0", () => {
    expect(checkFile("test/geheimwort.test.ts", "sauber", liste)).toEqual([{ file: "test/***.test.ts", line: 0 }]);
  });

  it("Pfad und Inhalt zugleich ergeben zwei Treffer", () => {
    expect(checkFile("geheimwort.md", "a\ngeheimwort", liste)).toEqual([
      { file: "***.md", line: 0 },
      { file: "***.md", line: 2 },
    ]);
  });

  it("content null prüft nur den Pfad (Binärdatei)", () => {
    expect(checkFile("bild.png", null, liste)).toEqual([]);
    expect(checkFile("geheimwort.png", null, liste)).toEqual([{ file: "***.png", line: 0 }]);
  });

  it("leere Liste meldet nichts", () => {
    expect(checkFile("a.ts", "geheimwort", { terms: [], exceptions: [] })).toEqual([]);
  });
});

const L2 = parseDenylist("geheimwort\n!geheimwort-ok\n");
const u = (...c: number[]) => Uint8Array.from(c);
const enc = (t: string) => new TextEncoder().encode(t);
const utf16 = (t: string, bom: "le" | "be" | null) => {
  const out: number[] = bom === "le" ? [0xff, 0xfe] : bom === "be" ? [0xfe, 0xff] : [];
  for (const ch of t) {
    const c = ch.charCodeAt(0);
    if (bom === "be") out.push(c >> 8, c & 255);
    else out.push(c & 255, c >> 8);
  }
  return Uint8Array.from(out);
};

describe("Lücke 1: Binär und UTF-16", () => {
  it("UTF-16 LE mit BOM wird zeilenweise geprüft", () => {
    expect(checkBytes("a.txt", utf16("eins\nzwei geheimwort", "le"), L2)).toEqual([{ file: "a.txt", line: 2 }]);
  });
  it("UTF-16 BE mit BOM wird zeilenweise geprüft", () => {
    expect(checkBytes("a.txt", utf16("geheimwort\nzwei", "be"), L2)).toEqual([{ file: "a.txt", line: 1 }]);
  });
  it("sonstige Binärdatei (NUL) mit latin1-Treffer: Zeile 0, Vermerk binär", () => {
    expect(checkBytes("b.bin", Uint8Array.from([0, 1, 2, ...enc("xx geheimwort yy"), 0]), L2)).toEqual([{ file: "b.bin", line: 0, note: "binär" }]);
  });
  it("sonstige Binärdatei mit utf16le-Treffer ohne BOM", () => {
    expect(checkBytes("b.bin", Uint8Array.from([0, 0, 1, ...utf16("geheimwort", null)]), L2)).toEqual([{ file: "b.bin", line: 0, note: "binär" }]);
  });
  it("saubere Binärdatei ergibt nichts, normaler UTF-8-Text bleibt zeilenweise", () => {
    expect(checkBytes("b.bin", u(0, 1, 2, 3), L2)).toEqual([]);
    expect(checkBytes("t.txt", enc("a\ngeheimwort"), L2)).toEqual([{ file: "t.txt", line: 2 }]);
  });
});

describe("Lücke 2: maskierter Pfad", () => {
  it("maskPath ersetzt jedes Vorkommen, Ausnahmen bleiben", () => {
    expect(maskPath("a/GeheimWort/geheimwort-ok/x-geheimwort.ts", L2)).toBe("a/***/geheimwort-ok/x-***.ts");
  });
  it("Inhaltstreffer in Datei mit Begriff im Pfad nennt nur den maskierten Pfad", () => {
    const r = checkFile("geheimwort/a.ts", "geheimwort", L2);
    expect(r).toEqual([
      { file: "***/a.ts", line: 0 },
      { file: "***/a.ts", line: 1 },
    ]);
    expect(JSON.stringify(r).toLowerCase()).not.toContain("geheimwort");
  });
});

describe("Lücke 3: Ausnahme nur mit Wortgrenze", () => {
  it.each([
    ["geheimwort-ok", 0],
    ["x/geheimwort-ok.", 0],
    ["geheimwort-okay", 1],
    ["geheimwort-ok_2", 1],
    ["geheimwort-okzzz", 1],
    ["zzzgeheimwort-ok", 1],
    ["1geheimwort-ok", 1],
  ])("%s -> %i Treffer", (text, n) => {
    expect(checkFile("a.ts", text, L2)).toHaveLength(n);
  });
});

describe("Lücke 5: Unicode-Umgehung", () => {
  const li = parseDenylist("ilkerx\ngeheimwort\n");
  it("İ (I mit Punkt) wird gefunden", () => {
    expect(checkFile("a.ts", "x\nİLKERX", li)).toEqual([{ file: "a.ts", line: 2 }]);
  });
  it("Zeichen mit Nullbreite im Begriff werden entfernt", () => {
    expect(checkFile("a.ts", "geheim\u200bwort", li)).toEqual([{ file: "a.ts", line: 1 }]);
    expect(checkFile("a.ts", "gehe\ufeffim\u200dwort", li)).toEqual([{ file: "a.ts", line: 1 }]);
  });
  it("Kombinationszeichen und Kompatibilitätsformen werden gefunden", () => {
    expect(checkFile("a.ts", "ｇｅｈｅｉｍｗｏｒｔ", li)).toHaveLength(1);
    expect(checkFile("a.ts", "gẹheimwort", li)).toHaveLength(1);
  });
  it("Pfadmaske trifft auch bei Umgehungsschreibweise", () => {
    expect(maskPath("a/geheim\u200bwort.ts", li)).toBe("a/***.ts");
  });
});
