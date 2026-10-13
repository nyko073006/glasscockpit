// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CockpitInputs } from "../src/core/cockpit-panels";
import { Observable } from "../src/core/observable";
import type { PullSnapshot } from "../src/core/pull-state";
import type { CockpitCrop, DashboardLayout } from "../src/core/settings";
import type { CockpitFeed, CockpitFeedActions } from "../src/core/cockpit-feed";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { DashboardLayoutController } from "../src/host/dashboard-layout-controller";
import { installObsidianDom } from "./helpers/obsidian-dom";

// Umschalt- und Lebenszyklus-Logik der DashboardView (Abend 15), ohne Obsidian: Liste <-> Cockpit, Karten zwischen
// Liste, Regal und Zoom, Reload beim Wechsel, Abos der Instrumente, Aufräumen beim Schließen.

let root: HTMLElement;
let head: HTMLElement;
let cards: HTMLElement[];
let layoutSetting: DashboardLayout;
let cropSetting: CockpitCrop;
let settingsSubs: Set<() => void>;
let briefing: Observable<CockpitInputs["briefing"]>;
/** Eine Quelle, die nur „etwas hat sich geändert“ meldet (im Plugin: die Sitzungen, das Sitzungsradar zeichnet neu). */
let sessions: Observable<number>;
let pull: Observable<PullSnapshot>;
let expanded: boolean;
let expandedCalls: boolean[];
let ctl: DashboardLayoutController;

const all = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const q = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const e = root.querySelector<T>(sel);
  if (!e) throw new Error(`nicht gefunden: ${sel}`);
  return e;
};
const click = (e: Element) => e.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

function inputs(): CockpitInputs {
  return {
    now: 1_000_000,
    briefing: briefing.get(),
    usage: { snapshot: null },
    tasks: null,
    research: null,
    pull: pull.get(),
  };
}

function make(): DashboardLayoutController {
  const c = new DashboardLayoutController({
    root,
    doc: document,
    head,
    cards,
    backgroundUrl: "data:image/jpeg;base64,AAAA",
    layout: () => layoutSetting,
    crop: () => cropSetting,
    onSettingsChange: (cb) => { settingsSubs.add(cb); return () => { settingsSubs.delete(cb); }; },
    sources: [(cb) => briefing.subscribe(cb), (cb) => sessions.subscribe(cb), (cb) => pull.subscribe(cb)],
    inputs,
    clock: () => "21:20",
    isExpanded: () => expanded,
    setExpanded: (v) => { expanded = v; expandedCalls.push(v); },
  });
  c.start();
  return c;
}

const switchTo = (l: DashboardLayout) => {
  layoutSetting = l;
  for (const cb of [...settingsSubs]) cb();
};

beforeAll(() => installObsidianDom(window));
beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement("div");
  document.body.append(root);
  head = document.createElement("div");
  head.className = "head";
  cards = ["briefing", "usage", "tasks", "skills", "research"].map((n) => {
    const e = document.createElement("div");
    e.className = `card ${n}`;
    return e;
  });
  // Wie die View: Kopf und Karten stehen zuerst in der Wurzel.
  root.append(head, ...cards);
  layoutSetting = "list";
  cropSetting = "crop";
  settingsSubs = new Set();
  briefing = new Observable<CockpitInputs["briefing"]>(null);
  sessions = new Observable(0);
  pull = new Observable<PullSnapshot>({ status: "idle", at: null, error: null });
  expanded = false;
  expandedCalls = [];
  ctl = make();
});
afterEach(() => ctl.destroy());

