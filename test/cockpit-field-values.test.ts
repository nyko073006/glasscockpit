import { describe, expect, it } from "vitest";
import { type CockpitFeed } from "../src/core/cockpit-feed";
import { fieldValues } from "../src/core/cockpit-panels";
import type { RadarInput } from "../src/core/session-radar";

// Werte der neuen Flächen (Abend 18, Darstellung), reine Logik.

const NOW = new Date(2026, 9, 6, 12, 0, 0).getTime();
const DAY = 86_400_000;
const settings = { contextWarn: 150_000, contextHandoff: 175_000, tokensDayMedian: 340_000, tokensDayP90: 870_000, lintAfterDays: 7, lintCommand: "/lint" };

const sess = (o: Partial<RadarInput> & { id: string }): RadarInput => ({
  name: o.id, cwd: "/vault", running: true, failed: false, signal: null, signalAt: null, seen: false, ...o,
});
const feed = (o: Partial<CockpitFeed> = {}): CockpitFeed => ({
  sessions: [], active: null, tokensToday: null, focus: [], vault: null, repos: null,
  radars: [{ name: "Projekt-Monitor", lamp: "green" }, { name: "AV-Lager-Radar", lamp: "gray" }], unset: { projects: false, briefings: false, inbox: false, index: false, daily: false }, effort: "high", telegramOn: true, soundOn: true, day: null, handoffs: [], ...o,
});
const file = (tokens: number) => ({ sessionId: "s", contextTokens: tokens, usedPercentage: 50, model: "opus", writtenAt: NOW / 1000 - 120 });
const active = (tokens: number) => ({ id: "a", name: "Haupt", file: file(tokens) });

describe("fieldValues: Sitzungsradar", () => {
  it("Lampen, Reihenfolge, gekürzter Name und „+n“ ab sechs Sitzungen", () => {
    const sessions = [
      sess({ id: "1", name: "alpha", signal: "busy", signalAt: NOW }),
      sess({ id: "2", name: "beta", signal: "question", signalAt: NOW }),
      sess({ id: "3", name: "gamma", signal: "done", signalAt: NOW }),
      sess({ id: "4", name: "delta" }),
      sess({ id: "5", name: "epsilon", running: false }),
      sess({ id: "6", name: "ein sehr sehr langer Sitzungsname" }),
    ];
    const r = fieldValues(feed({ sessions }), settings, NOW).radar;
    expect(r.rows.map((x) => x.lamp)).toEqual(["question", "unseen", "busy", "idle", "idle"]);
    expect(r.rows).toHaveLength(5);
    expect(r.more).toBe("+1");
    expect(r.rows.every((x) => Array.from(x.name).length <= 18)).toBe(true);
    expect(r.sessions).toHaveLength(6);
    expect(r.sessions.find((s) => s.id === "6")?.name).toBe("ein sehr sehr langer Sitzungsname");
  });
  it("ohne Überlauf kein „+n“, ohne Sitzungen keine Zeilen", () => {
    expect(fieldValues(feed({ sessions: [sess({ id: "1" })] }), settings, NOW).radar.more).toBeNull();
    const r = fieldValues(feed(), settings, NOW).radar;
    expect(r.rows).toEqual([]);
    expect(r.more).toBeNull();
  });
  it("Zoom-Zeile trägt Ordner, Lampentext und Alter des letzten Signals", () => {
    const s = fieldValues(feed({ sessions: [sess({ id: "1", cwd: "/p/x", signal: "question", signalAt: NOW - 5 * 60_000 }), sess({ id: "2" })] }), settings, NOW).radar.sessions;
    expect(s[0]).toMatchObject({ id: "1", cwd: "/p/x", lamp: "question", lampText: "wartet auf dich", ageText: "vor 5 Min." });
    expect(s[1].ageText).toBeNull();
  });
});

