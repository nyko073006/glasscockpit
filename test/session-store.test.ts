import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/core/session-store";
import type { CockpitData, SessionRecord } from "../src/core/session-model";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { FakeTimers } from "./helpers/fakes";

const rec = (id: string, name = "claude"): SessionRecord => ({ id, name, kind: "claude", cwd: "/v", createdAt: "t" });
function setup(initial: SessionRecord[] = []) {
  const saves: CockpitData[] = [];
  const timers = new FakeTimers();
  const store = new SessionStore({ schemaVersion: 1, sessions: initial, settings: DEFAULT_SETTINGS, recentSkills: [], openAtUnload: [], dashboardAtUnload: null }, async (d) => { saves.push(d); }, timers, 300);
  return { store, saves, timers };
}

describe("SessionStore: zuletzt benutzte Skills", () => {
  it("useSkill: nach vorn, ohne Dopplung, begrenzt, Listener, entprellt gespeichert", () => {
    const { store, saves, timers } = setup();
    const seen: string[][] = [];
    store.onRecentsChange(() => seen.push(store.recentSkills()));
    store.useSkill("a"); store.useSkill("b"); store.useSkill("a");
    expect(store.recentSkills()).toEqual(["a", "b"]);
    expect(seen).toEqual([["a"], ["b", "a"], ["a", "b"]]);
    expect(saves).toHaveLength(0);
    timers.advance(300);
    expect(saves).toHaveLength(1);
    expect(saves[0].recentSkills).toEqual(["a", "b"]);
    for (let i = 0; i < 40; i++) store.useSkill(`s${i}`);
    expect(store.recentSkills()).toHaveLength(30);
  });
  it("Anfangswert aus den Daten, recentSkills() gibt eine Kopie", () => {
    const store = new SessionStore({ schemaVersion: 1, sessions: [], settings: DEFAULT_SETTINGS, recentSkills: ["x", "y"], openAtUnload: [], dashboardAtUnload: null }, async () => {}, new FakeTimers(), 300);
    expect(store.recentSkills()).toEqual(["x", "y"]);
    store.recentSkills().push("z");
    expect(store.recentSkills()).toEqual(["x", "y"]);
  });
  it("Abmelden und andere Speicherungen tragen recentSkills mit", () => {
    const { store, saves, timers } = setup();
    let n = 0;
    const off = store.onRecentsChange(() => n++);
    store.useSkill("a"); off(); store.useSkill("b");
    expect(n).toBe(1);
    store.add(rec("a")); timers.advance(300);
    expect(saves.at(-1)?.recentSkills).toEqual(["b", "a"]);
  });
});

describe("SessionStore: ideDiff braucht ideBridge (06.10.2026)", () => {
  it("Brücke aus schaltet ideDiff mit ab, die Meldung sieht beides; Brücke wieder an lässt ideDiff aus", () => {
    const { store } = setup();
    expect(store.updateSetting("ideDiff", true).ok).toBe(true);
    const seen: boolean[] = [];
    store.onSettingsChange((s) => seen.push(s.ideDiff));
    store.updateSetting("ideBridge", false);
    expect(store.settings().ideDiff).toBe(false);
    expect(seen).toEqual([false]);
    store.updateSetting("ideBridge", true);
    expect(store.settings().ideDiff).toBe(false);
  });
  it("ideDiff einschalten bei ausgeschalteter Brücke wird abgelehnt, nichts gespeichert", () => {
    const { store, saves, timers } = setup();
    store.updateSetting("ideBridge", false);
    timers.advance(300);
    const before = saves.length;
    expect(store.updateSetting("ideDiff", true)).toEqual({ ok: false, reason: "braucht die IDE-Brücke" });
    expect(store.settings().ideDiff).toBe(false);
    timers.advance(300);
    expect(saves).toHaveLength(before);
  });
});

