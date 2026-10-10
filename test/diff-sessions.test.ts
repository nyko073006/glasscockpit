import { beforeEach, describe, expect, it } from "vitest";
import { DiffSessions, type DiffRequest } from "../src/core/diff-sessions";

const req = (name: string, over: Partial<DiffRequest> = {}): DiffRequest => ({
  tabName: name, oldFilePath: "/a/x", newFilePath: "/a/x", newFileContents: "neu", oldContents: "alt", clientId: 1, ...over,
});

let shown: Array<{ name: string; id: string }>;
let hidden: string[];
let s: DiffSessions;
beforeEach(() => {
  shown = [];
  hidden = [];
  s = new DiffSessions({ show: (r, id) => shown.push({ name: r.tabName, id }), hide: (id) => hidden.push(id) });
});

/** Ob das Versprechen schon entschieden ist, ohne darauf zu warten. */
const state = async (p: Promise<unknown>): Promise<unknown> => Promise.race([p, new Promise((r) => setTimeout(() => r("offen"), 20))]);

describe("DiffSessions", () => {
  it("open zeigt den Diff und wartet (blockiert), bis entschieden ist", async () => {
    const p = s.open(req("t1"));
    expect(shown).toEqual([{ name: "t1", id: expect.any(String) }]);
    expect(await state(p)).toBe("offen");
    expect(s.has("t1")).toBe(true);
    expect(s.size).toBe(1);
  });
  it("Annehmen löst mit accepted auf und räumt auf", async () => {
    const p = s.open(req("t1"));
    expect(s.decide(shown[0].id, "accepted")).toBe(true);
    expect(await p).toBe("accepted");
    expect(s.has("t1")).toBe(false);
    expect(s.size).toBe(0);
  });
  it("Ablehnen löst mit rejected auf", async () => {
    const p = s.open(req("t1"));
    s.decide(shown[0].id, "rejected");
    expect(await p).toBe("rejected");
  });
  it("zweite Entscheidung zur selben id wirkt nicht (false)", async () => {
    const p = s.open(req("t1"));
    const id = shown[0].id;
    expect(s.decide(id, "accepted")).toBe(true);
    expect(s.decide(id, "rejected")).toBe(false);
    expect(await p).toBe("accepted");
  });
  it("Tab schließen ohne Entscheidung gilt als Ablehnen, ohne den Tab noch einmal zu schließen", async () => {
    const p = s.open(req("t1"));
    s.viewClosed(shown[0].id);
    expect(await p).toBe("rejected");
    expect(hidden).toEqual([]);
    expect(s.size).toBe(0);
  });
  it("Schließen nach der Entscheidung ändert nichts mehr", async () => {
    const p = s.open(req("t1"));
    s.decide(shown[0].id, "accepted");
    s.viewClosed(shown[0].id);
    expect(await p).toBe("accepted");
  });
  it("gleicher tab_name ersetzt: das alte Versprechen wird abgelehnt, das neue bleibt offen", async () => {
    const alt = s.open(req("t1", { newFileContents: "alt" }));
    const neu = s.open(req("t1", { newFileContents: "neu" }));
    expect(await alt).toBe("rejected");
    expect(await state(neu)).toBe("offen");
    expect(s.size).toBe(1);
    expect(shown.map((x) => x.name)).toEqual(["t1", "t1"]);
  });
  it("das Schließen des ersetzten Tabs lehnt den neuen Diff nicht ab (veraltete id)", async () => {
    const alt = s.open(req("t1"));
    const oldId = shown[0].id;
    const neu = s.open(req("t1"));
    await alt;
    s.viewClosed(oldId);
    expect(await state(neu)).toBe("offen");
    expect(s.has("t1")).toBe(true);
  });
  it("verschiedene tab_name laufen nebeneinander", async () => {
    const a = s.open(req("a"));
    const b = s.open(req("b"));
    s.decide(shown[1].id, "accepted");
    expect(await b).toBe("accepted");
    expect(await state(a)).toBe("offen");
  });
  it("closeTab: lehnt ab, schließt den Tab, meldet ob es ihn gab", async () => {
    const p = s.open(req("t1"));
    expect(s.closeTab("t1")).toBe(true);
    expect(await p).toBe("rejected");
    expect(hidden).toEqual([shown[0].id]);
    expect(s.closeTab("t1")).toBe(false);
    expect(s.closeTab("gibt-es-nicht")).toBe(false);
  });
  it("closeTab mit Verbindung: fremde Diffs bleiben offen", async () => {
    const p = s.open(req("t1", { clientId: 1 }));
    expect(s.closeTab("t1", 2)).toBe(false);
    expect(await state(p)).toBe("offen");
    expect(s.closeTab("t1", 1)).toBe(true);
    expect(await p).toBe("rejected");
  });
  it("closeAll: lehnt alle ab, schließt alle Tabs, zählt", async () => {
    const a = s.open(req("a"));
    const b = s.open(req("b"));
    expect(s.closeAll()).toBe(2);
    expect(await a).toBe("rejected");
    expect(await b).toBe("rejected");
    expect(hidden.sort()).toEqual(shown.map((x) => x.id).sort());
    expect(s.size).toBe(0);
    expect(s.closeAll()).toBe(0);
  });
  it("closeClient: nur die Diffs dieser Verbindung, Tabs zu", async () => {
    const a = s.open(req("a", { clientId: 1 }));
    const b = s.open(req("b", { clientId: 2 }));
    expect(s.closeClient(1)).toBe(1);
    expect(await a).toBe("rejected");
    expect(await state(b)).toBe("offen");
    expect(hidden).toEqual([shown[0].id]);
  });
  it("get liefert die Anfrage zur id, danach null", async () => {
    void s.open(req("t1"));
    const id = shown[0].id;
    expect(s.get(id)?.tabName).toBe("t1");
    s.decide(id, "rejected");
    expect(s.get(id)).toBeNull();
  });
  it("gleicher tab_name einer ANDEREN Verbindung ersetzt nicht und lehnt nichts ab (Schlüssel: Verbindung plus Name)", async () => {
    const a = s.open(req("t1", { clientId: 1 }));
    const b = s.open(req("t1", { clientId: 2 }));
    expect(await state(a)).toBe("offen");
    expect(await state(b)).toBe("offen");
    expect(s.size).toBe(2);
    expect(s.closeTab("t1", 2)).toBe(true);
    expect(await b).toBe("rejected");
    expect(await state(a)).toBe("offen");
  });
  it("gleicher tab_name, gleiche Verbindung: ersetzt weiter", async () => {
    const a = s.open(req("t1", { clientId: 1 }));
    void s.open(req("t1", { clientId: 1 }));
    expect(await a).toBe("rejected");
    expect(s.size).toBe(1);
  });
  it("ids sind über Läufe eindeutig: die id eines früheren Laufs trifft nichts im neuen", async () => {
    const alt = new DiffSessions({ show: () => undefined, hide: () => undefined });
    const idsAlt: string[] = [];
    const a2 = new DiffSessions({ show: (_r, id) => idsAlt.push(id), hide: () => undefined });
    void a2.open(req("x"));
    const neu = s.open(req("t1"));
    const idNeu = shown[0].id;
    expect(typeof idNeu).toBe("string");
    expect(idsAlt[0]).not.toBe(idNeu);
    // Ein wiederhergestellter Alt-Tab mit der id des alten Laufs (gleicher Zähler) darf den neuen Diff nicht berühren.
    s.viewClosed(idsAlt[0]);
    expect(s.decide(idsAlt[0], "rejected")).toBe(false);
    expect(await state(neu)).toBe("offen");
    expect(alt.size).toBe(0);
  });
  it("show wirft: das Versprechen wird abgelehnt statt zu hängen", async () => {
    const kaputt = new DiffSessions({ show: () => { throw new Error("Tab nicht möglich"); }, hide: () => undefined });
    expect(await kaputt.open(req("t"))).toBe("rejected");
    expect(kaputt.size).toBe(0);
  });
});
