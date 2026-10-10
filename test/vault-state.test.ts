import { describe, expect, it } from "vitest";
import { countInboxNotes, dailyNoteName, hasDailyNote, indexAgeDays, indexStale, localDayKey, parseGeneratedAt } from "../src/core/vault-state";

describe("parseGeneratedAt", () => {
  it("Datum mit Uhrzeit als lokale Zeit", () => {
    const d = parseGeneratedAt("---\ntags: [x]\ngenerated_at: 2026-09-30 10:27\nsource: claude\n---\n\nText");
    expect(d).toEqual(new Date(2026, 8, 30, 10, 27));
  });
  it("T-Schreibweise, Sekunden, Anführungszeichen, CRLF", () => {
    expect(parseGeneratedAt("---\ngenerated_at: 2026-09-30T10:27:05\n---\n")).toEqual(new Date(2026, 8, 30, 10, 27, 5));
    expect(parseGeneratedAt('---\ngenerated_at: "2026-09-30 10:27"\n---\n')).toEqual(new Date(2026, 8, 30, 10, 27));
    expect(parseGeneratedAt("---\r\ngenerated_at: 2026-09-30 10:27\r\n---\r\n")).toEqual(new Date(2026, 8, 30, 10, 27));
  });
  it("nur Datum: lokaler Tagesbeginn", () => {
    expect(parseGeneratedAt("---\ngenerated_at: 2026-09-30\n---\n")).toEqual(new Date(2026, 8, 30));
  });
  it("mit Zeitzone: absolute Zeit", () => {
    expect(parseGeneratedAt("---\ngenerated_at: 2026-09-30T10:27:00Z\n---\n")?.getTime()).toBe(Date.UTC(2026, 8, 30, 10, 27));
  });
  it("kaputtes Frontmatter ergibt null", () => {
    expect(parseGeneratedAt("generated_at: 2026-09-30 10:27\n")).toBeNull();
    expect(parseGeneratedAt("---\ngenerated_at: 2026-09-30 10:27\nohne Schluss")).toBeNull();
    expect(parseGeneratedAt("")).toBeNull();
  });
  it("Feld fehlt oder Wert unbrauchbar ergibt null", () => {
    expect(parseGeneratedAt("---\ntags: [x]\n---\n")).toBeNull();
    expect(parseGeneratedAt("---\ngenerated_at: gestern\n---\n")).toBeNull();
    expect(parseGeneratedAt("---\ngenerated_at:\n---\n")).toBeNull();
    expect(parseGeneratedAt("---\ngenerated_at: 2026-13-45 10:00\n---\n")).toBeNull();
    expect(parseGeneratedAt("---\ngenerated_at: 2026-02-30 10:00\n---\n")).toBeNull();
    expect(parseGeneratedAt("---\ngenerated_at: 2026-09-30 25:00\n---\n")).toBeNull();
  });
  it("Feld im Text nach dem Frontmatter zählt nicht; ähnlicher Schlüssel auch nicht", () => {
    expect(parseGeneratedAt("---\ntags: x\n---\ngenerated_at: 2026-09-30 10:27")).toBeNull();
    expect(parseGeneratedAt("---\nxgenerated_at: 2026-09-30 10:27\n---\n")).toBeNull();
  });
});

describe("indexAgeDays und indexStale", () => {
  const gen = new Date(2026, 8, 30, 10, 27);
  it("volle Tage, abgerundet", () => {
    expect(indexAgeDays(gen, new Date(2026, 8, 30, 23, 0))).toBe(0);
    expect(indexAgeDays(gen, new Date(2026, 9, 1, 10, 26))).toBe(0);
    expect(indexAgeDays(gen, new Date(2026, 9, 1, 10, 27))).toBe(1);
    expect(indexAgeDays(gen, new Date(2026, 9, 7, 10, 27))).toBe(7);
  });
  it("Zukunft ergibt 0", () => {
    expect(indexAgeDays(gen, new Date(2026, 8, 1))).toBe(0);
  });
  it("gelb ab lintAfterDays, genau an der Grenze", () => {
    expect(indexStale(6, 7)).toBe(false);
    expect(indexStale(7, 7)).toBe(true);
    expect(indexStale(8, 7)).toBe(true);
  });
});

describe("countInboxNotes", () => {
  it("zählt nur .md, keine versteckten Dateien, keine Unterpfade", () => {
    const names = ["a.md", "B.MD", ".versteckt.md", ".DS_Store", "bild.png", "notiz.txt", "md", "ordner/c.md", "d.md.bak", ".md"];
    expect(countInboxNotes(names)).toBe(2);
  });
  it("leer ergibt 0", () => {
    expect(countInboxNotes([])).toBe(0);
  });
});

describe("dailyNoteName und hasDailyNote", () => {
  it("lokales Datum, mit führenden Nullen", () => {
    expect(dailyNoteName(new Date(2026, 0, 5, 12))).toBe("2026-01-05.md");
    expect(dailyNoteName(new Date(2026, 9, 6, 0, 0, 1))).toBe("2026-10-06.md");
    expect(dailyNoteName(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31.md");
  });
  it("hasDailyNote: Name muss genau stimmen", () => {
    const now = new Date(2026, 9, 6, 8);
    expect(hasDailyNote(["2026-10-05.md", "2026-10-06.md"], now)).toBe(true);
    expect(hasDailyNote(["2026-10-05.md", "2026-10-06.md.bak", "x/2026-10-06.md"], now)).toBe(false);
    expect(hasDailyNote([], now)).toBe(false);
  });
  it("localDayKey: Zahl oder Date", () => {
    const d = new Date(2026, 9, 6, 23, 59);
    expect(localDayKey(d)).toBe("2026-10-06");
    expect(localDayKey(d.getTime())).toBe("2026-10-06");
  });
});
