import { describe, expect, it } from "vitest";
import {
  REMINDERS_LIST_SCRIPT,
  REMINDERS_SET_SCRIPT,
  type Reminder,
  dueReminders,
  parseListNames,
  parseReminders,
  reminderErrorText,
} from "../src/core/reminders";

const FS = String.fromCharCode(31);
const RS = String.fromCharCode(30);
const satz = (...felder: string[]): string => felder.join(FS);
const r = (id: string, name: string, list: string, due: string): Reminder => ({ id, name, list, due });

describe("parseReminders", () => {
  it("liest Sätze mit Fälligkeit, füllt Monat und Tag zweistellig auf und verwirft Sätze ohne Datum", () => {
    const out = [
      satz("id-1", "Steuer", "Arbeit", "2026", "11", "11"),
      satz("id-2", "Ohne Datum", "Privat", "", "", ""),
      satz("id-3", "Frühling", "Privat", "2026", "3", "5"),
    ].join(RS);
    expect(parseReminders(out)).toEqual([
      { id: "id-1", name: "Steuer", list: "Arbeit", due: "2026-11-11" },
      { id: "id-3", name: "Frühling", list: "Privat", due: "2026-03-05" },
    ]);
  });

  it("macht aus Leerraumfolgen im Namen ein Leerzeichen, verwirft falsche Feldzahl und liefert bei leerer Ausgabe nichts", () => {
    const out = [satz("id-1", "Zeile1\nZeile2\tTab", "Arbeit", "2026", "11", "11"), satz("id-2", "Kurz", "Arbeit", "2026", "11")].join(RS);
    expect(parseReminders(out)).toEqual([{ id: "id-1", name: "Zeile1 Zeile2 Tab", list: "Arbeit", due: "2026-11-11" }]);
    expect(parseReminders("")).toEqual([]);
  });

  it("verwirft Sätze ohne id oder mit ungültigem Datum", () => {
    const out = [
      satz("", "Ohne id", "Arbeit", "2026", "11", "11"),
      satz("id-2", "Monat 13", "Arbeit", "2026", "13", "1"),
      satz("id-3", "Kein Datum", "Arbeit", "x", "1", "1"),
      satz("id-4", "31. Februar", "Arbeit", "2026", "2", "31"),
    ].join(RS);
    expect(parseReminders(out)).toEqual([]);
  });
});

describe("parseListNames", () => {
  it("trennt am Komma, trimmt und lässt Leeres weg", () => {
    expect(parseListNames(" Arbeit , ,Privat,")).toEqual(["Arbeit", "Privat"]);
    expect(parseListNames("")).toEqual([]);
  });
});

describe("dueReminders", () => {
  const heute = "2026-11-11";
  const alle = [
    r("m", "Morgen", "Arbeit", "2026-11-12"),
    r("h2", "Zebra", "Privat", "2026-11-11"),
    r("g", "Gestern", "Arbeit", "2026-11-10"),
    r("h1", "Apfel", "Arbeit", "2026-11-11"),
  ];

  it("lässt Künftiges weg, setzt since bei Überfälligem und sortiert nach Fälligkeit, dann Name", () => {
    expect(dueReminders(alle, heute, { lists: [], overdue: true })).toEqual([
      { ...alle[2], since: "10.11." },
      { ...alle[3], since: null },
      { ...alle[1], since: null },
    ]);
  });

  it("zeigt ohne Überfällige nur heute", () => {
    expect(dueReminders(alle, heute, { lists: [], overdue: false }).map((d) => d.id)).toEqual(["h1", "h2"]);
  });

  it("filtert nach Listen ohne Groß/Klein und getrimmt", () => {
    expect(dueReminders(alle, heute, { lists: [" arbeit "], overdue: true }).map((d) => d.id)).toEqual(["g", "h1"]);
  });
});

describe("reminderErrorText", () => {
  it("erkennt fehlenden Zugriff an -1743", () => {
    expect(reminderErrorText("execution error: Not authorized to send Apple events to Reminders. (-1743)")).toBe(
      "Erinnerungen: Zugriff fehlt. Systemeinstellungen → Datenschutz & Sicherheit → Automation → Obsidian → Erinnerungen einschalten.",
    );
  });

  it("erkennt -1743 nur in Klammern, nicht als Teil einer id", () => {
    expect(reminderErrorText("execution error: Erinnerung x-1743-y nicht gefunden (-1728)")).toBe(
      "Erinnerungen: execution error: Erinnerung x-1743-y nicht gefunden (-1728)",
    );
    expect(reminderErrorText("Not authorized (-1743)")).toContain("Zugriff fehlt");
  });

  it("erkennt das Zeitlimit", () => {
    expect(reminderErrorText("Command failed: osascript killed SIGTERM")).toBe("Erinnerungen: keine Antwort nach 20 s");
    expect(reminderErrorText("spawnSync ETIMEDOUT")).toBe("Erinnerungen: keine Antwort nach 20 s");
  });

  it("nimmt sonst die erste Zeile, höchstens 160 Zeichen", () => {
    expect(reminderErrorText("erste Zeile\nzweite Zeile")).toBe("Erinnerungen: erste Zeile");
    expect(reminderErrorText("x".repeat(300))).toBe(`Erinnerungen: ${"x".repeat(160)}`);
  });
});

describe("Skripte", () => {
  // Dass keine Werte ins Skript montiert werden, sichern die Gleichheitsprüfungen von Skript und argv in reminders-host.test.ts.
  it("das Leseskript fragt die App Erinnerungen", () => {
    expect(REMINDERS_LIST_SCRIPT).toContain("tell application \"Reminders\"");
  });

  it("das Setzskript liest id und Zielzustand aus argv und greift per reminder id zu", () => {
    expect(REMINDERS_SET_SCRIPT).toMatch(/^on run argv\n/);
    expect(REMINDERS_SET_SCRIPT).toContain("set completed of reminder id (item 1 of argv) to ((item 2 of argv) is \"true\")");
    expect(REMINDERS_SET_SCRIPT).not.toContain("whose");
  });
});
