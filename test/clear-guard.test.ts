import { describe, expect, it, vi } from "vitest";
import type { HandoffCheck } from "../src/core/handoff-check";
import { type ClearGuardDeps, guardedClearInsert } from "../src/host/clear-guard";
import { DEFAULT_SETTINGS, parseSettings } from "../src/core/settings";

const rot: HandoffCheck = { tone: "red", gaps: ["Handoff fehlt", "Git offen"], lines: [], tooltip: "" };
const gruen: HandoffCheck = { tone: "green", gaps: [], lines: [], tooltip: "" };
const grau: HandoffCheck = { tone: "gray", gaps: [], lines: [], tooltip: "" };

function deps(over: Partial<ClearGuardDeps> = {}): ClearGuardDeps & { insert: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn> } {
  return {
    enabled: () => true,
    check: vi.fn(async () => gruen),
    confirm: vi.fn(),
    insert: vi.fn(),
    log: vi.fn(),
    ...over,
  } as never;
}

describe("guardedClearInsert", () => {
  it("a) aus: sofort einfügen, check wird nie gerufen", async () => {
    const d = deps({ enabled: () => false });
    await guardedClearInsert(d);
    expect(d.insert).toHaveBeenCalledTimes(1);
    expect(d.check).not.toHaveBeenCalled();
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it("b) Check wirft: log und genau ein Einfügen, keine Rückfrage", async () => {
    const d = deps({ check: vi.fn(async () => { throw new Error("kaputt"); }) });
    await guardedClearInsert(d);
    expect(d.log).toHaveBeenCalledTimes(1);
    expect(d.insert).toHaveBeenCalledTimes(1);
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it("c) zweiter Klick während laufendem Check wird verworfen: genau eine Rückfrage", async () => {
    let release!: (c: HandoffCheck) => void;
    const d = deps({ check: vi.fn(() => new Promise<HandoffCheck>((r) => { release = r; })) });
    const state = { busy: false };
    const a = guardedClearInsert(d, state);
    const b = guardedClearInsert(d, state);
    release(rot);
    await Promise.all([a, b]);
    expect(d.check).toHaveBeenCalledTimes(1);
    expect(d.confirm).toHaveBeenCalledTimes(1);
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("c2) zwei Klicks bei Grün: genau ein Einfügen; danach ist der nächste Klick wieder erlaubt", async () => {
    let release!: (c: HandoffCheck) => void;
    const d = deps({ check: vi.fn(() => new Promise<HandoffCheck>((r) => { release = r; })) });
    const state = { busy: false };
    const a = guardedClearInsert(d, state);
    const b = guardedClearInsert(d, state);
    release(gruen);
    await Promise.all([a, b]);
    expect(d.insert).toHaveBeenCalledTimes(1);
    d.check.mockImplementation(async () => gruen);
    await guardedClearInsert(d, state);
    expect(d.insert).toHaveBeenCalledTimes(2);
  });

  it("c3) Zustand gilt je View: ein hängender Check in einer View sperrt eine andere nicht", async () => {
    const hang = deps({ check: vi.fn(() => new Promise<HandoffCheck>(() => {})) });
    const frei = deps();
    void guardedClearInsert(hang, { busy: false });
    await guardedClearInsert(frei, { busy: false });
    expect(frei.insert).toHaveBeenCalledTimes(1);
  });

  it("d) rot: Rückfrage mit den Lücken, Einfügen erst nach onYes", async () => {
    const d = deps({ check: vi.fn(async () => rot) });
    await guardedClearInsert(d);
    expect(d.confirm).toHaveBeenCalledTimes(1);
    expect(d.confirm.mock.calls[0][0]).toEqual(["Handoff fehlt", "Git offen"]);
    expect(d.insert).not.toHaveBeenCalled();
    d.confirm.mock.calls[0][1]();
    expect(d.insert).toHaveBeenCalledTimes(1);
  });

  it("e) grün und grau (und null): einfügen ohne Rückfrage", async () => {
    for (const c of [gruen, grau, null]) {
      const d = deps({ check: vi.fn(async () => c) });
      await guardedClearInsert(d);
      expect(d.insert).toHaveBeenCalledTimes(1);
      expect(d.confirm).not.toHaveBeenCalled();
    }
  });
});

describe("Einstellung checkBeforeClear", () => {
  it("Vorgabe an", () => {
    expect(DEFAULT_SETTINGS.checkBeforeClear).toBe(true);
    expect(parseSettings({}).settings.checkBeforeClear).toBe(true);
  });
  it("aus bleibt aus, kaputter Wert fällt auf die Vorgabe", () => {
    expect(parseSettings({ checkBeforeClear: false }).settings.checkBeforeClear).toBe(false);
    const r = parseSettings({ checkBeforeClear: "ja" });
    expect([...r.invalid]).toEqual(["checkBeforeClear"]);
    expect(r.settings.checkBeforeClear).toBe(true);
  });
});
