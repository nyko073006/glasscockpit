import { describe, expect, it } from "vitest";
import { MAX_RENDER_ROWS, buildDiffView, diffTabTitle, displayPath, hunkHeader } from "../src/core/diff-view-model";

describe("buildDiffView", () => {
  it("Änderung: Zusammenfassung mit Plus und Minus, ein Hunk, keine Hinweise", () => {
    const v = buildDiffView("alt\n", "neu\n");
    expect(v.summary).toBe("+1 −1");
    expect(v.hunks).toHaveLength(1);
    expect(v.notes).toEqual([]);
    expect(v.hiddenRows).toBe(0);
  });
  it("neue Datei: sagt es und zählt die Zeilen", () => {
    expect(buildDiffView(null, "a\nb\n").summary).toBe("Neue Datei, +2 Zeilen");
    expect(buildDiffView(null, "a\n").summary).toBe("Neue Datei, +1 Zeile");
  });
  it("neue leere Datei", () => {
    expect(buildDiffView(null, "").summary).toBe("Neue Datei, leer");
  });
  it("keine Textänderung: sagt es", () => {
    expect(buildDiffView("a\n", "a\n").summary).toBe("Keine Änderung");
    expect(buildDiffView("a\n", "a\n").hunks).toEqual([]);
  });
  it("nur Zeilenenden geändert: Hinweis, kein Hunk", () => {
    const v = buildDiffView("a\r\n", "a\n");
    expect(v.notes).toContain("Zeilenenden ändern sich (CRLF und LF)");
    expect(v.hunks).toEqual([]);
  });
  it("grober Rückfall wird erklärt", () => {
    const n = 3000;
    const a = Array.from({ length: n }, (_, i) => `a${i}`).join("\n") + "\n";
    const b = Array.from({ length: n }, (_, i) => `b${i}`).join("\n") + "\n";
    const v = buildDiffView(a, b);
    expect(v.notes.some((x) => /ganz ersetzt/.test(x))).toBe(true);
  });
  it("zu viele Zeilen: abgeschnitten, hiddenRows zählt den Rest, Hinweis nennt die Zahl", () => {
    const n = MAX_RENDER_ROWS + 300;
    const b = Array.from({ length: n }, (_, i) => `z${i}`).join("\n") + "\n";
    const v = buildDiffView(null, b);
    const shown = v.hunks.reduce((s, h) => s + h.lines.length, 0);
    expect(shown).toBe(MAX_RENDER_ROWS);
    expect(v.hiddenRows).toBe(300);
    expect(v.notes.some((x) => x.includes("300"))).toBe(true);
  });
  it("mehrere Hunks, Budget in einem späteren erschöpft: nie ein Hunk ohne Zeilen, Hinweis nennt weitere Änderungen", () => {
    // Drei weit auseinanderliegende Änderungen, zusammen deutlich über der Grenze.
    const n = 9000;
    const a = Array.from({ length: n }, (_, i) => `z${i}`);
    const b = a.map((t, i) => ((i % 3000) < 200 ? `${t}!` : t)); // drei Hunks zu je rund 1200 Zeilen mit 400 Zeilen Kontext
    const v = buildDiffView(`${a.join("\n")}\n`, `${b.join("\n")}\n`, 400);
    expect(v.hunks.length).toBeGreaterThan(1);
    for (const h of v.hunks) expect(h.lines.length).toBeGreaterThan(0);
    expect(v.hunks.reduce((s, h) => s + h.lines.length, 0)).toBeLessThanOrEqual(MAX_RENDER_ROWS);
    expect(v.hiddenRows).toBeGreaterThan(0);
    expect(v.notes.some((x) => /weitere Änderungen nicht gezeigt/.test(x))).toBe(true);
  });
  it("Budget genau am Ende eines Hunks erschöpft: der nächste Hunk fehlt ganz, kein leerer Kopf", () => {
    const a = Array.from({ length: 4000 }, (_, i) => `z${i}`);
    const b = a.map((t, i) => (i === 10 || i === 3990 ? `${t}!` : t));
    const v = buildDiffView(`${a.join("\n")}\n`, `${b.join("\n")}\n`, 3);
    for (const h of v.hunks) expect(h.lines.length).toBeGreaterThan(0);
  });
  it("Binärdatei (NUL in der alten oder neuen Fassung): keine Zeilen, Hinweis", () => {
    for (const [o, n] of [["a\0b\n", "x\n"], ["x\n", "a\0b\n"], [null, "\0\0"]] as const) {
      const v = buildDiffView(o, n);
      expect(v.binary).toBe(true);
      expect(v.hunks).toEqual([]);
      expect(v.summary).toBe("Binärdatei");
      expect(v.notes).toContain("Binärdatei, nur Annehmen oder Ablehnen");
    }
    expect(buildDiffView("a\n", "b\n").binary).toBe(false);
  });
  it("unter der Grenze wird nichts abgeschnitten", () => {
    const b = Array.from({ length: 50 }, (_, i) => `z${i}`).join("\n") + "\n";
    expect(buildDiffView(null, b).hiddenRows).toBe(0);
  });
});

