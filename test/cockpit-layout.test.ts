// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CardId, FIELDS, PANELS, type PanelValues, VIEW_CROP, polygonCss, stagePlacement, viewAspect, viewRect } from "../src/core/cockpit-panels";
import { type CockpitLayout, createCockpitLayout } from "../src/host/cockpit-layout";

// Die Bühne der Cockpit-Ansicht (Abend 15): nur DOM-APIs, das Dokument kommt als Parameter.

const CARD_IDS: CardId[] = ["pull", "briefing", "usage", "tasks", "skills", "research"];

const values = (o: Partial<PanelValues> = {}): PanelValues => ({
  briefing: { big: "05.10.", lines: ["Abend 15: Cockpit-Ansicht"], tone: "plain" },
  usage: { big: "42 %", lines: ["noch 2:13"], tone: "green" },
  tasks: { big: "3", lines: ["Erste", "Zweite"], tone: "plain" },
  research: { big: "2", lines: ["alpha", "beta"], tone: "plain" },
  system: { big: "OK", lines: ["Pull 21:20"], tone: "green" },
  week: { big: "38 %", lines: ["Reset 3 T 0 Std"], tone: "green", bar: 38 },
  warnings: { big: "", lines: ["5h knapp"], tone: "yellow" },
  lampPull: "green",
  ...o,
});

let host: HTMLElement;
let layout: CockpitLayout;
let cards: Record<CardId, HTMLElement>;
let zooms: string[];
let zoomCloses: number;

function make(): CockpitLayout {
  cards = Object.fromEntries(CARD_IDS.map((id) => {
    const el = document.createElement("div");
    el.className = `fake-card fake-${id}`;
    el.textContent = id;
    return [id, el];
  })) as unknown as Record<CardId, HTMLElement>;
  zooms = [];
  zoomCloses = 0;
  const l = createCockpitLayout({
    doc: document,
    backgroundUrl: "data:image/jpeg;base64,AAAA",
    cards,
    onZoom: (id) => zooms.push(id),
    onZoomClose: () => { zoomCloses++; },
  });
  host.append(l.el);
  l.update(values());
  return l;
}

const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = host): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`nicht gefunden: ${sel}`);
  return el;
};
const all = (sel: string, root: ParentNode = host): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const esc = (target: EventTarget = q(".cockpit-zoom-panel")) => target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement("div");
  document.body.append(host);
  layout = make();
});
afterEach(() => {
  layout.destroy();
});

