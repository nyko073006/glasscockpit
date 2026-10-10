import { describe, expect, it } from "vitest";
import { parseFocus } from "../src/core/focus";

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
  it("nur bis zur nächsten Überschrift, jeder Ebene", () => {
    expect(parseFocus("## Heute dran\n- A\n### Unter\n- B\n- C", "Heute dran")).toEqual(["A"]);
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
