import { describe, expect, it } from "vitest";
import {
  type CockpitInputs, FIELDS, FIELD_TITLES, type FieldId, IMAGE_H, IMAGE_W, PANELS, PANEL_TITLES, VIEW_CROP, ampel, clip, polygonCss, researchForPanel, panelValues, shortDate,
  stagePlacement, viewAspect, viewRect, zoomTargets,
  type PanelId, type Point, type Rect,
} from "../src/core/cockpit-panels";
import * as panelsModule from "../src/core/cockpit-panels";
import type { RepoItem, ResearchCache } from "../src/core/research";
import { localDayKey } from "../src/core/vault-state";

// Geometrie, Instrumentenwerte und Ampel der Cockpit-Ansicht (Abend 15), reine Logik.

const near = (a: number, b: number, tol = 0.1) => Math.abs(a - b) <= tol;
const panel = (id: PanelId) => {
  const p = PANELS.find((x) => x.id === id);
  if (!p) throw new Error(`Fläche ${id} fehlt`);
  return p;
};

describe("ampel", () => {
  it("unter 70 grün, unter 90 gelb, sonst rot (Grenzen)", () => {
    expect(ampel(0)).toBe("green");
    expect(ampel(69)).toBe("green");
    expect(ampel(69.9)).toBe("green");
    expect(ampel(70)).toBe("yellow");
    expect(ampel(89)).toBe("yellow");
    expect(ampel(89.9)).toBe("yellow");
    expect(ampel(90)).toBe("red");
    expect(ampel(100)).toBe("red");
  });

  it("ohne Stand grau", () => {
    expect(ampel(null)).toBe("gray");
    expect(ampel(undefined)).toBe("gray");
    expect(ampel(Number.NaN)).toBe("gray");
  });
});

describe("Geometrie der Flächen", () => {
  const rect = (r: Rect) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
  const overlap = (a: Rect, b: Rect) => {
    const p = rect(a);
    const q = rect(b);
    return p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
  };

  it("Bildmaße des zugeschnittenen Hintergrunds", () => {
    expect([IMAGE_W, IMAGE_H]).toEqual([1536, 1942]);
  });

  it("die acht Flächen stehen in Prozent wie in der Bauanleitung gemessen (der Skills-Schirm ist seit 19b der Effort-Bildschirm)", () => {
    const sollwerte: Array<[PanelId, number, number, number, number]> = [
      ["briefing", 23.4, 4.2, 24.0, 17.6],
      ["usage", 52.7, 4.2, 24.0, 17.6],
      ["tasks", 4.4, 10.8, 17.2, 29.7],
      ["research", 78.5, 10.8, 17.2, 29.7],
      ["system", 61.2, 56.3, 11.1, 9.4],
      ["lamp-pull", 31.1, 49.4, 7.9, 3.7],
      ["week", 40.36, 48.66, 19.27, 2.32],
      ["warnings", 76.56, 75.59, 7.62, 4.58],
    ];
    expect(PANELS.map((p) => p.id).sort()).toEqual(sollwerte.map((s) => s[0]).sort());
    for (const [id, x, y, w, h] of sollwerte) {
      const r = panel(id).rect;
      expect([id, near(r.x, x), near(r.y, y), near(r.w, w), near(r.h, h)]).toEqual([id, true, true, true, true]);
    }
  });

  it("alles liegt in 0 bis 100 Prozent der Bühne", () => {
    for (const p of PANELS) {
      expect(p.rect.x).toBeGreaterThanOrEqual(0);
      expect(p.rect.y).toBeGreaterThanOrEqual(0);
      expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(100);
      expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(100);
    }
    for (const f of FIELDS) {
      expect([f.id, f.rect.x >= 0, f.rect.y >= 0, f.rect.x + f.rect.w <= 100, f.rect.y + f.rect.h <= 100]).toEqual([f.id, true, true, true, true]);
    }
  });

  it("keine Überlappung der Flächen untereinander", () => {
    const alle: Array<[string, Rect]> = PANELS.map((p) => [p.id, p.rect] as [string, Rect]);
    expect(alle.length).toBe(8);
    for (let i = 0; i < alle.length; i++) {
      for (let j = i + 1; j < alle.length; j++) {
        expect([alle[i][0], alle[j][0], overlap(alle[i][1], alle[j][1])]).toEqual([alle[i][0], alle[j][0], false]);
      }
    }
  });
});

describe("Panel „skills“ ist entfernt (Abend 19b)", () => {
  it("weder Fläche noch Titel noch Instrumentenwert; die Skill-Karte (CardId) und der Launcher bleiben", () => {
    expect(PANELS.some((p) => (p.id as string) === "skills")).toBe(false);
    expect(Object.keys(PANEL_TITLES)).not.toContain("skills");
    expect(Object.keys(panelValues(inputs(), clock))).not.toContain("skills");
    expect(PANELS.map((p) => p.id)).toHaveLength(8);
  });
  it("kein Panel zoomt mehr auf die Skill-Karte", () => {
    for (const p of PANELS) expect([p.id, zoomTargets(p.id).includes("skills")]).toEqual([p.id, false]);
  });
});

describe("clip-path-Polygone", () => {
  const area = (pts: readonly Point[]) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2 / 10000; // Anteil an der Fläche des Rechtecks (0 bis 1)
  };
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const segmentsCross = (p1: Point, p2: Point, p3: Point, p4: Point) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };

  it("jede Fläche hat 4 bis 8 Punkte, alle in 0 bis 100 Prozent der Fläche", () => {
    for (const p of PANELS) {
      expect(p.polygon.length).toBeGreaterThanOrEqual(4);
      expect(p.polygon.length).toBeLessThanOrEqual(8);
      for (const [x, y] of p.polygon) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
    }
  });

  it("Polygone schneiden sich nicht selbst", () => {
    for (const p of PANELS) {
      const n = p.polygon.length;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (j === i + 1 || (i === 0 && j === n - 1)) continue;
          expect([p.id, i, j, segmentsCross(p.polygon[i], p.polygon[(i + 1) % n], p.polygon[j], p.polygon[(j + 1) % n])]).toEqual([p.id, i, j, false]);
        }
      }
    }
  });

  it("Flächenanteil passt zum gemessenen Füllgrad (Briefing und Usage 0,73; Aufgaben und Research 0,58 bis zur Rahmenkante oben; MFD 1,0)", () => {
    const soll: Array<[PanelId, number]> = [["briefing", 0.73], ["usage", 0.73], ["tasks", 0.58], ["research", 0.58], ["system", 1]];
    for (const [id, fill] of soll) {
      const a = area(panel(id).polygon);
      expect([id, Math.abs(a - fill) <= 0.04]).toEqual([id, true]);
    }
  });

  it("die vier großen Flächen sind schräg, das System-MFD ein Rechteck", () => {
    for (const id of ["briefing", "usage", "tasks", "research"] as const) expect(area(panel(id).polygon)).toBeLessThan(0.8);
    expect(panel("system").polygon.length).toBe(4);
  });

  it("der Textbereich jeder Fläche liegt ganz im Polygon (nichts läuft über die Schräge)", () => {
    const inside = (pt: Point, poly: readonly Point[]) => {
      let in_ = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) in_ = !in_;
      }
      return in_;
    };
    for (const p of PANELS) {
      const c = p.content;
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(100);
      expect(c.y + c.h).toBeLessThanOrEqual(100);
      const ecken: Point[] = [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]];
      for (const e of ecken) expect([p.id, e, inside(e, p.polygon)]).toEqual([p.id, e, true]);
    }
  });

  it("polygonCss schreibt Prozentpaare", () => {
    expect(polygonCss([[0, 0], [100, 0], [50.5, 99.7]])).toBe("polygon(0% 0%, 100% 0%, 50.5% 99.7%)");
  });
});

