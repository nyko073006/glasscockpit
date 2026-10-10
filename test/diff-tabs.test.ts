// DiffTabs mit Fake-Workspace (kein Obsidian): Tab zu bei Fehler, Wiederverwendung auch für zurückgestellte Tabs.
import { describe, expect, it } from "vitest";
import type { DiffRequest } from "../src/core/diff-sessions";
import { DiffTabs } from "../src/host/diff-tabs";

interface FakeLeaf { state: unknown; detached: boolean; fail: boolean; view: unknown; setViewState(s: { state: unknown }): Promise<void>; getViewState(): { type: string; state: unknown }; detach(): void }
const leaf = (initial: unknown = null, fail = false): FakeLeaf => {
  const l: FakeLeaf = {
    state: initial, detached: false, fail,
    // Zurückgestellter Tab: view ist keine DiffView, nur der gespeicherte Zustand ist lesbar.
    view: { deferred: true },
    async setViewState(s) { if (l.fail) throw new Error("Render kaputt"); l.state = s.state; },
    getViewState() { return { type: "glasscockpit-diff", state: l.state }; },
    detach() { l.detached = true; },
  };
  return l;
};
const req = (over: Partial<DiffRequest> = {}): DiffRequest => ({ tabName: "t", oldFilePath: "/a", newFilePath: "/a", newFileContents: "n", oldContents: "o", clientId: 1, ...over });
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(existing: FakeLeaf[], fresh: () => FakeLeaf) {
  const failed: string[] = [];
  const created: FakeLeaf[] = [];
  const app = { workspace: { getLeavesOfType: () => existing, getLeaf: () => { const l = fresh(); created.push(l); return l; } } };
  return { tabs: new DiffTabs(app as never, (id) => failed.push(id)), failed, created };
}

describe("DiffTabs", () => {
  it("neuer Tab: Zustand trägt id, Name und Verbindung", async () => {
    const l = leaf();
    const { tabs } = setup([], () => l);
    tabs.show(req(), "r1:1");
    await tick();
    expect(l.state).toEqual({ id: "r1:1", tab: "t", client: 1 });
  });
  it("Fehler beim Öffnen oder Rendern: der Diff gilt als abgelehnt UND der Tab wird geschlossen", async () => {
    const l = leaf(null, true);
    const { tabs, failed } = setup([], () => l);
    tabs.show(req(), "r1:1");
    await tick();
    expect(failed).toEqual(["r1:1"]);
    expect(l.detached).toBe(true);
  });
  it("vorhandener Tab mit gleichem Namen und gleicher Verbindung wird wiederverwendet, auch ein zurückgestellter (nur über getViewState)", async () => {
    const deferred = leaf({ id: "alt:3", tab: "t", client: 1 });
    const { tabs, created } = setup([deferred], () => leaf());
    tabs.show(req(), "r1:1");
    await tick();
    expect(created).toHaveLength(0);
    expect(deferred.state).toEqual({ id: "r1:1", tab: "t", client: 1 });
  });
  it("gleicher Name, andere Verbindung: eigener neuer Tab", async () => {
    const other = leaf({ id: "r1:1", tab: "t", client: 2 });
    const { tabs, created } = setup([other], () => leaf());
    tabs.show(req({ clientId: 1 }), "r1:2");
    await tick();
    expect(created).toHaveLength(1);
    expect(other.state).toEqual({ id: "r1:1", tab: "t", client: 2 });
  });
  it("hide schließt den Tab, forget nicht", async () => {
    const l = leaf();
    const { tabs } = setup([], () => l);
    tabs.show(req(), "r1:1");
    tabs.forget("r1:1");
    tabs.hide("r1:1");
    expect(l.detached).toBe(false);
    tabs.show(req(), "r1:2");
    tabs.hide("r1:2");
    expect(l.detached).toBe(true);
  });
});
