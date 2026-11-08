import { afterEach, describe, expect, it, vi } from "vitest";
import { openWithDefaultApp } from "../src/host/electron";

// Nachtrag 43c: Datei im Standardprogramm öffnen über electron.shell.openPath.

const stubOpen = (openPath: (p: string) => Promise<string>): void => {
  vi.stubGlobal("window", { require: () => ({ shell: { openPath } }) });
};
afterEach(() => vi.unstubAllGlobals());

describe("openWithDefaultApp", () => {
  it("ohne window.require: Meldung", async () => {
    vi.stubGlobal("window", {});
    expect(await openWithDefaultApp("/a/b.png")).toBe("Standardprogramm nicht verfügbar");
  });
  it("Erfolg: null, genau mit dem Pfad gerufen", async () => {
    const openPath = vi.fn(async () => "");
    stubOpen(openPath);
    expect(await openWithDefaultApp("/a/b.png")).toBeNull();
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith("/a/b.png");
  });
  it("Fehlermeldung von Electron wird durchgereicht", async () => {
    stubOpen(async () => "Failed to open path");
    expect(await openWithDefaultApp("/a/b.png")).toBe("Failed to open path");
  });
  it("Wurf: Meldung der Ausnahme", async () => {
    stubOpen(async () => { throw new Error("x"); });
    expect(await openWithDefaultApp("/a/b.png")).toBe("x");
  });
});