describe("Bühne", () => {
  it("hat das Seitenverhältnis des Bilds (die volle Bühne), schwarzen Rand und ist Container für cqw", () => {
    const stage = q(".cockpit-stage");
    expect(stage.style.getPropertyValue("aspect-ratio").replace(/\s/g, "")).toBe("1536/1942");
    // container-type steht im Stylesheet (Linter: keine festen Stile per Skript).
    expect(readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8")).toMatch(/\n\.cockpit-stage \{[^}]*container-type:\s*inline-size/);
    expect(q(".cockpit-stage-wrap")).toBeTruthy();
  });

  it("das Hintergrundbild ist ein <img> mit der übergebenen URL, nicht ziehbar, ohne Beschreibung", () => {
    const img = q<HTMLImageElement>("img.cockpit-bg");
    expect(img.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("draggable")).toBe("false");
  });

  it("jede Fläche steht an ihrer Stelle in Prozent, mit clip-path aus der Geometrie", () => {
    for (const p of PANELS) {
      const el = q(`.cockpit-panel-${p.id}`);
      expect(el.style.left).toBe(`${p.rect.x}%`);
      expect(el.style.top).toBe(`${p.rect.y}%`);
      expect(el.style.width).toBe(`${p.rect.w}%`);
      expect(el.style.height).toBe(`${p.rect.h}%`);
      expect(q(".cockpit-panel-clip", el).style.getPropertyValue("clip-path")).toBe(polygonCss(p.polygon));
    }
  });

  it("Textbereich der Fläche liegt in Prozent der Fläche", () => {
    const p = PANELS.find((x) => x.id === "briefing");
    const c = q(".cockpit-panel-briefing .cockpit-panel-content");
    expect([c.style.left, c.style.top, c.style.width, c.style.height]).toEqual([`${p!.content.x}%`, `${p!.content.y}%`, `${p!.content.w}%`, `${p!.content.h}%`]);
  });

  it("die Karten liegen im verborgenen Regal, nicht auf der Bühne sichtbar", () => {
    for (const id of CARD_IDS) expect(layout.shelf.contains(cards[id])).toBe(true);
    expect(layout.shelf.getAttribute("aria-hidden")).toBe("true");
    expect(layout.shelf.className).toContain("cockpit-shelf");
  });
});

describe("Instrumente", () => {
  it("zeigen große Zahl, Zeilen und Ampelfarbe als Klasse", () => {
    const usage = q(".cockpit-panel-usage");
    expect(q(".cockpit-inst-big", usage).textContent).toBe("42 %");
    expect(all(".cockpit-inst-line", usage).map((e) => e.textContent)).toEqual(["noch 2:13"]);
    expect(usage.className).toContain("cockpit-tone-green");
    expect(q(".cockpit-panel-briefing").className).toContain("cockpit-tone-plain");
  });

  it("ein neuer Stand ersetzt den alten (keine Dopplung)", () => {
    layout.update(values({ usage: { big: "91 %", lines: ["noch 0:05"], tone: "red" } }));
    layout.update(values({ usage: { big: "91 %", lines: ["noch 0:05"], tone: "red" } }));
    const usage = q(".cockpit-panel-usage");
    expect(all(".cockpit-inst-big", usage).length).toBe(1);
    expect(all(".cockpit-inst-line", usage).map((e) => e.textContent)).toEqual(["noch 0:05"]);
    expect(usage.className).toContain("cockpit-tone-red");
    expect(usage.className).not.toContain("cockpit-tone-green");
  });

  it("fremder Text landet nur als Text, nie als HTML", () => {
    layout.update(values({ research: { big: "1", lines: ["<img src=x onerror=boom()>"], tone: "plain" } }));
    const research = q(".cockpit-panel-research");
    expect(research.querySelector("img")).toBeNull();
    expect(q(".cockpit-inst-line", research).textContent).toBe("<img src=x onerror=boom()>");
  });

  it("Lampen tragen die Ampelfarbe", () => {
    expect(q(".cockpit-panel-lamp-pull").className).toContain("cockpit-tone-green");
    layout.update(values({ lampPull: "gray" }));
    expect(q(".cockpit-panel-lamp-pull").className).toContain("cockpit-tone-gray");
    layout.update(values({ lampPull: "red" }));
    expect(q(".cockpit-panel-lamp-pull").className).toContain("cockpit-tone-red");
  });

  it("die Usage-Lampe gibt es nicht mehr (19d): nur die Pull-Lampe ist im DOM, auch nach update", () => {
    layout.update(values());
    expect(host.querySelector(".cockpit-panel-lamp-usage")).toBeNull();
    expect([...host.querySelectorAll(".cockpit-panel")].filter((e) => e.className.includes("lamp")).map((e) => e.className.match(/cockpit-panel-(lamp-[a-z]+)/)?.[1])).toEqual(["lamp-pull"]);
    expect(host.querySelectorAll(".cockpit-panel").length).toBe(PANELS.length);
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(css).not.toMatch(/lamp-usage/);
  });

  it("Flächen sind bedienbar: Rolle Knopf, Tastaturfokus, Name", () => {
    const el = q(".cockpit-panel-tasks");
    expect(el.getAttribute("role")).toBe("button");
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.getAttribute("aria-label")).toContain("Aufgaben");
  });
});

