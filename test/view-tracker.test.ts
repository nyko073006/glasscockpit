import { describe, expect, it } from "vitest";
import { KILL_GRACE_MS } from "../src/core/constants";
import { ViewTracker } from "../src/core/view-tracker";
import { FakeTimers } from "./helpers/fakes";

function setup(graceMs?: number) {
  const timers = new FakeTimers();
  const beendet: string[] = [];
  const tracker = new ViewTracker((id) => beendet.push(id), timers, graceMs);
  return { tracker, timers, beendet };
}

describe("ViewTracker", () => {
  it("Schonfrist ist KILL_GRACE_MS = 3000 und Standard", () => {
    expect(KILL_GRACE_MS).toBe(3000);
    const { tracker, timers, beendet } = setup();
    tracker.open("a");
    tracker.close("a");
    timers.advance(2999);
    expect(beendet).toEqual([]);
    timers.advance(1);
    expect(beendet).toEqual(["a"]);
  });

  it("zählt Views je Sitzung", () => {
    const { tracker } = setup();
    tracker.open("a");
    tracker.open("a");
    tracker.open("b");
    expect(tracker.count("a")).toBe(2);
    expect(tracker.count("b")).toBe(1);
    expect(tracker.count("c")).toBe(0);
  });

  it("solange eine View offen ist, kein Timer", () => {
    const { tracker, timers, beendet } = setup();
    tracker.open("a");
    tracker.open("a");
    tracker.close("a");
    expect(timers.pendingCount).toBe(0);
    timers.advance(10_000);
    expect(beendet).toEqual([]);
  });

  it("Wiederöffnen in der Schonfrist verwirft den Timer (Verschieben)", () => {
    const { tracker, timers, beendet } = setup();
    tracker.open("a");
    tracker.close("a");
    timers.advance(1500);
    tracker.open("a");
    expect(timers.pendingCount).toBe(0);
    timers.advance(10_000);
    expect(beendet).toEqual([]);
    expect(tracker.count("a")).toBe(1);
  });

  it("nach dem Wiederöffnen startet das nächste Schließen eine neue volle Frist", () => {
    const { tracker, timers, beendet } = setup();
    tracker.open("a");
    tracker.close("a");
    timers.advance(2000);
    tracker.open("a");
    tracker.close("a");
    timers.advance(2999);
    expect(beendet).toEqual([]);
    timers.advance(1);
    expect(beendet).toEqual(["a"]);
  });

  it("Ablauf trifft nur die geschlossene Sitzung", () => {
    const { tracker, timers, beendet } = setup();
    tracker.open("a");
    tracker.open("b");
    tracker.close("a");
    timers.advance(3000);
    expect(beendet).toEqual(["a"]);
    expect(tracker.count("b")).toBe(1);
  });

  it("nach dem Ablauf ist die Sitzung vergessen, ein neues open zählt ab 1", () => {
    const { tracker, timers } = setup();
    tracker.open("a");
    tracker.close("a");
    timers.advance(3000);
    expect(tracker.count("a")).toBe(0);
    tracker.open("a");
    expect(tracker.count("a")).toBe(1);
  });

  it("close ohne open wird ignoriert, kein Timer, kein Minus", () => {
    const { tracker, timers, beendet } = setup();
    tracker.close("a");
    expect(tracker.count("a")).toBe(0);
    expect(timers.pendingCount).toBe(0);
    timers.advance(10_000);
    expect(beendet).toEqual([]);
  });

  it("eigene Schonfrist aus dem Konstruktor", () => {
    const { tracker, timers, beendet } = setup(500);
    tracker.open("a");
    tracker.close("a");
    timers.advance(500);
    expect(beendet).toEqual(["a"]);
  });

  it("dispose verwirft laufende Timer, danach tut der Tracker nichts mehr", () => {
    const { tracker, timers, beendet } = setup();
    tracker.open("a");
    tracker.close("a");
    tracker.dispose();
    expect(timers.pendingCount).toBe(0);
    tracker.open("b");
    tracker.close("b");
    timers.advance(10_000);
    expect(beendet).toEqual([]);
  });
});