describe("Anzeigehelfer", () => {
  it("displayPath: im Vault relativ, sonst absolut", () => {
    expect(displayPath("/v/Notizen/a.md", "/v")).toBe("Notizen/a.md");
    expect(displayPath("/v/Notizen/a.md", "/v/")).toBe("Notizen/a.md");
    expect(displayPath("/r/x/a.ts", "/v")).toBe("/r/x/a.ts");
    expect(displayPath("/vault2/a.md", "/v")).toBe("/vault2/a.md");
    expect(displayPath("/r/x/a.ts", null)).toBe("/r/x/a.ts");
  });
  it("diffTabTitle: Dateiname, ohne Pfad", () => {
    expect(diffTabTitle("/r/x/a.ts")).toBe("Diff: a.ts");
    expect(diffTabTitle("/a.ts")).toBe("Diff: a.ts");
  });
  it("displayPath unter Windows: ohne Rücksicht auf Schreibweise und Trenner, vault-relativ mit /", () => {
    expect(displayPath("C:\\v\\a\\b.md", "C:\\V", "win32")).toBe("a/b.md");
    expect(displayPath("c:/v/a/b.md", "C:\\V\\", "win32")).toBe("a/b.md");
    expect(displayPath("C:\\V2\\b.md", "C:\\V", "win32")).toBe("C:\\V2\\b.md");
    expect(displayPath("D:\\V\\b.md", "C:\\V", "win32")).toBe("D:\\V\\b.md");
    expect(displayPath("C:\\V", "C:\\V", "win32")).toBe("C:\\V");
    expect(displayPath("C:\\x\\a.ts", null, "win32")).toBe("C:\\x\\a.ts");
    // darwin bleibt wie bisher: ein Windows-Pfad liegt dort nie im Vault
    expect(displayPath("C:\\v\\a\\b.md", "C:\\V")).toBe("C:\\v\\a\\b.md");
  });
  it("diffTabTitle unter Windows: letzter Teil an beiden Trennern", () => {
    expect(diffTabTitle("C:\\v\\a\\b.md", "win32")).toBe("Diff: b.md");
    expect(diffTabTitle("c:/v/a/b.md", "win32")).toBe("Diff: b.md");
    expect(diffTabTitle("C:\\v\\a\\b.md")).toBe("Diff: C:\\v\\a\\b.md");
  });
  it("hunkHeader im Stil von unified diff", () => {
    expect(hunkHeader({ oldStart: 7, oldCount: 7, newStart: 7, newCount: 8, lines: [] })).toBe("@@ −7,7 +7,8 @@");
    expect(hunkHeader({ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2, lines: [] })).toBe("@@ −0,0 +1,2 @@");
  });
});