describe("fieldValues: Fokus-Tafel", () => {
  it("höchstens zwei Zeilen, leer bei []", () => {
    expect(fieldValues(feed({ focus: ["a", "b", "c"] }), settings, NOW).focus).toEqual(["a", "b"]);
    expect(fieldValues(feed({ focus: [] }), settings, NOW).focus).toEqual([]);
  });

  it("Punkte bis 160 Zeichen bleiben ganz (zwei Punkte à etwa 120 Zeichen passen auf die Tafel), längere enden mit Auslassung", () => {
    const p1 = "Rückstandszahl für die Vorstellung am 08.10. erklärbar machen: Definition schriftlich festlegen, Erhebungsprotokoll aufsetzen.";
    expect(p1.length).toBeGreaterThan(120);
    expect(fieldValues(feed({ focus: [p1] }), settings, NOW).focus).toEqual([p1]);
    const exakt = "x".repeat(160);
    expect(fieldValues(feed({ focus: [exakt] }), settings, NOW).focus).toEqual([exakt]);
    const lang = fieldValues(feed({ focus: ["y".repeat(200)] }), settings, NOW).focus[0];
    expect([lang.length, lang.endsWith("…")]).toEqual([160, true]);
  });
});

describe("fieldValues: Rundinstrumente", () => {
  const left = (t: number | null) => fieldValues(feed({ active: t === null ? null : active(t) }), settings, NOW).gaugeLeft;
  it("Kontext: Grenzen genau an den Schwellen, Füllung gegen den Handoff", () => {
    expect(left(149_999).tone).toBe("green");
    expect(left(150_000).tone).toBe("yellow");
    expect(left(174_999).tone).toBe("yellow");
    expect(left(175_000).tone).toBe("red");
    expect(left(87_500).fill).toBeCloseTo(0.5);
    expect(left(400_000).fill).toBe(1);
  });
  it("nur rot pulsiert", () => {
    expect(left(150_000).pulse).toBe(false);
    expect(left(175_000).pulse).toBe(true);
  });
  it("Tooltip hat die Zahl deutsch formatiert", () => {
    expect(left(142_000).tooltip).toContain("142.000");
    expect(left(142_000).lines.join("\n")).toContain("150.000");
    expect(left(142_000).lines.join("\n")).toContain("175.000");
  });
  it("ohne Sitzungsdatei oder aktive Sitzung grau, Füllung 0, Tooltip ohne Zahl", () => {
    for (const f of [feed({ active: null }), feed({ active: { id: "a", name: "x", file: null } })]) {
      const g = fieldValues(f, settings, NOW).gaugeLeft;
      expect(g.tone).toBe("gray");
      expect(g.fill).toBe(0);
      expect(g.pulse).toBe(false);
      expect(g.tooltip).toMatch(/kein Stand/);
    }
  });
  it("Tokens: unter Median gelb, ab Median grün, ab p90 Regenbogen (Grenzen inklusive), Tooltip mit Zahl", () => {
    const right = (t: number | null) => fieldValues(feed({ tokensToday: t === null ? null : { tokens: t, asOf: NOW - 60_000 } }), settings, NOW).gaugeRight;
    expect(right(339_999).tone).toBe("yellow");
    expect(right(340_000).tone).toBe("green");
    expect(right(869_999).tone).toBe("green");
    expect(right(870_000).tone).toBe("rainbow");
    expect(right(870_001).tone).toBe("rainbow");
    expect(right(1_200_000).lines.join(" ")).toMatch(/Regenbogen ab p90 870\.000/);
    expect(right(435_000).fill).toBeCloseTo(0.5);
    expect(right(1_200_000).tooltip).toContain("1.200.000");
    expect(right(1_200_000).pulse).toBe(false);
    expect(right(null).tone).toBe("gray");
    expect(right(null).fill).toBe(0);
  });
});