describe("Skills-MFD ist entfernt (Abend 19b)", () => {
  it("kein Skills-Schirm auf der Bühne: weder Fläche noch Titel noch Tasten; die Skill-Karte bleibt im Regal", () => {
    expect(all(".cockpit-panel-skills")).toHaveLength(0);
    expect(all(".cockpit-mfd-title, .cockpit-mfd-key, .cockpit-mfd-hint")).toHaveLength(0);
    expect(layout.shelf.contains(cards.skills)).toBe(true);
  });
  it("die Bühne hat genau die acht Panels der Geometrie", () => {
    expect(all(".cockpit-panel")).toHaveLength(8);
    expect(all(".cockpit-panel").map((e) => e.className.match(/cockpit-panel-([\w-]+)/)?.[1]).sort()).toEqual(PANELS.map((p) => p.id).sort());
  });
});

describe("Woche und Warnungen", () => {
  it("Woche: Balken mit Breite und aria-valuenow, Prozent groß", () => {
    const week = q(".cockpit-panel-week");
    const bar = q(".cockpit-inst-bar", week);
    expect(bar.getAttribute("role")).toBe("progressbar");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuenow")).toBe("38");
    expect(q(".cockpit-inst-bar-fill", bar).style.width).toBe("38%");
    expect(q(".cockpit-inst-big", week).textContent).toBe("38 %");
    expect(week.className).toContain("cockpit-tone-green");
  });
  it("ein neuer Stand ersetzt den alten, keine Dopplung", () => {
    layout.update(values({ week: { big: "91 %", lines: ["Reset 0:05"], tone: "red", bar: 91 } }));
    const week = q(".cockpit-panel-week");
    expect(all(".cockpit-inst-bar", week).length).toBe(1);
    expect(q(".cockpit-inst-bar", week).getAttribute("aria-valuenow")).toBe("91");
    expect(q(".cockpit-inst-bar-fill", week).style.width).toBe("91%");
    expect(week.className).toContain("cockpit-tone-red");
  });
  it("Flächen ohne bar haben keinen Balken", () => {
    expect(all(".cockpit-inst-bar", q(".cockpit-panel-usage")).length).toBe(0);
  });
  it("leeres big wird nicht gerendert, die Zeilen schon", () => {
    const w = q(".cockpit-panel-warnings");
    expect(all(".cockpit-inst-big", w).length).toBe(0);
    expect(all(".cockpit-inst-line", w).map((e) => e.textContent)).toEqual(["5h knapp"]);
    expect(q(".cockpit-inst-title", w).textContent).toBe("WARNUNGEN");
    expect(w.className).toContain("cockpit-tone-yellow");
  });
  it("kritisch: das Ausrufezeichen steht im Warnungsfeld, und ein entspannter Stand nimmt es wieder weg", () => {
    layout.update(values({ warnings: { big: "!", lines: ["5h knapp"], tone: "red" } }));
    const w = q(".cockpit-panel-warnings");
    expect(all(".cockpit-inst-big", w).map((e) => e.textContent)).toEqual(["!"]);
    expect(w.className).toContain("cockpit-tone-red");
    layout.update(values());
    expect(all(".cockpit-inst-big", w).length).toBe(0);
  });
  it("Klick auf Woche und Warnungen öffnet den Zoom mit der Usage-Karte", () => {
    click(q(".cockpit-panel-week"));
    expect(layout.zoomed()).toBe("week");
    expect(q(".cockpit-zoom-body").contains(cards.usage)).toBe(true);
    layout.closeZoom();
    click(q(".cockpit-panel-warnings"));
    expect(layout.zoomed()).toBe("warnings");
    expect(q(".cockpit-zoom-body").contains(cards.usage)).toBe(true);
  });
});

describe("Tastenfeld ist entfernt (Abend 18b)", () => {
  it("die Bühne hat keine NEU/SKILL/CMD/REPOS-Tasten mehr", () => {
    expect(all(".cockpit-key")).toHaveLength(0);
    expect(all(".cockpit-key-face")).toHaveLength(0);
  });
});

