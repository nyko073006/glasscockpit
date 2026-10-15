import { describe, expect, it } from "vitest";
import { CLEAR_INSERT, clearRanges } from "../src/core/clear-link";
import { DEFAULT_SETTINGS, parseSettings } from "../src/core/settings";

/** Die Treffer als Ausschnitte des Textes samt Start; jeder Fall prüft damit die Range, nicht nur die Anzahl. */
const hits = (text: string) =>
  clearRanges(text).map((r) => {
    expect(text.slice(r.start, r.end)).toBe("/clear");
    return r.start;
  });

describe("CLEAR_INSERT", () => {
  it("ist /clear mit Leerzeichen hinten, ohne Enter", () => {
    expect(CLEAR_INSERT).toBe("/clear ");
  });
});

describe("clearRanges: Treffer", () => {
  it("mitten im Satz", () => {
    const text = "Diese Session jetzt mit /clear wipen.";
    expect(hits(text)).toEqual([text.indexOf("/clear")]);
    expect(clearRanges(text)).toEqual([{ start: 24, end: 30 }]);
  });
  it("allein: Anfang und Ende", () => {
    expect(clearRanges("/clear")).toEqual([{ start: 0, end: 6 }]);
  });
  it("Satzende mit Punkt", () => {
    expect(clearRanges("/clear.")).toEqual([{ start: 0, end: 6 }]);
  });
  it("Punkt, dann Leerraum", () => {
    expect(clearRanges("Bitte /clear. Danke")).toEqual([{ start: 6, end: 12 }]);
  });
  it("in Klammern", () => {
    expect(clearRanges("(/clear)")).toEqual([{ start: 1, end: 7 }]);
  });
  it("in typografischen Anführungszeichen", () => {
    expect(clearRanges("„/clear“")).toEqual([{ start: 1, end: 7 }]);
  });
  it("in Backticks", () => {
    expect(clearRanges("`/clear`")).toEqual([{ start: 1, end: 7 }]);
  });
  it("in geraden Anführungszeichen", () => {
    expect(clearRanges('"/clear"')).toEqual([{ start: 1, end: 7 }]);
  });
  it("zwei Treffer, aufsteigend", () => {
    expect(clearRanges("/clear und /clear")).toEqual([
      { start: 0, end: 6 },
      { start: 11, end: 17 },
    ]);
  });
});

describe("clearRanges: keine Treffer", () => {
  const keine = [
    "/clearable",
    "src/clear.ts",
    "x/clear",
    "/clear/x",
    "/clear.ts",
    "~/clear",
    "@/clear",
    "/clear-foo",
    "/clear_x",
    "a\\/clear",
    "/Clear",
    "/clear2",
    "ä/clear",
    "/clearé",
    "٣/clear",
    "/clear٣",
    // Je ein Zeichen der Grenzmengen (Abend 35, Review Task 1): fällt eines aus der Menge, bleibt sonst kein Test rot.
    "_/clear",
    "./clear",
    "-/clear",
    "//clear",
    "/clear\\x",
    "/clear.5",
    "a.b/clear",
    "",
  ];
  for (const text of keine) {
    it(JSON.stringify(text), () => {
      expect(clearRanges(text)).toEqual([]);
    });
  }
});

describe("Einstellung clearLink", () => {
  it("Vorgabe an", () => {
    expect(DEFAULT_SETTINGS.clearLink).toBe(true);
    expect(parseSettings({}).settings.clearLink).toBe(true);
  });
  it("aus bleibt aus, nur Wahrheitswerte gelten", () => {
    expect(parseSettings({ clearLink: false }).settings.clearLink).toBe(false);
    const r = parseSettings({ clearLink: "ja" });
    expect([...r.invalid]).toEqual(["clearLink"]);
    expect(r.settings.clearLink).toBe(true);
  });
});
