import { describe, expect, it, vi } from "vitest";

const { TFolder } = vi.hoisted(() => ({ TFolder: class TFolder { path = ""; } }));
vi.mock("obsidian", () => ({ TFolder }));

import { readExclusion } from "../src/host/exclusion-vault";

const folder = (path: string) => Object.assign(new TFolder(), { path });
const file = (path: string) => ({ path });
const ON = { claudeExclusion: true, claudeExclusionSandbox: false };

function vault(files: Record<string, string>, entries: Array<{ path: string }>, configDir = ".obsidian") {
  const calls: string[] = [];
  return {
    calls,
    configDir,
    adapter: {
      exists: async (p: string) => { calls.push(`exists ${p}`); return p in files; },
      read: async (p: string) => { calls.push(`read ${p}`); if (!(p in files)) throw new Error("ENOENT"); return files[p]; },
    },
    getAllLoadedFiles: () => entries,
  };
}

describe("readExclusion", () => {
  const entries = [folder("/"), folder("Vertraulich"), file("Vertraulich/a.md"), file("offen.md")];
  it("aus: liest nichts, ergibt nichts", async () => {
    const v = vault({ ".obsidian/app.json": '{"userIgnoreFilters":["Vertraulich/"]}' }, entries);
    expect(await readExclusion(v, "/V", { ...ON, claudeExclusion: false })).toEqual({ settings: {}, notice: null, filters: [] });
    expect(v.calls).toEqual([]);
  });
  it("app.json fehlt oder ohne Schlüssel: nichts gesperrt, keine Zeile", async () => {
    expect(await readExclusion(vault({}, entries), "/V", ON)).toEqual({ settings: {}, notice: null, filters: [] });
    expect(await readExclusion(vault({ ".obsidian/app.json": '{"alwaysUpdateLinks":true}' }, entries), "/V", ON))
      .toEqual({ settings: {}, notice: null, filters: [] });
  });
  it("Liste aus app.json, Ordner als Ordner erkannt (die Wurzel \"/\" stört nicht)", async () => {
    const p = await readExclusion(vault({ ".obsidian/app.json": '{"userIgnoreFilters":["vertraulich/"]}' }, entries), "/V", ON);
    expect(p.settings).toEqual({ permissions: { deny: ["Edit(//V/Vertraulich/**)", "Edit(//V/vertraulich/**)", "Read(//V/Vertraulich/**)", "Read(//V/vertraulich/**)"] } });
    expect(p.notice).toBe("Ausschluss aktiv: 1 Eintrag gesperrt, Shell-Befehle wie grep -r nicht (Sandbox aus).");
    expect(p.filters.map((f) => f.text)).toEqual(["vertraulich/"]);
  });
  it("eigener Konfigordner", async () => {
    const v = vault({ ".mein/app.json": '{"userIgnoreFilters":["Vertraulich/"]}' }, entries, ".mein");
    expect((await readExclusion(v, "/V", ON)).settings).toHaveProperty("permissions");
    expect(v.calls).toContain("read .mein/app.json");
  });
  it("Sandbox-Schalter wird durchgereicht", async () => {
    const p = await readExclusion(vault({ ".obsidian/app.json": '{"userIgnoreFilters":["Vertraulich/"]}' }, entries), "/V", { ...ON, claudeExclusionSandbox: true });
    expect(p.settings).toHaveProperty("sandbox");
  });
  it("kaputtes JSON, null und gültiges JSON ohne Objekt: Sitzung startet ohne Regeln, mit Warnzeile (Review Focus)", async () => {
    for (const text of ["{kaputt", "null", "5", '"x"']) {
      const p = await readExclusion(vault({ ".obsidian/app.json": text }, entries), "/V", ON);
      expect(p.settings).toEqual({});
      expect(p.notice).toMatch(/^Ausschluss NICHT aktiv: app\.json nicht lesbar \(.+\)\.$/);
    }
  });
  it("userIgnoreFilters als Text: Fehlerzeile, nichts gesperrt", async () => {
    const p = await readExclusion(vault({ ".obsidian/app.json": '{"userIgnoreFilters":"Vertraulich/"}' }, entries), "/V", ON);
    expect(p.settings).toEqual({});
    expect(p.notice).toBe("Ausschluss: nichts gesperrt. Fehler in der Ausschlussliste: Ausschlussliste ist keine Liste.");
  });
});
