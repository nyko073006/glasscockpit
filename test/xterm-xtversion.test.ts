// @vitest-environment happy-dom
import { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";

/**
 * Nachtrag 43f: Claude Code wertet die Antwort auf XTVERSION (`ESC[>0q`) aus, um das Terminal zu erkennen (xterm.js bekommt
 * einen anderen Scroll-Zweig). xterm 6 antwortet bisher nicht darauf (geprobt 04.11.2026, ohne open()). Wird der zweite Test
 * rot, nimmt Claude den xterm.js-Zweig: vor dem Release mit ~/.claude/_archiv/2026-11-04-43f-messung/zaehl-probe.cjs neu messen.
 */
function antworten(eingabe: string): Promise<string> {
  const term = new Terminal({ allowProposedApi: true });
  let aus = "";
  term.onData((d) => {
    aus += d;
  });
  return new Promise((fertig) => {
    term.write(eingabe, () => {
      term.dispose();
      fertig(aus);
    });
  });
}

describe("xterm antwortet auf Geräteabfragen (Nachtrag 43f)", () => {
  it("DA1 bekommt eine Antwort (Positivprobe)", async () => {
    expect(await antworten("\x1b[c")).toBe("\x1b[?1;2c");
  });
  it("XTVERSION bleibt ohne Antwort", async () => {
    expect(await antworten("\x1b[>0q")).toBe("");
  });
});
