import { describe, expect, it } from "vitest";
import { readSessionId } from "../src/core/session-state";

describe("readSessionId", () => {
  it("liest sessionId aus dem View-State", () => {
    expect(readSessionId({ sessionId: "3f2a" })).toBe("3f2a");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["kein Objekt", "3f2a"],
    ["leeres Objekt", {}],
    ["leerer Text", { sessionId: "" }],
    ["nur Leerzeichen", { sessionId: "  " }],
    ["Zahl", { sessionId: 42 }],
  ])("%s: null", (_, state) => {
    expect(readSessionId(state)).toBeNull();
  });
});