describe("fieldValues: Vault-Lage", () => {
  const vault = (o: Partial<NonNullable<CockpitFeed["vault"]>> = {}) => ({ inbox: ["01 Inbox/a.md", "01 Inbox/b.md", "01 Inbox/c.md"], indexGeneratedAt: NOW - 9 * DAY, dailyToday: true, ...o });
  const lines = (v: CockpitFeed["vault"]) => fieldValues(feed({ vault: v }), settings, NOW).vault.lines;
  it("drei Zeilen: Inbox-Zahl, Index-Alter gelb ab lintAfterDays, Daily ja", () => {
    const l = lines(vault());
    expect(l).toHaveLength(3);
    expect(l[0]).toMatchObject({ label: "Inbox", value: "3" });
    expect(l[1]).toMatchObject({ label: "Index", value: "9 T", tone: "yellow" });
    expect(l[2]).toMatchObject({ label: "Daily", value: "ja", tone: "green" });
  });
  it("Index genau an der Grenze gelb, einen Tag davor nicht", () => {
    expect(lines(vault({ indexGeneratedAt: NOW - 7 * DAY }))[1].tone).toBe("yellow");
    expect(lines(vault({ indexGeneratedAt: NOW - 6 * DAY }))[1]).toMatchObject({ value: "6 T", tone: "plain" });
    expect(lines(vault({ indexGeneratedAt: NOW - 3_600_000 }))[1].value).toBe("heute");
  });
  it("Index ohne Datum und Daily nein sind grau", () => {
    const l = lines(vault({ indexGeneratedAt: null, dailyToday: false }));
    expect(l[1]).toMatchObject({ value: "?", tone: "gray" });
    expect(l[2]).toMatchObject({ value: "nein", tone: "gray" });
  });
  it("ohne Stand (null) alle drei Zeilen grau mit Strich, Inbox leer", () => {
    const v = fieldValues(feed({ vault: null }), settings, NOW).vault;
    expect(v.lines.map((x) => x.value)).toEqual(["–", "–", "–"]);
    expect(v.lines.every((x) => x.tone === "gray")).toBe(true);
    expect(v.inbox).toEqual([]);
  });
  it("Inbox-Pfade gehen unverändert in den Zoom", () => {
    expect(fieldValues(feed({ vault: vault() }), settings, NOW).vault.inbox).toEqual(["01 Inbox/a.md", "01 Inbox/b.md", "01 Inbox/c.md"]);
  });
});

describe("fieldValues: Repo-Ampel", () => {
  const clean = { dirty: false, ahead: 0, noUpstream: false };
  const repos = (r: CockpitFeed["repos"]) => fieldValues(feed({ repos: r }), settings, NOW).repos;
  it("0 grün, ab 1 gelb", () => {
    expect(repos([{ name: "a", status: clean }])).toMatchObject({ big: "0", tone: "green" });
    expect(repos([{ name: "a", status: { ...clean, dirty: true } }, { name: "b", status: clean }])).toMatchObject({ big: "1", tone: "yellow" });
    expect(repos([{ name: "a", status: { ...clean, ahead: 2 } }, { name: "b", status: { ...clean, dirty: true } }])).toMatchObject({ big: "2", tone: "yellow" });
  });
  it("null (nie gelaufen), leere Liste und nur Unbekannte sind grau", () => {
    expect(repos(null)).toMatchObject({ big: "–", tone: "gray", list: [] });
    expect(repos([])).toMatchObject({ big: "–", tone: "gray" });
    expect(repos([{ name: "a", status: null }])).toMatchObject({ tone: "gray" });
  });
  it("Zoom-Liste: Repos mit Handlungsbedarf zuerst, Zustand als Text", () => {
    const l = repos([
      { name: "ok", status: clean },
      { name: "x", status: null },
      { name: "dirty", status: { dirty: true, ahead: 2, noUpstream: false } },
      { name: "up", status: { dirty: false, ahead: 1, noUpstream: false } },
      { name: "noup", status: { dirty: false, ahead: 0, noUpstream: true } },
    ]).list;
    expect(l.map((x) => x.name)).toEqual(["dirty", "up", "ok", "noup", "x"]);
    expect(l[0].state).toBe("geändert, 2 Commits ohne Push");
    expect(l[1].state).toBe("1 Commit ohne Push");
    expect(l[2].state).toBe("sauber");
    expect(l[3].state).toBe("sauber, kein Upstream");
    expect(l[4].state).toBe("unbekannt");
  });
});

