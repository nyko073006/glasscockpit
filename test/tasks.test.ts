import { describe, expect, it } from "vitest";
import { TASKS_TEMPLATE, displayText, parentFolders, taskRows, textParts, toggleTask } from "../src/core/tasks";

const ok = (r: ReturnType<typeof toggleTask>) => {
  if (!r.ok) throw new Error(`erwartet ok, bekam: ${r.reason}`);
  return r;
};
const fail = (r: ReturnType<typeof toggleTask>) => {
  if (r.ok) throw new Error("erwartet Fehler");
  return r.reason;
};

describe("toggleTask: Umschalten", () => {
  it("offen wird erledigt (LF)", () => {
    const r = ok(toggleTask("# T\n- [ ] A\n- [ ] B\n", 1, "A", false));
    expect(r.content).toBe("# T\n- [x] A\n- [ ] B\n");
    expect(r.done).toBe(true);
  });

  it("erledigt wird offen", () => {
    const r = ok(toggleTask("- [x] A\n", 0, "A", true));
    expect(r.content).toBe("- [ ] A\n");
    expect(r.done).toBe(false);
  });

  it("Groß-X wird zu offen, andere X-Zeilen bleiben unberührt", () => {
    const inhalt = "- [X] A\n- [x] B\n- [ ] C\n";
    const r = ok(toggleTask(inhalt, 0, "A", true));
    expect(r.content).toBe("- [ ] A\n- [x] B\n- [ ] C\n");
    expect(r.done).toBe(false);
  });

  it("jedes andere Zeichen gilt als erledigt und wird offen", () => {
    expect(ok(toggleTask("- [/] A\n", 0, "A", true)).content).toBe("- [ ] A\n");
  });

  it("CRLF bleibt je Zeile erhalten", () => {
    const r = ok(toggleTask("# T\r\n- [ ] A\r\n- [ ] B\r\n", 1, "A", false));
    expect(r.content).toBe("# T\r\n- [x] A\r\n- [ ] B\r\n");
  });

  it("gemischte Zeilenenden bleiben je Zeile erhalten", () => {
    expect(ok(toggleTask("a\n- [ ] A\r\nb\r\n", 1, "A", false)).content).toBe("a\n- [x] A\r\nb\r\n");
  });

  it("Tab- und Leerzeichen-Einrückung bleibt", () => {
    expect(ok(toggleTask("- [ ] A\n\t- [ ] B\n", 1, "B", false)).content).toBe("- [ ] A\n\t- [x] B\n");
    expect(ok(toggleTask("- [ ] A\n    - [ ] B\n", 1, "B", false)).content).toBe("- [ ] A\n    - [x] B\n");
  });

  it.each(["- ", "* ", "+ ", "1. ", "12) "])("Bullet %j", (bullet) => {
    const r = ok(toggleTask(`${bullet}[ ] A\n`, 0, "A", false));
    expect(r.content).toBe(`${bullet}[x] A\n`);
  });

  it("Dateiende ohne Umbruch bleibt ohne Umbruch", () => {
    expect(ok(toggleTask("- [ ] A\n- [ ] B", 1, "B", false)).content).toBe("- [ ] A\n- [x] B");
  });

  it("Umlaut, Wikilink und eingerückter Unterpunkt bleiben bytegenau", () => {
    const inhalt = "# Übersicht\r\n\r\n- [ ] Größe prüfen mit [[Notiz|Alias]] äöü ß\r\n\t- [ ] Unter­punkt\r\n- [x] Fertig\r\n";
    const r = ok(toggleTask(inhalt, 2, "Größe prüfen mit [[Notiz|Alias]] äöü ß", false));
    expect(r.content).toBe(inhalt.replace("- [ ] Größe", "- [x] Größe"));
    expect(Buffer.from(r.content.replace("[x] Größe", "[ ] Größe")).equals(Buffer.from(inhalt))).toBe(true);
  });

  it("Text mit eckigen Klammern im Text wird nicht verwechselt", () => {
    expect(ok(toggleTask("- [ ] A [x] B\n", 0, "A [x] B", false)).content).toBe("- [x] A [x] B\n");
  });
});

