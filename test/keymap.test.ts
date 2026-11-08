import { describe, expect, it } from "vitest";
import { SHIFT_ENTER_SEQUENCE } from "../src/core/constants";
import { keyToSequence, windowsClipboardAction, type KeyInput } from "../src/core/keymap";

function taste(key: string, mod: Partial<KeyInput> = {}): KeyInput {
  return { key, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, ...mod };
}

describe("keyToSequence macOS", () => {
  it.each([
    ["Cmd+Backspace", taste("Backspace", { metaKey: true }), "\x15"],
    ["Cmd+ArrowLeft", taste("ArrowLeft", { metaKey: true }), "\x01"],
    ["Cmd+ArrowRight", taste("ArrowRight", { metaKey: true }), "\x05"],
    ["Alt+Backspace", taste("Backspace", { altKey: true }), "\x17"],
    ["Alt+ArrowLeft", taste("ArrowLeft", { altKey: true }), "\x1bb"],
    ["Alt+ArrowRight", taste("ArrowRight", { altKey: true }), "\x1bf"],
  ])("%s", (_name, eingabe, erwartet) => {
    expect(keyToSequence(eingabe, "darwin")).toBe(erwartet);
  });

  it("Shift+Enter gibt SHIFT_ENTER_SEQUENCE", () => {
    expect(SHIFT_ENTER_SEQUENCE).not.toBe("");
    expect(keyToSequence(taste("Enter", { shiftKey: true }), "darwin")).toBe(SHIFT_ENTER_SEQUENCE);
  });
  it("Shift+Enter mit Cmd, Alt oder Ctrl gibt null", () => {
    for (const mod of [{ metaKey: true }, { altKey: true }, { ctrlKey: true }]) {
      expect(keyToSequence(taste("Enter", { shiftKey: true, ...mod }), "darwin")).toBeNull();
    }
  });
  it("Escape gibt null", () => {
    expect(keyToSequence(taste("Escape"), "darwin")).toBeNull();
  });
  it("Enter ohne Shift gibt null", () => {
    expect(keyToSequence(taste("Enter"), "darwin")).toBeNull();
  });
  it("normaler Buchstabe gibt null", () => {
    expect(keyToSequence(taste("a"), "darwin")).toBeNull();
  });
  it("Cmd+Backspace mit zusätzlichem Shift gibt null", () => {
    expect(keyToSequence(taste("Backspace", { metaKey: true, shiftKey: true }), "darwin")).toBeNull();
  });

  // xterm hält Obsidian für „node“ (isMac false) und schickt sonst ESC+Buchstabe statt des Zeichens.
  it.each([
    ["Option+L", taste("@", { altKey: true }), "@"],
    ["Option+5", taste("[", { altKey: true }), "["],
    ["Option+7", taste("|", { altKey: true }), "|"],
    ["Option+E", taste("€", { altKey: true }), "€"],
    ["Option+Shift+7", taste("\\", { altKey: true, shiftKey: true }), "\\"],
  ])("%s gibt das Zeichen der Belegung", (_name, eingabe, erwartet) => {
    expect(keyToSequence(eingabe, "darwin")).toBe(erwartet);
  });
  it("Option mit toter Taste, Enter oder zusätzlichem Cmd/Ctrl gibt null", () => {
    expect(keyToSequence(taste("Dead", { altKey: true }), "darwin")).toBeNull();
    expect(keyToSequence(taste("Enter", { altKey: true }), "darwin")).toBeNull();
    expect(keyToSequence(taste("@", { altKey: true, metaKey: true }), "darwin")).toBeNull();
    expect(keyToSequence(taste("@", { altKey: true, ctrlKey: true }), "darwin")).toBeNull();
  });
});