describe("fieldValues: Radare, Effort-Liste, Schalter", () => {
  it("zwei Lampen mit den Farben aus dem Feed", () => {
    const r = fieldValues(feed({ radars: [{ name: "Projekt-Monitor", lamp: "green" }, { name: "AV-Lager-Radar", lamp: "gray" }] }), settings, NOW).radars;
    expect(r.lamps.map((l) => [l.id, l.tone])).toEqual([["radar0", "green"], ["radar1", "gray"]]);
    expect(r.lamps.map((l) => l.short)).toEqual(["PR", "AV"]);
    const red = fieldValues(feed({ radars: [{ name: "Projekt-Monitor", lamp: "red" }, { name: "AV-Lager-Radar", lamp: "green" }] }), settings, NOW).radars;
    expect(red.lamps.map((l) => l.tone)).toEqual(["red", "green"]);
  });
  it("Effort-Liste (19b): die gewählte Stufe und die sechs Stufen von max oben bis aus unten (wie ein Schubhebel)", () => {
    expect(fieldValues(feed({ effort: "high" }), settings, NOW).effort).toEqual({ step: "high", steps: ["max", "xhigh", "high", "medium", "low", "aus"] });
    expect(fieldValues(feed({ effort: "aus" }), settings, NOW).effort.step).toBe("aus");
    expect(fieldValues(feed({ effort: "max" }), settings, NOW).effort.step).toBe("max");
  });
  it("Effort-Liste: jede Stufe kommt genau einmal vor und die gewählte steht darin", () => {
    for (const step of ["aus", "low", "medium", "high", "xhigh", "max"] as const) {
      const e = fieldValues(feed({ effort: step }), settings, NOW).effort;
      expect(new Set(e.steps).size).toBe(e.steps.length);
      expect(e.steps).toContain(e.step);
    }
  });
  it("Schalterstellung", () => {
    expect(fieldValues(feed({ telegramOn: true }), settings, NOW).telegram.on).toBe(true);
    expect(fieldValues(feed({ telegramOn: false }), settings, NOW).telegram.on).toBe(false);
    expect(fieldValues(feed({ soundOn: true }), settings, NOW).sound.on).toBe(true);
    expect(fieldValues(feed({ soundOn: false }), settings, NOW).sound.on).toBe(false);
  });
});

describe("fieldValues: LOC und Commits heute", () => {
  const day = (repos: Array<{ name: string; loc: number; commits: number }>) => ({
    loc: repos.reduce((a, r) => a + r.loc, 0), commits: repos.reduce((a, r) => a + r.commits, 0), repos,
  });
  it("ohne Daten: Strich und Hinweis", () => {
    const v = fieldValues(feed({ day: null }), settings, NOW);
    expect([v.loc.big, v.commits.big]).toEqual(["–", "–"]);
    expect(v.loc.tooltip).toBe("Noch keine Abfrage.");
    expect(v.commits.tooltip).toBe("Noch keine Abfrage.");
  });
  it("Zahl groß, Tausender als 1,2k, negativ mit Minus", () => {
    const v = (loc: number) => fieldValues(feed({ day: day([{ name: "a", loc, commits: 3 }]) }), settings, NOW);
    expect(v(842).loc.big).toBe("842");
    expect(v(1234).loc.big).toBe("1,2k");
    expect(v(-1234).loc.big).toBe("-1,2k");
    expect(v(842).commits.big).toBe("3");
  });
  it("Tooltip: bis zu fünf Repos, „Name: Wert“ je Zeile, höchster zuerst", () => {
    const repos = ["a", "b", "c", "d", "e", "f"].map((name, i) => ({ name, loc: (i + 1) * 10, commits: 6 - i }));
    const v = fieldValues(feed({ day: day(repos) }), settings, NOW);
    expect(v.loc.tooltip).toBe("f: 60\ne: 50\nd: 40\nc: 30\nb: 20");
    expect(v.commits.tooltip).toBe("a: 6\nb: 5\nc: 4\nd: 3\ne: 2");
  });
  it("Abfrage gelaufen, aber nichts committet: 0 und Hinweis", () => {
    const v = fieldValues(feed({ day: day([{ name: "a", loc: 0, commits: 0 }]) }), settings, NOW);
    expect([v.loc.big, v.commits.big]).toEqual(["0", "0"]);
    expect(v.loc.tooltip).toBe("Heute noch keine Commits.");
  });
});

describe("Feld Neue Sitzung (Abend 19h)", () => {
  const h = (project: string) => ({ project, path: `P/${project}/Handoffs/a.md`, created: "2026-01-01", task: "", repo: null });
  it("zeigt die Zahl offener Handoffs", () => {
    expect(fieldValues(feed({ handoffs: [h("A"), h("B")] }), settings, NOW).newSession).toEqual({ hint: "2 offen" });
  });
  it("zeigt auch bei genau einem Handoff die Zahl", () => {
    expect(fieldValues(feed({ handoffs: [h("A")] }), settings, NOW).newSession).toEqual({ hint: "1 offen" });
  });
  it("ohne offene Handoffs kein Hinweis", () => {
    expect(fieldValues(feed({ handoffs: [] }), settings, NOW).newSession).toEqual({ hint: "" });
  });
});
