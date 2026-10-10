import { describe, expect, it } from "vitest";
import { lampOf, radarRows, type RadarInput } from "../src/core/session-radar";
import { RADAR_NAME_MAX } from "../src/core/constants";

const base = (o: Partial<RadarInput> = {}): RadarInput => ({
  id: "a", name: "A", cwd: "/x", running: true, failed: false, signal: null, signalAt: null, seen: false, ...o,
});

describe("lampOf", () => {
  it("beendet ist dead, auch bei offener Frage", () => {
    expect(lampOf(base({ running: false }))).toBe("dead");
    expect(lampOf(base({ running: false, signal: "question", seen: false }))).toBe("dead");
    expect(lampOf(base({ running: false, failed: true }))).toBe("dead");
  });
  it("Frage ungesehen: question; gesehen: idle", () => {
    expect(lampOf(base({ signal: "question", seen: false }))).toBe("question");
    expect(lampOf(base({ signal: "question", seen: true }))).toBe("idle");
  });
  it("fertig ungesehen: unseen; gesehen: idle", () => {
    expect(lampOf(base({ signal: "done", seen: false }))).toBe("unseen");
    expect(lampOf(base({ signal: "done", seen: true }))).toBe("idle");
  });
  it("busy: busy, unabhängig von seen", () => {
    expect(lampOf(base({ signal: "busy", seen: false }))).toBe("busy");
    expect(lampOf(base({ signal: "busy", seen: true }))).toBe("busy");
  });
  it("ohne Signal: idle", () => {
    expect(lampOf(base())).toBe("idle");
  });
});

describe("radarRows", () => {
  it("Reihenfolge: question, unseen, busy, idle, dead", () => {
    const inputs = [
      base({ id: "dead", name: "e", running: false }),
      base({ id: "idle", name: "d" }),
      base({ id: "busy", name: "c", signal: "busy" }),
      base({ id: "unseen", name: "b", signal: "done" }),
      base({ id: "question", name: "a", signal: "question" }),
    ];
    expect(radarRows(inputs).rows.map((r) => r.id)).toEqual(["question", "unseen", "busy", "idle", "dead"]);
    expect(radarRows(inputs).rows.map((r) => r.lamp)).toEqual(["question", "unseen", "busy", "idle", "dead"]);
  });
  it("innerhalb der Lampe: jüngstes signalAt zuerst, null zuletzt, dann Name", () => {
    const inputs = [
      base({ id: "n", name: "Zeta", signal: "busy", signalAt: null }),
      base({ id: "alt", name: "Alt", signal: "busy", signalAt: 100 }),
      base({ id: "neu", name: "Neu", signal: "busy", signalAt: 200 }),
      base({ id: "m", name: "Mu", signal: "busy", signalAt: null }),
    ];
    expect(radarRows(inputs).rows.map((r) => r.id)).toEqual(["neu", "alt", "m", "n"]);
  });
  it("gleiches signalAt: nach Name", () => {
    const inputs = [base({ id: "2", name: "b", signal: "busy", signalAt: 5 }), base({ id: "1", name: "a", signal: "busy", signalAt: 5 })];
    expect(radarRows(inputs).rows.map((r) => r.id)).toEqual(["1", "2"]);
  });
  it("höchstens fünf Zeilen, Rest als more", () => {
    const inputs = Array.from({ length: 8 }, (_, i) => base({ id: String(i), name: `s${i}` }));
    const r = radarRows(inputs);
    expect(r.rows).toHaveLength(5);
    expect(r.more).toBe(3);
  });
  it("genau fünf: more 0; sechs: more 1", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => base({ id: String(i), name: `s${i}` }));
    expect(radarRows(mk(5)).more).toBe(0);
    expect(radarRows(mk(6)).more).toBe(1);
    expect(radarRows(mk(6)).rows).toHaveLength(5);
  });
  it("max wird übernommen und nie negativ", () => {
    const inputs = [base({ id: "1", name: "a" }), base({ id: "2", name: "b" })];
    expect(radarRows(inputs, 1)).toMatchObject({ more: 1 });
    expect(radarRows(inputs, 0)).toEqual({ rows: [], more: 2 });
    expect(radarRows(inputs, -3)).toEqual({ rows: [], more: 2 });
  });
  it("leer: keine Zeilen", () => {
    expect(radarRows([])).toEqual({ rows: [], more: 0 });
  });
  it("Name: genau an der Grenze unverändert, länger gekürzt mit … auf Grenzlänge", () => {
    const exact = "x".repeat(RADAR_NAME_MAX);
    const long = "y".repeat(RADAR_NAME_MAX + 1);
    expect(radarRows([base({ name: exact })]).rows[0].name).toBe(exact);
    const cut = radarRows([base({ name: long })]).rows[0].name;
    expect(cut).toBe("y".repeat(RADAR_NAME_MAX - 1) + "…");
    expect(Array.from(cut)).toHaveLength(RADAR_NAME_MAX);
  });
  it("Kürzen trennt kein Surrogatpaar", () => {
    const name = "😀".repeat(RADAR_NAME_MAX + 2);
    const cut = radarRows([base({ name })]).rows[0].name;
    expect(cut).toBe("😀".repeat(RADAR_NAME_MAX - 1) + "…");
  });
  it("Zeile trägt id, Name und Lampe, sonst nichts", () => {
    expect(radarRows([base({ id: "q", name: "Q", signal: "question" })]).rows[0]).toEqual({ id: "q", name: "Q", lamp: "question" });
  });
  it("verändert die Eingabe nicht", () => {
    const inputs = [base({ id: "2", name: "b" }), base({ id: "1", name: "a", signal: "question" })];
    radarRows(inputs);
    expect(inputs.map((i) => i.id)).toEqual(["2", "1"]);
  });
});
