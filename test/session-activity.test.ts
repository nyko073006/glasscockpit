import { describe, expect, it } from "vitest";
import { SessionActivity, radarInputs, type RadarInput } from "../src/core/session-activity";

describe("SessionActivity", () => {
  it("unbekannte Sitzung: undefined", () => expect(new SessionActivity().get("a")).toBeUndefined());
  it("record merkt Signal und Zeit; done und question sind noch nicht angesehen", () => {
    const a = new SessionActivity();
    a.record("a", "done", 100);
    expect(a.get("a")).toEqual({ signal: "done", signalAt: 100, seen: false });
    a.record("b", "question", 200);
    expect(a.get("b")).toEqual({ signal: "question", signalAt: 200, seen: false });
  });
  it("busy setzt seen=true", () => {
    const a = new SessionActivity();
    a.record("a", "done", 1);
    a.record("a", "busy", 2);
    expect(a.get("a")).toEqual({ signal: "busy", signalAt: 2, seen: true });
  });
  it("ein späteres Signal überschreibt, auch done nach question", () => {
    const a = new SessionActivity();
    a.record("a", "question", 1);
    a.record("a", "done", 2);
    expect(a.get("a")).toEqual({ signal: "done", signalAt: 2, seen: false });
    a.record("a", "question", 3);
    expect(a.get("a")).toEqual({ signal: "question", signalAt: 3, seen: false });
  });
  it("markSeen setzt seen, ohne Signal oder Zeit zu ändern; unbekannte Sitzung: nichts", () => {
    const a = new SessionActivity();
    a.markSeen("x");
    expect(a.get("x")).toBeUndefined();
    a.record("a", "done", 5);
    a.markSeen("a");
    expect(a.get("a")).toEqual({ signal: "done", signalAt: 5, seen: true });
  });
  it("ein neues done nach markSeen ist wieder ungesehen", () => {
    const a = new SessionActivity();
    a.record("a", "done", 1);
    a.markSeen("a");
    a.record("a", "done", 2);
    expect(a.get("a")?.seen).toBe(false);
  });
  it("forget vergisst", () => {
    const a = new SessionActivity();
    a.record("a", "busy", 1);
    a.forget("a");
    expect(a.get("a")).toBeUndefined();
  });
  it("get gibt eine Kopie", () => {
    const a = new SessionActivity();
    a.record("a", "done", 1);
    a.get("a")!.seen = true;
    expect(a.get("a")?.seen).toBe(false);
  });
});

describe("radarInputs", () => {
  const act = new SessionActivity();
  act.record("a", "question", 50);
  const rows = radarInputs(
    [
      { id: "a", name: "A", cwd: "/a", running: true, exitCode: null },
      { id: "b", name: "B", cwd: "/b", running: true, exitCode: null },
      { id: "c", name: "C", cwd: "/c", running: false, exitCode: 0 },
      { id: "d", name: "D", cwd: "/d", running: false, exitCode: 1 },
      { id: "e", name: "E", cwd: "/e", running: false, exitCode: null },
    ],
    act,
  );
  const by = (id: string): RadarInput => rows.find((r) => r.id === id)!;
  it("Signal, Zeit und seen aus der Aktivität", () =>
    expect(by("a")).toEqual({ id: "a", name: "A", cwd: "/a", running: true, failed: false, signal: "question", signalAt: 50, seen: false }));
  it("ohne Signal: null, null, seen false", () =>
    expect(by("b")).toEqual({ id: "b", name: "B", cwd: "/b", running: true, failed: false, signal: null, signalAt: null, seen: false }));
  it("beendet mit Exit 0: nicht failed; Exit != 0: failed; Exit unbekannt: nicht failed", () => {
    expect([by("c").running, by("c").failed]).toEqual([false, false]);
    expect([by("d").running, by("d").failed]).toEqual([false, true]);
    expect(by("e").failed).toBe(false);
  });
  it("ein laufender Prozess ist nie failed, auch mit altem Exit-Code", () => {
    const r = radarInputs([{ id: "x", name: "X", cwd: "/", running: true, exitCode: 2 }], new SessionActivity());
    expect(r[0].failed).toBe(false);
  });
  it("Reihenfolge der Eingabe bleibt", () => expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]));
});
