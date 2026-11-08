import { beforeEach, describe, expect, it, vi } from "vitest";

// Abend 42, Task 6: Unter Windows gibt es kein ps. parentPid startet dort keinen Prozess und liefert null; auf dem Mac ruft es ps
// und trägt windowsHide: true.
const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync }));
vi.mock("obsidian", () => ({ ItemView: class {}, MarkdownView: class {}, FileView: class {}, FileSystemAdapter: class {}, Modal: class {}, Notice: class {} }));
vi.mock("@codemirror/view", () => ({ EditorView: { updateListener: { of: () => ({}) } } }));

import { parentPid } from "../src/host/ide-bridge";

beforeEach(() => execFileSync.mockReset());

describe("parentPid (IDE-Brücke)", () => {
  it("win32: startet keinen Prozess und liefert null", () => {
    execFileSync.mockReturnValue("1234\n");
    expect(parentPid(4242, "win32")).toBeNull();
    expect(execFileSync).not.toHaveBeenCalled();
  });
  it("darwin: ruft ps mit windowsHide: true und liest die Eltern-pid", () => {
    execFileSync.mockReturnValue("1234\n");
    expect(parentPid(4242, "darwin")).toBe(1234);
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith("ps", ["-o", "ppid=", "-p", "4242"], { encoding: "utf8", timeout: 1000, windowsHide: true });
  });
  it("darwin: scheitert ps oder liefert es Unsinn, ist die Antwort null", () => {
    execFileSync.mockImplementation(() => {
      throw new Error("ps fehlt");
    });
    expect(parentPid(4242, "darwin")).toBeNull();
    execFileSync.mockReset();
    execFileSync.mockReturnValue("0\n");
    expect(parentPid(4242, "darwin")).toBeNull();
  });
});
