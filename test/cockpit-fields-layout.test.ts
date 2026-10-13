// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CockpitFeed, CockpitFeedActions } from "../src/core/cockpit-feed";
import { FIELDS, IMAGE_H, IMAGE_W, type CardId, PANELS, VIEW_CROP, polygonCss } from "../src/core/cockpit-panels";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import type { RadarInput } from "../src/core/session-radar";
import { type CockpitLayout, createCockpitLayout } from "../src/host/cockpit-layout";
import { installObsidianDom } from "./helpers/obsidian-dom";

// Neue Flächen der Cockpit-Ansicht (Abend 18, Darstellung): Rendering, Klicks, Zoom-Inhalte.

const NOW = new Date(2026, 9, 6, 12, 0, 0).getTime();
const DAY = 86_400_000;
const CARD_IDS: CardId[] = ["pull", "briefing", "usage", "tasks", "skills", "research"];
const sess = (o: Partial<RadarInput> & { id: string }): RadarInput => ({ name: o.id, cwd: "/vault", running: true, failed: false, signal: null, signalAt: null, seen: false, ...o });
const feedOf = (o: Partial<CockpitFeed> = {}): CockpitFeed => ({
  sessions: [
    sess({ id: "q", name: "Frage", signal: "question", signalAt: NOW - 60_000 }),
    sess({ id: "b", name: "Bauen", signal: "busy", signalAt: NOW - 5000 }),
    sess({ id: "i", name: "Ruhe" }),
  ],
  active: { id: "q", name: "Frage", file: { sessionId: "s", contextTokens: 142_000, usedPercentage: 50, model: "opus", writtenAt: NOW / 1000 - 120 } },
  tokensToday: { tokens: 301_000, asOf: NOW - 30_000 },
  focus: ["Erster Punkt", "Zweiter Punkt"],
  vault: { inbox: ["01 Inbox/a.md", "01 Inbox/b.md", "01 Inbox/c.md"], indexGeneratedAt: NOW - 9 * DAY, dailyToday: true },
  repos: [
    { name: "alpha", status: { dirty: true, ahead: 0, noUpstream: false } },
    { name: "beta", status: { dirty: false, ahead: 2, noUpstream: false } },
    { name: "gamma", status: { dirty: false, ahead: 0, noUpstream: false } },
  ],
  radars: [{ name: "Projekt-Monitor", lamp: "green" }, { name: "AV-Lager-Radar", lamp: "gray" }],
  unset: { projects: false, briefings: false, inbox: false, index: false, daily: false },
  effort: "high",
  telegramOn: true,
  soundOn: true,
  handoffs: [],
  day: { loc: 1234, commits: 7, repos: [{ name: "alpha", loc: 1200, commits: 5 }, { name: "beta", loc: 34, commits: 2 }] },
  ...o,
});

let host: HTMLElement;
let layout: CockpitLayout;
let calls: string[];
const actions: CockpitFeedActions = {
  focusSession: (id) => calls.push(`focus:${id}`),
  openBriefing: () => calls.push("briefing"),
  openNote: (p) => calls.push(`note:${p}`),
  startLint: () => calls.push("lint"),
  setEffort: (step) => calls.push(`effort:${step}`),
  toggleTelegram: () => calls.push("telegram"),
  toggleSound: () => calls.push("sound"),
  newSession: () => calls.push("new-session"),
  openSettings: () => calls.push("settings"),
};
const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = host): T => {
  const e = root.querySelector<T>(sel);
  if (!e) throw new Error(`nicht gefunden: ${sel}`);
  return e;
};
const all = (sel: string, root: ParentNode = host): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];
const click = (e: Element) => e.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const clipOf = (id: string) => q(`.cockpit-field-${id} .cockpit-field-clip`);
const feed = (f: CockpitFeed = feedOf(), lintCommand = "/lint") => layout.updateFeed(f, { ...DEFAULT_SETTINGS, lintCommand }, NOW);

beforeAll(() => installObsidianDom(window));
beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement("div");
  document.body.append(host);
  calls = [];
  const cards = Object.fromEntries(CARD_IDS.map((id) => [id, document.createElement("div")])) as unknown as Record<CardId, HTMLElement>;
  layout = createCockpitLayout({ doc: document, backgroundUrl: "data:,", cards, actions });
  host.append(layout.el);
  feed();
});
afterEach(() => layout.destroy());