describe("Tastenfeld ist entfernt (Abend 18b)", () => {
  it("das Modul bietet weder KEYS noch KeySpec-Daten mehr an", () => {
    expect((panelsModule as Record<string, unknown>).KEYS).toBeUndefined();
  });
});

describe("researchForPanel", () => {
  const mk = (): ResearchCache => ({
    fetched_at: NOW,
    sections: [
      { query: "alt", sort: "stars", count: 8, fetched_at: NOW, items: [repo(1, "alpha"), repo(2, "beta")] },
      { query: "neu", sort: "stars", count: 8, fetched_at: NOW, items: [repo(3, "gamma")] },
    ],
    seen: [],
  });
  it("zählt nur Abschnitte der Suchen aus den Einstellungen (entfernte Suche fällt weg)", () => {
    const c = researchForPanel(mk(), "neu | stars | 8");
    expect(c?.sections.map((x) => x.query)).toEqual(["neu"]);
    expect(panelValues(inputs({ research: c }), clock).research.big).toBe("1");
  });
  it("null bleibt null", () => {
    expect(researchForPanel(null, "neu | stars | 8")).toBeNull();
  });
});

describe("Zoom-Ziele", () => {
  it("jede Zoom-Fläche öffnet ihre volle Karte", () => {
    expect(zoomTargets("briefing")).toEqual(["briefing"]);
    expect(zoomTargets("usage")).toEqual(["usage"]);
    expect(zoomTargets("tasks")).toEqual(["tasks"]);
    expect(zoomTargets("research")).toEqual(["research"]);
  });
  it("System und Pull-Lampe öffnen nur noch den Kopf mit „Jetzt pullen“ (kein Briefing mehr dazu)", () => {
    expect(zoomTargets("system")).toEqual(["pull"]);
    expect(zoomTargets("lamp-pull")).toEqual(["pull"]);
  });
  it("Woche und Warnungen öffnen die Usage-Karte", () => {
    expect(zoomTargets("week")).toEqual(["usage"]);
    expect(zoomTargets("warnings")).toEqual(["usage"]);
  });
});

describe("Hilfen", () => {
  it("shortDate: JJJJ-MM-TT wird TT.MM.", () => {
    expect(shortDate("2026-10-05")).toBe("05.10.");
    expect(shortDate("kaputt")).toBe("kaputt");
  });
  it("clip kürzt mit Auslassungszeichen auf genau max Zeichen", () => {
    expect(clip("kurz", 10)).toBe("kurz");
    expect(clip("1234567890", 10)).toBe("1234567890");
    expect(clip("12345678901", 10)).toBe("123456789…");
  });
});

// ---- Instrumentenwerte ----

const NOW = Date.UTC(2026, 9, 5, 19, 0, 0);
const clock = () => "21:20";
const repo = (id: number, name: string): RepoItem => ({ id, full_name: `own/${name}`, html_url: `https://github.com/own/${name}`, stargazers_count: 10, description: "", pushed_at: "2026-10-04T10:00:00Z" });
const cache = (items: RepoItem[], seen: number[] = []): ResearchCache => ({
  fetched_at: NOW,
  sections: [{ query: "q", sort: "stars", count: 8, fetched_at: NOW, items }],
  seen,
});
function inputs(o: Partial<CockpitInputs> = {}): CockpitInputs {
  return {
    now: NOW,
    briefing: { kind: "ok", date: localDayKey(NOW) },
    usage: {
      snapshot: {
        writtenAt: NOW / 1000 - 30,
        windows: {
          five_hour: { usedPercentage: 42, resetsAt: NOW / 1000 + 2 * 3600 + 13 * 60 },
          seven_day: { usedPercentage: 38, resetsAt: NOW / 1000 + 3 * 86400 },
        },
      },
    },
    tasks: {
      kind: "ok",
      rows: [
        { kind: "heading", line: 0, level: 1, text: "Heute" },
        { kind: "task", line: 2, text: "Erste", done: false, depth: 0 },
        { kind: "task", line: 3, text: "Zweite [[Ziel|Alias]]", done: false, depth: 0 },
        { kind: "task", line: 4, text: "Erledigt", done: true, depth: 0 },
        { kind: "task", line: 5, text: "Dritte", done: false, depth: 1 },
      ],
    },
    research: cache([repo(1, "alpha"), repo(2, "beta"), repo(3, "gamma")], [3]),
    pull: { status: "ok", at: NOW, error: null },
    ...o,
  };
}

describe("panelValues: Briefing (19b: nur das Datum)", () => {
  it("nur das Datum groß, keine Überschrift und keine Zeile darunter (die Inhalte zeigt der Tagesfokus)", () => {
    const heute = localDayKey(NOW);
    expect(panelValues(inputs(), clock).briefing).toEqual({ big: shortDate(heute), lines: [], tone: "plain" });
  });
  it("von heute neutral, jedes andere Datum gelb (gestern, morgen, vor Wochen)", () => {
    const at = (date: string) => panelValues(inputs({ briefing: { kind: "ok", date } }), clock).briefing;
    expect(at(localDayKey(NOW)).tone).toBe("plain");
    expect(at(localDayKey(NOW - 86_400_000)).tone).toBe("yellow");
    expect(at(localDayKey(NOW + 86_400_000)).tone).toBe("yellow");
    expect(at("2026-10-01")).toEqual({ big: "01.10.", lines: [], tone: "yellow" });
  });
  it("lädt noch", () => {
    expect(panelValues(inputs({ briefing: null }), clock).briefing).toMatchObject({ big: "…", tone: "gray" });
  });
  it("Ordner fehlt, keine Briefings", () => {
    expect(panelValues(inputs({ briefing: { kind: "missing" } }), clock).briefing).toMatchObject({ big: "–", lines: ["Ordner fehlt"], tone: "gray" });
    expect(panelValues(inputs({ briefing: { kind: "ok", date: null } }), clock).briefing).toMatchObject({ big: "–", lines: ["keine Briefings"], tone: "gray" });
  });
});

