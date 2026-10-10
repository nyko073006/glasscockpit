import { describe, expect, it } from "vitest";
import { DayScan, type DayScanDeps } from "../src/core/day-scan";
import { DAY_LOG_SEP } from "../src/core/day-stats";

const NOW = new Date(2026, 9, 6, 15, 0, 0);
const out = (hash: string, add: number) => `${DAY_LOG_SEP}${hash}\n\n${add}\t0\tsrc/a.ts\n`;
const rig = (over: Partial<DayScanDeps> = {}) => {
  const logs: string[] = [];
  const sinces: Date[] = [];
  const deps: DayScanDeps = {
    list: async () => [{ name: "a", dir: "/r/a" }, { name: "b", dir: "/r/b" }],
    identity: async (dir) => ({ commonDir: `${dir}/.git`, isMain: true }),
    dayLog: async (dir, since) => { sinces.push(since); return dir === "/r/a" ? out("h1", 5) + out("h2", 1) : out("h3", 10); },
    now: () => NOW,
    log: (m) => logs.push(m),
    ...over,
  };
  return { scan: new DayScan(deps), logs, sinces };
};

describe("DayScan", () => {
  it("vor dem ersten Lauf null, danach Summen und je Repo", async () => {
    const { scan } = rig();
    expect(scan.snapshot()).toBeNull();
    await scan.run();
    expect(scan.snapshot()).toEqual({
      loc: 16, commits: 3,
      repos: [{ name: "a", loc: 6, commits: 2 }, { name: "b", loc: 10, commits: 1 }],
    });
  });

  it("Hauptrepo plus Worktree: nur einmal abgefragt und gezählt, Name des Hauptrepos", async () => {
    const asked: string[] = [];
    const { scan } = rig({
      list: async () => [{ name: "app-etappe1", dir: "/r/app-etappe1" }, { name: "app", dir: "/r/app" }, { name: "b", dir: "/r/b" }],
      identity: async (dir) => ({ commonDir: dir.startsWith("/r/app") ? "/r/app/.git" : `${dir}/.git`, isMain: dir === "/r/app" || dir === "/r/b" }),
      dayLog: async (dir) => { asked.push(dir); return out("h1", 5); },
    });
    await scan.run();
    expect(asked.sort()).toEqual(["/r/app", "/r/b"]);
    expect(scan.snapshot()).toEqual({ loc: 10, commits: 2, repos: [{ name: "app", loc: 5, commits: 1 }, { name: "b", loc: 5, commits: 1 }] });
  });

  it("Auskunft zum Git-Verzeichnis scheitert: Repo steht für sich, wird geloggt", async () => {
    const { scan, logs } = rig({ identity: async (dir) => { if (dir === "/r/a") throw new Error("kaputt"); return { commonDir: `${dir}/.git`, isMain: true }; } });
    await scan.run();
    expect(scan.snapshot()?.repos.map((x) => x.name)).toEqual(["a", "b"]);
    expect(logs.join("\n")).toContain("kaputt");
  });

  it("fragt ab der lokalen Mitternacht des injizierten Zeitpunkts", async () => {
    const { scan, sinces } = rig();
    await scan.run();
    expect(sinces).toHaveLength(2);
    expect(sinces[0].getTime()).toBe(new Date(2026, 9, 6, 0, 0, 0, 0).getTime());
  });

  it("ein Repo scheitert: zählt 0, wird geloggt, die anderen bleiben", async () => {
    const { scan, logs } = rig({ dayLog: async (dir) => { if (dir === "/r/a") throw new Error("Zeitlimit"); return out("h3", 10); } });
    await scan.run();
    expect(scan.snapshot()).toEqual({ loc: 10, commits: 1, repos: [{ name: "a", loc: 0, commits: 0 }, { name: "b", loc: 10, commits: 1 }] });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("a");
    expect(logs[0]).toContain("Zeitlimit");
  });

  it("Liste scheitert: alter Stand bleibt, Log, kein Wurf", async () => {
    let fail = false;
    const { scan, logs } = rig({ list: async () => { if (fail) throw new Error("weg"); return [{ name: "a", dir: "/r/a" }]; } });
    await scan.run();
    const before = scan.snapshot();
    fail = true;
    await expect(scan.run()).resolves.toBeUndefined();
    expect(scan.snapshot()).toBe(before);
    expect(logs.join("\n")).toContain("weg");
  });

  it("höchstens vier gleichzeitig", async () => {
    let now = 0, peak = 0;
    const repos = Array.from({ length: 11 }, (_, i) => ({ name: `r${i}`, dir: `/r/${i}` }));
    const { scan } = rig({
      list: async () => repos,
      dayLog: async () => { now++; peak = Math.max(peak, now); await new Promise((r) => setTimeout(r, 5)); now--; return ""; },
    });
    await scan.run();
    expect(peak).toBe(4);
  });

  it("läuft nie parallel zu sich selbst und meldet den Abonnenten", async () => {
    let calls = 0;
    const { scan } = rig({ dayLog: async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return ""; } });
    let told = 0;
    scan.subscribe(() => told++);
    await Promise.all([scan.run(), scan.run()]);
    expect(calls).toBe(2); // zwei Repos, ein Lauf
    expect(told).toBe(1);
  });

  it("keine Repos: Snapshot mit Nullen (nicht null)", async () => {
    const { scan } = rig({ list: async () => [] });
    await scan.run();
    expect(scan.snapshot()).toEqual({ loc: 0, commits: 0, repos: [] });
  });
});
