import { afterEach, describe, expect, it, vi } from "vitest";
import { electronModule } from "../src/host/electron";
import { readClipboard } from "../src/host/clipboard";

// Abend 26c: Electron kommt über window.require (wie der Loader von node-pty), nicht über ein require() im Bundle.
describe("electronModule", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("holt electron über window.require", () => {
    const electron = { clipboard: { readText: () => "x", writeText: () => undefined } };
    const req = vi.fn((name: string) => (name === "electron" ? electron : (() => { throw new Error("nix"); })()));
    vi.stubGlobal("window", { require: req });
    expect(electronModule()).toBe(electron);
    expect(req).toHaveBeenCalledWith("electron");
  });
  it("null ohne window (Test, Mobil)", () => {
    vi.stubGlobal("window", undefined);
    expect(electronModule()).toBeNull();
  });
  it("null, wenn window.require fehlt oder wirft", () => {
    vi.stubGlobal("window", {});
    expect(electronModule()).toBeNull();
    vi.stubGlobal("window", { require: () => { throw new Error("kein electron"); } });
    expect(electronModule()).toBeNull();
  });
  it("readClipboard nimmt die Electron-Zwischenablage, sonst navigator.clipboard des Fensters", async () => {
    vi.stubGlobal("window", { require: () => ({ clipboard: { readText: () => "aus electron" } }) });
    expect(await readClipboard({ navigator: { clipboard: { readText: async () => "aus navigator" } } } as unknown as Window)).toBe("aus electron");
    vi.stubGlobal("window", {});
    expect(await readClipboard({ navigator: { clipboard: { readText: async () => "aus navigator" } } } as unknown as Window)).toBe("aus navigator");
  });
});
