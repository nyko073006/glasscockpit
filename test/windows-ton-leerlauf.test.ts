import { beforeEach, describe, expect, it, vi } from "vitest";
import { windowsSoundFile, DEFAULT_SOUND_FILE } from "../src/core/constants";
import { effectiveSoundFile, effectiveWriteStatusFile } from "../src/core/settings";

// Abend 43, Task 1: Ton unter Windows über Audio und Blob, Leerlauf über powerMonitor. Kein Prozessaufruf.
const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile }));
vi.mock("obsidian", () => ({ FileSystemAdapter: class {} }));
vi.mock("../src/host/electron", () => ({ electronRemote: () => null }));

const WIN_SOUND = "C:\\Windows\\Media\\Windows Notify System Generic.wav";
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("windowsSoundFile und effectiveSoundFile", () => {
  it("windowsSoundFile: SystemRoot oder C:\\Windows", () => {
    expect(windowsSoundFile("C:\\Windows")).toBe(WIN_SOUND);
    expect(windowsSoundFile("")).toBe(WIN_SOUND);
    expect(windowsSoundFile("D:\\WIN")).toBe("D:\\WIN\\Media\\Windows Notify System Generic.wav");
  });
  it("win32: Mac-Pfad oder leer ergibt den Windows-Ton, eigener Pfad bleibt", () => {
    expect(effectiveSoundFile("win32", "/System/Library/Sounds/Glass.aiff", "C:\\Windows")).toBe(WIN_SOUND);
    expect(effectiveSoundFile("win32", DEFAULT_SOUND_FILE, "")).toBe(WIN_SOUND);
    expect(effectiveSoundFile("win32", "", "C:\\Windows")).toBe(WIN_SOUND);
    expect(effectiveSoundFile("win32", "D:\\t.wav", "C:\\Windows")).toBe("D:\\t.wav");
    expect(effectiveSoundFile("win32", "/System/Library/Sounds/Ping.aiff", "C:\\Windows")).toBe(WIN_SOUND);
    expect(effectiveSoundFile("win32", "~/Library/Sounds/x.aiff", "C:\\Windows")).toBe(WIN_SOUND);
  });
  it("win32 (Fix-Welle): jeder Wert mit / oder ~/ am Anfang ist ein Mac-Pfad, ein Windows-Pfad bleibt", () => {
    expect(effectiveSoundFile("win32", "/Users/n/Music/x.aiff", "C:\\Windows")).toBe(WIN_SOUND);
    expect(effectiveSoundFile("win32", "~/Music/x.aiff", "C:\\Windows")).toBe(WIN_SOUND);
    expect(effectiveSoundFile("win32", "D:\\t.wav", "C:\\Windows")).toBe("D:\\t.wav");
    expect(effectiveSoundFile("win32", "\\\\server\\s\\t.wav", "C:\\Windows")).toBe("\\\\server\\s\\t.wav");
  });
  it("darwin (Fix-Welle): Pfade mit / und ~/ bleiben unverändert", () => {
    expect(effectiveSoundFile("darwin", "/Users/n/Music/x.aiff", "C:\\Windows")).toBe("/Users/n/Music/x.aiff");
    expect(effectiveSoundFile("darwin", "~/Music/x.aiff", "C:\\Windows")).toBe("~/Music/x.aiff");
  });
  it("darwin: immer der gespeicherte Wert", () => {
    expect(effectiveSoundFile("darwin", "", "C:\\Windows")).toBe("");
    expect(effectiveSoundFile("darwin", "/x.aiff", "C:\\Windows")).toBe("/x.aiff");
    expect(effectiveSoundFile("darwin", DEFAULT_SOUND_FILE, "")).toBe(DEFAULT_SOUND_FILE);
    expect(effectiveSoundFile("darwin", "/System/Library/Sounds/Ping.aiff", "")).toBe("/System/Library/Sounds/Ping.aiff");
    expect(effectiveSoundFile("darwin", "~/Library/Sounds/x.aiff", "")).toBe("~/Library/Sounds/x.aiff");
  });
});

describe("effectiveWriteStatusFile (Fix-Welle)", () => {
  it("win32: nie, egal was gespeichert ist; darwin: der gespeicherte Wert", () => {
    expect(effectiveWriteStatusFile("win32", true)).toBe(false);
    expect(effectiveWriteStatusFile("win32", false)).toBe(false);
    expect(effectiveWriteStatusFile("darwin", true)).toBe(true);
    expect(effectiveWriteStatusFile("darwin", false)).toBe(false);
  });
});

