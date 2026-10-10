import { describe, expect, it } from "vitest";
import { formatDroppedPaths } from "../src/core/dropped-paths";

describe("formatDroppedPaths", () => {
  it("normaler Pfad", () => {
    expect(formatDroppedPaths(["/a/b.txt"])).toBe("@/a/b.txt ");
  });
  it("Pfad mit Leerzeichen wird gequotet", () => {
    expect(formatDroppedPaths(["/a/mein ordner/b.txt"])).toBe('@"/a/mein ordner/b.txt" ');
  });
  it("Pfad mit Backslash wird gequotet", () => {
    expect(formatDroppedPaths(["C:\\x\\y"])).toBe('@"C:\\x\\y" ');
  });
  it("mehrere Pfade, ein Leerzeichen dazwischen und am Ende", () => {
    expect(formatDroppedPaths(["/a", "/b c"])).toBe('@/a @"/b c" ');
  });
  it("leere Liste gibt leeren Text", () => {
    expect(formatDroppedPaths([])).toBe("");
  });
});
