import { describe, expect, it } from "vitest";
import { markBriefing, parseFocus, pointKey, scanBriefing } from "../src/core/focus";

describe("pointKey", () => {
  it("säubert wie clean, fasst Leerraum zusammen, Kleinbuchstaben", () => {
    expect(pointKey("  **B**   mit\t[[Notiz|Alias]] ")).toBe("b mit alias");
  });
});

describe("scanBriefing", () => {
  it("Listenpunkte oberster Ebene unter der Überschrift, nicht danach", () => {
    const scan = scanBriefing("### Heute dran\n- A\n  - Unter\n- B [[Notiz|Alias]]\n### Anderes\n- C", "Heute dran");
    expect(scan.points).toEqual([
      { key: "a", text: "A", fileDone: false, underHeading: true },
      { key: "b alias", text: "B [[Notiz|Alias]]", fileDone: false, underHeading: true },
    ]);
    expect(scan.boxes).toEqual([
      { line: 1, key: "a", locked: false },
      { line: 3, key: "b alias", locked: false },
    ]);
  });
  it("Überschrift ohne Groß/Klein und Leerraum außen, tiefere Überschriften gehören dazu", () => {
    const scan = scanBriefing("## heute DRAN  \n- A\n### Tiefer\n- B\n## Gleich\n- C", "Heute dran");
    expect(scan.points.map((p) => p.key)).toEqual(["a", "b"]);
  });
  it("Checkboxen auch außerhalb der Überschrift", () => {
    const scan = scanBriefing("- [ ] X\n# Heute dran\n- Y\n- [x] Z", "Heute dran");
    expect(scan.points).toEqual([
      { key: "x", text: "X", fileDone: false, underHeading: false },
      { key: "y", text: "Y", fileDone: false, underHeading: true },
      { key: "z", text: "Z", fileDone: true, underHeading: true },
    ]);
    expect(scan.boxes).toEqual([
      { line: 0, key: "x", locked: false },
      { line: 2, key: "y", locked: false },
      { line: 3, key: "z", locked: true },
    ]);
  });
  it("gleicher Schlüssel: ein Punkt, zwei Boxen", () => {
    const scan = scanBriefing("# Heute dran\n- Gleich\n\n- [ ] gleich", "Heute dran");
    expect(scan.points).toEqual([{ key: "gleich", text: "Gleich", fileDone: false, underHeading: true }]);
    expect(scan.boxes).toEqual([
      { line: 1, key: "gleich", locked: false },
      { line: 3, key: "gleich", locked: false },
    ]);
  });
  it("gesperrte zweite Fundstelle macht den Punkt fertig", () => {
    const scan = scanBriefing("# Heute dran\n- Gleich\n- [-] gleich", "Heute dran");
    expect(scan.points).toEqual([{ key: "gleich", text: "Gleich", fileDone: true, underHeading: true }]);
    expect(scan.boxes.map((b) => b.locked)).toEqual([false, true]);
  });
  it("erste Fundstelle außerhalb, zweite unter der Überschrift: Text der ersten, Punkt der Überschrift", () => {
    const scan = scanBriefing("- [ ] **Gleich**\n# Heute dran\n- gleich", "Heute dran");
    expect(scan.points).toEqual([{ key: "gleich", text: "**Gleich**", fileDone: false, underHeading: true }]);
  });
  it("Frontmatter und Codeblöcke zählen nicht, die Zeilennummer zählt die Frontmatter mit", () => {
    const md = "---\ntitel: x\n- [ ] Kopf\n---\n# Heute dran\n```\n- [ ] Code\n- Code2\n```\n- A";
    const scan = scanBriefing(md, "Heute dran");
    expect(scan.points.map((p) => p.key)).toEqual(["a"]);
    expect(scan.boxes).toEqual([{ line: 9, key: "a", locked: false }]);
  });
  it("Zitat ist kein Punkt und keine Box", () => {
    expect(scanBriefing("> - [ ] Zitat", "Heute dran")).toEqual({ points: [], boxes: [] });
    expect(scanBriefing("# Heute dran\n> - Zitat", "Heute dran")).toEqual({ points: [], boxes: [] });
  });
  it("leere Überschrift: nur Checkboxen", () => {
    const scan = scanBriefing("## \n- A\n- [ ] B", "");
    expect(scan.points.map((p) => p.key)).toEqual(["b"]);
    expect(scan.boxes).toEqual([{ line: 2, key: "b", locked: false }]);
  });
  it("leerer Schlüssel: Listenpunkt entfällt samt Box, Checkbox bleibt als gesperrte Box ohne Punkt", () => {
    expect(scanBriefing("# Heute dran\n- **\n- [ ] ``", "Heute dran")).toEqual({
      points: [],
      boxes: [{ line: 2, key: "", locked: true }],
    });
  });
  it("eingerückte Checkbox unter der Überschrift zählt, aber nicht als Punkt der Überschrift", () => {
    const scan = scanBriefing("# Heute dran\n- A\n  - [ ] Unter", "Heute dran");
    expect(scan.points).toEqual([
      { key: "a", text: "A", fileDone: false, underHeading: true },
      { key: "unter", text: "Unter", fileDone: false, underHeading: false },
    ]);
  });
  it("Tab zählt als vier Leerzeichen bei der obersten Ebene", () => {
    const scan = scanBriefing("# Heute dran\n    - A\n\t- B\n      - C", "Heute dran");
    expect(scan.points.map((p) => p.key)).toEqual(["a", "b"]);
  });
  it("CRLF: kein \\r im Text, Checkbox erkannt", () => {
    const scan = scanBriefing("# Heute dran\r\n- [x] A\r\n- B\r\n", "Heute dran");
    expect(scan.points).toEqual([
      { key: "a", text: "A", fileDone: true, underHeading: true },
      { key: "b", text: "B", fileDone: false, underHeading: true },
    ]);
  });
});