describe("SessionStore", () => {
  it("speichert entprellt einmal nach 300 ms", () => {
    const { store, saves, timers } = setup();
    store.add(rec("a")); timers.advance(200); store.add(rec("b")); timers.advance(299);
    expect(saves).toHaveLength(0);
    timers.advance(1);
    expect(saves).toEqual([{ schemaVersion: 1, sessions: [rec("a"), rec("b")], settings: DEFAULT_SETTINGS, recentSkills: [], openAtUnload: [], dashboardAtUnload: null }]);
  });
  it("speichert nie ohne Änderung", () => {
    const { store, saves, timers } = setup([rec("a")]);
    store.rename("a", "  "); store.prune(["a"]); timers.advance(1000);
    expect(saves).toHaveLength(0);
  });
  it("flush speichert sofort und nur einmal", async () => {
    const { store, saves, timers } = setup();
    store.add(rec("a")); await store.flush(); timers.advance(1000);
    expect(saves).toHaveLength(1);
  });
  it("onChange meldet die id, prune meldet null", () => {
    const { store } = setup([rec("a"), rec("b")]);
    const seen: Array<string | null> = [];
    store.onChange((id) => seen.push(id));
    store.rename("a", "neu"); store.prune(["a"]);
    expect(seen).toEqual(["a", null]);
    expect(store.get("a")?.name).toBe("neu");
    expect(store.get("b")).toBeNull();
  });
  it("Speicherfehler geht an onSaveError", async () => {
    const fehler: unknown[] = [];
    const store = new SessionStore({ schemaVersion: 1, sessions: [], settings: DEFAULT_SETTINGS, recentSkills: [], openAtUnload: [], dashboardAtUnload: null }, async () => { throw new Error("voll"); }, new FakeTimers(), 300, (f) => fehler.push(f));
    store.add(rec("a")); await store.flush();
    expect(String(fehler[0])).toMatch(/voll/);
  });

  it("updateSetting lehnt Ungültiges ab und speichert nichts", () => {
    const { store, saves, timers } = setup();
    expect(store.updateSetting("maxSessions", 0)).toEqual({ ok: false, reason: "ganze Zahl von 1 bis 50" });
    timers.advance(1000);
    expect(saves).toHaveLength(0);
    expect(store.settings().maxSessions).toBe(DEFAULT_SETTINGS.maxSessions);
  });
  it("updateSetting speichert Textwerte getrimmt", () => {
    const { store } = setup();
    expect(store.updateSetting("projectsRoot", "  ~/x  ")).toEqual({ ok: true });
    expect(store.settings().projectsRoot).toBe("~/x");
    store.updateSetting("soundFile", " /a.aiff\n");
    expect(store.settings().soundFile).toBe("/a.aiff");
  });
  it("updateSetting speichert nach 300 ms und ruft Listener", () => {
    const { store, saves, timers } = setup();
    const seen: boolean[] = [];
    store.onSettingsChange((s) => seen.push(s.alertSound));
    expect(store.updateSetting("alertSound", false)).toEqual({ ok: true });
    expect(seen).toEqual([false]);
    timers.advance(299);
    expect(saves).toHaveLength(0);
    timers.advance(1);
    expect(saves).toHaveLength(1);
    expect(saves[0].settings.alertSound).toBe(false);
  });
  it("Listener lässt sich abmelden", () => {
    const { store } = setup();
    let n = 0;
    const off = store.onSettingsChange(() => n++);
    off();
    store.updateSetting("markTab", false);
    expect(n).toBe(0);
  });
});

describe("SessionStore: Claude-ID (Abend 11)", () => {
  const ID = "0f4b7c1e-2d3a-4b5c-8d9e-0123456789ab";
  it("setClaudeSessionId speichert entprellt, meldet die Änderung und lässt die Cockpit-id", () => {
    const { store, saves, timers } = setup([rec("a")]);
    const ids: Array<string | null> = [];
    store.onChange((id) => ids.push(id));
    expect(store.setClaudeSessionId("a", ID)).toEqual({ ok: true, sessions: [{ ...rec("a"), claudeSessionId: ID }] });
    expect(store.get("a")?.claudeSessionId).toBe(ID);
    expect(store.get("a")?.id).toBe("a");
    expect(ids).toEqual(["a"]);
    timers.advance(300);
    expect(saves[0].sessions[0].claudeSessionId).toBe(ID);
  });
  it("unbekannte Sitzung: abgelehnt, nichts gespeichert", () => {
    const { store, saves, timers } = setup([rec("a")]);
    expect(store.setClaudeSessionId("x", ID).ok).toBe(false);
    timers.advance(300);
    expect(saves).toHaveLength(0);
  });
});

