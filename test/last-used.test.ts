import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLastUsed } from "../src/host/last-used";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "last-used-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function datei(pfad: string, sekunden: number): void {
  mkdirSync(join(pfad, ".."), { recursive: true });
  writeFileSync(pfad, "{}\n");
  utimesSync(pfad, sekunden, sekunden);
}

describe("createLastUsed", () => {
  it("jüngste jsonl gewinnt", () => {
    datei(join(root, "-p-a", "x.jsonl"), 1000);
    datei(join(root, "-p-a", "y.jsonl"), 2000);
    expect(createLastUsed(root)("/p/a")).toBe(2_000_000);
  });

  it("andere Endungen und Unterordner zählen nicht", () => {
    datei(join(root, "-p-a", "x.jsonl"), 1000);
    datei(join(root, "-p-a", "notiz.txt"), 5000);
    datei(join(root, "-p-a", "subagents", "z.jsonl"), 6000);
    expect(createLastUsed(root)("/p/a")).toBe(1_000_000);
  });

  it("ein Unterordner, der auf .jsonl endet, zählt nicht", () => {
    datei(join(root, "-p-a", "x.jsonl"), 1000);
    datei(join(root, "-p-a", "ordner.jsonl", "q.txt"), 7000);
    expect(createLastUsed(root)("/p/a")).toBe(1_000_000);
  });

  it("Worktree-Geschwister zählt nicht", () => {
    datei(join(root, "-p-a--claude-worktrees-w", "x.jsonl"), 3000);
    expect(createLastUsed(root)("/p/a")).toBe(0);
  });

  it("fehlender Ordner und fehlendes root ergeben 0, ohne Wurf", () => {
    expect(createLastUsed(join(root, "gibts-nicht"))("/p/a")).toBe(0);
    expect(createLastUsed(root)("/p/a")).toBe(0);
  });

  it("Name über 200 Zeichen ergibt 0, ohne zu lesen", () => {
    const cwd = "/" + "a".repeat(250);
    datei(join(root, "-" + "a".repeat(250), "x.jsonl"), 4000);
    expect(createLastUsed(root)(cwd)).toBe(0);
  });

  it("Name mit genau 200 Zeichen wird noch gelesen", () => {
    const cwd = "/" + "a".repeat(199);
    datei(join(root, "-" + "a".repeat(199), "x.jsonl"), 4000);
    expect(createLastUsed(root)(cwd)).toBe(4_000_000);
  });

  it("Zwischenspeicher je Funktion", () => {
    datei(join(root, "-p-a", "x.jsonl"), 1000);
    const f = createLastUsed(root);
    expect(f("/p/a")).toBe(1_000_000);
    datei(join(root, "-p-a", "neu.jsonl"), 9000);
    expect(f("/p/a")).toBe(1_000_000);
    expect(createLastUsed(root)("/p/a")).toBe(9_000_000);
  });
});