describe("markBriefing", () => {
  it("schreibt Häkchen und ergänzt Checkboxen, gesperrte Zeilen bleiben", () => {
    const md = "- [ ] X\n# Heute dran\n- Y\n- [x] Z";
    expect(markBriefing(md, scanBriefing(md, "Heute dran"), new Set(["y"]))).toBe(
      "- [ ] X\n# Heute dran\n- [x] Y\n- [x] Z",
    );
  });
  it("nimmt ein Häkchen zurück und ergänzt leere Checkbox", () => {
    const md = "- [x] X\n# Heute dran\n1. Y\n* [ ] W";
    const scan = { points: [], boxes: [{ line: 0, key: "x", locked: false }, { line: 2, key: "y", locked: false }, { line: 3, key: "w", locked: false }] };
    expect(markBriefing(md, scan, new Set(["w"]))).toBe("- [ ] X\n# Heute dran\n1. [ ] Y\n* [x] W");
  });
  it("CRLF bleibt erhalten", () => {
    const md = "- [ ] X\r\n# Heute dran\r\n- Y\r\n- [x] Z\r\n";
    expect(markBriefing(md, scanBriefing(md, "Heute dran"), new Set(["y", "x"]))).toBe(
      "- [x] X\r\n# Heute dran\r\n- [x] Y\r\n- [x] Z\r\n",
    );
  });
  it("BOM vor der ersten Zeile bleibt", () => {
    const md = "\uFEFF- A\n- [ ] B";
    expect(markBriefing(md, scanBriefing(md, ""), new Set(["b"]))).toBe("\uFEFF- A\n- [x] B");
    const md2 = "\uFEFF- [ ] A";
    expect(markBriefing(md2, scanBriefing(md2, ""), new Set(["a"]))).toBe("\uFEFF- [x] A");
  });
  it("Zeilen ohne Box bleiben unberührt", () => {
    const md = "- A\n# Heute dran\n- B\n  - C";
    expect(markBriefing(md, scanBriefing(md, "Heute dran"), new Set())).toBe("- A\n# Heute dran\n- [ ] B\n  - C");
  });
});

describe("parseFocus über scanBriefing", () => {
  it("nur Punkte unter der Überschrift, gesäubert", () => {
    expect(parseFocus("- [ ] X\n# Heute dran\n- Y\n- [x] Z", "Heute dran")).toEqual(["Y", "Z"]);
    expect(parseFocus("- [ ] X\n# Heute dran\n- Y\n- [x] Z", "")).toEqual([]);
  });
  it("Überschrift ohne Groß/Klein", () => {
    expect(parseFocus("## HEUTE dran\n- A", "heute DRAN")).toEqual(["A"]);
  });
  it("Reihenfolge der Zeilen unter der Überschrift, frühere gleichlautende Checkbox zieht nicht vor", () => {
    expect(parseFocus("- [ ] C\n# Heute dran\n- A\n- B\n- C", "Heute dran")).toEqual(["A", "B"]);
    expect(parseFocus("## Offen\n- [ ] Steuer\n## Heute dran\n- Mail\n- Anruf\n- Steuer", "Heute dran")).toEqual(["Mail", "Anruf"]);
  });
  it("gleicher Schlüssel unter der Überschrift zählt einmal", () => {
    expect(parseFocus("# Heute dran\n- A\n- [ ] a\n- B", "Heute dran")).toEqual(["A", "B"]);
  });
});