describe("playSound", () => {
  beforeEach(() => { execFile.mockReset(); vi.restoreAllMocks(); });
  async function setup(over: Record<string, unknown> = {}) {
    const { playSound } = await import("../src/host/attention-alert");
    const listeners: Record<string, () => void> = {};
    const play = vi.fn(() => Promise.resolve());
    const deps = {
      readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
      createAudio: vi.fn(() => ({ play, addEventListener: (t: string, cb: () => void) => { listeners[t] = cb; } })),
      createObjectURL: vi.fn(() => "blob:x"),
      revokeObjectURL: vi.fn(),
      ...over,
    };
    return { playSound, deps, listeners, play };
  }
  it("win32: Datei lesen, Blob-URL, play einmal, nach ended revoke, nie execFile", async () => {
    const { playSound, deps, listeners, play } = await setup();
    playSound("C:\\a.wav", "win32", deps as never);
    await flush();
    expect(deps.readFile).toHaveBeenCalledWith("C:\\a.wav");
    expect(deps.createAudio).toHaveBeenCalledWith("blob:x");
    expect(play).toHaveBeenCalledTimes(1);
    expect(deps.revokeObjectURL).not.toHaveBeenCalled();
    listeners.ended();
    expect(deps.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    expect(execFile).not.toHaveBeenCalled();
  });
  it.each([
    ["C:\\a.wav", "audio/wav"], ["C:\\a.WAV", "audio/wav"], ["C:\\a.mp3", "audio/mpeg"], ["C:\\a.MP3", "audio/mpeg"], ["C:\\a.ogg", ""],
  ])("win32: Blob-Typ nach Endung (%s ergibt %j)", async (path, type) => {
    const { playSound, deps } = await setup();
    playSound(path, "win32", deps as never);
    await flush();
    const blob = (deps.createObjectURL.mock.calls as unknown as [Blob][])[0]![0];
    expect(blob.type).toBe(type);
  });
  it("win32: readFile wirft, genau eine Warnung, kein Audio", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { playSound, deps } = await setup({ readFile: vi.fn(async () => { throw new Error("weg"); }) });
    playSound("C:\\a.wav", "win32", deps as never);
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(deps.createAudio).not.toHaveBeenCalled();
    expect(deps.createObjectURL).not.toHaveBeenCalled();
  });
  it("win32: play lehnt ab, Warnung und revoke", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { playSound, deps } = await setup({ createAudio: vi.fn(() => ({ play: () => Promise.reject(new Error("nein")), addEventListener: () => undefined })) });
    playSound("C:\\a.wav", "win32", deps as never);
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(deps.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });
  it("win32: error gibt genau einmal frei und warnt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { playSound, deps, listeners } = await setup();
    playSound("C:\\a.wav", "win32", deps as never);
    await flush();
    listeners.error();
    listeners.error();
    listeners.ended();
    expect(deps.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });
  it("win32: abgelehntes play plus error gibt genau einmal frei", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const listeners: Record<string, () => void> = {};
    const { playSound, deps } = await setup({ createAudio: vi.fn(() => ({ play: () => Promise.reject(new Error("nein")), addEventListener: (t: string, cb: () => void) => { listeners[t] = cb; } })) });
    playSound("C:\\a.wav", "win32", deps as never);
    await flush();
    listeners.error();
    expect(deps.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
  it("darwin: afplay wie bisher", async () => {
    const { playSound, deps } = await setup();
    playSound("/x.aiff", "darwin", deps as never);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0].slice(0, 3)).toEqual(["afplay", ["/x.aiff"], { windowsHide: true }]);
    expect(deps.readFile).not.toHaveBeenCalled();
  });
});

describe("readIdleSeconds unter win32", () => {
  beforeEach(() => { vi.resetModules(); vi.restoreAllMocks(); execFile.mockReset(); });
  it("liefert getSystemIdleTime", async () => {
    const { readIdleSeconds } = await import("../src/host/idle-time");
    await expect(readIdleSeconds("win32", () => ({ getSystemIdleTime: () => 42 }))).resolves.toBe(42);
  });
  it("Remote null ergibt null, über zwei Aufrufe genau eine Warnung", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { readIdleSeconds } = await import("../src/host/idle-time");
    await expect(readIdleSeconds("win32", () => null)).resolves.toBeNull();
    await expect(readIdleSeconds("win32", () => null)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it.each([[NaN], [-1]])("getSystemIdleTime %s ergibt null", async (wert) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { readIdleSeconds } = await import("../src/host/idle-time");
    await expect(readIdleSeconds("win32", () => ({ getSystemIdleTime: () => wert }))).resolves.toBeNull();
  });
  it("Wurf ergibt null, über zwei Aufrufe genau eine Warnung", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { readIdleSeconds } = await import("../src/host/idle-time");
    const boom = () => ({ getSystemIdleTime: () => { throw new Error("x"); } });
    await expect(readIdleSeconds("win32", boom)).resolves.toBeNull();
    await expect(readIdleSeconds("win32", boom)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(execFile).not.toHaveBeenCalled();
  });
});
