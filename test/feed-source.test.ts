import { describe, expect, it } from "vitest";
import { CockpitFeedSource, type FeedSourceDeps } from "../src/host/feed-source";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import type { SessionFile } from "../src/core/session-file";

const ID = "90ef2efe-1234-4abc-8def-0123456789ab";
const file: SessionFile = { sessionId: ID, contextTokens: 160_000, usedPercentage: 80, model: "Opus", writtenAt: 1 };

function rig(over: Partial<FeedSourceDeps> = {}) {
  const logs: string[] = [];
  const reads = { files: 0, vault: 0, focus: 0, radar: 0 };
  const live = { sessions: [] as ReturnType<FeedSourceDeps["radarInputs"]> };
  const deps: FeedSourceDeps = {
    settings: () => ({ ...DEFAULT_SETTINGS, radars: [{ name: "Eins", stateFile: "~/projekt/state.json" }, { name: "Zwei", stateFile: "~/depot/state.json" }], nextEffort: "high", telegramOnDone: true, alertSound: false, alertBanner: true }),
    now: () => 1_000,
    radarInputs: () => live.sessions,
    active: () => ({ id: "c1", name: "claude 1", claudeId: ID }),
    ownClaudeIds: () => [ID],
    tokens: () => ({ tokens: 42, asOf: 7 }),
    day: () => ({ loc: 3, commits: 1, repos: [{ name: "r", loc: 3, commits: 1 }] }),
    repos: () => [{ name: "r", status: null }],
    readSessionFiles: async () => { reads.files++; return new Map([[ID, file]]); },
    readVault: async () => { reads.vault++; return { inbox: ["01 Inbox/a.md"], indexGeneratedAt: 5, dailyToday: true }; },
    readFocus: async () => { reads.focus++; return ["Eins"]; },
    readHandoffs: async () => [],
    readRadar: async (path) => { reads.radar++; return path.includes("projekt") ? "green" : "red"; },
    log: (m) => logs.push(m),
    ...over,
  };
  return { source: new CockpitFeedSource(deps), logs, reads, live };
}

