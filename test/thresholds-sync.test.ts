import { describe, expect, it } from "vitest";
import { ThresholdsSync } from "../src/core/thresholds-sync";
import { thresholdsFileText } from "../src/core/gauges";

const rig = (failOnce = false) => {
  const writes: string[] = [];
  const logs: string[] = [];
  let fail = failOnce;
  const sync = new ThresholdsSync({
    write: async (text) => { if (fail) { fail = false; throw new Error("Platte voll"); } writes.push(text); },
    log: (m) => logs.push(m),
  });
  return { sync, writes, logs };
};
const s = (warn: number, handoff: number) => ({ contextWarn: warn, contextHandoff: handoff });

describe("ThresholdsSync (Festlegung 1: Schwellen eine Quelle)", () => {
  it("schreibt beim ersten Aufruf den Inhalt aus thresholdsFileText", async () => {
    const { sync, writes } = rig();
    await sync.sync(s(150000, 175000));
    expect(writes).toEqual([thresholdsFileText(s(150000, 175000))]);
  });
  it("schreibt nur bei geänderten Schwellen, nicht bei jeder Einstellung", async () => {
    const { sync, writes } = rig();
    await sync.sync(s(150000, 175000));
    await sync.sync({ ...s(150000, 175000), fontSize: 12 } as never);
    expect(writes.length).toBe(1);
    await sync.sync(s(100000, 120000));
    expect(writes).toEqual([thresholdsFileText(s(150000, 175000)), thresholdsFileText(s(100000, 120000))]);
  });
  it("Schreibfehler: nur ins Log, kein Wurf, der nächste Aufruf versucht es noch einmal", async () => {
    const { sync, writes, logs } = rig(true);
    await expect(sync.sync(s(1000, 2000))).resolves.toBeUndefined();
    expect(writes).toEqual([]);
    expect(logs.join()).toMatch(/Platte voll/);
    await sync.sync(s(1000, 2000));
    expect(writes).toEqual([thresholdsFileText(s(1000, 2000))]);
  });
});