describe("Wechsel der Ansicht", () => {
  it("Liste: Kopf und Karten bleiben in der Wurzel in ihrer Reihenfolge, keine Bühne", () => {
    expect([...root.children]).toEqual([head, ...cards]);
    expect(root.querySelector(".cockpit-stage-wrap")).toBeNull();
    expect(root.classList.contains("cockpit-dashboard-cockpit")).toBe(false);
  });

  it("list -> cockpit: Bühne da, Karten im Regal, Wurzel markiert", () => {
    switchTo("cockpit");
    expect(root.querySelector(".cockpit-stage-wrap")).not.toBeNull();
    const shelf = q(".cockpit-shelf");
    for (const c of [head, ...cards]) expect(shelf.contains(c)).toBe(true);
    expect(root.classList.contains("cockpit-dashboard-cockpit")).toBe(true);
  });

  it("cockpit -> list: alle Karten und der Kopf sind wieder in der Liste, in Reihenfolge, Bühne weg", () => {
    switchTo("cockpit");
    switchTo("list");
    expect([...root.children]).toEqual([head, ...cards]);
    expect(root.querySelector(".cockpit-stage-wrap")).toBeNull();
    expect(root.classList.contains("cockpit-dashboard-cockpit")).toBe(false);
  });

  it("list -> cockpit -> list -> cockpit: nie zwei Bühnen", () => {
    switchTo("cockpit");
    switchTo("list");
    switchTo("cockpit");
    expect(root.querySelectorAll(".cockpit-stage-wrap").length).toBe(1);
  });

  it("derselbe Zustand noch einmal gemeldet ändert nichts", () => {
    switchTo("cockpit");
    const stage = q(".cockpit-stage-wrap");
    switchTo("cockpit");
    expect(q(".cockpit-stage-wrap")).toBe(stage);
  });

  it("Wechsel bei offenem Zoom: die Karten kommen in die Liste zurück", () => {
    switchTo("cockpit");
    click(q(".cockpit-panel-usage"));
    expect(q(".cockpit-zoom").contains(cards[1])).toBe(true);
    switchTo("list");
    expect([...root.children]).toEqual([head, ...cards]);
    expect(document.querySelector(".cockpit-zoom")).toBeNull();
  });

  it("Start im Cockpit (Einstellung schon cockpit): Bühne gleich da", () => {
    ctl.destroy();
    root.replaceChildren(head, ...cards);
    layoutSetting = "cockpit";
    ctl = make();
    expect(root.querySelector(".cockpit-stage-wrap")).not.toBeNull();
  });
});

describe("Instrumente folgen den Ständen", () => {
  beforeEach(() => switchTo("cockpit"));

  it("Briefing-Stand ändert das Briefing-Instrument (nur das Datum, keine Überschrift)", () => {
    briefing.set({ kind: "ok", date: "2026-10-05" });
    expect(q(".cockpit-panel-briefing .cockpit-inst-big").textContent).toBe("05.10.");
    briefing.set({ kind: "ok", date: "2026-10-06" });
    expect(q(".cockpit-panel-briefing .cockpit-inst-big").textContent).toBe("06.10.");
    expect(root.querySelectorAll(".cockpit-panel-briefing .cockpit-inst-line")).toHaveLength(0);
  });

  it("das System-Instrument zeigt keine Sitzungszahl mehr, auch wenn sich die Sitzungen ändern", () => {
    sessions.set(2);
    expect(q(".cockpit-panel-system").textContent).not.toMatch(/Sitzung/);
  });

  it("Pull-Zustand ändert System-Instrument und Lampe", () => {
    pull.set({ status: "ok", at: 5, error: null });
    expect(q(".cockpit-panel-system .cockpit-inst-big").textContent).toBe("OK");
    expect(q(".cockpit-panel-lamp-pull").className).toContain("cockpit-tone-green");
    pull.set({ status: "error", at: 6, error: "x" });
    expect(q(".cockpit-panel-system .cockpit-inst-big").textContent).toBe("FEHLER");
    expect(q(".cockpit-panel-lamp-pull").className).toContain("cockpit-tone-red");
  });

  it("beim Wechsel auf Cockpit zeichnet die Bühne sofort den aktuellen Stand", () => {
    ctl.destroy();
    root.replaceChildren(head, ...cards);
    layoutSetting = "list";
    pull.set({ status: "ok", at: 5, error: null });
    ctl = make();
    switchTo("cockpit");
    expect(q(".cockpit-panel-system .cockpit-inst-big").textContent).toBe("OK");
  });

  it("in der Listenansicht wird nichts gezeichnet (kein Fehler bei Änderungen)", () => {
    switchTo("list");
    expect(() => { sessions.set(9); pull.set({ status: "ok", at: 1, error: null }); }).not.toThrow();
  });
});

