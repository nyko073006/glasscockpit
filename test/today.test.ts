import { describe, expect, it } from "vitest";
import type { BriefingPoint } from "../src/core/focus";
import type { DueReminder } from "../src/core/reminders";
import type { TaskRow } from "../src/core/tasks";
import { type CockpitSettings, DEFAULT_SETTINGS } from "../src/core/settings";
import { briefingLoadKey, insertTask, todayBriefingPath, todayView, type TodayInput } from "../src/core/today";

describe("insertTask", () => {
  it("hinter den letzten Listenpunkt samt Unterpunkten, Überschrift ohne Groß/Klein", () => {
    expect(insertTask("# T\n\n## Heute\n\n- [ ] A\n  - [ ] A1\n\n## Später\n\n- [ ] B\n", "heute", "Neu")).toBe(
      "# T\n\n## Heute\n\n- [ ] A\n  - [ ] A1\n- [ ] Neu\n\n## Später\n\n- [ ] B\n",
    );
    expect(insertTask("## Heute\n- [ ] A\n\n  - [ ] A1\n\n## Später\n", "Heute", "Neu")).toBe("## Heute\n- [ ] A\n\n  - [ ] A1\n- [ ] Neu\n\n## Später\n");
  });
  it("eingerückter Listenpunkt am Abschnittsanfang ist ein Listenpunkt", () => {
    expect(insertTask("## Heute\n  - [ ] A\n## X\n", "Heute", "Neu")).toBe("## Heute\n  - [ ] A\n- [ ] Neu\n## X\n");
  });
  it("eingerückte Fortsetzungszeile und Text ohne Leerzeile davor gehören zum Listenpunkt", () => {
    expect(insertTask("## Heute\n- [ ] A\n  weiter\nText\n", "Heute", "Neu")).toBe("## Heute\n- [ ] A\n  weiter\nText\n- [ ] Neu\n");
    expect(insertTask("## Heute\n- [ ] A\nText\n", "Heute", "Neu")).toBe("## Heute\n- [ ] A\nText\n- [ ] Neu\n");
  });
  it("eingerückter Absatz nach Leerzeile gehört zum letzten Punkt", () => {
    expect(insertTask("## Heute\n- [ ] A\n\n  Notiz zu A\n\n## Später\n", "Heute", "Neu")).toBe("## Heute\n- [ ] A\n\n  Notiz zu A\n- [ ] Neu\n\n## Später\n");
    expect(insertTask("## Heute\n- [ ] A\n  Absatz 1\n\n  Absatz 2\n## Später\n", "Heute", "Neu")).toBe(
      "## Heute\n- [ ] A\n  Absatz 1\n\n  Absatz 2\n- [ ] Neu\n## Später\n",
    );
    expect(insertTask("## Heute\n- [ ] A\n  - [ ] U\n\n    > Zitat unter U\n## Später\n", "Heute", "Neu")).toBe(
      "## Heute\n- [ ] A\n  - [ ] U\n\n    > Zitat unter U\n- [ ] Neu\n## Später\n",
    );
  });
  it("nicht eingerückter Absatz nach Leerzeile schließt den Punkt", () => {
    expect(insertTask("## Heute\n- [ ] A\n\nAbsatz\n", "Heute", "Neu")).toBe("## Heute\n- [ ] A\n- [ ] Neu\n\nAbsatz\n");
  });
  it("eingerückter Zaun im Punkt zählt bis zur Schlusszeile, nie geschlossen bis zum Ende", () => {
    expect(insertTask("## Heute\n- [ ] A\n  ```\n  code\n  ```\n## Später\n", "Heute", "Neu")).toBe(
      "## Heute\n- [ ] A\n  ```\n  code\n  ```\n- [ ] Neu\n## Später\n",
    );
    expect(insertTask("## Heute\n- [ ] A\n\n  ~~~\n\n  code\n  ~~~\n\nText\n", "Heute", "Neu")).toBe(
      "## Heute\n- [ ] A\n\n  ~~~\n\n  code\n  ~~~\n- [ ] Neu\n\nText\n",
    );
    expect(insertTask("## Heute\n- [ ] A\n  ```\n  code\n", "Heute", "Neu")).toBe("## Heute\n- [ ] A\n  ```\n  code\n- [ ] Neu\n");
  });
  it("nicht eingerückter Zaun schließt den Punkt", () => {
    expect(insertTask("## Heute\n- [ ] A\n```\n  - [ ] X\n```\n", "Heute", "Neu")).toBe("## Heute\n- [ ] A\n- [ ] Neu\n```\n  - [ ] X\n```\n");
  });
  it("Trennlinie ist kein Listenpunkt", () => {
    expect(insertTask("## Heute\n- [ ] A\n\n* * *\nNotiz\n", "Heute", "Neu")).toBe("## Heute\n- [ ] A\n- [ ] Neu\n\n* * *\nNotiz\n");
    expect(insertTask("## Heute\n- [ ] A\n\n- - -\nNotiz\n## Später\n", "Heute", "Neu")).toBe("## Heute\n- [ ] A\n- [ ] Neu\n\n- - -\nNotiz\n## Später\n");
  });
  it("Zielabschnitt am Dateiende mit Schlussumbruch: keine Leerzeile dazu", () => {
    expect(insertTask("## Heute\n- [ ] A\n", "Heute", "Neu")).toBe("## Heute\n- [ ] A\n- [ ] Neu\n");
    expect(insertTask("## Heute\n", "Heute", "Neu")).toBe("## Heute\n- [ ] Neu\n");
  });
  it("heading mit Leerraum außen wird getrimmt", () => {
    expect(insertTask("## Heute\n- [ ] A\n## X\n", "  HEUTE  ", "Neu")).toBe("## Heute\n- [ ] A\n- [ ] Neu\n## X\n");
  });
  it("BOM vor der Überschrift in Zeile 0 bleibt, die Überschrift wird gefunden", () => {
    expect(insertTask("\uFEFF## Heute\n- [ ] A\n## X\n", "Heute", "Neu")).toBe("\uFEFF## Heute\n- [ ] A\n- [ ] Neu\n## X\n");
  });
  it("Überschrift ohne Punkte: nach genau einer Leerzeile unter die Überschrift", () => {
    expect(insertTask("## Heute\n\n## Später\n", "Heute", "Neu")).toBe("## Heute\n\n- [ ] Neu\n## Später\n");
  });
  it("Überschrift ohne Punkte und ohne Leerzeile: direkt darunter", () => {
    expect(insertTask("## Heute\n## Später\n", "Heute", "Neu")).toBe("## Heute\n- [ ] Neu\n## Später\n");
  });
  it("Überschrift fehlt: ans Dateiende, fehlender Umbruch wird vorher gesetzt", () => {
    expect(insertTask("- [ ] A", "Heute", "Neu")).toBe("- [ ] A\n- [ ] Neu\n");
    expect(insertTask("- [ ] A\n", "Heute", "Neu")).toBe("- [ ] A\n- [ ] Neu\n");
  });
  it("leere Überschrift: ans Dateiende, auch wenn eine leere Überschrift passen könnte", () => {
    expect(insertTask("## \n- [ ] A\n## Später\n- [ ] B\n", "", "Neu")).toBe("## \n- [ ] A\n## Später\n- [ ] B\n- [ ] Neu\n");
    expect(insertTask("## \n- [ ] A\n## Später\n- [ ] B\n", "  ", "Neu")).toBe("## \n- [ ] A\n## Später\n- [ ] B\n- [ ] Neu\n");
  });
  it("letzte Überschrift ohne Umbruch am Ende", () => {
    expect(insertTask("## Heute\n- [ ] A", "Heute", "Neu")).toBe("## Heute\n- [ ] A\n- [ ] Neu\n");
    expect(insertTask("## Heute", "Heute", "Neu")).toBe("## Heute\n- [ ] Neu\n");
  });
  it("Überschrift im Codeblock oder in der Frontmatter zählt nicht, erste echte Fundstelle", () => {
    const md = "---\n## Heute\n---\n```\n## Heute\n```\n## Heute\n- [ ] A\n## Heute\n- [ ] B\n";
    expect(insertTask(md, "Heute", "Neu")).toBe("---\n## Heute\n---\n```\n## Heute\n```\n## Heute\n- [ ] A\n- [ ] Neu\n## Heute\n- [ ] B\n");
  });
  it("Listenpunkt im Codeblock des Abschnitts zählt nicht, Überschrift im Codeblock beendet ihn nicht", () => {
    const md = "## Heute\n- [ ] A\n```\n- [ ] X\n## Später\n```\nText\n## Später\n";
    expect(insertTask(md, "Heute", "Neu")).toBe("## Heute\n- [ ] A\n- [ ] Neu\n```\n- [ ] X\n## Später\n```\nText\n## Später\n");
  });
  it("Abschnitt endet an der nächsten Überschrift jeder Ebene", () => {
    expect(insertTask("## Heute\n- [ ] A\n### Tiefer\n- [ ] B\n", "Heute", "Neu")).toBe("## Heute\n- [ ] A\n- [ ] Neu\n### Tiefer\n- [ ] B\n");
  });
  it("CRLF-Datei bleibt CRLF, auch die neue Zeile", () => {
    expect(insertTask("## Heute\r\n\r\n- [ ] A\r\n\r\n## Später\r\n", "Heute", "Neu")).toBe(
      "## Heute\r\n\r\n- [ ] A\r\n- [ ] Neu\r\n\r\n## Später\r\n",
    );
    expect(insertTask("- [ ] A\r\n- [ ] B", "Heute", "Neu")).toBe("- [ ] A\r\n- [ ] B\r\n- [ ] Neu\r\n");
  });
  it("Text: nur Leerraum ergibt null, Umbrüche werden Leerzeichen, getrimmt", () => {
    expect(insertTask("- [ ] A\n", "Heute", "  \n ")).toBeNull();
    expect(insertTask("- [ ] A\n", "Heute", " Zwei\nZeilen ")).toBe("- [ ] A\n- [ ] Zwei Zeilen\n");
  });
  it("leere Datei bekommt genau die neue Zeile", () => {
    expect(insertTask("", "Heute", "Neu")).toBe("- [ ] Neu\n");
  });
});

