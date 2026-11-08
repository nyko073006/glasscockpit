import { beforeEach, describe, expect, it, vi } from "vitest";

// Abend 42, Task 6: ioreg (Leerlauf) und afplay (Ton) gibt es nur auf dem Mac. Unter win32 werden sie nicht gestartet (Abend 43
// ersetzt sie); auf dem Mac tragen sie windowsHide: true wie jeder Prozessaufruf im Host.
const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile }));
vi.mock("obsidian", () => ({ FileSystemAdapter: class {} }));
vi.mock("../src/host/electron", () => ({ electronRemote: () => null }));

import { playSound } from "../src/host/attention-alert";
import { readIdleSeconds } from "../src/host/idle-time";

beforeEach(() => {
  execFile.mockReset();
  // Standard: der Aufruf scheitert sofort (ein Test, der den Aufruf nicht erwartet, darf nicht auf ihn warten).
  execFile.mockImplementation((...args: unknown[]) => (args[args.length - 1] as (e: Error) => void)(new Error("test")));
});

describe("readIdleSeconds", () => {
  it("win32: kein ioreg, die Sekunden kommen vom powerMonitor", async () => {
    await expect(readIdleSeconds("win32", () => ({ getSystemIdleTime: () => 3 }))).resolves.toBe(3);
    expect(execFile).not.toHaveBeenCalled();
  });
  it("darwin: ioreg mit windowsHide: true, die Sekunden kommen aus HIDIdleTime", async () => {
    execFile.mockImplementation((_file: string, _args: string[], _opts: object, cb: (e: Error | null, out: string) => void) =>
      cb(null, '"HIDIdleTime" = 5000000000\n'),
    );
    await expect(readIdleSeconds("darwin")).resolves.toBe(5);
    expect(execFile).toHaveBeenCalledTimes(1);
    const [file, args, opts] = execFile.mock.calls[0];
    expect(file).toBe("/usr/sbin/ioreg");
    expect(args).toEqual(["-c", "IOHIDSystem"]);
    expect(opts).toMatchObject({ windowsHide: true });
  });
});

describe("playSound", () => {
  it("win32: kein afplay, kein Ton über einen Prozess", () => {
    const deps = { readFile: async () => new Uint8Array(), createAudio: () => ({ play: async () => undefined, addEventListener: () => undefined }), createObjectURL: () => "blob:x", revokeObjectURL: () => undefined };
    playSound("/x/ton.aiff", "win32", deps);
    expect(execFile).not.toHaveBeenCalled();
  });
  it("darwin: afplay mit windowsHide: true", () => {
    playSound("/x/ton.aiff", "darwin");
    expect(execFile).toHaveBeenCalledTimes(1);
    const [file, args, opts] = execFile.mock.calls[0];
    expect(file).toBe("afplay");
    expect(args).toEqual(["/x/ton.aiff"]);
    expect(opts).toMatchObject({ windowsHide: true });
  });
});
