import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { addSession, backupSuffix, claudeIdOf, setClaudeId, parseData, parseDataText, planAfterLoad, pruneUnused, reopenNotice, renameSession, uniqueName, limitReached, type SessionRecord } from "../src/core/session-model";

const rec = (id: string, name = "claude"): SessionRecord =>
  ({ id, name, kind: "claude", cwd: "/v", createdAt: "2026-10-04T18:00:00.000Z" });

describe("parseData", () => {
  it("fehlend ergibt Defaults ohne Grund", () => {
    expect(parseData(undefined)).toEqual({ data: { schemaVersion: 1, sessions: [], settings: DEFAULT_SETTINGS, recentSkills: [], openAtUnload: [], dashboardAtUnload: null }, reason: null });
    expect(parseData(null).reason).toBeNull();
  });
  it("kaputt ergibt Defaults mit Grund", () => {
    for (const raw of ["{kaputt", 42, [], true]) {
      const r = parseData(raw);
      expect(r.data.sessions).toEqual([]);
      expect(r.reason).toMatch(/kein Objekt/);
    }
  });
  it("falsche Version ergibt Defaults mit Grund", () => {
    const r = parseData({ schemaVersion: 2, sessions: [rec("a")] });
    expect(r.data.sessions).toEqual([]);
    expect(r.reason).toMatch(/schemaVersion 2/);
  });
  it("sessions keine Liste", () => {
    expect(parseData({ schemaVersion: 1, sessions: {} }).reason).toMatch(/keine Liste/);
  });
  it("gültig bleibt gleich", () => {
    const data = { schemaVersion: 1, sessions: [rec("a"), { ...rec("b", "Briefing"), kind: "agent", agentName: "stefan" }], settings: DEFAULT_SETTINGS, recentSkills: ["lint", "council"], openAtUnload: [], dashboardAtUnload: null };
    expect(parseData(data)).toEqual({ data, reason: null });
  });
  it("ungültige und doppelte Einträge fliegen, gültige bleiben", () => {
    const r = parseData({ schemaVersion: 1, sessions: [rec("a"), { id: "", name: "x" }, rec("a", "dup"), { ...rec("c"), kind: "vim" }, { ...rec("d"), agentName: 5 }] });
    expect(r.data.sessions.map((s) => s.id)).toEqual(["a"]);
    expect(r.reason).toBe("4 ungültige Einträge verworfen");
  });
});

describe("recentSkills (Abend 10)", () => {
  const base = { schemaVersion: 1, sessions: [] };
  it("fehlt das Feld: leere Liste, kein Grund", () => {
    const r = parseData(base);
    expect(r.data.recentSkills).toEqual([]);
    expect(r.reason).toBeNull();
  });
  it("kein Array: leere Liste, kein Grund", () => {
    for (const bad of ["lint", 5, {}, null]) {
      const r = parseData({ ...base, recentSkills: bad });
      expect(r.data.recentSkills).toEqual([]);
      expect(r.reason).toBeNull();
    }
  });
  it("Nicht-Strings und Dopplungen fliegen, Reihenfolge bleibt, kein Grund", () => {
    const r = parseData({ ...base, recentSkills: ["b", 5, "a", null, "b", "", "c"] });
    expect(r.data.recentSkills).toEqual(["b", "a", "c"]);
    expect(r.reason).toBeNull();
  });
  it("auf 30 gekürzt", () => {
    const r = parseData({ ...base, recentSkills: Array.from({ length: 40 }, (_, i) => `s${i}`) });
    expect(r.data.recentSkills).toHaveLength(30);
    expect(r.data.recentSkills[0]).toBe("s0");
  });
  it("falsche schemaVersion setzt auch recentSkills zurück", () => {
    expect(parseData({ schemaVersion: 2, recentSkills: ["a"] }).data.recentSkills).toEqual([]);
  });
});

