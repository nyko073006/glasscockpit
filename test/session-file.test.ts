import { describe, expect, it } from "vitest";
import { isStale, parseSessionFile, sessionFileAge, SESSION_FILE_MAX_AGE_MS } from "../src/core/session-file";

const ID = "90ef2efe-1234-4abc-8def-0123456789ab";
const gut = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ session_id: ID, written_at: 1_000, context_tokens: 82_000, used_percentage: 41, model: "Opus 5.5", ...extra });

describe("parseSessionFile", () => {
  it("liest alle Felder", () => {
    expect(parseSessionFile(gut())).toEqual({
      sessionId: ID, contextTokens: 82_000, usedPercentage: 41, model: "Opus 5.5", writtenAt: 1_000,
    });
  });
  it("kaputt, leer, kein Objekt: null", () => {
    for (const t of ["", "  \n", "{ kaputt", "[1]", "42", "null", "\"x\""]) expect(parseSessionFile(t)).toBeNull();
  });
  it("fremde oder unvollständige Felder: null", () => {
    expect(parseSessionFile(gut({ session_id: "../../etc/passwd" }))).toBeNull();
    expect(parseSessionFile(gut({ session_id: 5 }))).toBeNull();
    expect(parseSessionFile(gut({ context_tokens: "viele" }))).toBeNull();
    expect(parseSessionFile(gut({ context_tokens: -1 }))).toBeNull();
    expect(parseSessionFile(gut({ used_percentage: null }))).toBeNull();
    expect(parseSessionFile(gut({ model: 3 }))).toBeNull();
    expect(parseSessionFile(gut({ written_at: "heute" }))).toBeNull();
    expect(parseSessionFile(JSON.stringify({ rate_limits: {} }))).toBeNull();
  });
});

describe("sessionFileAge", () => {
  it("Sekunden zwischen written_at (Unix-Sekunden) und jetzt (ms)", () => {
    expect(sessionFileAge(1_000, 1_090_000)).toBe(90);
    expect(sessionFileAge(1_000, 1_090_999)).toBe(90);
  });
  it("Datei aus der Zukunft: 0", () => {
    expect(sessionFileAge(2_000, 1_000_000)).toBe(0);
  });
});

describe("isStale", () => {
  const h24 = 24 * 3600 * 1000;
  it("Vorgabe 24 Stunden: genau 24 h noch nicht, danach ja", () => {
    expect(SESSION_FILE_MAX_AGE_MS).toBe(h24);
    expect(isStale(1_000, 1_000_000 + h24)).toBe(false);
    expect(isStale(1_000, 1_000_000 + h24 + 1000)).toBe(true);
  });
  it("eigene Grenze", () => {
    expect(isStale(1_000, 1_000_000 + 5000, 4000)).toBe(true);
    expect(isStale(1_000, 1_000_000 + 4000, 4000)).toBe(false);
  });
  it("frisch und Zukunft: nicht veraltet", () => {
    expect(isStale(1_000, 1_000_000)).toBe(false);
    expect(isStale(9_999_999, 1_000_000)).toBe(false);
  });
});