const point = (key: string, fileDone = false): BriefingPoint => ({ key, text: key.toUpperCase(), fileDone, underHeading: true });
const reminder = (id: string, since: string | null): DueReminder => ({ id, name: `Erinnerung ${id}`, list: "Arbeit", due: "2026-11-10", since });
const input = (over: Partial<TodayInput>): TodayInput => ({
  briefing: [],
  briefingDone: [],
  reminders: [],
  remindersDone: [],
  tasks: [],
  ...over,
});

describe("todayView", () => {
  it("drei Quellen: offen in fester Reihenfolge, Erledigtes getrennt, Zählung", () => {
    const tasks: TaskRow[] = [
      { kind: "heading", line: 0, level: 2, text: "Heute" },
      { kind: "task", line: 1, text: "Offen", done: false, depth: 0 },
      { kind: "heading", line: 2, level: 2, text: "Später" },
      { kind: "task", line: 3, text: "Fertig", done: true, depth: 0 },
    ];
    const view = todayView(
      input({
        briefing: [point("a"), point("b")],
        briefingDone: ["b"],
        reminders: [reminder("r1", "09.11.")],
        remindersDone: [
          { id: "fremd", name: "Erledigte Erinnerung" },
          { id: "r1", name: "Erinnerung r1" },
        ],
        tasks,
      }),
    );
    expect(view.open).toEqual([
      { kind: "source", text: "Briefing" },
      { kind: "briefing", key: "a", text: "A", done: false, locked: false },
      { kind: "source", text: "Erinnerungen" },
      { kind: "reminder", id: "r1", text: "Erinnerung r1", done: false, since: "09.11." },
      { kind: "heading", text: "Heute", level: 2 },
      { kind: "task", line: 1, text: "Offen", done: false, depth: 0 },
    ]);
    expect(view.done).toEqual([
      { kind: "briefing", key: "b", text: "B", done: true, locked: false },
      { kind: "reminder", id: "fremd", text: "Erledigte Erinnerung", done: true, since: null },
      { kind: "task", line: 3, text: "Fertig", done: true, depth: 0 },
    ]);
    expect(view.doneCount).toBe(3);
    expect(view.total).toBe(6);
    expect(view.openTexts).toEqual(["A", "Erinnerung r1", "Offen"]);
    expect(view.tasksMissing).toBe(false);
  });
  it("alles leer, Datei fehlt: nichts offen, keine Quellzeilen", () => {
    const view = todayView(input({ tasks: null }));
    expect(view).toEqual({ open: [], done: [], doneCount: 0, total: 0, openTexts: [], tasksMissing: true });
  });
  it("Haken zu einem Schlüssel, den das Briefing nicht nennt, zählt nicht", () => {
    const view = todayView(input({ briefing: [point("a")], briefingDone: ["weg"] }));
    expect(view.done).toEqual([]);
    expect(view.total).toBe(1);
    expect(view.open.map((r) => r.kind)).toEqual(["source", "briefing"]);
  });
  it("in der Datei erledigter Punkt steht unter Erledigt und ist gesperrt; nur Erledigtes: keine Quellzeile", () => {
    const view = todayView(input({ briefing: [point("a", true)] }));
    expect(view.done).toEqual([{ kind: "briefing", key: "a", text: "A", done: true, locked: true }]);
    expect(view.open).toEqual([]);
    expect(view.total).toBe(1);
  });
  it("Punkt in der Datei erledigt und zugleich abgehakt: gesperrt, einmal gezählt", () => {
    const view = todayView(input({ briefing: [point("a", true)], briefingDone: ["a"] }));
    expect(view.done).toEqual([{ kind: "briefing", key: "a", text: "A", done: true, locked: true }]);
    expect(view.doneCount).toBe(1);
    expect(view.total).toBe(1);
  });
  it("Überschrift nur bei offener Aufgabe bis zur nächsten Überschrift jeder Ebene", () => {
    const tasks: TaskRow[] = [
      { kind: "heading", line: 0, level: 2, text: "Oben" },
      { kind: "heading", line: 1, level: 3, text: "Unten" },
      { kind: "task", line: 2, text: "X", done: false, depth: 1 },
      { kind: "heading", line: 3, level: 2, text: "Leer" },
    ];
    const view = todayView(input({ tasks }));
    expect(view.open).toEqual([
      { kind: "heading", text: "Unten", level: 3 },
      { kind: "task", line: 2, text: "X", done: false, depth: 1 },
    ]);
    expect(view.openTexts).toEqual(["X"]);
  });
});