describe("toggleTask: verschobene Zeilen", () => {
  const basis = ["- [ ] A", "- [ ] B", "- [ ] C"];

  it("2 Zeilen oberhalb eingefügt: findet die Aufgabe im Fenster", () => {
    const inhalt = ["x", "y", ...basis].join("\n");
    const r = ok(toggleTask(inhalt, 1, "B", false)); // Cache meinte Zeile 1, B steht jetzt in Zeile 3
    expect(r.content).toBe(["x", "y", "- [ ] A", "- [x] B", "- [ ] C"].join("\n"));
  });

  it("2 Zeilen entfernt (Aufgabe liegt weiter oben)", () => {
    const r = ok(toggleTask("- [ ] A\n- [ ] B\n", 3, "A", false));
    expect(r.content).toBe("- [x] A\n- [ ] B\n");
  });

  it("Verschiebung um 5 geht, um 6 scheitert", () => {
    const fuell = (n: number) => Array.from({ length: n }, () => "text");
    expect(ok(toggleTask([...fuell(5), "- [ ] Z"].join("\n"), 0, "Z", false)).done).toBe(true);
    expect(fail(toggleTask([...fuell(6), "- [ ] Z"].join("\n"), 0, "Z", false))).toMatch(/nicht gefunden/);
  });

  it("zwei gleiche Texte im Fenster: mehrdeutig, nichts geschaltet", () => {
    const inhalt = "a\n- [ ] Gleich\nb\n- [ ] Gleich\n";
    const reason = fail(toggleTask(inhalt, 2, "Gleich", false));
    expect(reason).toMatch(/mehrdeutig/);
    expect(reason).not.toMatch(/nicht gefunden/);
  });

  it("trifft die Zeile genau, gewinnt sie auch bei gleichem Text daneben", () => {
    const inhalt = "- [ ] Gleich\n- [ ] Gleich\n";
    expect(ok(toggleTask(inhalt, 1, "Gleich", false)).content).toBe("- [ ] Gleich\n- [x] Gleich\n");
  });

  it("anderer Text an der Zeile: es wird nichts an der falschen Zeile geschaltet", () => {
    expect(fail(toggleTask("- [ ] Andere\n", 0, "Erwartet", false))).toMatch(/nicht gefunden/);
  });

  it("Zeile hinter dem Dateiende", () => {
    expect(fail(toggleTask("- [ ] A\n", 99, "A", false))).toMatch(/nicht gefunden/);
  });

  it("negative Zeile", () => {
    expect(fail(toggleTask("- [ ] A\n", -1, "Z", false))).toMatch(/nicht gefunden/);
  });

  it("Zeile ohne Checkbox", () => {
    expect(fail(toggleTask("# Titel\n- Punkt\n", 1, "Punkt", false))).toMatch(/nicht gefunden/);
  });
});

describe("toggleTask: erwarteter Zustand (Abend 29)", () => {
  it("erwartet offen, die Zeile ist schon erledigt: abgelehnt, nichts zu schreiben", () => {
    expect(toggleTask("- [x] A\n", 0, "A", false)).toEqual({ ok: false, reason: "Aufgabe ist schon abgehakt" });
  });

  it("erwartet erledigt, die Zeile ist schon offen: abgelehnt, nichts zu schreiben", () => {
    expect(toggleTask("- [ ] A\n", 0, "A", true)).toEqual({ ok: false, reason: "Aufgabe ist schon offen" });
  });

  it.each(["x", "X", "/", "-"])("Zeichen %j in der Box gilt als erledigt (wie in der Anzeige): offen erwartet wird abgelehnt, erledigt erwartet geschaltet", (mark) => {
    const inhalt = `- [${mark}] A\n`;
    expect(toggleTask(inhalt, 0, "A", false)).toEqual({ ok: false, reason: "Aufgabe ist schon abgehakt" });
    expect(ok(toggleTask(inhalt, 0, "A", true))).toEqual({ ok: true, content: "- [ ] A\n", done: false });
  });

  it("gilt auch, wenn die Aufgabe verschoben ist und erst die Fenstersuche sie findet", () => {
    expect(toggleTask("x\ny\n- [x] B\n", 0, "B", false)).toEqual({ ok: false, reason: "Aufgabe ist schon abgehakt" });
    expect(toggleTask("x\ny\n- [ ] B\n", 0, "B", true)).toEqual({ ok: false, reason: "Aufgabe ist schon offen" });
    expect(ok(toggleTask("x\ny\n- [x] B\n", 0, "B", true)).content).toBe("x\ny\n- [ ] B\n");
  });

  it("zweiter Klick mit der alten Anzeige kippt die Aufgabe nicht zurück", () => {
    const erst = ok(toggleTask("- [ ] A\n", 0, "A", false));
    expect(erst.content).toBe("- [x] A\n");
    expect(toggleTask(erst.content, 0, "A", false)).toEqual({ ok: false, reason: "Aufgabe ist schon abgehakt" });
  });

  it("andere Fehler haben Vorrang vor dem Zustand: fehlende Aufgabe bleibt „nicht gefunden“", () => {
    expect(fail(toggleTask("- [x] Andere\n", 0, "A", false))).toMatch(/nicht gefunden/);
  });
});

