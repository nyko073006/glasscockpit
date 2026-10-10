import { describe, expect, it } from "vitest";
import { SHIFT_ENTER_SEQUENCE } from "../src/core/constants";
import { keyToSequence, type KeyInput } from "../src/core/keymap";

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

describe("keyToSequence andere Plattformen", () => {
  it("win32: Cmd+Backspace und Shift+Enter geben null", () => {
    expect(keyToSequence(taste("Backspace", { metaKey: true }), "win32")).toBeNull();
    expect(keyToSequence(taste("Enter", { shiftKey: true }), "win32")).toBeNull();
  });
  it("linux: Alt+ArrowLeft gibt null", () => {
    expect(keyToSequence(taste("ArrowLeft", { altKey: true }), "linux")).toBeNull();
  });
});