describe("SessionStore: Merkzettel openAtUnload (Abend 19c)", () => {
  it("Anfangswert aus den Daten, openAtUnload() gibt eine Kopie", () => {
    const store = new SessionStore({ schemaVersion: 1, sessions: [], settings: DEFAULT_SETTINGS, recentSkills: [], openAtUnload: ["a", "b"], dashboardAtUnload: null }, async () => {}, new FakeTimers(), 300);
    expect(store.openAtUnload()).toEqual(["a", "b"]);
    store.openAtUnload().push("z");
    expect(store.openAtUnload()).toEqual(["a", "b"]);
  });
  it("setOpenAtUnload und flush: geschrieben sofort, ohne auf den Takt zu warten", async () => {
    const { store, saves } = setup([rec("a"), rec("b")]);
    store.setOpenAtUnload(["b", "a"]);
    await store.flush();
    expect(saves).toHaveLength(1);
    expect(saves[0].openAtUnload).toEqual(["b", "a"]);
  });
  it("Leeren nach dem Laden wird entprellt gespeichert; gleiche Liste speichert nichts", () => {
    const saves: CockpitData[] = [];
    const timers = new FakeTimers();
    const store = new SessionStore({ schemaVersion: 1, sessions: [], settings: DEFAULT_SETTINGS, recentSkills: [], openAtUnload: ["a"], dashboardAtUnload: null }, async (d) => { saves.push(d); }, timers, 300);
    store.setOpenAtUnload(["a"]);
    timers.advance(300);
    expect(saves).toHaveLength(0);
    store.setOpenAtUnload([]);
    timers.advance(300);
    expect(saves.map((d) => d.openAtUnload)).toEqual([[]]);
  });
  it("andere Speicherungen tragen den Merkzettel mit", () => {
    const { store, saves, timers } = setup();
    store.setOpenAtUnload(["a"]);
    store.add(rec("a"));
    timers.advance(300);
    expect(saves.at(-1)?.openAtUnload).toEqual(["a"]);
  });
});

describe("SessionStore: Merkzettel dashboardAtUnload (Abend 19e)", () => {
  const withMemo = (memo: CockpitData["dashboardAtUnload"], saves: CockpitData[], timers: FakeTimers) =>
    new SessionStore({ schemaVersion: 1, sessions: [], settings: DEFAULT_SETTINGS, recentSkills: [], openAtUnload: [], dashboardAtUnload: memo }, async (d) => { saves.push(d); }, timers, 300);

  it("Anfangswert aus den Daten, dashboardAtUnload() gibt eine Kopie", () => {
    const store = withMemo({ area: "left" }, [], new FakeTimers());
    expect(store.dashboardAtUnload()).toEqual({ area: "left" });
    const copy = store.dashboardAtUnload();
    if (copy) copy.area = "right";
    expect(store.dashboardAtUnload()).toEqual({ area: "left" });
  });
  it("setDashboardAtUnload und flush: geschrieben sofort, ohne auf den Takt zu warten", async () => {
    const { store, saves } = setup();
    store.setDashboardAtUnload({ area: "right" });
    await store.flush();
    expect(saves).toHaveLength(1);
    expect(saves[0].dashboardAtUnload).toEqual({ area: "right" });
    expect(store.dashboardAtUnload()).toEqual({ area: "right" });
  });
  it("gleicher Wert speichert nichts (null wie Bereich), anderer Wert und Leeren schon", () => {
    const saves: CockpitData[] = [];
    const timers = new FakeTimers();
    const store = withMemo({ area: "main" }, saves, timers);
    store.setDashboardAtUnload({ area: "main" });
    timers.advance(300);
    expect(saves).toHaveLength(0);
    store.setDashboardAtUnload({ area: "left" });
    timers.advance(300);
    expect(saves.map((d) => d.dashboardAtUnload)).toEqual([{ area: "left" }]);
    store.setDashboardAtUnload(null);
    timers.advance(300);
    expect(saves.map((d) => d.dashboardAtUnload)).toEqual([{ area: "left" }, null]);
    store.setDashboardAtUnload(null);
    timers.advance(300);
    expect(saves).toHaveLength(2);
  });
  it("andere Speicherungen tragen den Merkzettel mit", () => {
    const { store, saves, timers } = setup();
    store.setDashboardAtUnload({ area: "right" });
    store.add(rec("a"));
    timers.advance(300);
    expect(saves.at(-1)?.dashboardAtUnload).toEqual({ area: "right" });
  });
});
