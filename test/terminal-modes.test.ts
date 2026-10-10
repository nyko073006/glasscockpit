import { describe, expect, it } from "vitest";
import { ModeTracker } from "../src/core/terminal-modes";

function after(...chunks: string[]): string {
  const t = new ModeTracker();
  for (const c of chunks) t.feed(c);
  return t.prelude();
}

describe("ModeTracker", () => {
  it("ohne Modi kein Vorspann", () => {
    expect(after()).toBe("");
    expect(after("hallo\r\n")).toBe("");
  });

  it("eingeschaltete Modi kommen zurück, Alternate Screen zuerst", () => {
    expect(after("\x1b[?1000h\x1b[?1006h", "text", "\x1b[?1049h")).toBe("\x1b[?1049h\x1b[?1000h\x1b[?1006h");
  });

  it("mehrere Modi in einer Sequenz", () => {
    expect(after("\x1b[?1000;1002;1003;1006h")).toBe("\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h");
  });

  it("ausgeschaltet zählt der letzte Stand", () => {
    expect(after("\x1b[?2004h\x1b[?1049h", "\x1b[?1049l")).toBe("\x1b[?2004h");
    expect(after("\x1b[?2004l\x1b[?2004h")).toBe("\x1b[?2004h");
  });

  it("fremde Modi und nicht-private Sequenzen bleiben draußen", () => {
    expect(after("\x1b[?25l\x1b[?2031h\x1b[1049h\x1b[4h")).toBe("");
  });

  it("über Portionsgrenzen hinweg", () => {
    expect(after("abc\x1b[?10", "49h")).toBe("\x1b[?1049h");
    expect(after("abc\x1b", "[?2004h")).toBe("\x1b[?2004h");
    expect(after("\x1b[", "?1000", ";1006", "h")).toBe("\x1b[?1000h\x1b[?1006h");
  });

  it("ein abgebrochener Rest verschluckt keine spätere Sequenz", () => {
    expect(after("\x1b[?10", "x\x1b[?1004h")).toBe("\x1b[?1004h");
  });
});