describe("insertTask Byte-Regel", () => {
  /** Kleiner Zufallsgenerator (mulberry32) mit festem Startwert, damit jeder Lauf dieselben Dokumente prüft. */
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const blocks = [
    "# T", "## Heute", "### Heute", "## Später", "- [ ] A", "- [x] B", "* C", "1. D", "  - [ ] U", "    - [ ] UU", "  Absatz",
    "    > Zitat", "Text  ", "   ", "", "", "```", "  ```", "~~~", "code", "* * *", "- - -", "---", "Text", "\tEingerückt",
  ];
  it("ohne die neue Zeile bleibt die Datei gleich, höchstens um einen Schlussumbruch ergänzt", () => {
    const next = rng(44);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
    const marker = "Neue Zeile 44";
    for (let n = 0; n < 2500; n++) {
      const count = Math.floor(next() * 14);
      const eol = next() < 0.5 ? "\n" : "\r\n";
      const parts = Array.from({ length: count }, () => pick(blocks));
      const content = (next() < 0.1 ? "\uFEFF" : "") + parts.join(eol) + (count > 0 && next() < 0.6 ? eol : "");
      const heading = pick(["Heute", "heute ", "Später", "Nirgends", ""]);
      const out = insertTask(content, heading, marker) as string;
      const lines = out.split("\n");
      const hits = lines.flatMap((l, j) => (l === `- [ ] ${marker}` || l === `- [ ] ${marker}\r` ? [j] : []));
      expect(hits, JSON.stringify(content)).toHaveLength(1);
      const rest = lines.filter((_, j) => j !== hits[0]).join("\n");
      const fileEol = content.split("\n")[0].endsWith("\r") && content.includes("\n") ? "\r\n" : "\n";
      // Den Schlussumbruch darf es nur ergänzen, wo er fehlt.
      const allowed = content === "" || content.endsWith("\n") ? [content] : [content, content + fileEol];
      expect(allowed, JSON.stringify({ content, heading })).toContain(rest);
    }
  });
});

