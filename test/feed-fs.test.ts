import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOwnSessionFiles, readRadarFile } from "../src/host/feed-fs";

const ID_A = "90ef2efe-1234-4abc-8def-0123456789ab";
const ID_B = "11111111-2222-4333-8444-555555555555";
const NOW = new Date(2026, 9, 6, 12, 0, 0).getTime();
const gut = (id: string, writtenAtMs: number) =>
  JSON.stringify({ session_id: id, written_at: Math.floor(writtenAtMs / 1000), context_tokens: 90_000, used_percentage: 45, model: "Opus" });

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "cockpit-feedfs-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("readOwnSessionFiles", () => {
  it("liefert nur eigene Sitzungen, nach Claude-ID", async () => {
    await writeFile(join(dir, `${ID_A}.json`), gut(ID_A, NOW - 1000));
    await writeFile(join(dir, `${ID_B}.json`), gut(ID_B, NOW - 1000));
    const m = await readOwnSessionFiles(dir, [ID_A], NOW);
    expect([...m.keys()]).toEqual([ID_A]);
    expect(m.get(ID_A)?.contextTokens).toBe(90_000);
  });

  it("räumt Dateien älter als 24 h weg (auch fremde), frische bleiben", async () => {
    await writeFile(join(dir, `${ID_A}.json`), gut(ID_A, NOW - 1000));
    await writeFile(join(dir, `${ID_B}.json`), gut(ID_B, NOW - 25 * 3600_000));
    await readOwnSessionFiles(dir, [ID_A], NOW);
    expect((await readdir(dir)).sort()).toEqual([`${ID_A}.json`]);
  });

  it("unlesbare Datei: übersprungen, nach 24 h (Dateizeit) weggeräumt, vorher nicht", async () => {
    await writeFile(join(dir, "kaputt.json"), "{ nicht json");
    await readOwnSessionFiles(dir, [ID_A], NOW);
    expect(await readdir(dir)).toEqual(["kaputt.json"]);
    const alt = new Date(NOW - 30 * 3600_000);
    await utimes(join(dir, "kaputt.json"), alt, alt);
    await readOwnSessionFiles(dir, [ID_A], NOW);
    expect(await readdir(dir)).toEqual([]);
  });

  it("fremde Dateien ohne .json und Unterordner bleiben unangetastet", async () => {
    await writeFile(join(dir, "notiz.txt"), "x");
    await mkdir(join(dir, "unter"));
    await readOwnSessionFiles(dir, [ID_A], NOW);
    expect((await readdir(dir)).sort()).toEqual(["notiz.txt", "unter"]);
  });

  it("Ordner fehlt: leere Liste, kein Fehler", async () => {
    const m = await readOwnSessionFiles(join(dir, "gibt-es-nicht"), [ID_A], NOW);
    expect(m.size).toBe(0);
  });

  it("Dateiname und Inhalt widersprechen sich: gilt der Inhalt (session_id), wie die Statuszeile ihn schreibt", async () => {
    await writeFile(join(dir, "irgendwas.json"), gut(ID_A, NOW));
    const m = await readOwnSessionFiles(dir, [ID_A], NOW);
    expect(m.has(ID_A)).toBe(true);
  });
});

describe("readRadarFile", () => {
  it("heute geschrieben und lesbar: green", async () => {
    await writeFile(join(dir, "state.json"), "{}");
    await utimes(join(dir, "state.json"), new Date(NOW - 60_000), new Date(NOW - 60_000));
    expect(await readRadarFile(join(dir, "state.json"), NOW)).toBe("green");
  });
  it("gestern geschrieben: gray", async () => {
    await writeFile(join(dir, "state.json"), "{}");
    const gestern = new Date(2026, 9, 5, 22, 0, 0);
    await utimes(join(dir, "state.json"), gestern, gestern);
    expect(await readRadarFile(join(dir, "state.json"), NOW)).toBe("gray");
  });
  it("Datei fehlt (ENOENT): gray", async () => {
    expect(await readRadarFile(join(dir, "nix.json"), NOW)).toBe("gray");
  });
  it("vorhanden, aber nicht lesbar (hier ein Ordner): red", async () => {
    await mkdir(join(dir, "ordner.json"));
    expect(await readRadarFile(join(dir, "ordner.json"), NOW)).toBe("red");
  });
  it("kaputtes JSON, auch wenn heute geschrieben: red", async () => {
    await writeFile(join(dir, "state.json"), "{ kaputt");
    await utimes(join(dir, "state.json"), new Date(NOW), new Date(NOW));
    expect(await readRadarFile(join(dir, "state.json"), NOW)).toBe("red");
  });
});
