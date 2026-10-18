// @vitest-environment happy-dom
import type { ILink, ILinkProvider } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PressGuard } from "../src/core/link-guard";
import { guardLinkProvider, trackPresses } from "../src/host/link-guard";

const link = (sy: number, ey: number, activate = vi.fn()): ILink => ({
  range: { start: { x: 1, y: sy }, end: { x: 4, y: ey } }, text: "x", activate,
});
const providerOf = (links: ILink[] | undefined): ILinkProvider => ({ provideLinks: (_y, cb) => cb(links) });
const ask = (p: ILinkProvider, y: number): ILink[] | undefined => {
  let got: ILink[] | undefined = [];
  p.provideLinks(y, (l) => (got = l));
  return got;
};
const ev = { button: 0 } as MouseEvent;

describe("guardLinkProvider: Zeilenfilter", () => {
  it("lässt nur Links durch, die Zeile y berühren, und gibt dieselben Objekte weiter", () => {
    const above = link(1, 1), here = link(2, 2), spanning = link(1, 2), below = link(3, 3);
    const got = ask(guardLinkProvider(providerOf([above, here, spanning, below]), () => true), 2);
    expect(got).toEqual([here, spanning]);
    expect(got?.[0]).toBe(here); // gleiches Objekt: xterm ersetzt decorations daran (FileLinkProvider)
  });
  it("bleibt keiner übrig oder liefert der Provider undefined: undefined", () => {
    expect(ask(guardLinkProvider(providerOf([link(1, 1)]), () => true), 2)).toBeUndefined();
    expect(ask(guardLinkProvider(providerOf(undefined), () => true), 2)).toBeUndefined();
  });
});

describe("guardLinkProvider: Druckwächter", () => {
  it("activate nur bei laufendem Druck, mit Ereignis und Text", () => {
    let pressed = false;
    const inner = vi.fn();
    const [l] = ask(guardLinkProvider(providerOf([link(2, 2, inner)]), () => pressed), 2) ?? [];
    l.activate(ev, "x");
    expect(inner).not.toHaveBeenCalled();
    pressed = true;
    l.activate(ev, "x");
    expect(inner).toHaveBeenCalledWith(ev, "x");
  });
});

describe("trackPresses", () => {
  let off: (() => void) | null = null;
  afterEach(() => { off?.(); off = null; document.body.innerHTML = ""; });
  const setup = () => {
    const host = document.createElement("div");
    const inner = document.createElement("div");
    host.appendChild(inner);
    document.body.appendChild(host);
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const guard = new PressGuard();
    off = trackPresses(host, guard);
    return { host, inner, outside, guard };
  };
  const fire = (el: Element, type: string) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
  const later = () => new Promise((r) => setTimeout(r, 10));

  it("Druck im Terminal ist während des eigenen mouseup noch aktiv, danach nicht mehr", async () => {
    const { inner, guard } = setup();
    let duringUp: boolean | null = null;
    inner.addEventListener("mouseup", () => { duringUp = guard.active(); }); // wie xterms Linkifier
    fire(inner, "mousedown");
    expect(guard.active()).toBe(true);
    fire(inner, "mouseup");
    expect(duringUp).toBe(true);
    await later();
    expect(guard.active()).toBe(false);
  });
  it("Druck außerhalb macht nicht aktiv", () => {
    const { outside, guard } = setup();
    fire(outside, "mousedown");
    expect(guard.active()).toBe(false);
  });
  it("Rechtsklick ohne mouseup, dann Druck außerhalb: nicht aktiv", () => {
    const { inner, outside, guard } = setup();
    fire(inner, "mousedown");
    fire(outside, "mousedown");
    expect(guard.active()).toBe(false);
  });
  it("Druck im Terminal, Loslassen außerhalb, dann Druck außerhalb und Loslassen im Terminal: nicht aktiv", async () => {
    const { inner, outside, guard } = setup();
    fire(inner, "mousedown"); fire(outside, "mouseup"); await later();
    fire(outside, "mousedown");
    let duringUp: boolean | null = null;
    inner.addEventListener("mouseup", () => { duringUp = guard.active(); });
    fire(inner, "mouseup");
    expect(duringUp).toBe(false);
  });
  it("Doppelklick: das verzögerte Ende des ersten Klicks beendet den zweiten Druck nicht", async () => {
    const { inner, guard } = setup();
    fire(inner, "mousedown"); fire(inner, "mouseup");
    fire(inner, "mousedown"); // vor dem verzögerten Ende des ersten
    await later();
    expect(guard.active()).toBe(true);
  });
  it("Element ohne Fenster: ein Druck macht nicht aktiv (es gäbe kein Ende)", () => {
    const listeners: Record<string, () => void> = {};
    const el = {
      ownerDocument: { defaultView: null },
      addEventListener: (type: string, fn: () => void) => { listeners[type] = fn; },
      removeEventListener: () => {},
    } as unknown as HTMLElement;
    const guard = new PressGuard();
    off = trackPresses(el, guard);
    expect(listeners.mousedown).toBeTypeOf("function"); // Listener ist angemeldet, sonst wäre der Test vakuum
    listeners.mousedown();
    expect(guard.active()).toBe(false);
  });
  it("Abmeldung: danach macht ein Druck nicht mehr aktiv", () => {
    const { inner, guard } = setup();
    off?.(); off = null;
    fire(inner, "mousedown");
    expect(guard.active()).toBe(false);
  });
});