describe("panelValues: Usage (19b: nur das 5h-Fenster)", () => {
  it("5h-Prozent groß als Ampel und die Restzeit; nichts von Woche und Tokens (die zeigen der Balken und OUT)", () => {
    const v = panelValues(inputs(), clock).usage;
    expect(v).toEqual({ big: "42 %", lines: ["noch 2:13"], tone: "green" });
    expect(v.lines.join(" ")).not.toMatch(/Woche|heute|Tokens|\bk\b/);
  });
  it("Ampelgrenzen kommen bei der Fläche an: 70 gelb, 90 rot", () => {
    const at = (p: number) => inputs({ usage: { snapshot: { writtenAt: null, windows: { five_hour: { usedPercentage: p, resetsAt: NOW / 1000 + 600 } } } } });
    expect(panelValues(at(69), clock).usage.tone).toBe("green");
    expect(panelValues(at(70), clock).usage.tone).toBe("yellow");
    expect(panelValues(at(89), clock).usage.tone).toBe("yellow");
    expect(panelValues(at(90), clock).usage.tone).toBe("red");
  });
  it("ohne Schnappschuss grau, nur „kein Stand“", () => {
    expect(panelValues(inputs({ usage: { snapshot: null } }), clock).usage).toEqual({ big: "–", lines: ["kein Stand"], tone: "gray" });
  });
  it("zurückgesetztes Fenster: keine alte Zahl, grau", () => {
    const v = panelValues(inputs({ usage: { snapshot: { writtenAt: null, windows: { five_hour: { usedPercentage: 95, resetsAt: NOW / 1000 - 5 } } } } }), clock).usage;
    expect(v).toEqual({ big: "–", lines: ["zurückgesetzt"], tone: "gray" });
  });
  it("ohne 5h-Fenster (nur die Woche da): „kein 5h-Stand“, die Woche steht nicht hier", () => {
    const v = panelValues(inputs({ usage: { snapshot: { writtenAt: null, windows: { seven_day: { usedPercentage: 50, resetsAt: NOW / 1000 + 86400 } } } } }), clock).usage;
    expect(v).toEqual({ big: "–", lines: ["kein 5h-Stand"], tone: "gray" });
  });
  it("die Eingaben der Usage-Fläche kennen keine Tokens mehr (OUT zeigt sie aus dem Feed)", () => {
    expect(Object.keys(inputs().usage)).toEqual(["snapshot"]);
  });
});

describe("panelValues: Aufgaben", () => {
  it("Zahl offen groß, die ersten drei offenen darunter (Wikilinks als Alias)", () => {
    const v = panelValues(inputs(), clock).tasks;
    expect(v.big).toBe("3");
    expect(v.lines).toEqual(["Erste", "Zweite Alias", "Dritte"]);
  });
  it("mehr als drei: nur drei Zeilen; lange Texte gekürzt", () => {
    const rows = ["a", "b", "c", "d", "x".repeat(40)].map((t, i) => ({ kind: "task" as const, line: i, text: t, done: false, depth: 0 }));
    const v = panelValues(inputs({ tasks: { kind: "ok", rows } }), clock).tasks;
    expect(v.big).toBe("5");
    expect(v.lines).toEqual(["a", "b", "c"]);
    const lang = panelValues(inputs({ tasks: { kind: "ok", rows: rows.slice(4) } }), clock).tasks.lines[0];
    expect(lang.length).toBe(24);
    expect(lang.endsWith("…")).toBe(true);
  });
  it("alles erledigt, leere Liste, fehlende Datei, lädt noch", () => {
    const done = [{ kind: "task" as const, line: 1, text: "x", done: true, depth: 0 }];
    expect(panelValues(inputs({ tasks: { kind: "ok", rows: done } }), clock).tasks).toMatchObject({ big: "0", lines: ["alles erledigt"] });
    expect(panelValues(inputs({ tasks: { kind: "ok", rows: [] } }), clock).tasks).toMatchObject({ big: "0", lines: ["keine Aufgaben"] });
    expect(panelValues(inputs({ tasks: { kind: "missing" } }), clock).tasks).toMatchObject({ big: "–", lines: ["fehlt"], tone: "gray", hint: "Aufgabenliste fehlt" });
    expect(panelValues(inputs({ tasks: null }), clock).tasks).toMatchObject({ big: "…", tone: "gray" });
  });
});

describe("panelValues: Research", () => {
  it("Zahl neu groß, die ersten zwei neuen Repos (nur der Repo-Name)", () => {
    const v = panelValues(inputs(), clock).research;
    expect(v.big).toBe("2");
    expect(v.lines).toEqual(["alpha", "beta"]);
  });
  it("nichts neu: 0 und der Hinweis „nichts neu“", () => {
    const v = panelValues(inputs({ research: cache([repo(1, "alpha"), repo(2, "beta"), repo(3, "gamma")], [1, 2, 3]) }), clock).research;
    expect(v.big).toBe("0");
    expect(v.lines).toEqual(["nichts neu"]);
  });
  it("ein Repo in zwei Abschnitten zählt einmal", () => {
    const c = cache([repo(1, "alpha")]);
    c.sections.push({ query: "p", sort: "updated", count: 8, fetched_at: NOW, items: [repo(1, "alpha"), repo(9, "zeta")] });
    const v = panelValues(inputs({ research: c }), clock).research;
    expect(v.big).toBe("2");
    expect(v.lines).toEqual(["alpha", "zeta"]);
  });
  it("lädt noch, kein Stand", () => {
    expect(panelValues(inputs({ research: null }), clock).research).toMatchObject({ big: "…", tone: "gray" });
    expect(panelValues(inputs({ research: { fetched_at: null, sections: [], seen: [] } }), clock).research).toMatchObject({ big: "–", lines: ["kein Stand"] });
  });
});

describe("panelValues: System (MFD rechts) und Lampen", () => {
  it("Pull ok mit Zeit, ohne Sitzungszahl (die zeigt der Radar), Lampen grün", () => {
    const v = panelValues(inputs(), clock);
    expect(v.system).toEqual({ big: "OK", tone: "green", lines: ["Pull 21:20"] });
    expect(v.lampPull).toBe("green");
  });
  it("Pull-Fehler rot", () => {
    const v = panelValues(inputs({ pull: { status: "error", at: NOW, error: "x" } }), clock);
    expect(v.system).toMatchObject({ big: "FEHLER", tone: "red" });
    expect(v.lampPull).toBe("red");
  });
  it("kein Repo, noch nicht gelaufen, läuft: grau", () => {
    for (const status of ["no-repo", "idle", "running"] as const) {
      expect(panelValues(inputs({ pull: { status, at: null, error: null } }), clock).lampPull).toBe("gray");
    }
    expect(panelValues(inputs({ pull: { status: "no-repo", at: NOW, error: null } }), clock).system).toEqual({ big: "KEIN REPO", lines: [], tone: "gray" });
    expect(panelValues(inputs({ pull: { status: "idle", at: null, error: null } }), clock).system.lines).toEqual(["noch nicht gepullt"]);
    expect(panelValues(inputs({ pull: { status: "running", at: null, error: null } }), clock).system.lines).toEqual(["pullt"]);
  });
  it("keine Sitzungszahl mehr, in keinem Zustand (Doppelanzeige zum Radar)", () => {
    for (const status of ["ok", "error", "running", "no-repo", "idle"] as const) {
      const s = panelValues(inputs({ pull: { status, at: NOW, error: null } }), clock).system;
      expect([status, s.lines.join(" ")]).toEqual([status, expect.not.stringMatching(/Sitzung/)]);
    }
    expect("sessions" in inputs()).toBe(false);
  });
  it("die Usage-Lampe ist weg (19d): kein Panel, kein Titel, kein Wert; die Usage-Scheibe trägt die 5h-Ampel weiter", () => {
    expect(PANELS.map((p) => p.id as string)).not.toContain("lamp-usage");
    expect(Object.keys(PANEL_TITLES)).not.toContain("lamp-usage");
    expect("lampUsage" in panelValues(inputs(), clock)).toBe(false);
    expect(Object.keys(panelValues(inputs(), clock)).sort()).toEqual(["briefing", "lampPull", "research", "system", "tasks", "usage", "warnings", "week"]);
    expect(panelValues(inputs(), clock).usage.tone).toBe("green");
    expect(panelValues(inputs({ usage: { snapshot: null } }), clock).usage.tone).toBe("gray");
  });
  it("die Pull-Lampe steht unverändert an ihrer Stelle (Rect, Umriss, Textfeld), auch ohne die Usage-Lampe", () => {
    const lamp = panel("lamp-pull");
    const r2 = (v: number) => Math.round(v * 100) / 100;
    expect(lamp.rect).toEqual({ x: r2((478 / IMAGE_W) * 100), y: r2((959 / IMAGE_H) * 100), w: r2((121 / IMAGE_W) * 100), h: r2((72 / IMAGE_H) * 100) });
    expect(lamp.polygon).toEqual([[94, 0], [100, 0], [100, 100], [0, 100], [0, 86], [38, 24], [53, 11]]);
    expect(lamp.content).toEqual({ x: 55, y: 35, w: 40, h: 55 });
  });

});

