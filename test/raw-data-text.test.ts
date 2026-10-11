import { describe, expect, it } from "vitest";
import { rawDataToString } from "../src/core/raw-data-text";

// Abend 26c: ws liefert Buffer, ArrayBuffer oder Buffer[]; data.toString() gäbe bei den beiden letzten Unfug (no-base-to-string).
describe("rawDataToString", () => {
  it("Buffer als UTF-8", () => {
    expect(rawDataToString(Buffer.from("{\"a\":\"Grüße\"}", "utf8"))).toBe("{\"a\":\"Grüße\"}");
  });
  it("ArrayBuffer als UTF-8", () => {
    const b = Buffer.from("äöü");
    expect(rawDataToString(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)).toBe("äöü");
  });
  it("Buffer-Liste verbunden", () => {
    expect(rawDataToString([Buffer.from("ab"), Buffer.from("cd")])).toBe("abcd");
  });
});