describe("parseDataText", () => {
  it("fehlende Datei ergibt Defaults ohne Grund", () => {
    expect(parseDataText(null)).toEqual(parseData(undefined));
  });
  it("kaputtes JSON ergibt Defaults mit Grund", () => {
    for (const text of ["{kaputt", "", "   "]) {
      const r = parseDataText(text);
      expect(r.data).toEqual(parseData(undefined).data);
      expect(r.reason).toMatch(/^data\.json nicht lesbar: /);
    }
  });
  it("gültiges JSON geht durch parseData", () => {
    const data = { schemaVersion: 1, sessions: [rec("a")], settings: DEFAULT_SETTINGS, recentSkills: ["x"], openAtUnload: [], dashboardAtUnload: null };
    expect(parseDataText(JSON.stringify(data))).toEqual({ data, reason: null });
    expect(parseDataText("42").reason).toBe("data.json ist kein Objekt");
  });
});

describe("renameSession", () => {
  const list = [rec("a"), rec("b", "zwei")];
  it("trimmt", () => {
    const r = renameSession(list, "a", "  Briefing  ");
    expect(r.ok && r.sessions[0].name).toBe("Briefing");
  });
  it("leer abgelehnt", () => expect(renameSession(list, "a", "   ")).toEqual({ ok: false, reason: "Name ist leer" }));
  it("40 Zeichen gehen, 41 nicht", () => {
    expect(renameSession(list, "a", "x".repeat(40)).ok).toBe(true);
    expect(renameSession(list, "a", "x".repeat(41))).toEqual({ ok: false, reason: "Name ist länger als 40 Zeichen" });
  });
  it("Emoji zählt als ein Zeichen", () => expect(renameSession(list, "a", "🚀".repeat(40)).ok).toBe(true));
  it("Name einer anderen Sitzung ist erlaubt", () => expect(renameSession(list, "a", "zwei").ok).toBe(true));
  it("unbekannte id", () => expect(renameSession(list, "x", "n")).toEqual({ ok: false, reason: "Sitzung unbekannt" }));
  it("ändert die Eingabe nicht", () => { renameSession(list, "a", "neu"); expect(list[0].name).toBe("claude"); });
});

describe("uniqueName", () => {
  it.each([
    [[], "claude"], [["claude"], "claude 2"], [["claude", "claude 2"], "claude 3"],
    [["Claude"], "claude 2"], [["claude 2"], "claude"],
  ])("%j → %s", (taken, expected) => expect(uniqueName("claude", taken as string[])).toBe(expected));
  it("leere Basis", () => expect(uniqueName("  ", [])).toBe("claude"));
});

describe("pruneUnused", () => {
  it("behält nur referenzierte", () =>
    expect(pruneUnused([rec("a"), rec("b"), rec("c")], new Set(["c", "a", "zzz"])).map((s) => s.id)).toEqual(["a", "c"]));
  it("leere Referenzen leeren die Liste", () => expect(pruneUnused([rec("a")], [])).toEqual([]));
});

describe("addSession und limitReached", () => {
  it("doppelte id abgelehnt", () => expect(addSession([rec("a")], rec("a"))).toEqual({ ok: false, reason: "Sitzung gibt es schon" }));
  it("Grenze", () => { expect(limitReached(9, 10)).toBe(false); expect(limitReached(10, 10)).toBe(true); expect(limitReached(1, 1)).toBe(true); });
});