describe("Flächen", () => {
  it("alle dreizehn stehen an ihrer Stelle, mit clip-path aus der Geometrie am klickbaren Element", () => {
    for (const f of FIELDS) {
      const outer = q(`.cockpit-field-${f.id}`);
      expect([outer.style.left, outer.style.top, outer.style.width, outer.style.height]).toEqual([`${f.rect.x}%`, `${f.rect.y}%`, `${f.rect.w}%`, `${f.rect.h}%`]);
      expect(clipOf(f.id).style.getPropertyValue("clip-path")).toBe(polygonCss(f.polygon));
      const c = q(".cockpit-field-content", outer);
      expect([c.style.left, c.style.width]).toEqual([`${f.content.x}%`, `${f.content.w}%`]);
    }
  });
  it("die Klickfläche folgt dem clip-path: das äußere Rechteck fängt keine Klicks (überlappende Boxen)", () => {
    for (const f of FIELDS) {
      // Steht im Stylesheet (Linter: keine festen Stile per Skript), nicht als Inline-Stil.
      expect(q(`.cockpit-field-${f.id}`).style.pointerEvents).toBe("");
      expect(clipOf(f.id).style.pointerEvents).toBe("");
    }
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(/\n\.cockpit-stage \.cockpit-field \{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\n\.cockpit-stage \.cockpit-field-clip \{[^}]*pointer-events:\s*auto/);
  });
  it("der Ring hat ohne Wert die Füllung 0 (Rückfall im Stylesheet)", () => {
    expect(readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8")).toMatch(/conic-gradient\(var\(--tone\) var\(--fill, 0%\)/);
  });
  it("ohne updateFeed bleiben die Flächen leer (nur Rahmen), nichts wirft", () => {
    const l2 = createCockpitLayout({ doc: document, backgroundUrl: "data:,", cards: Object.fromEntries(CARD_IDS.map((id) => [id, document.createElement("div")])) as unknown as Record<CardId, HTMLElement> });
    host.append(l2.el);
    l2.destroy();
  });
});

describe("Sitzungsradar", () => {
  it("eine Zeile je Sitzung mit Lampe und Name, Reihenfolge Frage vor Arbeit vor Ruhe", () => {
    const rows = all(".cockpit-radar-row");
    expect(rows.map((r) => q(".cockpit-radar-name", r).textContent)).toEqual(["Frage", "Bauen", "Ruhe"]);
    expect(rows.map((r) => q(".cockpit-lamp", r).className)).toEqual([
      expect.stringContaining("cockpit-lamp-question"), expect.stringContaining("cockpit-lamp-busy"), expect.stringContaining("cockpit-lamp-idle"),
    ]);
    expect(all(".cockpit-radar-more")).toHaveLength(0);
  });
  it("sechs Sitzungen: fünf Zeilen und „+1“", () => {
    feed(feedOf({ sessions: Array.from({ length: 6 }, (_, i) => sess({ id: `s${i}`, name: `S${i}` })) }));
    expect(all(".cockpit-radar-row")).toHaveLength(5);
    expect(q(".cockpit-radar-more").textContent).toBe("+1");
  });
  it("Klick auf eine Zeile ruft focusSession(id), ohne den Zoom zu öffnen", () => {
    click(all(".cockpit-radar-row")[1]);
    expect(calls).toEqual(["focus:b"]);
    expect(layout.zoomedField()).toBeNull();
  });
  it("Klick auf den Rahmen öffnet den Zoom „Sitzungen“ mit allen Sitzungen, Ordner und Alter", () => {
    click(clipOf("radar"));
    expect(layout.zoomedField()).toBe("radar");
    const z = q(".cockpit-zoom");
    expect(q(".cockpit-zoom-title", z).textContent).toBe("Sitzungen");
    expect(all(".cockpit-zoom-session", z)).toHaveLength(3);
    expect(z.textContent).toContain("/vault");
    expect(z.textContent).toContain("wartet auf dich");
    expect(z.textContent).toContain("vor 1 Min.");
    expect(calls).toEqual([]);
  });
  it("Zeile im Zoom holt den Tab und schließt den Zoom", () => {
    click(clipOf("radar"));
    click(all(".cockpit-zoom-session")[0]);
    expect(calls).toEqual(["focus:q"]);
    expect(layout.zoomedField()).toBeNull();
  });
  it("fremder Name landet nur als Text", () => {
    feed(feedOf({ sessions: [sess({ id: "x", name: "<img src=x onerror=boom()>", cwd: "<b>c</b>" })] }));
    expect(host.querySelector(".cockpit-field-radar img")).toBeNull();
    click(clipOf("radar"));
    expect(q(".cockpit-zoom").querySelector("img, b")).toBeNull();
  });
  it("derselbe Stand baut die Zeilen nicht neu auf (ein Klick im Neuaufbau ginge verloren)", () => {
    const before = all(".cockpit-radar-row")[0];
    feed(feedOf());
    expect(all(".cockpit-radar-row")[0]).toBe(before);
  });
});

describe("Fokus-Tafel", () => {
  it("Kopfzeile HEUTE DRAN, darunter zwei Punkte; Klick öffnet das Briefing", () => {
    expect(q(".cockpit-field-focus .cockpit-focus-head").textContent).toBe("HEUTE DRAN");
    expect(q(".cockpit-field-focus .cockpit-field-content").getAttribute("lang")).toBe("de");
    expect(all(".cockpit-focus-line").map((e) => e.textContent)).toEqual(["Erster Punkt", "Zweiter Punkt"]);
    click(clipOf("focus"));
    expect(calls).toEqual(["briefing"]);
  });
  it("kein nativer title mehr; der volle Text bleibt als aria-label am Punkt", () => {
    const lang = "Beispiel: im Server-Konto den Rettungsweg (Rescue-System) klären, vor jedem Neustart; danach healthchecks.io einrichten.";
    feed(feedOf({ focus: [lang, "Zweiter"] }));
    expect(all(".cockpit-focus-line").map((e) => e.getAttribute("title"))).toEqual([null, null]);
    expect(all(".cockpit-focus-line").map((e) => e.getAttribute("aria-label"))).toEqual([lang, "Zweiter"]);
  });
  describe("kein HUD-Popup mehr (19d): die Tafel „HEUTE DRAN“ zeigt den Fokus allein", () => {
    const lang = "Beispiel: im Server-Konto den Rettungsweg klären, vor jedem Neustart.";
    const fire = (type: string) => clipOf("focus").dispatchEvent(new window.Event(type, { bubbles: false }));
    it("kein Popup im DOM, weder vorher noch nach mouseenter oder Tastaturfokus auf der Tafel", () => {
      feed(feedOf({ focus: [lang, "Zweiter"] }));
      expect(host.querySelector(".cockpit-focus-pop")).toBeNull();
      for (const ev of ["mouseenter", "focus"]) {
        fire(ev);
        expect([ev, host.querySelector(".cockpit-focus-pop") === null, host.querySelector("[class*='cockpit-focus-pop']") === null]).toEqual([ev, true, true]);
        fire(ev === "mouseenter" ? "mouseleave" : "blur");
      }
    });
    it("die Tafel selbst bleibt: Kopf, Punkte im vollen Text als aria-label, Klick öffnet das Briefing", () => {
      feed(feedOf({ focus: [lang, "Zweiter"] }));
      fire("mouseenter");
      expect(q(".cockpit-field-focus .cockpit-focus-head").textContent).toBe("HEUTE DRAN");
      expect(all(".cockpit-focus-line").map((e) => e.textContent)).toEqual([lang, "Zweiter"]);
      expect(clipOf("focus").getAttribute("aria-label")).toBe("Briefing öffnen");
      click(clipOf("focus"));
      expect(calls).toEqual(["briefing"]);
    });
    it("kein CSS für das Popup mehr", () => {
      const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
      expect(css).not.toMatch(/cockpit-focus-pop/);
    });
  });
  it("leer bei [] ohne Ersatztext und ohne Kopfzeile", () => {
    feed(feedOf({ focus: [] }));
    expect(all(".cockpit-focus-line")).toHaveLength(0);
    expect(all(".cockpit-focus-head")).toHaveLength(0);
    expect(q(".cockpit-field-focus .cockpit-field-content").textContent).toBe("");
  });
  it("fremder Text nur als Text", () => {
    feed(feedOf({ focus: ["<img src=x onerror=boom()>"] }));
    expect(host.querySelector(".cockpit-field-focus img")).toBeNull();
  });
  it("die Tafel deckt die gezeichneten Kästen mit dunklem, deckendem Grund; Zeilen umbrechen über line-clamp statt nowrap", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const grund = /\.cockpit-stage \.cockpit-field-focus \.cockpit-field-clip\s*\{[^}]*background:\s*#[0-9a-f]{3,8}\s*;/i.exec(css);
    expect(grund).not.toBeNull();
    const zeile = /\.cockpit-stage \.cockpit-focus-line\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(zeile).toMatch(/-webkit-line-clamp:\s*\d/);
    expect(zeile).toMatch(/font-size:\s*1(\.\d+)?cqw/);
    expect(zeile).toMatch(/flex:\s*none/);
    expect(zeile).not.toMatch(/white-space:\s*nowrap/);
    expect(css).not.toMatch(/cockpit-key/);
  });
});

describe("Rundinstrumente", () => {
  it("Ring mit Füllung, Ampelfarbe und Tooltip mit Zahl", () => {
    const l = q(".cockpit-field-gaugeLeft");
    expect(l.className).toContain("cockpit-tone-green");
    expect(q(".cockpit-ring", l).style.getPropertyValue("--fill")).toBe("81.14%");
    expect(clipOf("gaugeLeft").getAttribute("aria-label")).toContain("142.000");
    expect(clipOf("gaugeRight").getAttribute("aria-label")).toContain("301.000");
    expect([l.textContent, q(".cockpit-field-gaugeRight").textContent]).toEqual(["CTX", "OUT"]);
    expect(q(".cockpit-field-gaugeRight").className).toContain("cockpit-tone-yellow");
  });
  it("Token-Ring: Median grün, ab p90 Regenbogen am Feld und im Zoom, ohne Pulsieren", () => {
    feed(feedOf({ tokensToday: { tokens: 340_000, asOf: NOW - 30_000 } }));
    expect(q(".cockpit-field-gaugeRight").className).toContain("cockpit-tone-green");
    feed(feedOf({ tokensToday: { tokens: 870_000, asOf: NOW - 30_000 } }));
    expect(q(".cockpit-field-gaugeRight").className).toContain("cockpit-tone-rainbow");
    expect(q(".cockpit-field-gaugeRight .cockpit-ring").className).not.toContain("cockpit-ring-pulse");
    expect(q(".cockpit-field-gaugeLeft").className).not.toContain("cockpit-tone-rainbow");
    click(clipOf("gaugeRight"));
    const gauges = all(".cockpit-zoom .cockpit-zoom-gauge");
    expect(gauges[1].className).toContain("cockpit-tone-rainbow");
    expect(gauges[0].className).not.toContain("cockpit-tone-rainbow");
  });
  it("rot: pulsierender Rand nur dort", () => {
    feed(feedOf({ active: { id: "q", name: "x", file: { sessionId: "s", contextTokens: 180_000, usedPercentage: 90, model: "m", writtenAt: NOW / 1000 } } }));
    expect(q(".cockpit-field-gaugeLeft").className).toContain("cockpit-tone-red");
    expect(q(".cockpit-field-gaugeLeft .cockpit-ring").className).toContain("cockpit-ring-pulse");
    expect(q(".cockpit-field-gaugeRight .cockpit-ring").className).not.toContain("cockpit-ring-pulse");
  });
  it("grau ohne Stand: Füllung 0", () => {
    feed(feedOf({ active: null, tokensToday: null }));
    for (const id of ["gaugeLeft", "gaugeRight"]) {
      expect(q(`.cockpit-field-${id}`).className).toContain("cockpit-tone-gray");
      expect(q(`.cockpit-field-${id} .cockpit-ring`).style.getPropertyValue("--fill")).toBe("0%");
    }
  });
  it("Klick auf einen der Ringe öffnet den Zoom mit beiden Werten, Schwellen und Stand", () => {
    click(clipOf("gaugeRight"));
    expect(layout.zoomedField()).toBe("gaugeRight");
    const t = q(".cockpit-zoom").textContent ?? "";
    for (const part of ["142.000", "150.000", "175.000", "301.000", "340.000", "870.000", "Stand"]) expect(t).toContain(part);
    layout.closeZoom();
    click(clipOf("gaugeLeft"));
    expect(layout.zoomedField()).toBe("gaugeLeft");
    expect(q(".cockpit-zoom").textContent).toContain("301.000");
  });
});

describe("Vault-Lage", () => {
  it("drei Zeilen, Index gelb", () => {
    const lines = all(".cockpit-vault-line");
    expect(lines.map((l) => l.textContent)).toEqual(["Inbox 3", "Index 9 T", "Daily ja"]);
    expect(lines[1].className).toContain("cockpit-tone-yellow");
  });
  it("Zoom: Inbox-Notizen als Links, Klick ruft openNote(pfad); „Lint starten“ ruft startLint", () => {
    click(clipOf("vault"));
    const links = all(".cockpit-zoom .cockpit-link");
    expect(links.map((l) => l.textContent)).toEqual(["01 Inbox/a.md", "01 Inbox/b.md", "01 Inbox/c.md"]);
    click(links[1]);
    expect(calls).toEqual(["note:01 Inbox/b.md"]);
    click(q(".cockpit-zoom .cockpit-lint-button"));
    expect(calls).toEqual(["note:01 Inbox/b.md", "lint"]);
  });
  it("ohne Stand Striche in grau", () => {
    feed(feedOf({ vault: null }));
    expect(all(".cockpit-vault-line").map((l) => l.textContent)).toEqual(["Inbox –", "Index –", "Daily –"]);
  });
});

describe("Repos und Radare", () => {
  it("Repo-Ampel zeigt die Zahl, gelb ab 1", () => {
    expect(q(".cockpit-field-repos .cockpit-big").textContent).toBe("2");
    expect(q(".cockpit-field-repos").className).toContain("cockpit-tone-yellow");
  });
  it("grau und Strich bei null", () => {
    feed(feedOf({ repos: null }));
    expect(q(".cockpit-field-repos .cockpit-big").textContent).toBe("–");
    expect(q(".cockpit-field-repos").className).toContain("cockpit-tone-gray");
  });
  it("Zoom listet Repo und Zustand, Handlungsbedarf zuerst", () => {
    click(clipOf("repos"));
    const rows = all(".cockpit-zoom .cockpit-repo-row").map((r) => r.textContent);
    expect(rows).toEqual(["alpha geändert", "beta 2 Commits ohne Push", "gamma sauber"]);
  });
  it("zwei Radarlampen in Ampelfarbe, Zoom zeigt beide", () => {
    const lamps = all(".cockpit-radar-lamp");
    expect(lamps).toHaveLength(2);
    expect(lamps[0].className).toContain("cockpit-tone-green");
    expect(lamps[1].className).toContain("cockpit-tone-gray");
    click(clipOf("radars"));
    const t = q(".cockpit-zoom").textContent ?? "";
    expect(t).toContain("Projekt-Monitor");
    expect(t).toContain("AV-Lager-Radar");
    expect(t).toContain("heute geschrieben");
  });
  it("Radar rot", () => {
    feed(feedOf({ radars: [{ name: "Projekt-Monitor", lamp: "red" }, { name: "AV-Lager-Radar", lamp: "green" }] }));
    expect(all(".cockpit-radar-lamp").map((l) => l.className.match(/cockpit-tone-\w+/)?.[0])).toEqual(["cockpit-tone-red", "cockpit-tone-green"]);
  });
});

describe("Effort-Schieber auf dem Bildschirm (Abend 19e, löst die Liste aus 19b ab)", () => {
  const TOP = 100;
  const HEIGHT = 200;
  const yOf = (pos: number) => TOP + pos * HEIGHT;
  const rail = () => q(".cockpit-effort-rail", clipOf("effort"));
  const lever = () => q(".cockpit-effort-lever", clipOf("effort"));
  const knob = () => q(".cockpit-effort-knob", clipOf("effort"));
  const marks = () => all(".cockpit-effort-mark", clipOf("effort"));
  const mark = (step: string) => marks().find((m) => m.dataset.step === step)!;
  const on = () => marks().filter((m) => m.classList.contains("cockpit-effort-mark-on")).map((m) => m.dataset.step);
  const pos = () => Number(knob().style.getPropertyValue("--pos"));
  const measure = () => {
    rail().getBoundingClientRect = () => ({ top: TOP, height: HEIGHT, bottom: TOP + HEIGHT, left: 0, right: 30, width: 30, x: 0, y: TOP, toJSON: () => ({}) }) as DOMRect;
  };
  const ptr = (target: Element, type: string, pos01: number) =>
    target.dispatchEvent(new window.PointerEvent(type, { clientY: yOf(pos01), pointerId: 1, pointerType: "mouse", button: 0, bubbles: true, cancelable: true }));
  /** Ein Zug: anfassen irgendwo im Schlitz, über die Stationen ziehen, loslassen. */
  const pull = (...stations: number[]) => {
    ptr(rail(), "pointerdown", stations[0]);
    for (const p of stations.slice(1)) ptr(lever(), "pointermove", p);
    ptr(lever(), "pointerup", stations[stations.length - 1]);
  };
  beforeEach(measure);

  it("ein Schieber (role=slider) im Inhalt des Schirms, sechs Beschriftungen, max oben, aus unten; keine Knopfliste mehr", () => {
    expect(all(".cockpit-effort-lever", host)).toHaveLength(1);
    expect(q(".cockpit-field-effort .cockpit-field-content").contains(lever())).toBe(true);
    expect(lever().getAttribute("role")).toBe("slider");
    expect(marks().map((m) => m.textContent)).toEqual(["max", "xhigh", "high", "medium", "low", "aus"]);
    expect(all(".cockpit-effort-list, .cockpit-effort-step, .cockpit-effort-frame, .cockpit-effort-readout", host)).toHaveLength(0);
    expect(host.querySelector(".cockpit-field-effort svg")).toBeNull();
    expect(clipOf("effort").getAttribute("role")).toBe("group");
  });
  it("der Griff steht auf der Stufe aus dem Feed, die Beschriftung leuchtet, aria-valuetext nennt sie", () => {
    expect(on()).toEqual(["high"]);
    expect(pos()).toBeCloseTo(0.4, 10);
    expect(lever().getAttribute("aria-valuetext")).toBe("high, Stufe 4 von 6");
    expect(lever().getAttribute("aria-label")).toBe("Effort der nächsten Sitzung");
  });
  it("Ziehen und Loslassen ruft setEffort einmal mit der Stufe unter dem Griff, nicht mitten im Zug", () => {
    ptr(rail(), "pointerdown", 0.4);
    ptr(lever(), "pointermove", 0.2);
    ptr(lever(), "pointermove", 0);
    ptr(lever(), "pointermove", 0.2);
    expect(calls).toEqual([]);
    expect(on()).toEqual(["xhigh"]);
    ptr(lever(), "pointerup", 0.2);
    expect(calls).toEqual(["effort:xhigh"]);
  });
  it("jede der sechs Stufen lässt sich ziehen (ein Aufruf je Zug); ein Zug auf die alte Stufe löst nichts aus", () => {
    for (const [p, step] of [[1, "aus"], [0.8, "low"], [0.6, "medium"], [0.2, "xhigh"], [0, "max"]] as const) pull(0.4, p);
    expect(calls).toEqual(["effort:aus", "effort:low", "effort:medium", "effort:xhigh", "effort:max"]);
  });
  it("ein Zug über mehrere Stufen und zurück auf die alte löst nichts aus", () => {
    pull(0.4, 1, 0, 0.42);
    expect(calls).toEqual([]);
  });
  it("Klick auf eine Beschriftung springt: ein Aufruf; Klick auf die gewählte Stufe: keiner", () => {
    click(mark("max"));
    expect(calls).toEqual(["effort:max"]);
    expect(pos()).toBe(0);
    click(mark("max"));
    expect(calls).toEqual(["effort:max"]);
  });
  it("Pfeiltasten am Schieber setzen die Nachbarstufe", () => {
    lever().dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(calls).toEqual(["effort:medium"]);
  });
  it("eine neue Stufe aus dem Feed (Command, Einstellung) schiebt den Griff mit; die Elemente bleiben dieselben", () => {
    const vorherMarks = marks();
    const vorherKnob = knob();
    lever().focus();
    feed(feedOf({ effort: "max" }));
    expect(on()).toEqual(["max"]);
    expect(pos()).toBe(0);
    feed(feedOf({ effort: "aus" }));
    expect(on()).toEqual(["aus"]);
    expect(pos()).toBe(1);
    expect(marks()).toEqual(vorherMarks);
    expect(knob()).toBe(vorherKnob);
    expect(document.activeElement).toBe(lever());
    expect(calls).toEqual([]);
  });
  it("während eines Zugs schiebt der Feed den Griff nicht weg", () => {
    ptr(rail(), "pointerdown", 0.4);
    ptr(lever(), "pointermove", 0.6);
    feed(feedOf({ effort: "max" }));
    expect(pos()).toBeCloseTo(0.6, 10);
    expect(on()).toEqual(["medium"]);
    ptr(lever(), "pointerup", 0.6);
    expect(calls).toEqual(["effort:medium"]);
  });
  it("Ton: grün, bei „aus“ grau; sofort beim Loslassen, und meldet der Feed die alte Stufe zurück (Speichern missglückt), kehrt Griff und Ton um", () => {
    const cls = () => q(".cockpit-field-effort").className;
    expect(cls()).toMatch(/cockpit-tone-green/);
    pull(0.4, 1);
    expect(cls()).toMatch(/cockpit-tone-gray/);
    feed(feedOf({ effort: "high" }));
    expect(cls()).toMatch(/cockpit-tone-green/);
    expect(pos()).toBeCloseTo(0.4, 10);
    expect(on()).toEqual(["high"]);
    feed(feedOf({ effort: "aus" }));
    expect(cls()).toMatch(/cockpit-tone-gray/);
    feed(feedOf({ effort: "xhigh" }));
    expect(cls()).toMatch(/cockpit-tone-green/);
  });
  it("Tooltip aus einer Quelle: aria-label der Fläche nennt die Stufe, kein title", () => {
    expect(clipOf("effort").getAttribute("aria-label")).toBe("Effort der nächsten Sitzung: high");
    expect(clipOf("effort").getAttribute("title")).toBeNull();
    feed(feedOf({ effort: "aus" }));
    expect(clipOf("effort").getAttribute("aria-label")).toBe("Effort der nächsten Sitzung: aus");
  });
  it("ohne Actions tut ein Zug nichts Schlimmes und wirft nicht", () => {
    layout.destroy();
    layout = createCockpitLayout({ doc: document, backgroundUrl: "data:,", cards: Object.fromEntries(CARD_IDS.map((id) => [id, document.createElement("div")])) as unknown as Record<CardId, HTMLElement> });
    host.append(layout.el);
    feed();
    measure();
    expect(() => pull(0.4, 1)).not.toThrow();
    expect(calls).toEqual([]);
  });
  it("Fläche, Schieber und Beschriftungen öffnen keinen Zoom", () => {
    click(clipOf("effort"));
    click(mark("max"));
    click(lever());
    expect(layout.zoomedField()).toBeNull();
  });
  it("derselbe Stand baut den Schieber nicht neu auf", () => {
    const vorher = marks();
    feed(feedOf());
    feed(feedOf());
    expect(marks()).toEqual(vorher);
    expect(all(".cockpit-effort-lever", host)).toHaveLength(1);
    expect(all(".cockpit-effort-mark", host)).toHaveLength(6);
  });
});

describe("Schalter", () => {
  it("Schalter zeigt die Stellung und ruft toggleTelegram", () => {
    const c = clipOf("telegram");
    expect(c.getAttribute("role")).toBe("switch");
    expect(c.getAttribute("aria-checked")).toBe("true");
    click(c);
    expect(calls).toEqual(["telegram"]);
    feed(feedOf({ telegramOn: false }));
    expect(c.getAttribute("aria-checked")).toBe("false");
  });
});

describe("Ton-Schalter", () => {
  const text = (sel: string) => q(sel, clipOf("sound")).textContent;
  it("zeigt TON und AN bzw. AUS, ruft toggleSound, lässt Telegram in Ruhe", () => {
    const c = clipOf("sound");
    expect(c.getAttribute("role")).toBe("switch");
    expect(c.getAttribute("aria-checked")).toBe("true");
    expect(text(".cockpit-switch-label")).toBe("TON");
    expect(text(".cockpit-switch-state")).toBe("AN");
    expect(q(".cockpit-field-sound").classList.contains("cockpit-switch-on")).toBe(true);
    click(c);
    expect(calls).toEqual(["sound"]);
    feed(feedOf({ soundOn: false }));
    expect(c.getAttribute("aria-checked")).toBe("false");
    expect(text(".cockpit-switch-state")).toBe("AUS");
    expect(q(".cockpit-field-sound").classList.contains("cockpit-switch-on")).toBe(false);
    expect(q(".cockpit-switch-state", clipOf("telegram")).textContent).toBe("AN");
  });
});

describe("Tooltips", () => {
  it("je Element höchstens eine Quelle: Obsidian zeigt aria-label als eigenen Tooltip, der Browser den title", () => {
    const doppelt = all("[title][aria-label]").map((e) => e.className);
    expect(doppelt).toEqual([]);
    expect(all("[title]").length).toBeGreaterThan(4); // die Prüfung hat etwas zu prüfen (Radarzeilen und Radarlampen; der Effort-Schirm nutzt seit 19b aria-label)
  });
  it("die Felder mit Zahlen und die Schalter nutzen Obsidians Tooltip (aria-label), der native title erscheint in Obsidian nicht verlässlich", () => {
    for (const id of ["gaugeLeft", "gaugeRight", "telegram", "sound", "loc", "commits"]) {
      expect([id, clipOf(id).getAttribute("title"), (clipOf(id).getAttribute("aria-label") ?? "").length > 0]).toEqual([id, null, true]);
    }
    expect(clipOf("telegram").getAttribute("aria-label")).toMatch(/^Telegram-Meldungen (an|aus)$/);
    expect(clipOf("sound").getAttribute("aria-label")).toMatch(/^Ton und Banner (an|aus)$/);
  });
});

describe("LOC und Commits heute", () => {
  const text = (id: string, sel: string) => q(sel, clipOf(id)).textContent;
  it("kleine Beschriftung und große Zahl, Tooltip mit den Repos", () => {
    expect(text("loc", ".cockpit-field-title")).toBe("kLOC");
    expect(text("loc", ".cockpit-big")).toBe("1,2");
    expect(text("commits", ".cockpit-field-title")).toBe("COM");
    expect(text("commits", ".cockpit-big")).toBe("7");
    expect(clipOf("loc").getAttribute("aria-label")).toBe("LOC heute: 1,2k\nalpha: 1200\nbeta: 34");
    expect(clipOf("commits").getAttribute("aria-label")).toBe("Commits heute: 7\nalpha: 5\nbeta: 2");
  });
  it("Zahl füllt den Schlitz: Schriftgröße nach Zeichenzahl, Beschriftung lesbar", () => {
    const big = (id: string) => q(".cockpit-big", clipOf(id));
    expect([big("loc").style.getPropertyValue("--chars"), big("commits").style.getPropertyValue("--chars")]).toEqual(["3", "1"]);
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const regel = (sel: string) => css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
    expect(regel(".cockpit-field-commits .cockpit-big {")).toMatch(/font-size: min\([\d.]+cqw, [\d.]+cqw \/ var\(--chars\)\)/);
    expect(regel(".cockpit-field-loc .cockpit-big {")).toMatch(/font-size: min\([\d.]+cqw, [\d.]+cqw \/ var\(--chars\)\)/);
    const titel = Number(/font-size: ([\d.]+)cqw/.exec(regel(".cockpit-field-commits .cockpit-field-title {"))?.[1]);
    expect(titel).toBeGreaterThanOrEqual(0.7);
  });
  it("aktualisiert sich mit dem Feed, ohne Daten Strich", () => {
    feed(feedOf({ day: { loc: -50, commits: 1, repos: [{ name: "gamma", loc: -50, commits: 1 }] } }));
    expect(text("loc", ".cockpit-big")).toBe("-50");
    expect(text("loc", ".cockpit-field-title")).toBe("LOC");
    expect(clipOf("loc").getAttribute("aria-label")).toBe("LOC heute: -50\ngamma: -50");
    feed(feedOf({ day: null }));
    expect(text("loc", ".cockpit-big")).toBe("–");
    expect(text("commits", ".cockpit-big")).toBe("–");
    expect(clipOf("commits").getAttribute("aria-label")).toBe("Commits heute: –\nNoch keine Abfrage.");
  });
  it("reine Anzeige: kein Button, kein Zoom, ein Klick tut nichts", () => {
    expect(clipOf("loc").getAttribute("role")).toBeNull();
    click(clipOf("loc"));
    click(clipOf("commits"));
    expect(layout.zoomedField()).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("Zoom", () => {
  it("höchstens ein Zoom, Escape und ✕ schließen, Karten bleiben im Regal", () => {
    click(clipOf("vault"));
    click(clipOf("repos"));
    expect(all(".cockpit-zoom")).toHaveLength(1);
    expect(layout.zoomedField()).toBe("repos");
    for (const id of CARD_IDS) expect(layout.shelf.querySelectorAll(".cockpit-shelf > *").length).toBe(CARD_IDS.length);
    q(".cockpit-zoom-panel").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(layout.zoomedField()).toBeNull();
    click(clipOf("repos"));
    click(q(".cockpit-zoom-close"));
    expect(all(".cockpit-zoom")).toHaveLength(0);
  });
  it("neuer Stand aktualisiert den offenen Zoom", () => {
    click(clipOf("vault"));
    feed(feedOf({ vault: { inbox: ["01 Inbox/neu.md"], indexGeneratedAt: NOW, dailyToday: false } }));
    expect(all(".cockpit-zoom .cockpit-link").map((l) => l.textContent)).toEqual(["01 Inbox/neu.md"]);
  });
  it("Flächen ohne Zoom (Effort-Schieber, Schalter, Kanzel) öffnen keinen", () => {
    click(clipOf("effort"));
    click(clipOf("focus"));
    expect(layout.zoomedField()).toBeNull();
  });
});

describe("CSS", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  it("Blinken und Pulsieren stehen bei prefers-reduced-motion still", () => {
    const block = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toMatch(/cockpit-lamp-busy[^}]*animation:\s*none/);
    expect(block).toMatch(/cockpit-ring-pulse[^}]*animation:\s*none/);
  });
  it("Effort-Schieber: Beschriftung in cqw, Griff und Beschriftung der gewählten Stufe leuchten in der Tonfarbe, Schirm mit dunklem Grund wie die anderen, Ziehen ohne Scrollen und Auswahl", () => {
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(rule(".cockpit-stage .cockpit-effort-mark")).toMatch(/font-size:\s*[\d.]+cqw/);
    expect(rule(".cockpit-stage .cockpit-effort-mark")).toMatch(/cursor:\s*pointer/);
    expect(rule(".cockpit-stage .cockpit-effort-mark-on")).toMatch(/var\(--tone\)/);
    expect(rule(".cockpit-stage .cockpit-effort-knob")).toMatch(/var\(--tone\)/);
    expect(rule(".cockpit-stage .cockpit-effort-lever")).toMatch(/touch-action:\s*none/);
    expect(rule(".cockpit-stage .cockpit-effort-lever")).toMatch(/user-select:\s*none/);
    expect(rule(".cockpit-stage .cockpit-field-effort .cockpit-field-clip")).toMatch(/background:\s*rgba\(/);
  });
  it("Effort-Schieber: der Griff ist flacher als der Stufenabstand (Rechnung aus Geometrie und CSS, bei 720 px Panebreite im Ausschnitt)", () => {
    const f = FIELDS.find((x) => x.id === "effort")!;
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    const cqw = (re: RegExp, text: string) => Number(re.exec(text)?.[1]);
    // Inhalt des Schirms in cqw (Breite der vollen Bühne = 100 cqw)
    const contentH = ((f.rect.h / 100) * (f.content.h / 100)) * (IMAGE_H / IMAGE_W) * 100;
    const pad = cqw(/padding:\s*([\d.]+)cqw/, rule(".cockpit-stage .cockpit-effort-lever"));
    const knobH = cqw(/(?:^|[;\s])height:\s*([\d.]+)cqw/, rule(".cockpit-stage .cockpit-effort-knob"));
    const railH = contentH - 2 * pad;
    const spacing = railH / 5;
    expect([pad > 0, knobH > 0, spacing > 0]).toEqual([true, true, true]);
    expect(knobH).toBeLessThan(spacing * 0.75);
    // bei 720 px Panebreite: 1 cqw = 720 / (VIEW_CROP.w% * 100) * 100 px
    const pxPerCqw = 720 / VIEW_CROP.w;
    expect(spacing * pxPerCqw).toBeGreaterThanOrEqual(11); // die Beschriftung bleibt lesbar
    expect(knobH * pxPerCqw).toBeGreaterThanOrEqual(5); // der Griff bleibt greifbar
  });
  it("Warnkasten: „Woche knapp“ passt auch mit dem Ausrufezeichen daneben in die Textspalte (Monospace, rund 0,602 em je Zeichen)", () => {
    const g = PANELS.find((p) => p.id === "warnings")!;
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    const num = (re: RegExp, text: string) => Number(re.exec(text)?.[1]);
    const box = (g.rect.w / 100) * g.content.w; // cqw: rect.w ist Prozent der Bühnenbreite
    const gap = num(/(?:^|[;\s])gap:\s*[\d.]+cqw\s+([\d.]+)cqw/, rule(".cockpit-panel-warnings .cockpit-panel-content")); // zweiter Wert von `gap: Zeile Spalte`
    const bang = num(/(?:^|[;\s])width:\s*([\d.]+)cqw/, rule(".cockpit-panel-warnings .cockpit-inst-big"));
    const size = num(/font-size:\s*([\d.]+)cqw/, rule(".cockpit-panel-warnings .cockpit-inst-line"));
    expect([gap > 0, bang > 0, size > 0]).toEqual([true, true, true]);
    const textColumn = box - gap - bang;
    expect(11 * 0.602 * size).toBeLessThanOrEqual(textColumn);
  });
  it("kein CSS der Knopfliste und der Plattenkulisse mehr", () => {
    expect(css).not.toMatch(/cockpit-effort-(list|step|frame|readout|title|name)/);
  });
  it("neue Klassen tragen alle das Präfix cockpit- (fremde Plugins teilen Klassennamen)", () => {
    const after = css.slice(css.indexOf("Neue Flächen (Abend 18"));
    expect(after.length).toBeGreaterThan(100);
    const selectors = [...after.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]).filter((c) => !c.startsWith("cockpit-") && !/^\d/.test(c));
    expect(selectors).toEqual([]);
  });
});

describe("Plus auf dem Knauf des Schalthebels (a18e)", () => {
  const knobField = () => clipOf("newSession");
  it("Fläche „newSession“ als Button „Neue Sitzung“ mit sichtbarem +, per Tab erreichbar", () => {
    expect(all(".cockpit-field-newSession")).toHaveLength(1);
    expect(knobField().getAttribute("role")).toBe("button");
    expect(knobField().getAttribute("aria-label")).toBe("Neue Sitzung");
    expect(knobField().tabIndex).toBeGreaterThanOrEqual(0);
    expect(q(".cockpit-field-newSession .cockpit-field-content").textContent).toBe("+");
  });
  it("Klick, Enter und Leertaste rufen actions.newSession", () => {
    click(knobField());
    knobField().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    knobField().dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(calls).toEqual(["new-session", "new-session", "new-session"]);
  });
  it("ein neuer Feed baut das Plus nicht ab, andere Tasten lösen nichts aus", () => {
    feed();
    knobField().dispatchEvent(new window.KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    expect(calls).toEqual([]);
    expect(q(".cockpit-field-newSession .cockpit-field-content").textContent).toBe("+");
  });
  it("offene Handoffs: Plus bleibt, Hinweis „1 offen“ daneben; ohne Handoffs kein Hinweis-Element", () => {
    const h = { project: "A", path: "P/A/Handoffs/a.md", created: "2026-01-01", task: "", repo: null };
    feed(feedOf({ handoffs: [h] }));
    expect(q(".cockpit-field-newSession .cockpit-newsession-plus").textContent).toBe("+");
    expect(q(".cockpit-field-newSession .cockpit-field-hint").textContent).toBe("1 offen");
    feed(feedOf({ handoffs: [] }));
    expect(q(".cockpit-field-newSession .cockpit-newsession-plus").textContent).toBe("+");
    expect(document.querySelector(".cockpit-field-newSession .cockpit-field-hint")).toBeNull();
  });
  it("die CSS legt Plus und Hinweis nebeneinander (Zeile), der Hinweis ist klein und umbricht nicht", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(/\.cockpit-field-newSession \.cockpit-field-content\s*\{[^}]*flex-direction:\s*row/.test(css)).toBe(true);
    const hint = /\.cockpit-field-newSession \.cockpit-field-hint\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(hint).toMatch(/white-space:\s*nowrap/);
    expect(Number(/font-size:\s*([\d.]+)cqw/.exec(hint)?.[1])).toBeLessThan(1.5);
  });
  it("die CSS macht das Plus groß, grün glühend und klickbar", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const block = /\.cockpit-field-newSession \.cockpit-newsession-plus\s*\{([^}]*)\}/.exec(css);
    expect(block).not.toBeNull();
    expect(/font-size:\s*([\d.]+)cqw/.exec(block![1])).not.toBeNull();
    expect(Number(/font-size:\s*([\d.]+)cqw/.exec(block![1])![1])).toBeGreaterThanOrEqual(3);
    expect(block![1]).toMatch(/#5ee08a|text-shadow/);
    expect(/\.cockpit-field-newSession \.cockpit-field-clip\s*\{[^}]*cursor:\s*pointer/.exec(css)).not.toBeNull();
  });

  // 18f: Das „+“ war unten abgeschnitten, weil die Schrift (7 cqw) höher war als das Textrechteck (rund 3,45 cqw, overflow hidden).
  it("Plus auf dem Knauf: Schrift passt in die Höhe des Textrechtecks (cqw), Zeilenhöhe 1", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const block = /\.cockpit-field-newSession \.cockpit-newsession-plus \{([^}]*)\}/.exec(css)?.[1] ?? "";
    const size = Number(/font-size:\s*([\d.]+)cqw/.exec(block)?.[1]);
    expect(size).toBeGreaterThan(0);
    expect(/line-height:\s*1;/.test(block)).toBe(true);
    const g = FIELDS.find((f) => f.id === "newSession")!;
    // rect.h ist Prozent der Bildhöhe, cqw bezieht sich auf die Bühnenbreite (Seitenverhältnis 1536/1942).
    const contentHeightCqw = ((g.rect.h * 1942) / 1536) * (g.content.h / 100);
    expect(size).toBeLessThanOrEqual(contentHeightCqw);
  });
});

