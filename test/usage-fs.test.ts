import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "../src/host/usage-fs";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cockpit-usagefs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeFileAtomic (Abend 13)", () => {
  it("legt fehlende Ordner an und schreibt den Inhalt", async () => {
    const ziel = join(dir, "neu", "cockpit", "tokens-today.json");
    await writeFileAtomic(ziel, "{\"a\":1}\n");
    expect(await readFile(ziel, "utf8")).toBe("{\"a\":1}\n");
  });
  it("ersetzt eine vorhandene Datei und lässt keine temporäre zurück", async () => {
    const ziel = join(dir, "t.json");
    await writeFile(ziel, "alt");
    await writeFileAtomic(ziel, "neu");
    expect(await readFile(ziel, "utf8")).toBe("neu");
    expect(await readdir(dir)).toEqual(["t.json"]);
  });
  it("scheitert das Umbenennen (Ziel ist ein Ordner), bleibt keine temporäre Datei liegen und der Fehler kommt an", async () => {
    const ziel = join(dir, "ziel");
    await mkdir(join(ziel, "unter"), { recursive: true });
    await expect(writeFileAtomic(ziel, "inhalt")).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["ziel"]);
  });
});