describe("panelValues: Woche", () => {
  const win = (p: number, sec = 3 * 86400) => ({ usedPercentage: p, resetsAt: NOW / 1000 + sec });
  const snap = (windows: NonNullable<CockpitInputs["usage"]["snapshot"]>["windows"]) =>
    inputs({ usage: { snapshot: { writtenAt: null, windows } } });

  it("Prozent groß, Reset-Zeit, Ampel und Balken", () => {
    const v = panelValues(inputs(), clock).week;
    expect(v).toEqual({ big: "38 %", lines: ["Reset 3 T 0 Std"], tone: "green", bar: 38 });
  });
  it("Restzeit kurz, damit sie in den Balken passt: ab einem Tag T und Std, darunter h:mm (Vorschau 06.10.2026)", () => {
    expect(panelValues(snap({ seven_day: win(10, 6 * 86400 + 23 * 3600 + 59 * 60) }), clock).week.lines).toEqual(["Reset 6 T 23 Std"]);
    expect(panelValues(snap({ seven_day: win(10, 86400) }), clock).week.lines).toEqual(["Reset 1 T 0 Std"]);
    expect(panelValues(snap({ seven_day: win(10, 86399) }), clock).week.lines).toEqual(["Reset 23:59"]);
    expect(panelValues(snap({ seven_day: win(10, 5 * 60) }), clock).week.lines).toEqual(["Reset 0:05"]);
  });
  it("kein Stand: Strich, grau, leerer Balken", () => {
    const v = panelValues(inputs({ usage: { snapshot: null } }), clock).week;
    expect(v).toEqual({ big: "–", lines: ["kein Stand"], tone: "gray", bar: 0 });
  });
  it("kein Wochenfenster", () => {
    expect(panelValues(snap({ five_hour: win(10, 600) }), clock).week).toEqual({ big: "–", lines: ["kein Wochenstand"], tone: "gray", bar: 0 });
  });
  it("abgelaufen: zurückgesetzt, leerer Balken", () => {
    expect(panelValues(snap({ seven_day: win(80, -5) }), clock).week).toEqual({ big: "–", lines: ["zurückgesetzt"], tone: "gray", bar: 0 });
  });
  it("Schwellen 69, 70, 89, 90 kommen als Ampel an, der Balken trägt die Prozent", () => {
    const at = (p: number) => panelValues(snap({ seven_day: win(p) }), clock).week;
    expect([at(69).tone, at(70).tone, at(89).tone, at(90).tone]).toEqual(["green", "yellow", "yellow", "red"]);
    expect([at(69).bar, at(90).bar]).toEqual([69, 90]);
  });
});

describe("panelValues: Warnungen (19b: die Folge statt der Prozente)", () => {
  const win = (p: number, sec = 600) => ({ usedPercentage: p, resetsAt: NOW / 1000 + sec });
  const snap = (windows: NonNullable<CockpitInputs["usage"]["snapshot"]>["windows"]) =>
    inputs({ usage: { snapshot: { writtenAt: null, windows } } });
  const w = (windows: NonNullable<CockpitInputs["usage"]["snapshot"]>["windows"]) => panelValues(snap(windows), clock).warnings;

  it("kein Stand: grau", () => {
    expect(panelValues(inputs({ usage: { snapshot: null } }), clock).warnings).toEqual({ big: "", lines: ["kein Stand"], tone: "gray" });
  });
  it("unter der Schwelle: keine, grün", () => {
    expect(w({ five_hour: win(69), seven_day: win(10) })).toEqual({ big: "", lines: ["keine"], tone: "green" });
  });
  it("Schwellen 69, 70, 89, 90 je Fenster; die Zeile nennt die Folge („knapp“), nie eine Prozentzahl", () => {
    expect(w({ five_hour: win(70) })).toEqual({ big: "", lines: ["5h knapp"], tone: "yellow" });
    expect(w({ five_hour: win(89) }).tone).toBe("yellow");
    expect(w({ five_hour: win(90) })).toEqual({ big: "!", lines: ["5h knapp"], tone: "red" });
    expect(w({ seven_day: win(69) }).lines).toEqual(["keine"]);
    expect(w({ seven_day: win(70) })).toEqual({ big: "", lines: ["Woche knapp"], tone: "yellow" });
  });
  it("keine Prozentzahl in den Zeilen, bei keinem Stand der Fenster (die Zahlen stehen im Zoom, in der Usage-Karte)", () => {
    for (const p of [70, 75, 89, 90, 95, 100]) {
      expect([p, w({ five_hour: win(p), seven_day: win(p) }).lines.join(" ")]).toEqual([p, expect.not.stringMatching(/%/)]);
    }
  });
  it("beide Fenster: Reihenfolge 5h, Woche; schlimmster Ton gewinnt", () => {
    expect(w({ five_hour: win(75), seven_day: win(95) })).toEqual({ big: "!", lines: ["5h knapp", "Woche knapp"], tone: "red" });
    expect(w({ five_hour: win(95), seven_day: win(72) })).toEqual({ big: "!", lines: ["5h knapp", "Woche knapp"], tone: "red" });
  });
  it("kritisch heißt rot: nur dann ein Ausrufezeichen, bei gelb und grün nicht (Wunsch 06.10.2026)", () => {
    expect(w({ seven_day: win(90) }).big).toBe("!");
    expect(w({ five_hour: win(89), seven_day: win(89) }).big).toBe("");
    expect(w({ five_hour: win(10) }).big).toBe("");
    expect(panelValues(inputs({ usage: { snapshot: null } }), clock).warnings.big).toBe("");
  });
  it("abgelaufene Fenster warnen nicht", () => {
    expect(w({ five_hour: win(95, -1), seven_day: win(80) })).toEqual({ big: "", lines: ["Woche knapp"], tone: "yellow" });
    expect(w({ five_hour: win(95, -1) })).toEqual({ big: "", lines: ["keine"], tone: "green" });
  });
});