describe("parseData und Einstellungen", () => {
  it("ungültige Felder gehen mit Namen in den Grund", () => {
    const r = parseData({ schemaVersion: 1, sessions: [], settings: { maxSessions: "0", alertSound: "ja" } });
    expect(r.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.reason).toBe("Einstellungen auf Vorgabe zurückgesetzt: maxSessions, alertSound");
  });
  it("hängt an den Grund mit Semikolon an", () => {
    const r = parseData({ schemaVersion: 1, sessions: [{ id: "" }], settings: { maxSessions: "0" } });
    expect(r.reason).toBe("1 ungültige Einträge verworfen; Einstellungen auf Vorgabe zurückgesetzt: maxSessions");
  });
  it("gültige Einstellungen bleiben", () => {
    const r = parseData({ schemaVersion: 1, sessions: [], settings: { maxSessions: 3 } });
    expect(r.data.settings).toEqual({ ...DEFAULT_SETTINGS, maxSessions: 3 });
    expect(r.reason).toBeNull();
  });
  it("falsche Version ergibt Vorgaben", () => {
    expect(parseData({ schemaVersion: 2, settings: { maxSessions: 3 } }).data.settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe("backupSuffix", () => {
  it("lokale Zeit, zweistellig aufgefüllt", () => {
    expect(backupSuffix(new Date(2026, 9, 4, 18, 5, 9))).toBe("kaputt-2026-10-04-180509");
    expect(backupSuffix(new Date(2026, 0, 2, 3, 4, 5))).toBe("kaputt-2026-01-02-030405");
  });
});

describe("claudeSessionId (Abend 11)", () => {
  const ID = "0f4b7c1e-2d3a-4b5c-8d9e-0123456789ab";
  const mit = (extra: Record<string, unknown>) =>
    parseData({ schemaVersion: 1, sessions: [{ ...rec("a"), ...extra }], settings: DEFAULT_SETTINGS, recentSkills: [] });

  it("fehlt das Feld, bleibt der Eintrag gültig und die Cockpit-id gilt, ohne Grund", () => {
    const r = parseData({ schemaVersion: 1, sessions: [rec("0f4b7c1e-aaaa-4bbb-8ccc-0123456789ab")], settings: DEFAULT_SETTINGS, recentSkills: [] });
    expect(r.reason).toBeNull();
    expect(r.data.sessions).toHaveLength(1);
    expect("claudeSessionId" in r.data.sessions[0]).toBe(false);
    expect(claudeIdOf(r.data.sessions[0])).toBe("0f4b7c1e-aaaa-4bbb-8ccc-0123456789ab");
  });

  it("ungültig (kein Text, keine UUID, leer) fällt weg: kein Verwerfen, kein Grund, Cockpit-id gilt", () => {
    for (const bad of [5, null, "", "abc", "0f4b7c1e-2d3a-4b5c-8d9e", `${ID}x`, true, {}]) {
      const r = mit({ claudeSessionId: bad });
      expect(r.reason).toBeNull();
      expect(r.data.sessions).toHaveLength(1);
      expect("claudeSessionId" in r.data.sessions[0]).toBe(false);
      expect(claudeIdOf(r.data.sessions[0])).toBe("a");
    }
  });

  it("claudeIdOf prüft selbst: ein Eintrag im Speicher mit kaputter Claude-ID nimmt die Cockpit-id", () => {
    const base = { id: "a", name: "A", kind: "claude", cwd: "/x", createdAt: "2026-10-05T00:00:00.000Z" } as SessionRecord;
    for (const bad of ["", "abc", `${ID}x`]) expect(claudeIdOf({ ...base, claudeSessionId: bad })).toBe("a");
    expect(claudeIdOf({ ...base, claudeSessionId: ID })).toBe(ID);
  });

  it("gültige UUID bleibt erhalten und gilt als Claude-ID", () => {
    const r = mit({ claudeSessionId: ID });
    expect(r.reason).toBeNull();
    expect(r.data.sessions[0].claudeSessionId).toBe(ID);
    expect(claudeIdOf(r.data.sessions[0])).toBe(ID);
    expect(r.data.sessions[0].id).toBe("a");
  });

  it("Großschreibung ist eine gültige UUID", () => {
    expect(mit({ claudeSessionId: ID.toUpperCase() }).data.sessions[0].claudeSessionId).toBe(ID.toUpperCase());
  });

  it("setClaudeId setzt die ID am Eintrag, unbekannte Sitzung und ungültige UUID werden abgelehnt", () => {
    const list = [rec("a"), rec("b")];
    const ok = setClaudeId(list, "b", ID);
    expect(ok).toEqual({ ok: true, sessions: [rec("a"), { ...rec("b"), claudeSessionId: ID }] });
    expect(list[1].claudeSessionId).toBeUndefined();
    expect(setClaudeId(list, "x", ID).ok).toBe(false);
    expect(setClaudeId(list, "a", "keine-uuid").ok).toBe(false);
  });
});

describe("openAtUnload in data.json (Abend 19c)", () => {
  const base = { schemaVersion: 1, sessions: [rec("a"), rec("b")], settings: DEFAULT_SETTINGS, recentSkills: [] };
  it("alte data.json ohne das Feld lädt mit leerer Liste, ohne Grund und mit schemaVersion 1", () => {
    const r = parseData(base);
    expect(r.reason).toBeNull();
    expect(r.data.openAtUnload).toEqual([]);
    expect(r.data.schemaVersion).toBe(1);
  });
  it("die Liste wird gelesen, Reihenfolge bleibt", () => {
    expect(parseData({ ...base, openAtUnload: ["b", "a"] }).data.openAtUnload).toEqual(["b", "a"]);
  });
  it("Unsinn fällt raus: kein Array ergibt [], Nicht-Strings, Leeres und Dopplungen fallen weg, nie ein Grund", () => {
    for (const bad of ["a", 5, null, { a: 1 }]) {
      const r = parseData({ ...base, openAtUnload: bad });
      expect(r.data.openAtUnload).toEqual([]);
      expect(r.reason).toBeNull();
    }
    expect(parseData({ ...base, openAtUnload: ["b", 3, "", "b", "a"] }).data.openAtUnload).toEqual(["b", "a"]);
  });
  it("übersteht den Weg durch JSON", () => {
    const data = { ...base, openAtUnload: ["a"], dashboardAtUnload: null };
    expect(parseDataText(JSON.stringify(data)).data).toEqual(data);
  });
});

describe("planAfterLoad (Abend 19c)", () => {
  const plan = (o: Partial<Parameters<typeof planAfterLoad>[0]>) =>
    planAfterLoad({ openAtUnload: [], leavesAtLoad: [], records: [], reopenSetting: true, dashboardAtUnload: null, dashboardAtLoad: false, ...o });

  it("Abschalten: keine Tabs beim Laden, zwei im Merkzettel: beide wieder öffnen, nichts löschen", () => {
    expect(plan({ openAtUnload: ["a", "b"], records: ["a", "b"] })).toEqual({ reopen: ["a", "b"], prune: [], dashboard: null });
  });
  it("plugin:reload und Update: Tabs da, nichts öffnen, Einträge ohne Tab wie bisher löschen", () => {
    expect(plan({ openAtUnload: ["a", "b"], leavesAtLoad: ["a", "b"], records: ["a", "b", "c"] })).toEqual({ reopen: [], prune: ["c"], dashboard: null });
  });
  it("Tab vorher vom Nutzer geschlossen: Eintrag da, nicht im Merkzettel, wird gelöscht", () => {
    expect(plan({ openAtUnload: ["a"], records: ["a", "b"] })).toEqual({ reopen: ["a"], prune: ["b"], dashboard: null });
  });
  it("Merkzettel nennt eine id ohne Eintrag: überspringen", () => {
    expect(plan({ openAtUnload: ["x", "a"], records: ["a"] })).toEqual({ reopen: ["a"], prune: [], dashboard: null });
  });
  it("Einstellung aus: Verhalten wie bisher, alles ohne Tab wird gelöscht", () => {
    expect(plan({ openAtUnload: ["a", "b"], records: ["a", "b"], reopenSetting: false })).toEqual({ reopen: [], prune: ["a", "b"], dashboard: null });
  });
  it("leerer Merkzettel: wie bisher", () => {
    expect(plan({ records: ["a", "b"] })).toEqual({ reopen: [], prune: ["a", "b"], dashboard: null });
    expect(plan({ leavesAtLoad: ["a"], records: ["a", "b"] })).toEqual({ reopen: [], prune: ["b"], dashboard: null });
  });
  it("Reihenfolge wie im Merkzettel, Dopplungen nur einmal", () => {
    expect(plan({ openAtUnload: ["c", "a", "c", "b"], records: ["a", "b", "c"] })).toEqual({ reopen: ["c", "a", "b"], prune: [], dashboard: null });
  });
});

describe("dashboardAtUnload in data.json (Abend 19e)", () => {
  const base = { schemaVersion: 1, sessions: [rec("a")], settings: DEFAULT_SETTINGS, recentSkills: [], openAtUnload: [] };
  it("data.json ohne das Feld lädt mit null, ohne Grund und mit schemaVersion 1", () => {
    const r = parseData(base);
    expect(r.reason).toBeNull();
    expect(r.data.dashboardAtUnload).toBeNull();
    expect(r.data.schemaVersion).toBe(1);
  });
  it("gültige Bereiche werden gelesen", () => {
    for (const area of ["main", "left", "right"] as const) {
      expect(parseData({ ...base, dashboardAtUnload: { area } }).data.dashboardAtUnload).toEqual({ area });
    }
  });
  it("Unsinn ergibt null und nie einen Grund für die Kaputt-Notice", () => {
    for (const bad of ["main", 5, true, [], {}, { area: "oben" }, { area: 3 }, { area: null }, { Area: "main" }]) {
      const r = parseData({ ...base, dashboardAtUnload: bad });
      expect([bad, r.data.dashboardAtUnload]).toEqual([bad, null]);
      expect(r.reason).toBeNull();
    }
  });
  it("übersteht den Weg durch JSON", () => {
    const data = { ...base, dashboardAtUnload: { area: "right" } };
    expect(parseDataText(JSON.stringify(data)).data).toEqual(data);
  });
});

describe("planAfterLoad: Cockpit-Ansicht (Abend 19e)", () => {
  const plan = (o: Partial<Parameters<typeof planAfterLoad>[0]>) =>
    planAfterLoad({ openAtUnload: [], leavesAtLoad: [], records: [], reopenSetting: true, dashboardAtUnload: null, dashboardAtLoad: false, ...o });

  it("Abschalten mit offenem Cockpit: der gemerkte Bereich kommt zurück, jeder der drei", () => {
    for (const area of ["main", "left", "right"] as const) {
      expect(plan({ dashboardAtUnload: { area } }).dashboard).toBe(area);
    }
  });
  it("Abschalten mit Cockpit und zwei Sitzungen: beide kommen", () => {
    expect(plan({ dashboardAtUnload: { area: "main" }, openAtUnload: ["a", "b"], records: ["a", "b"] }))
      .toEqual({ reopen: ["a", "b"], prune: [], dashboard: "main" });
  });
  it("plugin:reload (Cockpit beim Laden da): nichts öffnen", () => {
    expect(plan({ dashboardAtUnload: { area: "main" }, dashboardAtLoad: true }).dashboard).toBeNull();
  });
  it("Cockpit vorher geschlossen (Merkzettel null): nichts öffnen, auch wenn Sitzungen zurückkommen", () => {
    expect(plan({ openAtUnload: ["a"], records: ["a"] })).toEqual({ reopen: ["a"], prune: [], dashboard: null });
  });
  it("Einstellung aus: weder Sitzungen noch Cockpit", () => {
    expect(plan({ dashboardAtUnload: { area: "left" }, openAtUnload: ["a"], records: ["a"], reopenSetting: false }))
      .toEqual({ reopen: [], prune: ["a"], dashboard: null });
  });
  it("Cockpit allein ohne Sitzungen: Bereich da, reopen leer", () => {
    expect(plan({ dashboardAtUnload: { area: "right" } })).toEqual({ reopen: [], prune: [], dashboard: "right" });
  });
});

describe("reopenNotice (Abend 19e)", () => {
  it("Sitzungen und Cockpit-Ansicht, Einzahl und Mehrzahl", () => {
    expect(reopenNotice(2, true)).toBe("Glasscockpit: 2 Sitzungen und die Cockpit-Ansicht wieder geöffnet");
    expect(reopenNotice(1, true)).toBe("Glasscockpit: 1 Sitzung und die Cockpit-Ansicht wieder geöffnet");
  });
  it("nur Cockpit-Ansicht", () => {
    expect(reopenNotice(0, true)).toBe("Glasscockpit: Cockpit-Ansicht wieder geöffnet");
  });
  it("nur Sitzungen: Text wie seit Abend 19c", () => {
    expect(reopenNotice(1, false)).toBe("Glasscockpit: 1 Sitzung wieder geöffnet");
    expect(reopenNotice(3, false)).toBe("Glasscockpit: 3 Sitzungen wieder geöffnet");
  });
});
