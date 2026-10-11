import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BannerManager, type BannerHandle } from "../src/core/banner-manager";
import { DEFAULT_BANNER_SECONDS } from "../src/core/constants";
import { DEFAULT_SETTINGS, parseSettings, validateSetting } from "../src/core/settings";
import { electronRemote } from "../src/host/electron";
import { ROOT } from "./helpers/files";

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Attrappen: Banner mit Protokoll und ein Zeitgeber, den der Test von Hand weiterdreht. */
function setup() {
  const made: { title: string; body: string; shown: boolean; closed: number; click: () => void }[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  const mgr = new BannerManager(
    (title, body): BannerHandle => {
      const rec = { title, body, shown: false, closed: 0, click: () => undefined as void };
      made.push(rec);
      return { show: () => { rec.shown = true; }, close: () => { rec.closed++; }, onClick: (cb) => { rec.click = cb; } };
    },
    { set: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; }, clear: (h) => { timers.delete(h as number); } },
  );
  const fire = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
  return { mgr, made, timers, fire };
}

// Abend 26c, Teil C: Web-Notification.close() wirkt nicht; nur die Hauptprozess-Notification lässt sich schließen.
describe("BannerManager", () => {
  it("zeigt das Banner und schließt es nach der eingestellten Zeit", () => {
    const { mgr, made, timers, fire } = setup();
    mgr.show("s1", "T", "B", () => undefined, 6);
    expect(made[0]).toMatchObject({ title: "T", body: "B", shown: true, closed: 0 });
    expect([...timers.values()].map((t) => t.ms)).toEqual([6000]);
    fire();
    expect(made[0].closed).toBe(1);
  });
  it("die Zeit kommt aus dem Aufruf, nicht aus einem festen Wert", () => {
    const { mgr, timers } = setup();
    mgr.show("s1", "T", "B", () => undefined, 17);
    expect([...timers.values()][0].ms).toBe(17000);
  });
  it("ein zweites Banner derselben Sitzung schließt das erste, andere Sitzungen bleiben", () => {
    const { mgr, made } = setup();
    mgr.show("s1", "T", "eins", () => undefined, 6);
    mgr.show("s2", "T", "andere", () => undefined, 6);
    mgr.show("s1", "T", "zwei", () => undefined, 6);
    expect(made.map((m) => m.closed)).toEqual([1, 0, 0]);
  });
  it("das ersetzte Banner schließt nicht nochmal, wenn sein alter Zeitgeber käme", () => {
    const { mgr, made, fire } = setup();
    mgr.show("s1", "T", "eins", () => undefined, 6);
    mgr.show("s1", "T", "zwei", () => undefined, 6);
    fire();
    expect(made.map((m) => m.closed)).toEqual([1, 1]);
  });
  it("closeAll schließt alle offenen Banner und räumt die Zeitgeber ab", () => {
    const { mgr, made, timers } = setup();
    mgr.show("s1", "T", "a", () => undefined, 6);
    mgr.show("s2", "T", "b", () => undefined, 6);
    mgr.closeAll();
    expect(made.map((m) => m.closed)).toEqual([1, 1]);
    expect(timers.size).toBe(0);
  });
  it("Klick ruft onClick, schließt nicht selbst nach und stoppt den Zeitgeber", () => {
    const { mgr, made, timers } = setup();
    const onClick = vi.fn();
    mgr.show("s1", "T", "a", onClick, 6);
    made[0].click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(made[0].closed).toBe(0);
    expect(timers.size).toBe(0);
  });
  it("wirft close(), bleibt es bei einer Warnung", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mgr = new BannerManager(
      () => ({ show: () => undefined, close: () => { throw new Error("weg"); }, onClick: () => undefined }),
      { set: () => 1, clear: () => undefined },
    );
    mgr.show("s1", "T", "a", () => undefined, 6);
    expect(() => mgr.closeAll()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("Einstellung bannerSeconds", () => {
  it("Vorgabe 6, Bereich 1 bis 60, ganze Zahl", () => {
    expect(DEFAULT_BANNER_SECONDS).toBe(6);
    expect(DEFAULT_SETTINGS.bannerSeconds).toBe(6);
    expect(parseSettings(undefined).settings.bannerSeconds).toBe(6);
    expect(validateSetting("bannerSeconds", 1)).toBeNull();
    expect(validateSetting("bannerSeconds", 60)).toBeNull();
    expect(validateSetting("bannerSeconds", 0)).toBe("ganze Zahl von 1 bis 60");
    expect(validateSetting("bannerSeconds", 61)).toBe("ganze Zahl von 1 bis 60");
    expect(validateSetting("bannerSeconds", 2.5)).not.toBeNull();
  });
  it("beim Laden geklemmt, Unfug meldet invalid", () => {
    expect(parseSettings({ bannerSeconds: 999 }).settings.bannerSeconds).toBe(60);
    expect(parseSettings({ bannerSeconds: 0 }).settings.bannerSeconds).toBe(1);
    const r = parseSettings({ bannerSeconds: "lang" });
    expect(r.invalid).toEqual(["bannerSeconds"]);
    expect(r.settings.bannerSeconds).toBe(6);
  });
});

describe("Verdrahtung", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("electronRemote holt @electron/remote über window.require, sonst null", () => {
    const remote = { Notification: class {} };
    const req = vi.fn((id: string) => { if (id === "@electron/remote") return remote; throw new Error("nix"); });
    vi.stubGlobal("window", { require: req });
    expect(electronRemote()).toBe(remote);
    vi.stubGlobal("window", { require: () => { throw new Error("fehlt"); } });
    expect(electronRemote()).toBeNull();
  });
  it("die View übergibt Sitzungs-ID und die Einstellung, die Einstellungsseite hat das Feld, main schließt beim Entladen", () => {
    expect(read("src/host/terminal-view.ts")).toMatch(/showBanner\(this\.contentEl\.win, id, "Glasscockpit", bannerText\(name, signal\), \(\) => this\.bringToFront\(\), s\.bannerSeconds\)/);
    expect(read("src/host/settings-tab.ts")).toMatch(/numberField\("bannerSeconds", "Banner ausblenden nach \(Sekunden\)"/);
    expect(read("src/main.ts")).toMatch(/onunload\(\): void \{[^}]*closeAllBanners\(\);/s);
  });
  it("attention-alert nimmt den Hauptprozess zuerst und hat die Web-Notification nur als Rückfall", () => {
    const src = read("src/host/attention-alert.ts");
    expect(src).toMatch(/electronRemote</);
    expect(src).toMatch(/silent: true/);
    expect(src).toMatch(/new BannerManager\(/);
  });
});