// Neue Flächen aus Abend 18 (Geometrie am Bild nachgemessen): eigene Liste FIELDS neben PANELS. Seit 19b liegen Repos und Radare
// in der Konsole unter dem System-Display, und der Effort-Bildschirm sitzt auf dem Platz des früheren Skills-Schirms.
describe("neue Flächen (Abend 18): Geometrie", () => {
  const ids: FieldId[] = ["radar", "focus", "gaugeLeft", "gaugeRight", "vault", "repos", "radars", "effort", "telegram", "sound", "loc", "commits", "newSession"];
  const field = (id: FieldId) => {
    const f = FIELDS.find((x) => x.id === id);
    if (!f) throw new Error(`Fläche ${id} fehlt`);
    return f;
  };
  const px = (r: Rect): Rect => ({ x: (r.x / 100) * IMAGE_W, y: (r.y / 100) * IMAGE_H, w: (r.w / 100) * IMAGE_W, h: (r.h / 100) * IMAGE_H });
  const inside = (x: number, y: number, poly: readonly Point[]) => {
    let in_ = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) in_ = !in_;
    }
    return in_;
  };
  /** Bildpixel (Mitte des Pixels), die ein Polygon in Prozent der Fläche belegt. */
  const pixels = (rect: Rect, poly: readonly Point[]): Set<number> => {
    const r = px(rect);
    const set = new Set<number>();
    for (let y = Math.floor(r.y); y <= Math.ceil(r.y + r.h); y++) {
      for (let x = Math.floor(r.x); x <= Math.ceil(r.x + r.w); x++) {
        if (inside(((x + 0.5 - r.x) / r.w) * 100, ((y + 0.5 - r.y) / r.h) * 100, poly)) set.add(y * IMAGE_W + x);
      }
    }
    return set;
  };

  it("genau dreizehn neue Flächen, alle mit Titel, keine davon in PANELS", () => {
    expect(FIELDS.map((f) => f.id).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(FIELD_TITLES[id].length).toBeGreaterThan(0);
      expect(PANELS.some((p) => (p.id as string) === id)).toBe(false);
    }
  });

  it("liegen ungefähr dort, wo die Bauanleitung sie schätzt (Mitte ±50 px, Größe 0,6 bis 1,5fach)", () => {
    // x, y, b, h der Bauanleitung (Abend 18); die Rundinstrumente nur als Mitte
    const grob: Array<[FieldId, number, number, number, number]> = [
      ["radar", 630, 660, 280, 265],
      ["focus", 632, 994, 272, 202],
      ["vault", 640, 1270, 218, 168],
    ];
    for (const [id, x, y, w, h] of grob) {
      const r = px(field(id).rect);
      const ok = Math.abs(r.x + r.w / 2 - (x + w / 2)) <= 50 && Math.abs(r.y + r.h / 2 - (y + h / 2)) <= 50
        && r.w / w >= 0.6 && r.w / w <= 1.5 && r.h / h >= 0.6 && r.h / h <= 1.5;
      expect([id, ok]).toEqual([id, true]);
    }
    for (const [id, cx, cy] of [["gaugeLeft", 350, 1321], ["gaugeRight", 1198, 1321]] as const) {
      const r = px(field(id).rect);
      expect([id, Math.abs(r.x + r.w / 2 - cx) <= 20, Math.abs(r.y + r.h / 2 - cy) <= 20]).toEqual([id, true, true]);
    }
  });

  it("gemessene Bildpixel (x, y, Breite, Höhe) stehen fest; Kreise mit Mitte und Radius", () => {
    const gemessen: Array<[FieldId, number, number, number, number]> = [
      ["radar", 641, 668, 254, 255],
      ["focus", 632, 994, 272, 202],
      ["gaugeLeft", 322.5, 1293.4, 58, 58],
      ["gaugeRight", 1155.4, 1293.4, 58, 58],
      ["vault", 655, 1277, 227, 212],
      ["repos", 900, 1324, 158, 257],
      ["radars", 1048, 1324, 92, 257],
      ["effort", 425, 1094, 171, 182],
      ["telegram", 240, 1452, 53, 119],
      ["sound", 312, 1404, 53, 159],
      ["loc", 1157, 1140, 41, 57],
      ["commits", 1157, 1212, 49, 61],
      ["newSession", 699, 1498, 116, 83],
    ];
    for (const [id, x, y, w, h] of gemessen) {
      const r = px(field(id).rect);
      expect([id, near(r.x, x, 1.5), near(r.y, y, 1.5), near(r.w, w, 1.5), near(r.h, h, 1.5)]).toEqual([id, true, true, true, true]);
    }
    const l = px(field("gaugeLeft").rect);
    const rr = px(field("gaugeRight").rect);
    expect([near(l.x + l.w / 2, 351.5, 0.3), near(l.y + l.h / 2, 1322.4, 0.3), near(l.w / 2, 29, 0.3)]).toEqual([true, true, true]);
    expect([near(rr.x + rr.w / 2, 1184.4, 0.3), near(rr.y + rr.h / 2, 1322.4, 0.3)]).toEqual([true, true]);
  });

  it("die Rundinstrumente sind Kreise: gleich breit wie hoch, Radius gemessen, spiegelsymmetrisch", () => {
    for (const id of ["gaugeLeft", "gaugeRight"] as const) {
      const f = field(id);
      expect(f.circle).toBeDefined();
      const r = px(f.rect);
      expect(Math.abs(r.w - r.h)).toBeLessThanOrEqual(3);
      expect(r.w / 2).toBeGreaterThan(24);
      expect(r.w / 2).toBeLessThan(36);
      expect(f.circle).toEqual({ cx: 50, cy: 50, r: 50 });
    }
    const l = px(field("gaugeLeft").rect);
    const rr = px(field("gaugeRight").rect);
    expect(Math.abs(l.x + l.w / 2 + (rr.x + rr.w / 2) - IMAGE_W)).toBeLessThanOrEqual(6);
    expect(Math.abs(l.y - rr.y)).toBeLessThanOrEqual(2);
  });

  it("jede Fläche: Polygon in 0 bis 100 Prozent, ohne Selbstschnitt, deckt die Fläche, Text liegt ganz drin", () => {
    const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const cuts = (p1: Point, p2: Point, p3: Point, p4: Point) => {
      const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
      return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    };
    for (const f of FIELDS) {
      expect(f.polygon.length).toBeGreaterThanOrEqual(4);
      // der Knauf (newSession) ist rund und gewellt: 12 Ecken deckten nur 96,6 %, mit 20 sind es 99,2 %
      expect(f.polygon.length).toBeLessThanOrEqual(f.circle ? 48 : f.id === "newSession" ? 20 : 12);
      for (const [x, y] of f.polygon) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
      const n = f.polygon.length;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (j === i + 1 || (i === 0 && j === n - 1)) continue;
          expect([f.id, i, j, cuts(f.polygon[i], f.polygon[(i + 1) % n], f.polygon[j], f.polygon[(j + 1) % n])]).toEqual([f.id, i, j, false]);
        }
      }
      // am Bild gemessene Deckung (Polygon gegen Fläche im Bild, Schnittmenge durch Vereinigung), Messskript scripts/measure-fields.py
      expect([f.id, f.coverage >= 0.98 && f.coverage <= 1]).toEqual([f.id, true]);
      // Seit 19b ist jede Fläche gemessen, keine ein Entwurf (die Effort-Kulisse fiel mit dem Hebel weg)
      expect([f.id, "designed" in f]).toEqual([f.id, false]);
      const c = f.content;
      expect(c.w).toBeGreaterThan(0);
      expect(c.h).toBeGreaterThan(0);
      for (const [x, y] of [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]] as const) {
        expect([f.id, x, y, inside(x, y, f.polygon)]).toEqual([f.id, x, y, true]);
      }
    }
  });

  it("die Kreise haben ein Polygon aus 48 Punkten um ihre Mitte", () => {
    for (const id of ["gaugeLeft", "gaugeRight"] as const) {
      const f = field(id);
      expect(f.polygon.length).toBe(48);
      for (const [x, y] of f.polygon) expect(Math.abs(Math.hypot(x - 50, y - 50) - 50)).toBeLessThanOrEqual(0.2);
    }
  });

  // Seit 19b prüft der Überlappungstest PANELS und FIELDS gemeinsam: jedes Paar aus allen 21 Flächen, nicht nur Felder gegen Panels.
  type Belegt = [string, Set<number>, Rect];
  const belegung = (): Belegt[] => [
    ...PANELS.map((p) => [p.id, pixels(p.rect, p.polygon), p.rect] as Belegt),
    ...FIELDS.map((f) => [f.id, pixels(f.rect, f.polygon), f.rect] as Belegt),
  ];
  const gemeinsam = (a: Belegt, b: Belegt) => {
    if (!(a[2].x < b[2].x + b[2].w && b[2].x < a[2].x + a[2].w && a[2].y < b[2].y + b[2].h && b[2].y < a[2].y + a[2].h)) return 0;
    const [klein, gross] = a[1].size <= b[1].size ? [a[1], b[1]] : [b[1], a[1]];
    let n = 0;
    for (const v of klein) if (gross.has(v)) n++;
    return n;
  };

  it("keine Überlappung: jede Fläche aus PANELS und FIELDS gegen jede andere (Pixel im Bild)", () => {
    // Pixelmengen mit Umrandung: Paare, deren Rechtecke sich nicht berühren, haben keine gemeinsamen Pixel und werden übersprungen
    const alle = belegung();
    expect(alle).toHaveLength(PANELS.length + FIELDS.length);
    expect(alle).toHaveLength(21);
    for (const [, s] of alle) expect(s.size).toBeGreaterThan(300);
    for (let i = 0; i < alle.length; i++) {
      for (let j = i + 1; j < alle.length; j++) expect([alle[i][0], alle[j][0], gemeinsam(alle[i], alle[j])]).toEqual([alle[i][0], alle[j][0], 0]);
    }
  }, 30_000); // Pixelmengen aller Flächen: allein etwa 3 s, bei voller Suite über dem 5-s-Vorgabelimit

  it("Gegenprobe: der Überlappungstest schlägt an, wenn eine Fläche in eine andere rutscht (Panel in Panel, Feld in Panel, Feld in Feld)", () => {
    const rutsch = (a: { rect: Rect; polygon: readonly Point[] }, b: { rect: Rect; polygon: readonly Point[] }) => {
      const pa = pixels(a.rect, a.polygon);
      const pb = pixels({ ...b.rect, x: a.rect.x + 0.5 }, b.polygon);
      const bb: Belegt = ["b", pb, { ...b.rect, x: a.rect.x + 0.5 }];
      return gemeinsam(["a", pa, a.rect], bb);
    };
    expect(rutsch(panel("system"), panel("system"))).toBeGreaterThan(1000);
    expect(rutsch(panel("system"), field("effort"))).toBeGreaterThan(1000);
    expect(rutsch(field("effort"), field("effort"))).toBeGreaterThan(1000);
  });

  it("Repos und Radare liegen in der Konsole unter dem System-Display, rechts neben dem Vault-Display und links von Ring und Schlitzen; Repos links, Radare rechts", () => {
    const vault = px(field("vault").rect);
    const system = px(panel("system").rect);
    const ring = px(field("gaugeRight").rect);
    const repos = px(field("repos").rect);
    const radars = px(field("radars").rect);
    for (const r of [repos, radars]) {
      expect(r.x).toBeGreaterThanOrEqual(vault.x + vault.w + 15);
      expect(r.y).toBeGreaterThanOrEqual(system.y + system.h + 15);
      expect(r.x + r.w).toBeLessThanOrEqual(ring.x - 15);
    }
    expect(repos.x + repos.w / 2).toBeLessThan(radars.x + radars.w / 2);
    // die Konsole ist eine hohe Tafel: Repos und Radare sind hoch, nicht flach (anders als die frühere Seitenkonsole)
    expect(repos.h).toBeGreaterThan(repos.w);
    expect(radars.h).toBeGreaterThan(radars.w);
  });

  it("mindestens 15 Bildpixel Abstand (Rechteck zu Rechteck) von Repos und Radaren zu Vault, System, rechtem Ring, LOC und Commits", () => {
    const gap = (a: Rect, b: Rect) => {
      const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
      const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
      return Math.hypot(dx, dy);
    };
    const nachbarn: Array<[string, Rect]> = [
      ["vault", px(field("vault").rect)], ["system", px(panel("system").rect)], ["gaugeRight", px(field("gaugeRight").rect)],
      ["loc", px(field("loc").rect)], ["commits", px(field("commits").rect)],
    ];
    for (const id of ["repos", "radars"] as const) {
      for (const [name, r] of nachbarn) expect([id, name, gap(px(field(id).rect), r) >= 15]).toEqual([id, name, true]);
    }
  });

  it("der Fokus (focus) füllt die Tafel der Mittelkonsole: unter dem Querbalken Woche, zwischen den Lampen, über dem Vault", () => {
    const focus = px(field("focus").rect);
    const week = px(panel("week").rect);
    const lampL = px(panel("lamp-pull").rect);
    // Das rechte Mini-Display ist nur noch im Bild gezeichnet (kein Panel mehr, 19d); der Fokus darf es nicht überdecken: Bildpixel x 936, y 959, 122 × 72.
    const lampR: Rect = { x: 936, y: 959, w: 122, h: 72 };
    const vault = px(field("vault").rect);
    expect(focus.y).toBeGreaterThanOrEqual(week.y + week.h);
    expect(focus.y + focus.h).toBeLessThan(vault.y);
    expect(focus.x).toBeGreaterThan(lampL.x + lampL.w);
    expect(focus.x + focus.w).toBeLessThan(lampR.x);
    // Die Tafel ist groß genug für zwei mehrzeilige Punkte: Textrechteck mindestens 200 x 150 Bildpixel.
    const c = field("focus").content;
    expect([(c.w / 100) * focus.w >= 200, (c.h / 100) * focus.h >= 150]).toEqual([true, true]);
  });

  it("der Fokus verdeckt die vier in die Tafel gezeichneten Tastenkästen (Löcher gefüllt, Kästen liegen ganz im Polygon)", () => {
    const f = field("focus");
    const r = px(f.rect);
    // gezeichnete Kästen im Hintergrundbild (x, y, b, h) in Bildpixeln; sie sind eigene Komponenten der Tafel
    const kaesten: Array<[number, number, number, number]> = [[678, 1015, 86, 22], [780, 1015, 80, 22], [780, 1080, 80, 24], [780, 1141, 80, 26]];
    for (const [x, y, w, h] of kaesten) {
      for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as const) {
        expect([cx, cy, inside(((cx - r.x) / r.w) * 100, ((cy - r.y) / r.h) * 100, f.polygon)]).toEqual([cx, cy, true]);
      }
    }
  });

  it("der Knauf (newSession) sitzt mittig auf dem Schalthebel unter dem Vault: Mitte der Bühne, unter y 1488, ohne Berührung mit dem Vault", () => {
    const k = px(field("newSession").rect);
    const vault = px(field("vault").rect);
    // Knauf im Bild: x 700 bis 840, y 1494 bis 1600; die Fläche ist die dunkle Innenfläche des Kopfes
    expect([k.x >= 690, k.x + k.w <= 840, k.y >= 1494, k.y + k.h <= 1600]).toEqual([true, true, true, true]);
    expect(Math.abs(k.x + k.w / 2 - IMAGE_W / 2)).toBeLessThanOrEqual(40);
    expect(k.y).toBeGreaterThanOrEqual(vault.y + vault.h);
    // groß genug zum Treffen: Textrechteck (das Plus) mindestens 50 x 45 Bildpixel
    const c = field("newSession").content;
    expect([(c.w / 100) * k.w >= 50, (c.h / 100) * k.h >= 45]).toEqual([true, true]);
    // die Kontur des Knaufs (Kopf, Mitte und Ränder) liegt im Polygon
    const f = field("newSession");
    for (const [x, y] of [[757, 1540], [710, 1535], [805, 1535], [757, 1505], [757, 1575]] as const) {
      expect([x, y, inside(((x - k.x) / k.w) * 100, ((y - k.y) / k.h) * 100, f.polygon)]).toEqual([x, y, true]);
    }
  });

  it("Gegenprobe: ein um 40 Pixel nach unten verschobener Knauf liegt nicht mehr im Polygon", () => {
    const f = field("newSession");
    const k = px(f.rect);
    expect(inside(((757 - k.x) / k.w) * 100, ((1540 + 80 - k.y) / k.h) * 100, f.polygon)).toBe(false);
  });

  it("Effort ersetzt den Skills-Schirm: gleiches Rechteck (Bild 425/1094/171/182) und Rechteck-Polygon, links neben dem System-Schirm auf gleicher Höhe", () => {
    const e = field("effort");
    const r = px(e.rect);
    expect([near(r.x, 425, 1.5), near(r.y, 1094, 1.5), near(r.w, 171, 1.5), near(r.h, 182, 1.5)]).toEqual([true, true, true, true]);
    expect(e.polygon).toEqual([[0, 0], [100, 0], [100, 100], [0, 100]]);
    const sys = px(panel("system").rect);
    expect(r.x + r.w).toBeLessThan(sys.x);
    expect(r.w).toBeCloseTo(sys.w, 0);
    expect(r.h).toBeCloseTo(sys.h, 0);
    expect(Math.abs(r.y - sys.y)).toBeLessThanOrEqual(1.5);
  });

  it("Telegram- und Ton-Schalter liegen links vom Effort-Schirm, ohne ihn zu berühren", () => {
    const e = px(field("effort").rect);
    for (const id of ["telegram", "sound"] as const) {
      const t = px(field(id).rect);
      expect([id, t.x + t.w < e.x]).toEqual([id, true]);
    }
  });

  it("Ton-Schalter liegt rechts neben dem Telegram-Schalter, ohne ihn zu berühren", () => {
    const t = px(field("telegram").rect);
    const s = px(field("sound").rect);
    expect(s.x).toBeGreaterThan(t.x + t.w);
    expect(s.x).toBeLessThan(400);
    const tg = new Set(pixels(field("telegram").rect, field("telegram").polygon));
    for (const v of pixels(field("sound").rect, field("sound").polygon)) expect(tg.has(v)).toBe(false);
    expect(FIELD_TITLES.sound).toBe("Ton");
  });

  it("LOC und Commits liegen rechts über dem OUT-Ring, untereinander, ohne Ring und ohne einander zu berühren", () => {
    const ring = px(field("gaugeRight").rect);
    const l = px(field("loc").rect);
    const c = px(field("commits").rect);
    expect(l.y + l.h).toBeLessThan(c.y);
    expect(c.y + c.h).toBeLessThan(ring.y);
    for (const r of [l, c]) {
      expect(r.x).toBeGreaterThan(1100);
      expect(r.x + r.w).toBeLessThan(ring.x + ring.w);
    }
    const rg = new Set(pixels(field("gaugeRight").rect, field("gaugeRight").polygon));
    const lp = new Set(pixels(field("loc").rect, field("loc").polygon));
    for (const v of pixels(field("commits").rect, field("commits").polygon)) {
      expect(rg.has(v)).toBe(false);
      expect(lp.has(v)).toBe(false);
    }
    for (const v of lp) expect(rg.has(v)).toBe(false);
    expect([FIELD_TITLES.loc, FIELD_TITLES.commits]).toEqual(["LOC heute", "Commits heute"]);
  });

  it("der Effort-Schirm trägt sechs Zeilen: bei 640 px Pane im Ausschnitt ist jede Zeile mindestens 11 px hoch, das Textrechteck mindestens 60 px breit", () => {
    const f = field("effort");
    const r = px(f.rect);
    const scale = 640 / (VIEW_CROP.w / 100) / IMAGE_W; // Bühnenbreite = Pane-Breite durch den Breitenanteil des Ausschnitts
    const c = { w: ((f.content.w / 100) * r.w) * scale, h: ((f.content.h / 100) * r.h) * scale };
    expect(c.h / 6).toBeGreaterThanOrEqual(11);
    expect(c.w).toBeGreaterThanOrEqual(60);
  });
});