describe("todayBriefingPath", () => {
  it("Schalter an und Ordner gesetzt: <Ordner>/<heute>.md", () => {
    expect(todayBriefingPath({ todayBriefing: true, briefingsDir: "Briefings" }, "2026-11-11")).toBe("Briefings/2026-11-11.md");
  });
  it("Schalter aus oder Ordner leer: null", () => {
    expect(todayBriefingPath({ todayBriefing: false, briefingsDir: "Briefings" }, "2026-11-11")).toBeNull();
    expect(todayBriefingPath({ todayBriefing: true, briefingsDir: "" }, "2026-11-11")).toBeNull();
    expect(todayBriefingPath({ todayBriefing: true, briefingsDir: "  " }, "2026-11-11")).toBeNull();
  });
});

describe("briefingLoadKey", () => {
  const base = { ...DEFAULT_SETTINGS, briefingsDir: "Briefings", todayBriefing: true, focusHeading: "Heute dran" };
  it("ändert sich mit briefingsDir, todayBriefing und focusHeading", () => {
    const k = briefingLoadKey(base);
    expect(briefingLoadKey({ ...base, briefingsDir: "Andere" })).not.toBe(k);
    expect(briefingLoadKey({ ...base, todayBriefing: false })).not.toBe(k);
    expect(briefingLoadKey({ ...base, focusHeading: "Fokus" })).not.toBe(k);
  });
  it("eine fremde Einstellung ändert ihn nicht", () => {
    const other: CockpitSettings = { ...base, tasksFile: "Andere.md", remindersEnabled: true };
    expect(briefingLoadKey(other)).toBe(briefingLoadKey(base));
  });
});
