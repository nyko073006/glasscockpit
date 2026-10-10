import { describe, expect, it } from "vitest";
import { createDebounce } from "../src/core/debounce";
import type { TimerApi } from "../src/core/view-tracker";

class FakeTimer implements TimerApi {
  private next = 1;
  private pending = new Map<number, () => void>();
  set(cb: () => void, _ms: number): unknown {
    const id = this.next++;
    this.pending.set(id, cb);
    return id;
  }
  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  fire(): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const cb of all) cb();
  }
}

describe("createDebounce", () => {
  it("viele Aufrufe ergeben einen Aufruf nach Ablauf", () => {
    const t = new FakeTimer();
    let n = 0;
    const d = createDebounce(() => n++, 400, t);
    d(); d(); d(); d();
    expect(n).toBe(0);
    t.fire();
    expect(n).toBe(1);
  });
  it("Aufruf nach Ablauf löst einen zweiten aus", () => {
    const t = new FakeTimer();
    let n = 0;
    const d = createDebounce(() => n++, 400, t);
    d(); t.fire();
    d(); t.fire();
    expect(n).toBe(2);
  });
  it("cancel verhindert den Aufruf", () => {
    const t = new FakeTimer();
    let n = 0;
    const d = createDebounce(() => n++, 400, t);
    d();
    d.cancel();
    t.fire();
    expect(n).toBe(0);
  });
  it("gibt die Wartezeit an den Timer", () => {
    const waits: number[] = [];
    const d = createDebounce(() => {}, 400, { set: (_cb, ms) => { waits.push(ms); return 1; }, clear: () => {} });
    d();
    expect(waits).toEqual([400]);
  });
});
