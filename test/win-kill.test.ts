import { beforeEach, describe, expect, it, vi } from "vitest";

const execFile = vi.fn();
vi.mock("node:child_process", () => ({ execFile: (...args: unknown[]) => execFile(...args) }));

import { forceKillTree } from "../src/host/win-kill";

describe("forceKillTree (Abend 41)", () => {
  beforeEach(() => execFile.mockReset());

  it("startet taskkill.exe aus System32 mit /PID <pid> /T /F, versteckt, ohne Shell", () => {
    forceKillTree(4711, "D:\\Win");
    expect(execFile).toHaveBeenCalledTimes(1);
    const [file, args, options, callback] = execFile.mock.calls[0];
    expect(file).toBe("D:\\Win\\System32\\taskkill.exe");
    expect(args).toEqual(["/PID", "4711", "/T", "/F"]);
    expect(options).toEqual({ windowsHide: true });
    expect(typeof callback).toBe("function");
  });

  it("ohne SystemRoot gilt C:\\Windows", () => {
    forceKillTree(1);
    expect(execFile.mock.calls[0][0]).toBe("C:\\Windows\\System32\\taskkill.exe");
  });

  it("wirft nie: weder wenn execFile wirft noch wenn taskkill mit Fehler antwortet", () => {
    execFile.mockImplementationOnce(() => { throw new Error("ENOENT"); });
    expect(() => forceKillTree(2)).not.toThrow();
    execFile.mockImplementationOnce((_f, _a, _o, cb: (e: Error | null) => void) => cb(new Error("Prozess nicht gefunden")));
    expect(() => forceKillTree(3)).not.toThrow();
  });
});