describe("scanBriefing, Randfälle", () => {
  const keys = (md: string, h = "Heute dran") => scanBriefing(md, h).points.map((p) => p.key);
  const boxKeys = (md: string, h = "Heute dran") => scanBriefing(md, h).boxes.map((b) => b.key);
  it("Tab zählt genau vier Leerzeichen", () => {
    expect(keys("# Heute dran\n\t- A\n    - B\n     - C")).toEqual(["a", "b"]);
  });
  it("flachere Punkte als der erste zählen", () => {
    expect(keys("# Heute dran\n  - A\n- B")).toEqual(["a", "b"]);
  });
  it("Checkbox mit leerem Schlüssel behält eine gesperrte Box ohne Punkt, markBriefing lässt sie", () => {
    const md = "- [ ]\n- [ ] **\n- [ ] B";
    const scan = scanBriefing(md, "");
    expect(scan.boxes).toEqual([
      { line: 0, key: "", locked: true },
      { line: 1, key: "", locked: true },
      { line: 2, key: "b", locked: false },
    ]);
    expect(scan.points).toEqual([{ key: "b", text: "B", fileDone: false, underHeading: false }]);
    expect(markBriefing(md, scan, new Set(["", "b"]))).toBe("- [ ]\n- [ ] **\n- [x] B");
  });
  it("Zaun schließt nur mit gleichem Zeichen, mindestens gleich lang, ohne Info-String", () => {
    expect(boxKeys("````\n```\n- [ ] Codezeile\n```\n````\n- [ ] B")).toEqual(["b"]);
    expect(boxKeys("```\n```js\n- [ ] A\n```\n- [ ] B")).toEqual(["b"]);
    expect(boxKeys("```\n~~~\n- [ ] A\n```\n- [ ] B")).toEqual(["b"]);
    expect(boxKeys("~~~\n- [ ] Code\n~~~\n- [ ] A")).toEqual(["a"]);
  });
  it("Trennlinie ist weder Punkt noch Box", () => {
    expect(keys("# H\n- a\n* * *\n- b", "H")).toEqual(["a", "b"]);
    for (const rule of ["- - -", "***", "---", "_ _ _", "-  -  -  -"]) {
      expect(scanBriefing(`# H\n- a\n${rule}\n- b`, "H").boxes.map((b) => b.key)).toEqual(["a", "b"]);
    }
  });
  it("Tab nach der Klammer: Checkbox, markBriefing setzt keine zweite davor", () => {
    const md = "# Heute dran\n- [ ]\tText";
    const scan = scanBriefing(md, "Heute dran");
    expect(scan.points).toEqual([{ key: "text", text: "Text", fileDone: false, underHeading: true }]);
    expect(markBriefing(md, scan, new Set(["text"]))).toBe("# Heute dran\n- [x]\tText");
  });
  it("Nummerierte Checkboxen, erste gesperrt", () => {
    expect(scanBriefing("1. [x] A\n2) [ ] B", "").boxes).toEqual([
      { line: 0, key: "a", locked: true },
      { line: 1, key: "b", locked: false },
    ]);
  });
  it("zwei Zeichen in der Klammer sind keine Checkbox", () => {
    expect(scanBriefing("- [xx] A", "")).toEqual({ points: [], boxes: [] });
  });
});

