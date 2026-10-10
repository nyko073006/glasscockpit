import { describe, expect, it } from "vitest";
import { RepoScan, type RepoScanDeps } from "../src/core/repo-scan";

const SAUBER = "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n";
const DIRTY = SAUBER + "1 .M N... 100644 100644 100644 a b file.txt\n";

function rig(over: Partial<RepoScanDeps> = {}) {
  const calls: string[] = [];
  let release: (() => void)[] = [];
  const deps: RepoScanDeps = {
    list: async () => [{ name: "a", dir: "/r/a" }, { name: "b", dir: "/r/b" }],
    status: async (dir) => { calls.push(dir); return dir === "/r/a" ? SAUBER : DIRTY; },
    log: () => undefined,
    ...over,
  };
  return { scan: new RepoScan(deps), calls, release: () => release.forEach((f) => f()), push: (f: () => void) => release.push(f), deps };
}

describe("RepoScan", () => {
  it("vor dem ersten Lauf null (noch nie gelaufen), danach je Repo ein Status", async () => {
    const { scan } = rig();
    expect(scan.snapshot()).toBeNull();
    await scan.run();
    expect(scan.snapshot()).toEqual([
      { name: "a", status: { dirty: false, ahead: 0, noUpstream: false } },
      { name: "b", status: { dirty: true, ahead: 0, noUpstream: false } },
    ]);
  });

  it("ein Fehler bei einem Repo ergibt status null, die anderen bleiben, nichts wirft", async () => {
    const { scan } = rig({ status: async (dir) => { if (dir === "/r/a") throw new Error("Zeitlimit"); return SAUBER; } });
    await expect(scan.run()).resolves.toBeUndefined();
    expect(scan.snapshot()?.map((r) => [r.name, r.status === null])).toEqual([["a", true], ["b", false]]);
  });

  it("scheitert schon die Liste: Fehler nur ins Log, Stand bleibt, kein Wurf", async () => {
    const logs: string[] = [];
    const { scan } = rig({ list: async () => { throw new Error("kein Ordner"); }, log: (m) => logs.push(m) });
    await expect(scan.run()).resolves.toBeUndefined();
    expect(scan.snapshot()).toBeNull();
    expect(logs.join()).toMatch(/kein Ordner/);
  });

  it("läuft nicht parallel zu sich selbst: ein zweiter Aufruf mitten im Lauf startet nichts Neues", async () => {
    let gate!: () => void;
    const hold = new Promise<void>((r) => { gate = r; });
    const { scan, calls } = rig({ status: async (dir) => { calls_push(dir); await hold; return SAUBER; } });
    const calls_push = (d: string) => calls.push(d);
    const first = scan.run();
    const second = scan.run();
    gate();
    await Promise.all([first, second]);
    expect(calls).toEqual(["/r/a", "/r/b"]);
    await scan.run();
    expect(calls.length).toBe(4);
  });

  it("meldet Abonnenten nach jedem Lauf, auch wenn die Liste scheitert; abmelden wirkt", async () => {
    const { scan } = rig();
    let n = 0;
    const off = scan.subscribe(() => { n++; });
    await scan.run();
    expect(n).toBe(1);
    off();
    await scan.run();
    expect(n).toBe(1);
  });

  it("Abonnent, der wirft, stört den Lauf nicht", async () => {
    const { scan } = rig();
    scan.subscribe(() => { throw new Error("kaputt"); });
    await expect(scan.run()).resolves.toBeUndefined();
    expect(scan.snapshot()).not.toBeNull();
  });

  it("Ordner ohne Repos: leere Liste, nicht null", async () => {
    const { scan } = rig({ list: async () => [] });
    await scan.run();
    expect(scan.snapshot()).toEqual([]);
  });
});
