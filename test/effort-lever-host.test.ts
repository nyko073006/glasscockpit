// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EffortStep } from "../src/core/effort";
import { type EffortLever, mountEffortLever } from "../src/host/effort-lever";
import { installObsidianDom } from "./helpers/obsidian-dom";

// Effort-Schieber (Abend 19e, Teil A), DOM: Ziehen mit Pointer-Events, Einrasten beim Loslassen, ein Aufruf je Zug.
// happy-dom misst keine Boxen: Der Schlitz bekommt oben 100 und eine Höhe von 200 (Stufenabstand 40).

const TOP = 100;
const HEIGHT = 200;
const yOf = (pos: number) => TOP + pos * HEIGHT;

let host: HTMLElement;
let lever: EffortLever;
let sets: EffortStep[];

const rail = () => host.querySelector<HTMLElement>(".cockpit-effort-rail")!;
const knob = () => host.querySelector<HTMLElement>(".cockpit-effort-knob")!;
const marks = () => [...host.querySelectorAll<HTMLElement>(".cockpit-effort-mark")];
const mark = (step: string) => marks().find((m) => m.dataset.step === step)!;
const marked = () => marks().filter((m) => m.classList.contains("cockpit-effort-mark-on")).map((m) => m.dataset.step);
const pos = () => Number(knob().style.getPropertyValue("--pos"));

const ptr = (type: string, y: number, init: PointerEventInit = {}) =>
  new window.PointerEvent(type, { clientY: y, pointerId: 1, pointerType: "mouse", button: 0, bubbles: true, cancelable: true, ...init });
const fire = (target: Element, type: string, y: number, init: PointerEventInit = {}) => target.dispatchEvent(ptr(type, y, init));
const key = (k: string, init: KeyboardEventInit = {}) => {
  const ev = new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  lever.el.dispatchEvent(ev);
  return ev;
};

beforeAll(() => installObsidianDom(window));
beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement("div");
  document.body.append(host);
  sets = [];
  lever = mountEffortLever({ doc: document, host, onSet: (s) => sets.push(s) });
  // Maße des Schlitzes: gilt für Zeiger und Griffversatz
  const r = host.querySelector<HTMLElement>(".cockpit-effort-rail");
  if (r) r.getBoundingClientRect = () => ({ top: TOP, height: HEIGHT, bottom: TOP + HEIGHT, left: 0, right: 30, width: 30, x: 0, y: TOP, toJSON: () => ({}) }) as DOMRect;
  lever.show("high");
});
afterEach(() => { host.remove(); });

describe("Aufbau", () => {
  it("ein Schieber mit role=slider, senkrecht, sechs Stufen, aria-label und Tastaturfokus", () => {
    expect(host.querySelectorAll(".cockpit-effort-lever")).toHaveLength(1);
    const el = lever.el;
    expect(el.getAttribute("role")).toBe("slider");
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
    expect(el.getAttribute("aria-label")).toBe("Effort der nächsten Sitzung");
    expect([el.getAttribute("aria-valuemin"), el.getAttribute("aria-valuemax")]).toEqual(["0", "5"]);
    expect(el.tabIndex).toBe(0);
    expect(host.contains(el)).toBe(true);
  });
  it("sechs Beschriftungen, max oben, aus unten, jede auf ihrer Position im Weg", () => {
    expect(marks().map((m) => m.textContent)).toEqual(["max", "xhigh", "high", "medium", "low", "aus"]);
    marks().forEach((m, i) => expect(Number(m.style.getPropertyValue("--pos"))).toBeCloseTo(i / 5, 10));
  });
  it("ein Griff, flach und breit gebaut aus einem Element mit Griffleiste", () => {
    expect(host.querySelectorAll(".cockpit-effort-knob")).toHaveLength(1);
    expect(knob().querySelector(".cockpit-effort-grip")).not.toBeNull();
  });
  it("show setzt Griff, Hervorhebung, aria-valuenow und aria-valuetext", () => {
    lever.show("medium");
    expect(pos()).toBeCloseTo(0.6, 10);
    expect(marked()).toEqual(["medium"]);
    expect(lever.el.getAttribute("aria-valuenow")).toBe("2");
    expect(lever.el.getAttribute("aria-valuetext")).toBe("medium, Stufe 3 von 6");
    expect(sets).toEqual([]);
  });
});