describe("keyToSequence Windows", () => {
  it.each([
    ["Shift+Enter", taste("Enter", { shiftKey: true }), SHIFT_ENTER_SEQUENCE],
    ["Ctrl+Backspace", taste("Backspace", { ctrlKey: true }), "\x17"],
    ["Ctrl+ArrowLeft", taste("ArrowLeft", { ctrlKey: true }), "\x1bb"],
    ["Ctrl+ArrowRight", taste("ArrowRight", { ctrlKey: true }), "\x1bf"],
  ])("win32: %s", (_name, eingabe, erwartet) => {
    expect(keyToSequence(eingabe, "win32")).toBe(erwartet);
  });
  it("win32: Cmd+Backspace gibt null, Shift+Enter gibt SHIFT_ENTER_SEQUENCE", () => {
    expect(keyToSequence(taste("Backspace", { metaKey: true }), "win32")).toBeNull();
    expect(keyToSequence(taste("Enter", { shiftKey: true }), "win32")).toBe(SHIFT_ENTER_SEQUENCE);
  });
  it("win32: Ctrl+C ohne Auswahl gibt null (^C geht an das Programm)", () => {
    expect(keyToSequence(taste("c", { ctrlKey: true }), "win32")).toBeNull();
    expect(windowsClipboardAction(taste("c", { ctrlKey: true }), false)).toBeNull();
  });
  it("win32: Alt+V gibt null (Bild einfügen in Claude)", () => {
    expect(keyToSequence(taste("v", { altKey: true }), "win32")).toBeNull();
    expect(windowsClipboardAction(taste("v", { altKey: true }), false)).toBeNull();
    expect(windowsClipboardAction(taste("v", { altKey: true }), true)).toBeNull();
  });
  it("win32: Ctrl+Alt+Q gibt null (AltGr-@)", () => {
    expect(keyToSequence(taste("q", { ctrlKey: true, altKey: true }), "win32")).toBeNull();
    expect(keyToSequence(taste("@", { ctrlKey: true, altKey: true }), "win32")).toBeNull();
    expect(windowsClipboardAction(taste("q", { ctrlKey: true, altKey: true }), true)).toBeNull();
  });
  it.each([
    ["Alt+Backspace", taste("Backspace", { altKey: true })],
    ["Alt+ArrowLeft", taste("ArrowLeft", { altKey: true })],
    ["Alt+Zeichen", taste("@", { altKey: true })],
    ["Ctrl+Shift+Backspace", taste("Backspace", { ctrlKey: true, shiftKey: true })],
    ["Ctrl+Shift+ArrowLeft", taste("ArrowLeft", { ctrlKey: true, shiftKey: true })],
    ["Ctrl+Alt+ArrowLeft", taste("ArrowLeft", { ctrlKey: true, altKey: true })],
    ["Ctrl+Enter", taste("Enter", { ctrlKey: true })],
    ["Shift+Enter mit Ctrl", taste("Enter", { shiftKey: true, ctrlKey: true })],
    ["Shift+Enter mit Alt", taste("Enter", { shiftKey: true, altKey: true })],
    ["Win+Backspace", taste("Backspace", { metaKey: true })],
  ])("win32: %s gibt null", (_name, eingabe) => {
    expect(keyToSequence(eingabe, "win32")).toBeNull();
  });
});

describe("windowsClipboardAction", () => {
  it.each([
    ["Ctrl+C mit Auswahl", taste("c", { ctrlKey: true }), true, "copy"],
    ["Ctrl+C ohne Auswahl", taste("c", { ctrlKey: true }), false, null],
    ["Ctrl+V mit Auswahl", taste("v", { ctrlKey: true }), true, "paste"],
    ["Ctrl+V ohne Auswahl", taste("v", { ctrlKey: true }), false, "paste"],
    ["Ctrl+Shift+C mit Auswahl", taste("C", { ctrlKey: true, shiftKey: true }), true, "copy"],
    ["Ctrl+Shift+C ohne Auswahl: nichts tun, kein ^C", taste("C", { ctrlKey: true, shiftKey: true }), false, "none"],
    ["Ctrl+Shift+V", taste("V", { ctrlKey: true, shiftKey: true }), false, "paste"],
    ["Alt+V", taste("v", { altKey: true }), true, null],
    ["V ohne Modifikator", taste("v"), true, null],
    ["Ctrl+X", taste("x", { ctrlKey: true }), true, null],
    ["Win+V", taste("v", { metaKey: true }), true, null],
  ])("%s", (_name, eingabe, auswahl, erwartet) => {
    expect(windowsClipboardAction(eingabe, auswahl)).toBe(erwartet);
  });
});

describe("keyToSequence andere Plattformen", () => {
  it("linux: Alt+ArrowLeft, Ctrl+Backspace und Shift+Enter geben null", () => {
    // Der Typ kennt nur darwin und win32; der Laufzeit-Zweig für alles andere bleibt trotzdem null.
    const linux = "linux" as never;
    expect(keyToSequence(taste("ArrowLeft", { altKey: true }), linux)).toBeNull();
    expect(keyToSequence(taste("Backspace", { ctrlKey: true }), linux)).toBeNull();
    expect(keyToSequence(taste("Enter", { shiftKey: true }), linux)).toBeNull();
  });
});