describe("Ausschnitt folgt der Einstellung (Abend 19b)", () => {
  const changeCrop = (c: CockpitCrop) => {
    cropSetting = c;
    for (const cb of [...settingsSubs]) cb();
  };

  it("die Bühne entsteht mit der gewählten Ansicht, Vorgabe zugeschnitten", () => {
    switchTo("cockpit");
    expect(q(".cockpit-stage-wrap").getAttribute("data-crop")).toBe("crop");
    switchTo("list");
    cropSetting = "full";
    switchTo("cockpit");
    expect(q(".cockpit-stage-wrap").getAttribute("data-crop")).toBe("full");
  });

  it("ein Wechsel der Einstellung wirkt sofort auf die offene Bühne: dieselbe Wurzel, dieselbe Bühne, kein Neuaufbau", () => {
    switchTo("cockpit");
    const wrap = q(".cockpit-stage-wrap");
    const stage = q(".cockpit-stage");
    changeCrop("full");
    expect(q(".cockpit-stage-wrap")).toBe(wrap);
    expect(q(".cockpit-stage")).toBe(stage);
    expect(wrap.getAttribute("data-crop")).toBe("full");
    expect(stage.style.width).toBe("100%");
    changeCrop("crop");
    expect(wrap.getAttribute("data-crop")).toBe("crop");
    expect(stage.style.width).not.toBe("100%");
  });

  it("ein offener Zoom überlebt den Wechsel", () => {
    switchTo("cockpit");
    click(q(".cockpit-panel-usage"));
    changeCrop("full");
    expect(q(".cockpit-zoom").contains(cards[1])).toBe(true);
  });

  it("in der Listenansicht ändert der Wechsel nichts und wirft nicht", () => {
    expect(() => changeCrop("full")).not.toThrow();
    expect(root.querySelector(".cockpit-stage-wrap")).toBeNull();
  });

  it("die Einstellung wird bei jedem Wechsel frisch gelesen (nicht beim Start zwischengespeichert)", () => {
    switchTo("cockpit");
    changeCrop("full");
    switchTo("list");
    switchTo("cockpit");
    expect(q(".cockpit-stage-wrap").getAttribute("data-crop")).toBe("full");
  });
});

describe("Zoom verändert den Zustand der Liste nicht", () => {
  beforeEach(() => switchTo("cockpit"));

  it("Briefing klappt für den Zoom auf und beim Schließen wieder zu", () => {
    click(q(".cockpit-panel-briefing"));
    expect(expanded).toBe(true);
    click(q(".cockpit-zoom-close"));
    expect(expanded).toBe(false);
    expect(expandedCalls).toEqual([true, false]);
  });

  it("war es schon aufgeklappt, wird nichts angefasst", () => {
    expanded = true;
    click(q(".cockpit-panel-briefing"));
    click(q(".cockpit-zoom-close"));
    expect(expanded).toBe(true);
    expect(expandedCalls).toEqual([]);
  });

  it("Zoom ohne Briefing (Usage) ändert den Zustand nicht", () => {
    click(q(".cockpit-panel-usage"));
    click(q(".cockpit-zoom-close"));
    expect(expandedCalls).toEqual([]);
  });

  it("Wechsel auf Liste bei offenem Briefing-Zoom stellt ebenfalls zurück", () => {
    click(q(".cockpit-panel-briefing"));
    switchTo("list");
    expect(expanded).toBe(false);
  });
});

describe("Aufräumen beim Schließen", () => {
  it("destroy: keine Abos mehr, keine Dokument-Listener, keine weitere Zeichnung", () => {
    ctl.destroy();
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    ctl = make();
    switchTo("cockpit");
    click(q(".cockpit-panel-usage"));
    ctl.destroy();
    expect(add.mock.calls.length).toBeGreaterThan(0);
    expect(remove.mock.calls.map((c) => c[0]).sort()).toEqual(add.mock.calls.map((c) => c[0]).sort());
    expect(briefing.subscriberCount()).toBe(0);
    expect(sessions.subscriberCount()).toBe(0);
    expect(pull.subscriberCount()).toBe(0);
    expect(settingsSubs.size).toBe(0);
    expect(root.querySelector(".cockpit-stage-wrap")).toBeNull();
    add.mockRestore();
    remove.mockRestore();
  });

  it("nach destroy reagiert Escape nicht mehr und Änderungen lösen nichts aus", () => {
    switchTo("cockpit");
    click(q(".cockpit-panel-usage"));
    ctl.destroy();
    const ev = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(() => sessions.set(4)).not.toThrow();
  });

  it("destroy zweimal ist harmlos", () => {
    switchTo("cockpit");
    ctl.destroy();
    expect(() => ctl.destroy()).not.toThrow();
  });
});