// Ausschnitt der Cockpit-Ansicht (Abend 19b): Die Geometrie bleibt in Prozent der vollen Bühne, VIEW_CROP ist ein Fenster darüber.
describe("Ausschnitt VIEW_CROP (Abend 19b)", () => {
  const px = (r: Rect): Rect => ({ x: (r.x / 100) * IMAGE_W, y: (r.y / 100) * IMAGE_H, w: (r.w / 100) * IMAGE_W, h: (r.h / 100) * IMAGE_H });
  /** Anteil der Rect-Fläche, der im Ausschnitt liegt (0 bis 1). */
  const insideShare = (r: Rect, view: Rect): number => {
    const w = Math.max(0, Math.min(r.x + r.w, view.x + view.w) - Math.max(r.x, view.x));
    const h = Math.max(0, Math.min(r.y + r.h, view.y + view.h) - Math.max(r.y, view.y));
    return (w * h) / (r.w * r.h);
  };
  /** Das Textrechteck einer Fläche in Prozent der Bühne. */
  const contentOnStage = (g: { rect: Rect; content: Rect }): Rect => ({
    x: g.rect.x + (g.content.x / 100) * g.rect.w, y: g.rect.y + (g.content.y / 100) * g.rect.h,
    w: (g.content.w / 100) * g.rect.w, h: (g.content.h / 100) * g.rect.h,
  });
  /** Angeschnitten dürfen nur die Scheiben oben und die Seitenscheiben (Aufgaben, Research). */
  const ALLOWED_CUT: readonly string[] = ["briefing", "usage", "tasks", "research"];
  const sichtbar = [...PANELS, ...FIELDS];

  it("Kanten in Bildpixeln: links 76, rechts 1460, oben 85, unten 1772; horizontal mittig (je 76 px, 4,95 % weg)", () => {
    const v = px(VIEW_CROP);
    expect([v.x, v.y, v.x + v.w, v.y + v.h].map(Math.round)).toEqual([76, 85, 1460, 1772]);
    expect(Math.abs(v.x - (IMAGE_W - (v.x + v.w)))).toBeLessThanOrEqual(0.5);
    expect(VIEW_CROP.x).toBeCloseTo(100 - (VIEW_CROP.x + VIEW_CROP.w), 2);
  });

  it("der Ausschnitt ist 1384 x 1687 Bildpixel groß (Breite gleich dem Foto, 90,1 % der Bühnenbreite)", () => {
    const v = px(VIEW_CROP);
    expect([Math.round(v.w), Math.round(v.h)]).toEqual([1384, 1687]);
  });

  it("der Ausschnitt hat das Hochformat der Pane 640 x 780 (Wunsch 07.10.2026: unten zurückholen, damit es passt)", () => {
    expect(viewAspect(VIEW_CROP)).toBeCloseTo(640 / 780, 3);
  });

  it("jede sichtbare Fläche liegt ganz im Ausschnitt; nur ALLOWED_CUT darf angeschnitten sein, mit mindestens 85 % der Rect-Fläche drin", () => {
    expect(sichtbar).toHaveLength(21);
    for (const f of sichtbar) {
      const share = insideShare(f.rect, VIEW_CROP);
      if (ALLOWED_CUT.includes(f.id)) expect([f.id, share >= 0.85]).toEqual([f.id, true]);
      else expect([f.id, share > 0.9999]).toEqual([f.id, true]);
    }
  });

  it("die Ausnahmeliste ist ehrlich: Jede Fläche darin gibt es und ist wirklich angeschnitten", () => {
    for (const id of ALLOWED_CUT) {
      const f = sichtbar.find((x) => x.id === id);
      expect([id, f !== undefined]).toEqual([id, true]);
      expect([id, insideShare(f!.rect, VIEW_CROP) < 0.9999]).toEqual([id, true]);
    }
  });

  it("angeschnitten wird nur der Rahmen, nie der Text: das Textrechteck jeder Fläche liegt ganz im Ausschnitt", () => {
    for (const f of sichtbar) expect([f.id, insideShare(contentOnStage(f), VIEW_CROP) > 0.9999]).toEqual([f.id, true]);
  });

  it("der Text hält mindestens 10 Bildpixel Abstand zu allen vier Rändern des Ausschnitts (kein Text klebt am Rand der Pane)", () => {
    const v = px(VIEW_CROP);
    for (const f of sichtbar) {
      const c = px(contentOnStage(f));
      const abstand = [c.x - v.x, v.x + v.w - (c.x + c.w), c.y - v.y, v.y + v.h - (c.y + c.h)];
      expect([f.id, Math.min(...abstand) >= 10]).toEqual([f.id, true]);
    }
  });

  it("Gegenprobe: eine Fläche unter der Unterkante wäre nicht mehr drin (der Test oben erkennt das)", () => {
    const tief: Rect = { x: 30, y: 90.5, w: 10, h: 2 }; // Unterkante des Ausschnitts bei 91,25 %
    expect(insideShare(tief, VIEW_CROP)).toBeLessThan(0.9999);
    expect(insideShare({ x: 30, y: 70, w: 10, h: 2 }, VIEW_CROP)).toBeGreaterThan(0.9999);
  });
});