describe("parseFocus", () => {
  it("die ersten zwei Punkte unter der Überschrift", () => {
    const md = "# Briefing\n\n## Heute dran\n\n- Eins\n- Zwei\n- Drei\n\n## Termine\n- X";
    expect(parseFocus(md, "Heute dran")).toEqual(["Eins", "Zwei"]);
  });
  it("beliebige Ebene von 1 bis 6", () => {
    for (let n = 1; n <= 6; n++) expect(parseFocus(`${"#".repeat(n)} Heute dran\n- A`, "Heute dran")).toEqual(["A"]);
  });
  it("sieben Rauten sind keine Überschrift", () => {
    expect(parseFocus("####### Heute dran\n- A", "Heute dran")).toEqual([]);
  });
  it("Vergleich getrimmt, auch bei der Vorgabe", () => {
    expect(parseFocus("##   Heute dran   \n- A", "  Heute dran ")).toEqual(["A"]);
    expect(parseFocus("## Heute dran ##\n- A", "Heute dran")).toEqual(["A"]);
  });
  it("kein Teiltreffer", () => {
    expect(parseFocus("## Heute dran später\n- A", "Heute dran")).toEqual([]);
    expect(parseFocus("## Nicht Heute dran\n- A", "Heute dran")).toEqual([]);
  });
  it("bis zur nächsten Überschrift gleicher oder höherer Ebene, tiefere gehören dazu", () => {
    expect(parseFocus("## Heute dran\n- A\n### Unter\n- B\n- C", "Heute dran")).toEqual(["A", "B"]);
    expect(parseFocus("## Heute dran\n### Unter\n## Gleich\n- B", "Heute dran")).toEqual([]);
    expect(parseFocus("## Heute dran\n# Oben\n- B", "Heute dran")).toEqual([]);
  });
  it("fehlende Überschrift oder keine Punkte ergibt leer", () => {
    expect(parseFocus("## Anderes\n- A", "Heute dran")).toEqual([]);
    expect(parseFocus("## Heute dran\nnur Text\n\n## Next", "Heute dran")).toEqual([]);
    expect(parseFocus("", "Heute dran")).toEqual([]);
    expect(parseFocus("## Heute dran", "Heute dran")).toEqual([]);
  });
  it("leere Überschrift im Aufruf trifft nichts", () => {
    expect(parseFocus("## \n- A", "")).toEqual([]);
  });
  it("nur ein Punkt ergibt einen", () => {
    expect(parseFocus("## Heute dran\n- Nur einer", "Heute dran")).toEqual(["Nur einer"]);
  });
  it("Markierungen -, *, +, 1. und 1)", () => {
    expect(parseFocus("## Heute dran\n* A\n+ B", "Heute dran")).toEqual(["A", "B"]);
    expect(parseFocus("## Heute dran\n1. A\n2) B", "Heute dran")).toEqual(["A", "B"]);
  });
  it("Text zwischen den Punkten stört nicht, eingerückte Unterpunkte zählen nicht", () => {
    expect(parseFocus("## Heute dran\n- A\n  - A1\n  - A2\nText\n- B\n- C", "Heute dran")).toEqual(["A", "B"]);
  });
  it("säubert Wikilinks, Markdown-Links, Fett, Code und Häkchen", () => {
    const md = "## Heute dran\n- [ ] **Wichtig** mit [[Seite|Alias]] und [[Nur Seite]]\n- [x] [Text](http://a.b) und `code` und __fett__";
    expect(parseFocus(md, "Heute dran")).toEqual(["Wichtig mit Alias und Nur Seite", "Text und code und fett"]);
  });
  it("Häkchen in Großschreibung, nur am Anfang", () => {
    expect(parseFocus("## Heute dran\n- [X] Fertig\n- Text [ ] mitten", "Heute dran")).toEqual(["Fertig", "Text [ ] mitten"]);
  });
  it("Punkt, der nach dem Säubern leer ist, zählt nicht", () => {
    expect(parseFocus("## Heute dran\n- [ ]\n- **\n- A\n- B\n- C", "Heute dran")).toEqual(["A", "B"]);
  });
  it("Frontmatter und Codeblöcke werden übersprungen", () => {
    const md = "---\n# Heute dran\n- Y\n---\n## Heute dran\n```\n## Anderes\n- Code\n```\n- A";
    expect(parseFocus(md, "Heute dran")).toEqual(["A"]);
    expect(parseFocus("```\n## Heute dran\n- A\n```", "Heute dran")).toEqual([]);
  });
  it("CRLF", () => {
    expect(parseFocus("## Heute dran\r\n- A\r\n- B\r\n", "Heute dran")).toEqual(["A", "B"]);
  });
  it("erste passende Überschrift gilt", () => {
    expect(parseFocus("## Heute dran\n- A\n## Heute dran\n- B", "Heute dran")).toEqual(["A"]);
  });
});
