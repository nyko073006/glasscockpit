import { describe, expect, it } from "vitest";
import { SEND_ENTER_DELAY_MS } from "../src/core/constants";
import { buildInsert, buildSend, checkTarget } from "../src/core/send";

const START = "\x1b[200~";
const ENDE = "\x1b[201~";

describe("buildSend", () => {
  it("leer: keine Schritte", () => expect(buildSend("")).toEqual([]));
  it("Einzeiler: Text plus Enter in einem Schritt", () => {
    expect(buildSend("/handoff")).toEqual([{ data: "/handoff\r", delayMs: 0 }]);
  });
  it("Mehrzeiler: Paste, dann Enter nach Verzögerung", () => {
    expect(buildSend("a\nb")).toEqual([
      { data: `${START}a\nb${ENDE}`, delayMs: 0 },
      { data: "\r", delayMs: SEND_ENTER_DELAY_MS },
    ]);
  });
  it("Mehrzeiler mit \\r wird auch als Mehrzeiler behandelt", () => {
    const steps = buildSend("a\rb");
    expect(steps).toHaveLength(2);
    expect(steps[0].data).toBe(`${START}a\nb${ENDE}`);
  });
  it("SEND_ENTER_DELAY_MS ist 80", () => expect(SEND_ENTER_DELAY_MS).toBe(80));
});

describe("buildInsert", () => {
  it("leer: keine Schritte", () => expect(buildInsert("")).toEqual([]));
  it("Einzeiler ohne Enter, Leerzeichen bleibt", () => {
    expect(buildInsert("/lint ")).toEqual([{ data: "/lint ", delayMs: 0 }]);
  });
  it("Mehrzeiler über Paste, ohne Enter", () => {
    expect(buildInsert("a\nb")).toEqual([{ data: `${START}a\nb${ENDE}`, delayMs: 0 }]);
  });
});

describe("checkTarget", () => {
  it("keine Sitzung", () => expect(checkTarget({ sessionId: null, kind: null, running: false })).toBe("no-session"));
  it("beendet", () => expect(checkTarget({ sessionId: "a", kind: "claude", running: false })).toBe("exited"));
  it("Shell", () => expect(checkTarget({ sessionId: "a", kind: "shell", running: true })).toBe("not-claude"));
  it("Shell, beendet: beendet zuerst", () => expect(checkTarget({ sessionId: "a", kind: "shell", running: false })).toBe("exited"));
  it("claude läuft", () => expect(checkTarget({ sessionId: "a", kind: "claude", running: true })).toBe("ok"));
  it("agent läuft", () => expect(checkTarget({ sessionId: "a", kind: "agent", running: true })).toBe("ok"));
  it("Art unbekannt, aber ID da: keine Raterei", () => {
    expect(checkTarget({ sessionId: "a", kind: null, running: true })).toBe("not-claude");
  });
});