describe("taskRows", () => {
  const inhalt = [
    "# Glasscockpit Tasks", // 0
    "", // 1
    "## Heute", // 2
    "", // 3
    "- [ ] Eins", // 4
    "\t- [x] Unter eins", // 5
    "\t\t- [ ] Ganz unten", // 6
    "- Nur ein Punkt", // 7
    "\t- [ ] Unter Punkt", // 8
    "", // 9
    "## Später", // 10
    "- [X] Zwei [[Ziel|Alias]]", // 11
  ].join("\n");
  const items = [
    { line: 4, task: " ", parent: -4 },
    { line: 5, task: "x", parent: 4 },
    { line: 6, task: " ", parent: 5 },
    { line: 7, task: undefined, parent: -4 },
    { line: 8, task: " ", parent: 7 },
    { line: 11, task: "X", parent: -11 },
  ];
  const headings = [
    { line: 10, level: 2, heading: "Später" },
    { line: 0, level: 1, heading: "Glasscockpit Tasks" },
    { line: 2, level: 2, heading: "Heute" },
  ];

  it("Dateireihenfolge, Überschriften und Aufgaben gemischt", () => {
    const r = taskRows(inhalt, items, headings);
    expect(r.rows.map((x) => `${x.kind}:${x.line}`)).toEqual([
      "heading:0", "heading:2", "task:4", "task:5", "task:6", "task:8", "heading:10", "task:11",
    ]);
    expect(r.rows[0]).toEqual({ kind: "heading", line: 0, level: 1, text: "Glasscockpit Tasks" });
  });

  it("depth über die parent-Kette, auch unter Nicht-Aufgabe", () => {
    const tasks = taskRows(inhalt, items, headings).rows.filter((x) => x.kind === "task");
    expect(tasks.map((x) => (x.kind === "task" ? x.depth : -1))).toEqual([0, 1, 2, 1, 0]);
  });

  it("text ist roh (Wikilink bleibt), done aus dem Zeichen, Zählung", () => {
    const r = taskRows(inhalt, items, headings);
    const last = r.rows[r.rows.length - 1];
    expect(last).toEqual({ kind: "task", line: 11, text: "Zwei [[Ziel|Alias]]", done: true, depth: 0 });
    expect(r.total).toBe(5);
    expect(r.done).toBe(2);
  });

  it("veralteter Cache-Eintrag (Zeile ist keine Checkbox) wird übersprungen und nicht gezählt", () => {
    const r = taskRows("# T\nnichts\n- [ ] A\n", [{ line: 1, task: " ", parent: -1 }, { line: 2, task: " ", parent: -2 }, { line: 9, task: " ", parent: -9 }], []);
    expect(r.rows).toEqual([{ kind: "task", line: 2, text: "A", done: false, depth: 0 }]);
    expect(r.total).toBe(1);
  });

  it("leer: keine Zeilen", () => {
    expect(taskRows("", [], [])).toEqual({ rows: [], done: 0, total: 0 });
  });

  it("CRLF: text ohne \\r", () => {
    const r = taskRows("- [ ] A\r\n", [{ line: 0, task: " ", parent: -1 }], []);
    expect(r.rows[0]).toMatchObject({ text: "A" });
  });

  it("kaputte parent-Schleife hängt nicht", () => {
    const r = taskRows("- [ ] A\n- [ ] B\n", [{ line: 0, task: " ", parent: 1 }, { line: 1, task: " ", parent: 0 }], []);
    expect(r.total).toBe(2);
  });
});

describe("displayText", () => {
  it("Alias statt Ziel", () => expect(displayText("Siehe [[Ziel|Alias]] jetzt")).toBe("Siehe Alias jetzt"));
  it("Ziel ohne Alias", () => expect(displayText("Siehe [[Ziel]]")).toBe("Siehe Ziel"));
  it("mehrere Links", () => expect(displayText("[[A]] und [[B|b]]")).toBe("A und b"));
  it("sonst unverändert", () => expect(displayText("Kein [Link](x) hier")).toBe("Kein [Link](x) hier"));
});