describe("Escape gilt nur im Cockpit", () => {
  it("Escape aus einem anderen Bereich (Terminal rechts) schließt den Zoom nicht und wird nicht abgefangen", () => {
    layout.zoom("usage");
    const fremd = document.createElement("div");
    document.body.append(fremd);
    const seen: string[] = [];
    document.addEventListener("keydown", () => seen.push("bubble"));
    const ev = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    fremd.dispatchEvent(ev);
    expect(layout.zoomed()).toBe("usage");
    expect(ev.defaultPrevented).toBe(false);
    expect(seen).toEqual(["bubble"]);
  });
  it("Escape aus dem Zoom schließt und geht nicht weiter (stopPropagation)", () => {
    layout.zoom("usage");
    const seen: string[] = [];
    document.addEventListener("keydown", () => seen.push("bubble"));
    esc();
    expect(layout.zoomed()).toBeNull();
    expect(seen).toEqual([]);
  });
  it("Escape von der Bühne aus (nicht im Overlay) schließt ebenfalls", () => {
    layout.zoom("usage");
    esc(q(".cockpit-stage"));
    expect(layout.zoomed()).toBeNull();
  });
});

describe("Zoom", () => {
  it("meldet das Schließen genau einmal (onZoomClose)", () => {
    layout.zoom("usage");
    layout.closeZoom();
    layout.closeZoom();
    expect(zoomCloses).toBe(1);
  });

  it("Klick auf eine Fläche zeigt die volle Karte im Overlay, dieselbe Element-Instanz", () => {
    click(q(".cockpit-panel-usage"));
    expect(layout.zoomed()).toBe("usage");
    const overlay = q(".cockpit-zoom");
    expect(overlay.contains(cards.usage)).toBe(true);
    expect(layout.shelf.contains(cards.usage)).toBe(false);
    expect(zooms).toEqual(["usage"]);
  });

  it("System zeigt nur noch den Kopf mit „Jetzt pullen“, nicht mehr zusätzlich das Briefing", () => {
    click(q(".cockpit-panel-system"));
    const body = q(".cockpit-zoom-body");
    expect([...body.children]).toEqual([cards.pull]);
    expect(zooms).toEqual(["system"]);
  });

  it("die Pull-Lampe öffnet ebenfalls nur den Kopf", () => {
    click(q(".cockpit-panel-lamp-pull"));
    expect([...q(".cockpit-zoom-body").children]).toEqual([cards.pull]);
  });

  it("Tastatur: Enter und Leertaste auf einer Fläche öffnen den Zoom", () => {
    q(".cockpit-panel-tasks").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(layout.zoomed()).toBe("tasks");
    layout.closeZoom();
    q(".cockpit-panel-research").dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(layout.zoomed()).toBe("research");
  });

  it("Escape schließt, die Karte geht zurück ins Regal an ihren Platz", () => {
    click(q(".cockpit-panel-tasks"));
    esc();
    expect(layout.zoomed()).toBeNull();
    expect(document.querySelector(".cockpit-zoom")).toBeNull();
    expect([...layout.shelf.children]).toEqual(CARD_IDS.map((id) => cards[id]));
  });

  it("✕ schließt", () => {
    click(q(".cockpit-panel-tasks"));
    const x = q(".cockpit-zoom-close");
    expect(x.getAttribute("aria-label")).toBe("Schließen");
    click(x);
    expect(layout.zoomed()).toBeNull();
  });

  it("Klick daneben (auf den Hintergrund) schließt, Klick in die Karte nicht", () => {
    click(q(".cockpit-panel-tasks"));
    click(cards.tasks);
    expect(layout.zoomed()).toBe("tasks");
    click(q(".cockpit-zoom-panel"));
    expect(layout.zoomed()).toBe("tasks");
    click(q(".cockpit-zoom"));
    expect(layout.zoomed()).toBeNull();
  });

  it("höchstens eins offen: ein zweiter Zoom ersetzt den ersten, kein zweites Overlay", () => {
    click(q(".cockpit-panel-usage"));
    click(q(".cockpit-panel-research"));
    expect(all(".cockpit-zoom").length).toBe(1);
    expect(layout.zoomed()).toBe("research");
    expect(layout.shelf.contains(cards.usage)).toBe(true);
    expect(q(".cockpit-zoom").contains(cards.research)).toBe(true);
  });

  it("derselbe Zoom zweimal geöffnet bleibt ein Overlay", () => {
    layout.zoom("usage");
    layout.zoom("usage");
    expect(all(".cockpit-zoom").length).toBe(1);
    expect([...q(".cockpit-zoom-body").children]).toEqual([cards.usage]);
  });

  it("Escape ohne offenen Zoom tut nichts und stört andere nicht", () => {
    const ev = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("beim Schließen bleiben keine Abos: Dokument-Listener sind genauso oft abgemeldet wie angemeldet", () => {
    layout.destroy();
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    layout = make();
    layout.zoom("usage");
    layout.closeZoom();
    layout.zoom("tasks");
    layout.zoom("research");
    layout.closeZoom();
    expect(add.mock.calls.length).toBeGreaterThan(0);
    expect(remove.mock.calls.map((c) => c[0]).sort()).toEqual(add.mock.calls.map((c) => c[0]).sort());
    add.mockRestore();
    remove.mockRestore();
  });

  it("beim Schließen bleiben keine Timer liegen", () => {
    vi.useFakeTimers();
    try {
      layout.zoom("usage");
      layout.closeZoom();
      layout.zoom("tasks");
      layout.destroy();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroy schließt den Zoom, entfernt die Bühne und gibt die Karten zurück ins Regal", () => {
    layout.zoom("usage");
    layout.destroy();
    expect(layout.zoomed()).toBeNull();
    expect(host.querySelector(".cockpit-stage-wrap")).toBeNull();
    expect(document.querySelector(".cockpit-zoom")).toBeNull();
    expect(cards.usage.parentElement).toBe(layout.shelf);
  });

  it("nach destroy reagiert Escape nicht mehr (Listener weg)", () => {
    layout.zoom("usage");
    layout.destroy();
    const ev = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

// Ausschnitt (Abend 19b): Die Bühne steht in einem Fenster; zugeschnitten ist sie größer als das Fenster und nach links oben geschoben,
// voll füllt sie es. Alle Prozentwerte der Flächen bleiben die der vollen Bühne.
describe("Ausschnitt: Fenster über der Bühne", () => {
  const stage = () => q(".cockpit-stage");
  const win = () => q(".cockpit-window");
  const place = (el: HTMLElement) => [el.style.left, el.style.top, el.style.width, el.style.height];
  const everyPlace = () => [...PANELS.map((p) => place(q(`.cockpit-panel-${p.id}`))), ...FIELDS.map((f) => place(q(`.cockpit-field-${f.id}`)))];

  it("Vorgabe zugeschnitten: Wurzel, Fenster, Bühne; das Fenster hat das Seitenverhältnis des Ausschnitts, die Bühne ist größer und nach links oben geschoben", () => {
    expect(win().parentElement).toBe(q(".cockpit-stage-wrap"));
    expect(stage().parentElement).toBe(win());
    expect(layout.crop()).toBe("crop");
    const p = stagePlacement(VIEW_CROP);
    expect([stage().style.width, stage().style.left, stage().style.top]).toEqual([`${p.width}%`, `${p.left}%`, `${p.top}%`]);
    expect(Number(win().style.getPropertyValue("--cockpit-view-aspect"))).toBeCloseTo(viewAspect(VIEW_CROP), 6);
    expect(q(".cockpit-stage-wrap").getAttribute("data-crop")).toBe("crop");
  });

  it("voll: das Fenster hat das Seitenverhältnis des Bilds, die Bühne füllt es ohne Versatz", () => {
    layout.setCrop("full");
    expect(layout.crop()).toBe("full");
    expect([stage().style.width, stage().style.left, stage().style.top]).toEqual(["100%", "0%", "0%"]);
    expect(Number(win().style.getPropertyValue("--cockpit-view-aspect"))).toBeCloseTo(viewAspect(viewRect("full")), 6);
    expect(q(".cockpit-stage-wrap").getAttribute("data-crop")).toBe("full");
  });

  it("hin und zurück: setCrop stellt exakt den Ausgangszustand wieder her", () => {
    const vorher = [stage().style.width, stage().style.left, stage().style.top, win().style.getPropertyValue("--cockpit-view-aspect")];
    layout.setCrop("full");
    layout.setCrop("crop");
    expect([stage().style.width, stage().style.left, stage().style.top, win().style.getPropertyValue("--cockpit-view-aspect")]).toEqual(vorher);
  });

  it("alle Prozentwerte der Flächen bleiben die der vollen Bühne, in beiden Ansichten (kein Umrechnen, kein neues Bild)", () => {
    const zugeschnitten = everyPlace();
    layout.setCrop("full");
    expect(everyPlace()).toEqual(zugeschnitten);
    for (const p of PANELS) expect(place(q(`.cockpit-panel-${p.id}`))).toEqual([`${p.rect.x}%`, `${p.rect.y}%`, `${p.rect.w}%`, `${p.rect.h}%`]);
    for (const f of FIELDS) expect(place(q(`.cockpit-field-${f.id}`))).toEqual([`${f.rect.x}%`, `${f.rect.y}%`, `${f.rect.w}%`, `${f.rect.h}%`]);
  });

  it("das Bild ist dasselbe Element in beiden Ansichten (kein zweites Bild, kein Neuaufbau der Flächen)", () => {
    const img = q("img.cockpit-bg");
    const radar = q(".cockpit-field-radar");
    layout.setCrop("full");
    expect(q("img.cockpit-bg")).toBe(img);
    expect(q(".cockpit-field-radar")).toBe(radar);
    expect(all("img.cockpit-bg")).toHaveLength(1);
  });

  it("der Zoom liegt über der ganzen Pane (Kind der Wurzel, nicht des Fensters) und bleibt beim Wechsel offen", () => {
    layout.zoom("usage");
    expect(q(".cockpit-zoom").parentElement).toBe(q(".cockpit-stage-wrap"));
    layout.setCrop("full");
    expect(layout.zoomed()).toBe("usage");
    expect(q(".cockpit-zoom").parentElement).toBe(q(".cockpit-stage-wrap"));
    expect(q(".cockpit-zoom").contains(cards.usage)).toBe(true);
    layout.setCrop("crop");
    expect(layout.zoomed()).toBe("usage");
  });

  it("die Instrumente überstehen den Wechsel (gleiche Werte, gleiche Elemente)", () => {
    const usage = q(".cockpit-panel-usage .cockpit-inst-big");
    layout.setCrop("full");
    expect(q(".cockpit-panel-usage .cockpit-inst-big")).toBe(usage);
    expect(usage.textContent).toBe("42 %");
  });

  it("dasselbe Setzen zweimal ändert nichts (kein Flackern, kein Neuschreiben)", () => {
    const before = stage().getAttribute("style");
    layout.setCrop("crop");
    expect(stage().getAttribute("style")).toBe(before);
  });

  it("startet mit der übergebenen Ansicht", () => {
    layout.destroy();
    const l2 = createCockpitLayout({ doc: document, backgroundUrl: "data:,", cards, crop: "full" });
    host.append(l2.el);
    expect(l2.crop()).toBe("full");
    expect(q(".cockpit-stage").style.width).toBe("100%");
    l2.destroy();
    layout = make();
  });

  it("destroy lässt kein Fenster zurück", () => {
    layout.destroy();
    expect(document.querySelector(".cockpit-window")).toBeNull();
    layout = make();
  });
});