describe("nicht eingerichtet (Abend 21.2)", () => {
  const alles = { projects: true, briefings: true, inbox: true, index: true, daily: true };
  const leer = () => feedOf({ unset: alles, vault: null, repos: null, day: null, focus: [], radars: [] });
  it("Vault-Zoom: Hinweis je fehlender Einstellung, Sprung ruft openSettings, ohne lintCommand keine Lint-Taste", () => {
    feed(leer(), "");
    click(clipOf("vault"));
    expect(all(".cockpit-zoom .cockpit-zoom-hint").map((h) => h.textContent)).toEqual([
      "Nicht eingerichtet: Einstellung „Inbox-Ordner“ ausfüllen.",
      "Nicht eingerichtet: Einstellung „Index-Datei“ ausfüllen.",
      "Nicht eingerichtet: Einstellung „Ordner der Daily Notes“ ausfüllen.",
    ]);
    expect(all(".cockpit-zoom .cockpit-lint-button")).toHaveLength(0);
    click(q(".cockpit-zoom .cockpit-unset-open"));
    expect(calls).toEqual(["settings"]);
  });
  it("Lint-Taste nur mit lintCommand, sonst kein Hinweis im Vault-Zoom, wenn alles eingerichtet ist", () => {
    click(clipOf("vault"));
    expect(all(".cockpit-zoom .cockpit-lint-button")).toHaveLength(1);
    expect(all(".cockpit-zoom .cockpit-zoom-hint")).toHaveLength(0);
    expect(all(".cockpit-zoom .cockpit-unset-open")).toHaveLength(0);
  });
  it("Repos-Zoom: Hinweis Projektordner mit Sprung", () => {
    feed(leer());
    click(clipOf("repos"));
    expect(q(".cockpit-zoom .cockpit-zoom-hint").textContent).toBe("Nicht eingerichtet: Einstellung „Projektordner“ ausfüllen.");
    click(q(".cockpit-zoom .cockpit-unset-open"));
    expect(calls).toEqual(["settings"]);
  });
  it("Radare-Zoom ohne Liste: Hinweis mit Sprung; Feld sagt kurz „aus“, voller Text im title", () => {
    feed(leer());
    expect(q(".cockpit-field-radars .cockpit-field-content").textContent).toBe("aus");
    expect(q(".cockpit-radars-unset").getAttribute("title")).toBe("Nicht eingerichtet: Einstellung „Radare“ ausfüllen.");
    click(clipOf("radars"));
    expect(q(".cockpit-zoom .cockpit-zoom-hint").textContent).toBe("Nicht eingerichtet: Einstellung „Radare“ ausfüllen.");
    click(q(".cockpit-zoom .cockpit-unset-open"));
    expect(calls).toEqual(["settings"]);
  });
  it("Fokus-Tafel ohne Briefing-Ordner: nicht eingerichtet, Tooltip nennt die Einstellung", () => {
    feed(leer());
    const c = q(".cockpit-field-focus .cockpit-field-content");
    expect(c.textContent).toContain("nicht eingerichtet");
    expect(c.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe("Nicht eingerichtet: Einstellung „Briefing-Ordner“ ausfüllen.");
  });
  it("LOC, Commits und Repos tragen den Hinweis im Tooltip", () => {
    feed(leer());
    for (const id of ["loc", "commits", "repos"]) expect(clipOf(id).getAttribute("aria-label")).toContain("Projektordner");
  });
  it("Radarlampen: zwei Lampen mit Namen aus der Liste und verschiedenen Kürzeln; unset-Lampe grau", () => {
    feed(feedOf({ radars: [{ name: "Radar 1", lamp: "unset" }, { name: "Radar 2", lamp: "gray" }] }));
    const lamps = all(".cockpit-field-radars .cockpit-radar-lamp");
    expect(lamps.map((l) => q(".cockpit-radar-lamp-name", l).textContent)).toEqual(["R1", "R2"]);
    expect(lamps.every((l) => l.className.includes("cockpit-tone-gray"))).toBe(true);
    expect(lamps[0].getAttribute("title")).toContain("Radar 1");
  });
});