describe("Ziehen", () => {
  it("vor dem ersten Stand aus dem Feed tut der Schieber nichts", () => {
    const h2 = document.createElement("div");
    document.body.append(h2);
    const l2 = mountEffortLever({ doc: document, host: h2, onSet: (s) => sets.push(s) });
    const r2 = h2.querySelector<HTMLElement>(".cockpit-effort-rail")!;
    r2.getBoundingClientRect = rail().getBoundingClientRect;
    fire(l2.el, "pointerdown", yOf(0.8));
    fire(l2.el, "pointerup", yOf(0.8));
    expect(sets).toEqual([]);
    expect(l2.el.classList.contains("cockpit-effort-dragging")).toBe(false);
  });
  it("ein Zug im Schlitz: der Griff folgt, die Beschriftung der Stufe unter dem Griff leuchtet, gesetzt wird erst beim Loslassen", () => {
    fire(lever.el, "pointerdown", yOf(0.8));
    expect(lever.el.classList.contains("cockpit-effort-dragging")).toBe(true);
    expect(pos()).toBeCloseTo(0.8, 10);
    expect(marked()).toEqual(["low"]);
    fire(lever.el, "pointermove", yOf(0.5));
    expect(pos()).toBeCloseTo(0.5, 10); // frei, noch nicht eingerastet
    expect(marked()).toEqual(["high"]); // genau auf der Mitte gewinnt die höhere
    fire(lever.el, "pointermove", yOf(0.18));
    expect(marked()).toEqual(["xhigh"]);
    expect(sets).toEqual([]);
    fire(lever.el, "pointerup", yOf(0.18));
    expect(sets).toEqual(["xhigh"]);
    expect(pos()).toBeCloseTo(0.2, 10); // eingerastet
    expect(marked()).toEqual(["xhigh"]);
    expect(lever.el.classList.contains("cockpit-effort-dragging")).toBe(false);
  });
  it("ein Aufruf je Zug: viele Bewegungen über mehrere Stufen rufen onSet nur beim Loslassen und nur einmal", () => {
    fire(lever.el, "pointerdown", yOf(0.4));
    for (const p of [0.3, 0.1, 0, 0.2, 0.4, 0.6, 0.8, 1, 0.9, 0.75]) fire(lever.el, "pointermove", yOf(p));
    expect(sets).toEqual([]);
    fire(lever.el, "pointerup", yOf(0.75));
    expect(sets).toEqual(["low"]);
  });
  it("Loslassen zwischen zwei Stufen rastet auf die nähere ein", () => {
    fire(lever.el, "pointerdown", yOf(0.4));
    fire(lever.el, "pointermove", yOf(0.67));
    fire(lever.el, "pointerup", yOf(0.67));
    expect(sets).toEqual(["medium"]);
    expect(pos()).toBeCloseTo(0.6, 10);
  });
  it("ein Zug, der auf der alten Stufe endet, löst nichts aus", () => {
    fire(lever.el, "pointerdown", yOf(0.4));
    fire(lever.el, "pointermove", yOf(0.9));
    fire(lever.el, "pointermove", yOf(0.43));
    fire(lever.el, "pointerup", yOf(0.43));
    expect(sets).toEqual([]);
    expect(pos()).toBeCloseTo(0.4, 10);
  });
  it("Klemmen: Zeiger weit über und unter dem Schlitz geben max und aus", () => {
    fire(lever.el, "pointerdown", yOf(0.4));
    fire(lever.el, "pointermove", -500);
    fire(lever.el, "pointerup", -500);
    expect(sets).toEqual(["max"]);
    fire(lever.el, "pointerdown", yOf(0));
    fire(lever.el, "pointermove", 9000);
    fire(lever.el, "pointerup", 9000);
    expect(sets).toEqual(["max", "aus"]);
  });
  it("Griffversatz: am Griff gefasst springt der Griff nicht unter den Zeiger", () => {
    fire(knob(), "pointerdown", yOf(0.4) + 3); // 3 px unter der Mitte des Griffs
    expect(pos()).toBeCloseTo(0.4, 10);
    fire(lever.el, "pointermove", yOf(0.6) + 3);
    expect(pos()).toBeCloseTo(0.6, 10);
    fire(lever.el, "pointerup", yOf(0.6) + 3);
    expect(sets).toEqual(["medium"]);
  });
  it("irgendwo im Schlitz gefasst springt der Griff unter den Zeiger", () => {
    fire(rail(), "pointerdown", yOf(0.9));
    expect(pos()).toBeCloseTo(0.9, 10);
    fire(rail(), "pointerup", yOf(0.9));
    expect(sets).toEqual(["aus"]);
  });
  it("pointercancel lässt den Griff, wo er war, und ruft nichts", () => {
    fire(lever.el, "pointerdown", yOf(0.4));
    fire(lever.el, "pointermove", yOf(1));
    fire(lever.el, "pointercancel", yOf(1));
    expect(sets).toEqual([]);
    expect(pos()).toBeCloseTo(0.4, 10);
    expect(marked()).toEqual(["high"]);
    expect(lever.el.classList.contains("cockpit-effort-dragging")).toBe(false);
  });
  it("ein zweiter Zeiger stört den Zug nicht, die rechte Maustaste fängt keinen an", () => {
    fire(lever.el, "pointerdown", yOf(0.4), { button: 2 });
    expect(lever.el.classList.contains("cockpit-effort-dragging")).toBe(false);
    fire(lever.el, "pointerdown", yOf(0.4));
    fire(lever.el, "pointerdown", yOf(1), { pointerId: 2 });
    fire(lever.el, "pointermove", yOf(0), { pointerId: 2 });
    fire(lever.el, "pointerup", yOf(0), { pointerId: 2 });
    expect(sets).toEqual([]);
    expect(lever.el.classList.contains("cockpit-effort-dragging")).toBe(true);
    fire(lever.el, "pointermove", yOf(0.6));
    fire(lever.el, "pointerup", yOf(0.6));
    expect(sets).toEqual(["medium"]);
  });
  it("ein Weg mit Höhe 0 ändert nichts: kein Zug, kein onSet", () => {
    rail().getBoundingClientRect = () => ({ top: TOP, height: 0, bottom: TOP, left: 0, right: 30, width: 30, x: 0, y: TOP, toJSON: () => ({}) }) as DOMRect;
    fire(lever.el, "pointerdown", yOf(0.9));
    fire(lever.el, "pointerup", yOf(0.9));
    expect(sets).toEqual([]);
    expect(lever.el.classList.contains("cockpit-effort-dragging")).toBe(false);
    expect(pos()).toBeCloseTo(0.4, 10);
  });
});

