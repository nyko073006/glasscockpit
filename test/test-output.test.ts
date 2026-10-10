import { describe, expect, it } from "vitest";
import { SCROLLBACK_TEST_LINES, buildTestOutput } from "../src/core/test-output";

const ESC = "\x1b";

describe("Testausgabe", () => {
  const text = buildTestOutput();

  it("ist nicht leer und endet mit einem Zeilenende", () => {
    expect(text.length).toBeGreaterThan(0);
    expect(text.endsWith("\r\n")).toBe(true);
  });

  it("jedes \\n hat ein \\r davor (convertEol ist aus)", () => {
    expect(text).toContain("\n");
    expect(text.match(/(?<!\r)\n/g)).toBeNull();
  });

  it.each([30, 31, 32, 33, 34, 35, 36, 37, 90, 91, 92, 93, 94, 95, 96, 97])(
    "enthält Vordergrundfarbe %i",
    (code) => {
      expect(text).toContain(`${ESC}[${code}m`);
    },
  );

  it.each([
    ["fett", 1],
    ["unterstrichen", 4],
    ["invertiert", 7],
    ["Reset", 0],
  ])("enthält %s (SGR %i)", (_name, code) => {
    expect(text).toContain(`${ESC}[${code}m`);
  });

  it("enthält den Umlauttest", () => {
    expect(text).toContain("äöüß €");
  });

  it(`enthält ${SCROLLBACK_TEST_LINES} nummerierte Zeilen, die erste und die letzte`, () => {
    expect(SCROLLBACK_TEST_LINES).toBe(200);
    const nummern = Array.from(text.matchAll(/Zeile (\d+) von 200/g), (t) => Number(t[1]));
    expect(nummern).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
  });
});
