import { describe, expect, it } from "vitest";
import { RecentSessions } from "../src/core/active-session";

const all = () => true;

describe("RecentSessions", () => {
  it("leer: null", () => expect(new RecentSessions().current(all)).toBeNull());
  it("zuletzt berührte zuerst", () => {
    const r = new RecentSessions();
    r.touch("a");
    r.touch("b");
    expect(r.current(all)).toBe("b");
    r.touch("a");
    expect(r.current(all)).toBe("a");
  });
  it("überspringt nicht mehr offene", () => {
    const r = new RecentSessions();
    r.touch("a");
    r.touch("b");
    expect(r.current((id) => id === "a")).toBe("a");
  });
  it("nichts offen: null", () => {
    const r = new RecentSessions();
    r.touch("a");
    expect(r.current(() => false)).toBeNull();
  });
  it("forget entfernt", () => {
    const r = new RecentSessions();
    r.touch("a");
    r.touch("b");
    r.forget("b");
    expect(r.current(all)).toBe("a");
  });
  it("doppeltes touch erzeugt keinen Doppeleintrag", () => {
    const r = new RecentSessions();
    r.touch("a");
    r.touch("b");
    r.touch("b");
    r.forget("b");
    expect(r.current(all)).toBe("a");
  });

  // Abend 19g: Nach dem Start kennt die Liste alle wiederhergestellten Tabs, nicht nur das aktive.
  it("seed hängt unbekannte hinten an, berührte bleiben vorn", () => {
    const r = new RecentSessions();
    r.touch("b");
    r.seed(["a", "b", "c"]);
    expect(r.open(all)).toEqual(["b", "a", "c"]);
  });
  it("seed, dann touch: das aktive zuerst", () => {
    const r = new RecentSessions();
    r.seed(["a", "b", "c"]);
    r.touch("c");
    expect(r.open(all)).toEqual(["c", "a", "b"]);
  });
  it("seed mit Doppelten erzeugt keinen Doppeleintrag", () => {
    const r = new RecentSessions();
    r.seed(["a", "a", "b"]);
    expect(r.open(all)).toEqual(["a", "b"]);
  });
});