describe("Ansicht und Fenster (Abend 19b)", () => {
  const full = (): Rect => ({ x: 0, y: 0, w: 100, h: 100 });

  it("viewRect: zugeschnitten ist VIEW_CROP, voll das ganze Bild", () => {
    expect(viewRect("crop")).toEqual(VIEW_CROP);
    expect(viewRect("full")).toEqual(full());
  });

  it("viewAspect: voll ist das Seitenverhältnis des Bilds, zugeschnitten das des Ausschnitts in Bildpixeln", () => {
    expect(viewAspect(viewRect("full"))).toBeCloseTo(IMAGE_W / IMAGE_H, 4);
    expect(viewAspect(VIEW_CROP)).toBeCloseTo(1384 / 1687, 3);
    expect(viewAspect({ x: 10, y: 10, w: 50, h: 25 })).toBeCloseTo((0.5 * IMAGE_W) / (0.25 * IMAGE_H), 6);
  });

  it("stagePlacement: voll füllt das Fenster ohne Versatz", () => {
    expect(stagePlacement(full())).toEqual({ width: 100, left: 0, top: 0 });
  });

  it("stagePlacement: zugeschnitten ist die Bühne um den Kehrwert des Breitenanteils größer als das Fenster und nach links oben verschoben", () => {
    const p = stagePlacement(VIEW_CROP);
    expect(p.width).toBeCloseTo(10000 / VIEW_CROP.w, 2); // 110,99 %
    expect(p.left).toBeCloseTo((-VIEW_CROP.x / VIEW_CROP.w) * 100, 2); // -5,49 %
    expect(p.top).toBeCloseTo((-VIEW_CROP.y / VIEW_CROP.h) * 100, 2); // -5,67 %
    expect(p.width).toBeGreaterThan(100);
    expect(p.left).toBeLessThan(0);
    expect(p.top).toBeLessThan(0);
  });

  // Ein Punkt der Bühne (Prozent der Bühne) liegt im Fenster (Prozent des Fensters) bei: links + x * Breite / 100 und oben + y * (Bühnenhöhe / Fensterhöhe).
  const toWindow = (view: Rect, p: { x: number; y: number }) => {
    const pl = stagePlacement(view);
    const stageOverWindowHeight = (pl.width / 100) * (IMAGE_H / IMAGE_W) * viewAspect(view);
    return { x: pl.left + (p.x * pl.width) / 100, y: pl.top + p.y * stageOverWindowHeight };
  };

  it("in beiden Ansichten liegen die Ecken des Ausschnitts auf den Ecken des Fensters und seine Mitte in der Mitte (Zoom-Ursprung und Klickflächen ziehen mit)", () => {
    for (const mode of ["crop", "full"] as const) {
      const v = viewRect(mode);
      const oben = toWindow(v, { x: v.x, y: v.y });
      const unten = toWindow(v, { x: v.x + v.w, y: v.y + v.h });
      const mitte = toWindow(v, { x: v.x + v.w / 2, y: v.y + v.h / 2 });
      for (const [name, got, want] of [
        ["oben links x", oben.x, 0], ["oben links y", oben.y, 0], ["unten rechts x", unten.x, 100], ["unten rechts y", unten.y, 100], ["Mitte x", mitte.x, 50], ["Mitte y", mitte.y, 50],
      ] as const) {
        expect([mode, name, Math.abs(got - want) < 0.01]).toEqual([mode, name, true]);
      }
    }
  });

  it("eine Fläche der Bühne landet im Fenster dort, wo sie im Ausschnitt liegt: Radar (Mitte der Bühne) bleibt in beiden Ansichten mittig", () => {
    const radar = FIELDS.find((f) => f.id === "radar")!;
    const mid = { x: radar.rect.x + radar.rect.w / 2, y: radar.rect.y + radar.rect.h / 2 };
    const crop = toWindow(viewRect("crop"), mid);
    const voll = toWindow(viewRect("full"), mid);
    expect(Math.abs(crop.x - 50)).toBeLessThan(0.5); // der Ausschnitt ist symmetrisch, das Radar sitzt auf der Mittellinie
    expect(Math.abs(voll.x - 50)).toBeLessThan(0.5);
    expect(crop.y).toBeGreaterThan(0);
    expect(crop.y).toBeLessThan(100);
  });
});

describe("Briefing-Ordner nicht eingerichtet (Abend 21.2)", () => {
  it("Instrument sagt „nicht eingerichtet“, grau", () => {
    expect(panelValues(inputs({ briefing: { kind: "unset" } }), clock).briefing).toEqual({ big: "aus", lines: [], tone: "gray", hint: "nicht eingerichtet: Einstellung „Briefing-Ordner“" });
  });
  it("Pull-Zustand „unset“: Systemlampe grau mit Hinweis", () => {
    const v = panelValues(inputs({ pull: { status: "unset", at: NOW, error: null } }), clock);
    expect(v.system).toEqual({ big: "aus", lines: [], tone: "gray", hint: "nicht eingerichtet: Einstellung „Briefing-Ordner“" });
    expect(v.lampPull).toBe("gray");
  });
});
