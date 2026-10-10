import { describe, expect, it } from "vitest";
import { Observable } from "../src/core/observable";

describe("Observable", () => {
  it("hält den Startwert und liefert den letzten gesetzten", () => {
    const o = new Observable<number>(1);
    expect(o.get()).toBe(1);
    o.set(2);
    expect(o.get()).toBe(2);
  });

  it("meldet jedem Abonnenten den neuen Wert, auch bei gleichem Wert", () => {
    const o = new Observable<number>(0);
    const a: number[] = [];
    const b: number[] = [];
    o.subscribe((v) => a.push(v));
    o.subscribe((v) => b.push(v));
    o.set(1);
    o.set(1);
    expect(a).toEqual([1, 1]);
    expect(b).toEqual([1, 1]);
  });

  it("Abmelden wirkt, auch mitten in der Meldung; Abonnentenzahl zählt", () => {
    const o = new Observable<number>(0);
    const seen: string[] = [];
    const off1 = o.subscribe(() => { seen.push("1"); off1(); });
    o.subscribe(() => seen.push("2"));
    expect(o.subscriberCount()).toBe(2);
    o.set(1);
    o.set(2);
    expect(seen).toEqual(["1", "2", "2"]);
    expect(o.subscriberCount()).toBe(1);
  });

  it("ein werfender Abonnent hindert die anderen nicht und wird gemeldet", () => {
    const errors: unknown[] = [];
    const o = new Observable<number>(0, (e) => errors.push(e));
    const seen: number[] = [];
    o.subscribe(() => { throw new Error("kaputt"); });
    o.subscribe((v) => seen.push(v));
    o.set(5);
    expect(seen).toEqual([5]);
    expect(errors).toHaveLength(1);
  });
});