describe("Abend 18: Feed bis zum Layout", () => {
  const radarInput = (id: string, name: string) => ({ id, name, cwd: "/v", running: true, failed: false, signal: "busy" as const, signalAt: 1, seen: true });
  const feedWith = (names: string[]): CockpitFeed => ({
    handoffs: [], sessions: names.map((n, i) => radarInput(`id${i}`, n)), active: null, tokensToday: null, focus: [], vault: null,
    repos: null, day: null, radars: [], unset: { projects: false, briefings: false, inbox: false, index: false, daily: false }, effort: "aus", telegramOn: false, soundOn: false,
  });

  it("Cockpit zeichnet den Feed, Klick auf die Radarzeile ruft focusSession, eine Änderung zeichnet neu", () => {
    const focused: string[] = [];
    let current = feedWith(["Alpha"]);
    const feedSubs = new Set<() => void>();
    const actions: CockpitFeedActions = {
      focusSession: (id) => focused.push(id), openBriefing: () => undefined, openNote: () => undefined,
      startLint: () => undefined, setEffort: () => undefined, toggleTelegram: () => undefined, toggleSound: () => undefined, newSession: () => undefined, openSettings: () => undefined,
    };
    ctl.destroy();
    layoutSetting = "cockpit";
    ctl = new DashboardLayoutController({
      root, doc: document, head, cards, backgroundUrl: "data:image/jpeg;base64,AAAA",
      layout: () => layoutSetting,
      crop: () => cropSetting,
      onSettingsChange: (cb) => { settingsSubs.add(cb); return () => { settingsSubs.delete(cb); }; },
      sources: [(cb) => { feedSubs.add(cb); return () => { feedSubs.delete(cb); }; }],
      inputs, clock: () => "21:20",
      isExpanded: () => false, setExpanded: () => undefined,
      feed: () => current, actions, settings: () => DEFAULT_SETTINGS, now: () => 1_000_000,
    });
    ctl.start();
    const row = q(".cockpit-radar-row");
    expect(row.textContent).toContain("Alpha");
    click(row);
    expect(focused).toEqual(["id0"]);
    current = feedWith(["Beta"]);
    for (const cb of [...feedSubs]) cb();
    expect(q(".cockpit-radar-row").textContent).toContain("Beta");
  });

  it("Kette Einstellungen -> Lint-Taste: mit lintCommand da, nach Änderung auf leer weg", () => {
    let lint = "/lint";
    const actions = { focusSession: () => undefined, openBriefing: () => undefined, openNote: () => undefined, startLint: () => undefined, setEffort: () => undefined, toggleTelegram: () => undefined, toggleSound: () => undefined, newSession: () => undefined, openSettings: () => undefined } as CockpitFeedActions;
    ctl.destroy();
    layoutSetting = "cockpit";
    ctl = new DashboardLayoutController({
      root, doc: document, head, cards, backgroundUrl: "data:image/jpeg;base64,AAAA",
      layout: () => layoutSetting,
      crop: () => cropSetting,
      onSettingsChange: (cb) => { settingsSubs.add(cb); return () => { settingsSubs.delete(cb); }; },
      sources: [],
      inputs, clock: () => "21:20",
      isExpanded: () => false, setExpanded: () => undefined,
      feed: () => feedWith([]), actions, settings: () => ({ ...DEFAULT_SETTINGS, lintCommand: lint }), now: () => 1_000_000,
    });
    ctl.start();
    click(q(".cockpit-field-vault .cockpit-field-clip"));
    expect(all(".cockpit-lint-button")).toHaveLength(1);
    lint = "";
    for (const cb of [...settingsSubs]) cb();
    expect(all(".cockpit-lint-button")).toHaveLength(0);
  });
});
