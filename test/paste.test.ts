import { describe, expect, it } from "vitest";
import { acceptPaste, preparePaste } from "../src/core/paste";

const START = "\x1b[200~";
const ENDE = "\x1b[201~";

describe("preparePaste", () => {
  it("lässt einen Einzeiler roh", () => {
    expect(preparePaste("hallo welt")).toBe("hallo welt");
  });
  it("umschließt mehrzeiligen Text", () => {
    expect(preparePaste("a\nb")).toBe(`${START}a\nb${ENDE}`);
  });
  it("macht \\r\\n und \\r zu \\n", () => {
    expect(preparePaste("a\r\nb\rc")).toBe(`${START}a\nb\nc${ENDE}`);
  });
  it("ein einzelnes \\r am Ende macht aus dem Einzeiler Mehrzeiler", () => {
    expect(preparePaste("a\r")).toBe(`${START}a\n${ENDE}`);
  });
  it("entfernt den Endmarker im Einzeiler", () => {
    expect(preparePaste(`ab${ENDE}cd`)).toBe("abcd");
  });
  it("entfernt Endmarker im Mehrzeiler, genau einer bleibt am Ende", () => {
    const aus = preparePaste(`a${ENDE}\nb${ENDE}`);
    expect(aus).toBe(`${START}a\nb${ENDE}`);
    expect(aus.split(ENDE)).toHaveLength(2);
  });
  it("leerer Text gibt leeren Text", () => {
    expect(preparePaste("")).toBe("");
  });
});

describe("acceptPaste", () => {
  it("das erste Einfügen geht durch", () => {
    expect(acceptPaste(null, 1000, 200)).toBe(true);
  });
  it("innerhalb des Fensters wird verworfen", () => {
    expect(acceptPaste(1000, 1199, 200)).toBe(false);
  });
  it("genau am Fensterrand und danach geht durch", () => {
    expect(acceptPaste(1000, 1200, 200)).toBe(true);
    expect(acceptPaste(1000, 5000, 200)).toBe(true);
  });
});

describe("preparePaste: verschachtelter Endmarker", () => {
  it("nach dem Entfernen entsteht kein neuer Endmarker", () => {
    const out = preparePaste("a\x1b[20\x1b[201~1~\nb");
    expect(out.split("\x1b[201~").length - 1).toBe(1);
    expect(out.endsWith("\x1b[201~")).toBe(true);
  });
});