describe("CockpitFeedSource", () => {
  it("vor dem ersten Lesen: nicht Gelesenes null oder leer, Lebendes (Sitzungen, Tokens, Einstellungen) schon da", () => {
    const { source, live } = rig();
    live.sessions = [{ id: "c1", name: "claude 1", cwd: "/x", running: true, failed: false, signal: null, signalAt: null, seen: false }];
    const feed = source.feed();
    expect(feed.sessions.length).toBe(1);
    expect(feed.tokensToday).toEqual({ tokens: 42, asOf: 7 });
    expect(feed.effort).toBe("high");
    expect(feed.telegramOn).toBe(true);
    expect(feed.soundOn).toBe(true);
    expect(feed.active).toEqual({ id: "c1", name: "claude 1", file: null });
    expect(feed.vault).toBeNull();
    expect(feed.focus).toEqual([]);
    expect(feed.repos).toEqual([{ name: "r", status: null }]);
  });

  it("nach refresh: Sitzungsdatei der aktiven Sitzung, Vault, Fokus, Radare", async () => {
    const { source } = rig();
    await source.refresh();
    const feed = source.feed();
    expect(feed.active?.file).toEqual(file);
    expect(feed.vault).toEqual({ inbox: ["01 Inbox/a.md"], indexGeneratedAt: 5, dailyToday: true });
    expect(feed.focus).toEqual(["Eins"]);
    expect(feed.radars).toEqual([{ name: "Eins", lamp: "green" }, { name: "Zwei", lamp: "red" }]);
  });

  it("liest die Radare an den Pfaden aus den Einstellungen (~ aufgelöst)", async () => {
    const paths: string[] = [];
    const { source } = rig({
      settings: () => ({ ...DEFAULT_SETTINGS, radars: [{ name: "A", stateFile: "~/a/state.json" }, { name: "B", stateFile: "/abs/b.json" }] }),
      home: "/Users/x",
      readRadar: async (p) => { paths.push(p); return "gray"; },
    });
    await source.refresh();
    expect(paths.sort()).toEqual(["/Users/x/a/state.json", "/abs/b.json"]);
  });

  it("leerer Radar-Pfad wird nicht gelesen (nicht eingerichtet, kein Fehler)", async () => {
    const paths: string[] = [];
    const { source, logs } = rig({
      settings: () => ({ ...DEFAULT_SETTINGS, radars: [{ name: "A", stateFile: "" }, { name: "B", stateFile: "/b.json" }] }),
      readRadar: async (p) => { paths.push(p); return "green"; },
    });
    await source.refresh();
    expect(paths).toEqual(["/b.json"]);
    expect(source.feed().radars).toEqual([{ name: "A", lamp: "unset" }, { name: "B", lamp: "green" }]);
    expect(logs).toEqual([]);
  });

  it("ein gelöschtes Radar verschwindet nach dem Lesen aus dem Feed", async () => {
    let radars = [{ name: "A", stateFile: "/a.json" }];
    const { source } = rig({ settings: () => ({ ...DEFAULT_SETTINGS, radars }) });
    await source.refresh();
    expect(source.feed().radars).toHaveLength(1);
    radars = [];
    expect(source.feed().radars).toEqual([]);
  });

  it("jeder Leser darf scheitern: Fehler ins Log, die anderen Teile bleiben", async () => {
    const { source, logs } = rig({
      readSessionFiles: async () => { throw new Error("Platte"); },
      readVault: async () => { throw new Error("Vault"); },
    });
    await expect(source.refresh()).resolves.toBeUndefined();
    const feed = source.feed();
    expect(feed.active?.file).toBeNull();
    expect(feed.vault).toBeNull();
    expect(feed.focus).toEqual(["Eins"]);
    expect(logs.join(" ")).toMatch(/Platte/);
    expect(logs.join(" ")).toMatch(/Vault/);
  });

  it("liest Handoffs beim refresh, bei Lesefehler bleiben die letzten", async () => {
    const h = { project: "A", path: "P/A/Handoffs/a.md", created: "2026-01-01", task: "", repo: null };
    let fail = false;
    const { source } = rig({ readHandoffs: async () => { if (fail) throw new Error("kaputt"); return [h]; } });
    expect(source.feed().handoffs).toEqual([]);
    await source.refresh();
    expect(source.feed().handoffs).toEqual([h]);
    fail = true;
    await source.refresh();
    expect(source.feed().handoffs).toEqual([h]);
  });

  it("läuft nicht parallel: ein zweiter refresh mitten im Lauf liest nicht noch einmal", async () => {
    let gate!: () => void;
    const hold = new Promise<void>((r) => { gate = r; });
    const { source, reads } = rig({ readFocus: async () => { await hold; return []; } });
    const a = source.refresh();
    const b = source.refresh();
    gate();
    await Promise.all([a, b]);
    expect(reads.files).toBe(1);
  });

  it("meldet Abonnenten nach refresh und bei changed(); abmelden wirkt; werfender Abonnent stört nicht", async () => {
    const { source } = rig();
    let n = 0;
    source.subscribe(() => { throw new Error("x"); });
    const off = source.subscribe(() => { n++; });
    await source.refresh();
    source.changed();
    expect(n).toBe(2);
    off();
    source.changed();
    expect(n).toBe(2);
  });

  it("eigene Claude-IDs werden bei jedem Lesen frisch erfragt", async () => {
    const seen: string[][] = [];
    let ids = [ID];
    const { source } = rig({ ownClaudeIds: () => ids, readSessionFiles: async (own) => { seen.push([...own]); return new Map(); } });
    await source.refresh();
    ids = ["x"];
    await source.refresh();
    expect(seen).toEqual([[ID], ["x"]]);
  });
});