describe("textParts", () => {
  it("leerer Text ergibt keine Teile", () => expect(textParts("")).toEqual([]));
  it("ohne Link ein einziger Textteil, andere Markdown-Formate bleiben roh", () => {
    expect(textParts("Kein [Link](x) und **fett** hier")).toEqual([{ kind: "text", text: "Kein [Link](x) und **fett** hier" }]);
  });
  it("[[ziel]]: Ziel und Anzeige sind gleich", () => {
    expect(textParts("Siehe [[Ziel]] jetzt")).toEqual([
      { kind: "text", text: "Siehe " },
      { kind: "link", ziel: "Ziel", anzeige: "Ziel" },
      { kind: "text", text: " jetzt" },
    ]);
  });
  it("[[ziel|alias]]: Ziel bleibt, Anzeige ist der Alias", () => {
    expect(textParts("[[Ziel|Alias]]")).toEqual([{ kind: "link", ziel: "Ziel", anzeige: "Alias" }]);
  });
  it("[[ziel#Abschnitt]]: der Abschnitt bleibt im Ziel (und in der Anzeige)", () => {
    expect(textParts("[[Ziel#Abschnitt]]")).toEqual([{ kind: "link", ziel: "Ziel#Abschnitt", anzeige: "Ziel#Abschnitt" }]);
  });
  it("[[ziel#Abschnitt|alias]]: Abschnitt im Ziel, Alias als Anzeige", () => {
    expect(textParts("[[Ziel#Abschnitt|Alias]]")).toEqual([{ kind: "link", ziel: "Ziel#Abschnitt", anzeige: "Alias" }]);
  });
  it("mehrere Links in Reihenfolge, direkt aufeinanderfolgende ohne leeren Textteil dazwischen", () => {
    expect(textParts("[[A]][[B|b]] und [[C]]")).toEqual([
      { kind: "link", ziel: "A", anzeige: "A" },
      { kind: "link", ziel: "B", anzeige: "b" },
      { kind: "text", text: " und " },
      { kind: "link", ziel: "C", anzeige: "C" },
    ]);
  });
  it("unvollständige Klammern bleiben Text", () => {
    expect(textParts("a [[A] b ]] c")).toEqual([{ kind: "text", text: "a [[A] b ]] c" }]);
    expect(textParts("a [[A]")).toEqual([{ kind: "text", text: "a [[A]" }]);
  });
  it("leeres Ziel ([[|alias]]) ist kein Link, sondern Text mit der Anzeige; angrenzender Text wird zusammengefasst", () => {
    expect(textParts("[[|Alias]]")).toEqual([{ kind: "text", text: "Alias" }]);
    expect(textParts("Siehe [[|Alias]] jetzt")).toEqual([{ kind: "text", text: "Siehe Alias jetzt" }]);
    expect(textParts("[[A]] und [[|b]] und [[C]]")).toEqual([
      { kind: "link", ziel: "A", anzeige: "A" },
      { kind: "text", text: " und b und " },
      { kind: "link", ziel: "C", anzeige: "C" },
    ]);
  });
  it("leerer Alias ([[ziel|]]) zeigt das Ziel wie [[ziel]], sonst entstünde ein Link ohne Text (Abend 30)", () => {
    expect(textParts("[[Ziel|]]")).toEqual([{ kind: "link", ziel: "Ziel", anzeige: "Ziel" }]);
    expect(textParts("Siehe [[Ziel#Abschnitt|]] jetzt")).toEqual([
      { kind: "text", text: "Siehe " },
      { kind: "link", ziel: "Ziel#Abschnitt", anzeige: "Ziel#Abschnitt" },
      { kind: "text", text: " jetzt" },
    ]);
    expect(displayText("[[Index|]]")).toBe("Index");
  });
  it("leeres Ziel ohne Anzeige ([[]], [[|]]) bleibt wie geschrieben im Text stehen", () => {
    expect(textParts("a [[]] b")).toEqual([{ kind: "text", text: "a [[]] b" }]);
    expect(textParts("[[|]]")).toEqual([{ kind: "text", text: "[[|]]" }]);
  });
  it("displayText ist die Verkettung der Anzeigen", () => {
    for (const t of ["", "ohne", "[[A]]", "[[A|a]] x [[B#S]]", "[[A]][[B|b]]", "[[|a]] x [[]]"]) {
      expect(displayText(t)).toBe(textParts(t).map((p) => (p.kind === "text" ? p.text : p.anzeige)).join(""));
    }
    expect(displayText("Siehe [[Ziel#Abschnitt|Alias]]")).toBe("Siehe Alias");
  });
});

describe("parentFolders und Vorlage", () => {
  it("Elternordner von außen nach innen", () => {
    expect(parentFolders("a/b/c.md")).toEqual(["a", "a/b"]);
    expect(parentFolders("T.md")).toEqual([]);
    expect(parentFolders("Mein Ordner/T.md")).toEqual(["Mein Ordner"]);
  });
  it("Vorlage enthält offene Aufgaben unter Überschriften", () => {
    expect(TASKS_TEMPLATE).toBe("# Glasscockpit Tasks\n\n## Heute\n\n- [ ] Erste Aufgabe\n\n## Später\n\n- [ ] Noch eine\n");
    expect(toggleTask(TASKS_TEMPLATE, 4, "Erste Aufgabe", false).ok).toBe(true);
  });
});
