import { describe, expect, it } from "vitest";
import { KILL_ESCALATION_MS } from "../src/core/constants";
import { type KillSignal, escalateKill } from "../src/core/kill-escalation";
import { FakeTimers } from "./helpers/fakes";

function setup(alive = true) {
  const timers = new FakeTimers();
  const sent: KillSignal[] = [];
  const state = { alive };
  let settled = 0;
  const handle = escalateKill(
    { send: (s) => void sent.push(s), isAlive: () => state.alive, set: (cb, ms) => timers.set(cb, ms), clear: (h) => timers.clear(h) },
    KILL_ESCALATION_MS,
    () => settled++,
  );
  return { timers, sent, state, handle, settled: () => settled };
}

describe("escalateKill", () => {
  it("Frist ist 2000 ms", () => {
    expect(KILL_ESCALATION_MS).toBe(2000);
  });

  it("sendet sofort SIGHUP und noch kein SIGKILL", () => {
    const { sent, timers } = setup();
    expect(sent).toEqual(["SIGHUP"]);
    timers.advance(KILL_ESCALATION_MS - 1);
    expect(sent).toEqual(["SIGHUP"]);
  });

  it("lebt der Prozess nach der Frist noch: SIGKILL, genau einmal", () => {
    const { sent, timers, settled } = setup();
    timers.advance(KILL_ESCALATION_MS);
    expect(sent).toEqual(["SIGHUP", "SIGKILL"]);
    timers.advance(10 * KILL_ESCALATION_MS);
    expect(sent).toEqual(["SIGHUP", "SIGKILL"]);
    expect(timers.pendingCount).toBe(0);
    expect(settled()).toBe(1);
  });

  it("stirbt der Prozess vorher: kein SIGKILL, Timer aufgeräumt", () => {
    const { sent, timers, state, handle, settled } = setup();
    timers.advance(500);
    state.alive = false;
    handle.processExited();
    expect(timers.pendingCount).toBe(0);
    timers.advance(10 * KILL_ESCALATION_MS);
    expect(sent).toEqual(["SIGHUP"]);
    expect(settled()).toBe(1);
  });

  it("Meldung vom Exit blieb aus, isAlive sagt aber tot, wenn die Frist abläuft: kein SIGKILL (PID-Wiederverwendung)", () => {
    const { sent, timers, state, settled } = setup();
    state.alive = false;
    timers.advance(KILL_ESCALATION_MS);
    expect(sent).toEqual(["SIGHUP"]);
    expect(settled()).toBe(1);
  });

  it("ist der Prozess nach dem Signal schon weg, entsteht gar kein Timer", () => {
    const timers = new FakeTimers();
    const sent: KillSignal[] = [];
    let alive = true;
    escalateKill({ send: (s) => { sent.push(s); alive = false; }, isAlive: () => alive, set: (cb, ms) => timers.set(cb, ms), clear: (h) => timers.clear(h) });
    expect(timers.pendingCount).toBe(0);
    expect(sent).toEqual(["SIGHUP"]);
  });

  it("ist der Prozess schon beendet, wird nichts gesendet", () => {
    const { sent, timers } = setup(false);
    expect(sent).toEqual([]);
    expect(timers.pendingCount).toBe(0);
  });

  it("processExited nach dem SIGKILL oder doppelt tut nichts", () => {
    const { sent, timers, handle, settled } = setup();
    timers.advance(KILL_ESCALATION_MS);
    handle.processExited();
    handle.processExited();
    expect(sent).toEqual(["SIGHUP", "SIGKILL"]);
    expect(settled()).toBe(1);
  });
});