describe("Klick auf eine Beschriftung und Tasten", () => {
  it("Klick auf eine andere Beschriftung springt dorthin und ruft onSet einmal", () => {
    mark("max").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(sets).toEqual(["max"]);
    expect(pos()).toBe(0);
    expect(marked()).toEqual(["max"]);
  });
  it("Klick auf die gewählte Stufe löst nichts aus; die nächste Wahl zählt gegen die neue Stufe", () => {
    mark("high").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(sets).toEqual([]);
    mark("aus").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    mark("aus").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(sets).toEqual(["aus"]);
  });
  it("auf einer Beschriftung fängt kein Zug an", () => {
    fire(mark("low"), "pointerdown", yOf(0.8));
    expect(lever.el.classList.contains("cockpit-effort-dragging")).toBe(false);
  });
  it("Pfeiltasten, Pos1 und Ende wie in 18b", () => {
    expect(key("ArrowUp").defaultPrevented).toBe(true);
    expect(sets).toEqual(["xhigh"]);
    key("ArrowDown"); key("ArrowDown");
    expect(sets).toEqual(["xhigh", "high", "medium"]);
    key("Home");
    expect(sets.at(-1)).toBe("aus");
    key("End");
    expect(sets.at(-1)).toBe("max");
    key("ArrowUp"); // schon oben: nichts Neues
    expect(sets).toHaveLength(5);
  });
  it("fremde Tasten und Tasten mit Strg, Alt oder Cmd gehören dem Schieber nicht", () => {
    expect(key("a").defaultPrevented).toBe(false);
    expect(key("Enter").defaultPrevented).toBe(false);
    expect(key("ArrowUp", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("ArrowUp", { metaKey: true }).defaultPrevented).toBe(false);
    expect(sets).toEqual([]);
  });
});

describe("Stand von außen (Feed)", () => {
  it("eine neue Stufe aus dem Feed schiebt den Griff mit", () => {
    lever.show("max");
    expect(pos()).toBe(0);
    expect(marked()).toEqual(["max"]);
    lever.show("aus");
    expect(pos()).toBe(1);
    expect(sets).toEqual([]);
  });
  it("während eines Zugs bleibt der Griff in der Hand; beim Loslassen zählt der neue Stand als alte Stufe", () => {
    fire(lever.el, "pointerdown", yOf(0.4));
    fire(lever.el, "pointermove", yOf(0.2));
    lever.show("low"); // Feed meldet mitten im Zug eine andere Stufe
    expect(pos()).toBeCloseTo(0.2, 10);
    expect(marked()).toEqual(["xhigh"]);
    fire(lever.el, "pointerup", yOf(0.2));
    expect(sets).toEqual(["xhigh"]);
  });
  it("endet der Zug auf der Stufe, die der Feed mittendrin gemeldet hat, bleibt onSet stumm", () => {
    fire(lever.el, "pointerdown", yOf(0.4));
    fire(lever.el, "pointermove", yOf(0.8));
    lever.show("low");
    fire(lever.el, "pointerup", yOf(0.8));
    expect(sets).toEqual([]);
    expect(pos()).toBeCloseTo(0.8, 10);
  });
});
