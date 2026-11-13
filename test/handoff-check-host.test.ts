import { describe, expect, it, vi } from "vitest";
import type { GitClean } from "../src/core/handoff-check";
import { gitClean, readHandoffCheck, type HandoffCheckDeps } from "../src/host/handoff-check";

const basis = (over: Partial<HandoffCheckDeps> = {}): HandoffCheckDeps => ({
  current: { claudeId: "neu", block: "Handoff: /h/a.md", startedAtMs: 1000 },
  claudeId: "neu", cwd: "/p", prefix: "Handoff:", home: "/home/x", vaultBase: "/v", dailyDir: "Daily",
  now: new Date(2026, 10, 8, 12, 0), env: {},
  mtime: async () => 2000,
  git: async (): Promise<GitClean> => "clean",
  ...over,
});

describe("readHandoffCheck", () => {
  it("a) alles da und neuer als der Start: grün", async () => {
    expect((await readHandoffCheck(basis())).tone).toBe("green");
  });
  it("b) Handoff-Datei fehlt: rot mit Pfad", async () => {
    const r = await readHandoffCheck(basis({ mtime: async (p) => (p === "/h/a.md" ? null : 2000) }));
    expect(r.tone).toBe("red");
    expect(r.gaps).toContain("Handoff-Datei fehlt: /h/a.md");
  });
  it("c) Block einer anderen Claude-ID: grau", async () => {
    const r = await readHandoffCheck(basis({ current: { claudeId: "alt", block: "Handoff: /h/a.md", startedAtMs: 1000 } }));
    expect(r.tone).toBe("gray");
  });
  it("h) erster Kandidat fehlt, zweiter existiert: grün, Zeile nennt dessen Dateinamen", async () => {
    const r = await readHandoffCheck(basis({
      current: { claudeId: "neu", block: "Handoff: MeinVault/Q/zweite.md", startedAtMs: 1000 },
      vaultBase: "/v/MeinVault",
      mtime: async (p) => (p === "/v/MeinVault/Q/zweite.md" ? 2000 : p.endsWith("zweite.md") ? null : 2000),
    }));
    expect(r.tone).toBe("green");
    expect(r.lines[0]).toBe("✓ Handoff geschrieben: zweite.md");
  });
  it("i) kein Kandidat existiert: Datei fehlt mit erstem Kandidaten", async () => {
    const r = await readHandoffCheck(basis({
      current: { claudeId: "neu", block: "Handoff: Q/a.md", startedAtMs: 1000 },
      mtime: async (p) => (p.endsWith("a.md") ? null : 2000),
    }));
    expect(r.gaps).toContain("Handoff-Datei fehlt: /v/Q/a.md");
  });
  it("j) fremde Claude-ID: weder git noch mtime werden gerufen", async () => {
    const git = vi.fn(async (): Promise<GitClean> => "clean");
    const mtime = vi.fn(async () => 2000);
    const r = await readHandoffCheck(basis({ current: { claudeId: "alt", block: "Handoff: /h/a.md", startedAtMs: 1000 }, git, mtime }));
    expect(r.tone).toBe("gray");
    expect(git).not.toHaveBeenCalled();
    expect(mtime).not.toHaveBeenCalled();
  });
  it("e) Git-Fake wirft: rot mit Git-Lücke, kein Reject", async () => {
    const r = await readHandoffCheck(basis({ git: async () => { throw new Error("boom"); } }));
    expect(r.tone).toBe("red");
    expect(r.gaps).toContain("Git-Status nicht lesbar");
  });
  it("e2) Git-Fake wirft synchron: rot mit Git-Lücke, kein Reject", async () => {
    const r = await readHandoffCheck(basis({ git: (() => { throw new Error("sync"); }) as never }));
    expect(r.gaps).toContain("Git-Status nicht lesbar");
  });
  it("f) mtime wirft für den Handoff: wie fehlend", async () => {
    const r = await readHandoffCheck(basis({ mtime: async (p) => { if (p === "/h/a.md") throw new Error("x"); return 2000; } }));
    expect(r.gaps).toContain("Handoff-Datei fehlt: /h/a.md");
  });
  it("g) kurz nach Mitternacht lokal: Daily-Pfad des neuen Tags", async () => {
    const gefragt: string[] = [];
    await readHandoffCheck(basis({ now: new Date(2026, 10, 9, 0, 30), mtime: async (p) => { gefragt.push(p); return 2000; } }));
    expect(gefragt.some((p) => p.endsWith("2026-11-09.md"))).toBe(true);
    expect(gefragt.some((p) => p.endsWith("2026-11-08.md"))).toBe(false);
  });
  it("Daily-Ordner leer: Lücke, kein Stat auf die Daily", async () => {
    const gefragt: string[] = [];
    const r = await readHandoffCheck(basis({ dailyDir: "  ", mtime: async (p) => { gefragt.push(p); return 2000; } }));
    expect(r.gaps).toContain("Daily-Ordner nicht eingerichtet");
    expect(gefragt).toEqual(["/h/a.md"]);
  });
});

describe("gitClean", () => {
  it("d) kein Repo → none, anderer Fehler → unknown, Porcelain mit Änderung → dirty, LC_ALL=C", async () => {
    expect(await gitClean("/p", {}, async () => { throw new Error("fatal: not a git repository (or any of the parent directories): .git"); })).toBe("none");
    expect(await gitClean("/p", {}, async () => { throw new Error("spawn git ENOENT"); })).toBe("unknown");
    expect(await gitClean("/p", {}, async () => "# branch.oid x\n1 .M N... 100644 100644 100644 a b f.txt\n")).toBe("dirty");
    expect(await gitClean("/p", {}, async () => "# branch.oid x\n")).toBe("clean");
    const run = vi.fn(async () => "");
    await gitClean("/p", { A: "1" }, run);
    expect(run).toHaveBeenCalledWith("/p", expect.objectContaining({ A: "1", LC_ALL: "C" }));
  });
});
