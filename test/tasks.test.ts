import { describe, expect, it } from "vitest";
import { TASKS_TEMPLATE, displayText, parentFolders, taskRows, toggleTask } from "../src/core/tasks";

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
    const r = ok(toggleTask("# T\n- [ ] A\n- [ ] B\n", 1, "A"));
    expect(r.content).toBe("# T\n- [x] A\n- [ ] B\n");
    expect(r.done).toBe(true);
  });

  it("erledigt wird offen", () => {
    const r = ok(toggleTask("- [x] A\n", 0, "A"));
    expect(r.content).toBe("- [ ] A\n");
    expect(r.done).toBe(false);
  });

  it("Groß-X wird zu offen, andere X-Zeilen bleiben unberührt", () => {
    const inhalt = "- [X] A\n- [x] B\n- [ ] C\n";
    const r = ok(toggleTask(inhalt, 0, "A"));
    expect(r.content).toBe("- [ ] A\n- [x] B\n- [ ] C\n");
    expect(r.done).toBe(false);
  });

  it("jedes andere Zeichen gilt als erledigt und wird offen", () => {
    expect(ok(toggleTask("- [/] A\n", 0, "A")).content).toBe("- [ ] A\n");
  });

  it("CRLF bleibt je Zeile erhalten", () => {
    const r = ok(toggleTask("# T\r\n- [ ] A\r\n- [ ] B\r\n", 1, "A"));
    expect(r.content).toBe("# T\r\n- [x] A\r\n- [ ] B\r\n");
  });

  it("gemischte Zeilenenden bleiben je Zeile erhalten", () => {
    expect(ok(toggleTask("a\n- [ ] A\r\nb\r\n", 1, "A")).content).toBe("a\n- [x] A\r\nb\r\n");
  });

  it("Tab- und Leerzeichen-Einrückung bleibt", () => {
    expect(ok(toggleTask("- [ ] A\n\t- [ ] B\n", 1, "B")).content).toBe("- [ ] A\n\t- [x] B\n");
    expect(ok(toggleTask("- [ ] A\n    - [ ] B\n", 1, "B")).content).toBe("- [ ] A\n    - [x] B\n");
  });

  it.each(["- ", "* ", "+ ", "1. ", "12) "])("Bullet %j", (bullet) => {
    const r = ok(toggleTask(`${bullet}[ ] A\n`, 0, "A"));
    expect(r.content).toBe(`${bullet}[x] A\n`);
  });

  it("Dateiende ohne Umbruch bleibt ohne Umbruch", () => {
    expect(ok(toggleTask("- [ ] A\n- [ ] B", 1, "B")).content).toBe("- [ ] A\n- [x] B");
  });

  it("Umlaut, Wikilink und eingerückter Unterpunkt bleiben bytegenau", () => {
    const inhalt = "# Übersicht\r\n\r\n- [ ] Größe prüfen mit [[Notiz|Alias]] äöü ß\r\n\t- [ ] Unter­punkt\r\n- [x] Fertig\r\n";
    const r = ok(toggleTask(inhalt, 2, "Größe prüfen mit [[Notiz|Alias]] äöü ß"));
    expect(r.content).toBe(inhalt.replace("- [ ] Größe", "- [x] Größe"));
    expect(Buffer.from(r.content.replace("[x] Größe", "[ ] Größe")).equals(Buffer.from(inhalt))).toBe(true);
  });

  it("Text mit eckigen Klammern im Text wird nicht verwechselt", () => {
    expect(ok(toggleTask("- [ ] A [x] B\n", 0, "A [x] B")).content).toBe("- [x] A [x] B\n");
  });
});

describe("toggleTask: verschobene Zeilen", () => {
  const basis = ["- [ ] A", "- [ ] B", "- [ ] C"];

  it("2 Zeilen oberhalb eingefügt: findet die Aufgabe im Fenster", () => {
    const inhalt = ["x", "y", ...basis].join("\n");
    const r = ok(toggleTask(inhalt, 1, "B")); // Cache meinte Zeile 1, B steht jetzt in Zeile 3
    expect(r.content).toBe(["x", "y", "- [ ] A", "- [x] B", "- [ ] C"].join("\n"));
  });

  it("2 Zeilen entfernt (Aufgabe liegt weiter oben)", () => {
    const r = ok(toggleTask("- [ ] A\n- [ ] B\n", 3, "A"));
    expect(r.content).toBe("- [x] A\n- [ ] B\n");
  });

  it("Verschiebung um 5 geht, um 6 scheitert", () => {
    const fuell = (n: number) => Array.from({ length: n }, () => "text");
    expect(ok(toggleTask([...fuell(5), "- [ ] Z"].join("\n"), 0, "Z")).done).toBe(true);
    expect(fail(toggleTask([...fuell(6), "- [ ] Z"].join("\n"), 0, "Z"))).toMatch(/nicht gefunden/);
  });

  it("zwei gleiche Texte im Fenster: mehrdeutig, nichts geschaltet", () => {
    const inhalt = "a\n- [ ] Gleich\nb\n- [ ] Gleich\n";
    const reason = fail(toggleTask(inhalt, 2, "Gleich"));
    expect(reason).toMatch(/mehrdeutig/);
    expect(reason).not.toMatch(/nicht gefunden/);
  });

  it("trifft die Zeile genau, gewinnt sie auch bei gleichem Text daneben", () => {
    const inhalt = "- [ ] Gleich\n- [ ] Gleich\n";
    expect(ok(toggleTask(inhalt, 1, "Gleich")).content).toBe("- [ ] Gleich\n- [x] Gleich\n");
  });

  it("anderer Text an der Zeile: es wird nichts an der falschen Zeile geschaltet", () => {
    expect(fail(toggleTask("- [ ] Andere\n", 0, "Erwartet"))).toMatch(/nicht gefunden/);
  });

  it("Zeile hinter dem Dateiende", () => {
    expect(fail(toggleTask("- [ ] A\n", 99, "A"))).toMatch(/nicht gefunden/);
  });

  it("negative Zeile", () => {
    expect(fail(toggleTask("- [ ] A\n", -1, "Z"))).toMatch(/nicht gefunden/);
  });

  it("Zeile ohne Checkbox", () => {
    expect(fail(toggleTask("# Titel\n- Punkt\n", 1, "Punkt"))).toMatch(/nicht gefunden/);
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

describe("parentFolders und Vorlage", () => {
  it("Elternordner von außen nach innen", () => {
    expect(parentFolders("a/b/c.md")).toEqual(["a", "a/b"]);
    expect(parentFolders("T.md")).toEqual([]);
    expect(parentFolders("Mein Ordner/T.md")).toEqual(["Mein Ordner"]);
  });
  it("Vorlage enthält offene Aufgaben unter Überschriften", () => {
    expect(TASKS_TEMPLATE).toBe("# Glasscockpit Tasks\n\n## Heute\n\n- [ ] Erste Aufgabe\n\n## Später\n\n- [ ] Noch eine\n");
    expect(toggleTask(TASKS_TEMPLATE, 4, "Erste Aufgabe").ok).toBe(true);
  });
});
