import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { windowsPtyOption } from "../src/core/terminal-options";
import { ROOT } from "./helpers/files";

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("windowsPtyOption", () => {
  it("nimmt die Buildnummer aus dem dritten Teil von os.release()", () => {
    expect(windowsPtyOption("10.0.22631")).toEqual({ backend: "conpty", buildNumber: 22631 });
    expect(windowsPtyOption("10.0.19045")).toEqual({ backend: "conpty", buildNumber: 19045 });
  });
  it.each(["", "10.0", "10.0.abc", "10.0.", "10.0.-5", "10.0.22631x"])("ohne Zahl im dritten Teil (%j) nur backend", (release) => {
    expect(windowsPtyOption(release)).toEqual({ backend: "conpty" });
  });
});

// Abend 41: Verdrahtung im Host (DOM, nicht ohne Obsidian ausführbar): Quelltext prüfen.
describe("Windows-Verdrahtung im Host", () => {
  it("terminal-pane: Schrift je Plattform, windowsPty nur unter win32 aus os.release()", () => {
    const pane = read("src/host/terminal-pane.ts");
    expect(pane).toMatch(/fontFamily: terminalFontFamily\(platform\)/);
    expect(pane).toMatch(/platform === "win32" \? \{ windowsPty: windowsPtyOption\(release\(\)\) \} : \{\}/);
  });
  it("terminal-input: Zwischenablage-Tasten nur unter win32, vor dem Mac-Block, mit return false", () => {
    const input = read("src/host/terminal-input.ts");
    const win = input.indexOf('this.opts.platform === "win32"');
    const mac = input.indexOf('this.opts.platform === "darwin" && ev.metaKey');
    expect(win).toBeGreaterThan(0);
    expect(win).toBeLessThan(mac);
    expect(input.slice(win, mac)).toMatch(/windowsClipboardAction\(ev, this\.opts\.term\.hasSelection\(\)\)[\s\S]*"copy"[\s\S]*return false;[\s\S]*"paste"[\s\S]*return false;/);
    expect(input.slice(win, mac)).toMatch(/action === "none"[\s\S]*preventDefault\(\);\s*return false;/);
  });
});
