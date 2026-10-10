import { describe, expect, it } from "vitest";
import { RING_MAX_CHARS } from "../src/core/constants";
import { RingBuffer, trimRing } from "../src/core/ring-buffer";

describe("trimRing", () => {
  it("unter dem Maximum: unverändert", () => {
    expect(trimRing("abc", 10)).toBe("abc");
  });

  it("genau am Maximum: unverändert", () => {
    expect(trimRing("0123456789", 10)).toBe("0123456789");
  });

  it("über dem Maximum: Schnitt hinter dem nächsten \\n ab länge minus Maximum", () => {
    // 14 Zeichen, Maximum 10: Suche ab Index 4, \n steht an 10, Rest beginnt bei 11.
    expect(trimRing("abcdefghij\nxyz", 10)).toBe("xyz");
  });

  it("\\n genau am Suchbeginn zählt mit", () => {
    // 12 Zeichen, Maximum 10: Suche ab Index 2, dort steht das \n.
    expect(trimRing("ab\ncdefghijk", 10)).toBe("cdefghijk");
  });

  it("\\n nur vor dem Suchbeginn: harter Schnitt", () => {
    expect(trimRing("aaaa\nbbbbbbbbbb", 10)).toBe("bbbbbbbbbb");
  });

  it("ohne \\n: harter Schnitt auf genau das Maximum", () => {
    expect(trimRing("abcdefghijklmn", 10)).toBe("efghijklmn");
  });

  it("\\n als letztes Zeichen: Ring wird leer", () => {
    expect(trimRing("abcdefghijk\n", 10)).toBe("");
  });

  it("Standard-Maximum ist RING_MAX_CHARS = 262144", () => {
    expect(RING_MAX_CHARS).toBe(262144);
    const voll = "x".repeat(RING_MAX_CHARS);
    expect(trimRing(voll)).toBe(voll);
    expect(trimRing(`${voll}y`)).toHaveLength(RING_MAX_CHARS);
  });
});

describe("RingBuffer", () => {
  it("hängt Portionen aneinander", () => {
    const ring = new RingBuffer(10);
    ring.append("ab");
    ring.append("cd");
    expect(ring.toString()).toBe("abcd");
    expect(ring.length).toBe(4);
  });

  it("schneidet über Portionsgrenzen hinweg am \\n", () => {
    const ring = new RingBuffer(10);
    ring.append("zeile1\n");
    ring.append("zeile2\n");
    // 14 Zeichen, Suche ab Index 4: das erste \n an 6, Rest „zeile2\n“.
    expect(ring.toString()).toBe("zeile2\n");
  });

  it("Standard: 262144 Zeichen ohne Schnitt, eins mehr schneidet", () => {
    const ring = new RingBuffer();
    ring.append("x".repeat(RING_MAX_CHARS));
    expect(ring.length).toBe(RING_MAX_CHARS);
    ring.append("\nyz");
    expect(ring.toString()).toBe("yz");
  });
});
