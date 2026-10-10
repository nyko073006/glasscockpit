import { describe, expect, it } from "vitest";
import { readFocus, readVaultState, type VaultLike } from "../src/host/feed-vault";
import { DEFAULT_SETTINGS } from "../src/core/settings";

// Minimaler Vault: Ordner mit Dateien (Name -> Inhalt), Pfad relativ zum Vault.
function vault(tree: Record<string, Record<string, string>>, failRead: string[] = []): VaultLike {
  const file = (dir: string, name: string) => ({ name, path: dir === "" ? name : `${dir}/${name}`, extension: name.split(".").pop() ?? "" });
  return {
    getFolderByPath: (p) => (p in tree ? { children: Object.keys(tree[p]).map((n) => file(p, n)) } : null),
    getFileByPath: (p) => {
      const i = p.lastIndexOf("/");
      const dir = i < 0 ? "" : p.slice(0, i);
      const name = p.slice(i + 1);
      return tree[dir] && name in tree[dir] ? file(dir, name) : null;
    },
    cachedRead: async (f) => {
      if (failRead.includes(f.path)) throw new Error("nicht lesbar");
      const i = f.path.lastIndexOf("/");
      return tree[i < 0 ? "" : f.path.slice(0, i)][f.name];
    },
  };
}
const NOW = new Date(2026, 9, 6, 12, 0, 0);
const s = { ...DEFAULT_SETTINGS, inboxDir: "01 Inbox", indexFile: "Index.md", dailyDir: "05 Daily Notes", briefingsDir: "Briefings", focusHeading: "Heute dran" };

describe("readVaultState", () => {
  const tree = {
    "01 Inbox": { "a.md": "x", "b.md": "y", ".versteckt.md": "z", "bild.png": "p" },
    "": { "Index.md": '---\ngenerated_at: 2026-10-01T08:00:00\n---\n' },
    "05 Daily Notes": { "2026-10-06.md": "", "2026-10-05.md": "" },
  } as Record<string, Record<string, string>>;

  it("Inbox-Notizen als Pfade (nur .md, nichts Verstecktes), Index-Stand in ms, Daily Note heute", async () => {
    const v = vault(tree);
    const state = await readVaultState(v, s, NOW);
    expect(state?.inbox).toEqual(["01 Inbox/a.md", "01 Inbox/b.md"]);
    expect(state?.indexGeneratedAt).toBe(new Date(2026, 9, 1, 8, 0, 0).getTime());
    expect(state?.dailyToday).toBe(true);
  });
  it("Daily Note von gestern zählt nicht", async () => {
    const v = vault({ ...tree, "05 Daily Notes": { "2026-10-05.md": "" } });
    expect((await readVaultState(v, s, NOW))?.dailyToday).toBe(false);
  });
  it("Inbox-Ordner fehlt: leere Liste; Daily-Ordner fehlt: nein; Index fehlt: null", async () => {
    const state = await readVaultState(vault({}), s, NOW);
    expect(state).toEqual({ inbox: [], indexGeneratedAt: null, dailyToday: false });
  });
  it("Index kaputt oder unlesbar: null, der Rest bleibt", async () => {
    const kaputt = vault({ ...tree, "": { "Index.md": "kein Frontmatter" } });
    expect((await readVaultState(kaputt, s, NOW))?.indexGeneratedAt).toBeNull();
    const unlesbar = vault(tree, ["Index.md"]);
    const state = await readVaultState(unlesbar, s, NOW);
    expect(state?.indexGeneratedAt).toBeNull();
    expect(state?.inbox.length).toBe(2);
  });
  it("Index in einem Unterordner (indexFile mit Pfad)", async () => {
    const v = vault({ ...tree, "Meta": { "Index.md": "---\ngenerated_at: 2026-09-30 10:00\n---\n" } });
    const state = await readVaultState(v, { ...s, indexFile: "Meta/Index.md" }, NOW);
    expect(state?.indexGeneratedAt).toBe(new Date(2026, 8, 30, 10, 0, 0).getTime());
  });
});

describe("readFocus: heutiges Briefing, parseFocus", () => {
  const text = "# Briefing\n\n## Heute dran\n\n- Erstes\n- Zweites\n- Drittes\n\n## Termine\n- x\n";
  it("die ersten zwei Punkte unter der Überschrift im Briefing von heute", async () => {
    const v = vault({ Briefings: { "2026-10-06.md": text, "2026-10-05.md": "## Heute dran\n- alt\n" } });
    expect(await readFocus(v, s, NOW)).toEqual(["Erstes", "Zweites"]);
  });
  it("kein Briefing von heute (nur gestern): leer, nie das alte", async () => {
    const v = vault({ Briefings: { "2026-10-05.md": text } });
    expect(await readFocus(v, s, NOW)).toEqual([]);
  });
  it("Ordner fehlt, Datei unlesbar, Überschrift fehlt: leer", async () => {
    expect(await readFocus(vault({}), s, NOW)).toEqual([]);
    expect(await readFocus(vault({ Briefings: { "2026-10-06.md": text } }, ["Briefings/2026-10-06.md"]), s, NOW)).toEqual([]);
    expect(await readFocus(vault({ Briefings: { "2026-10-06.md": "# nur Titel\n" } }), s, NOW)).toEqual([]);
  });
  it("eigene Überschrift aus den Einstellungen", async () => {
    const v = vault({ Briefings: { "2026-10-06.md": "## Fokus\n- A\n" } });
    expect(await readFocus(v, { ...s, focusHeading: "Fokus" }, NOW)).toEqual(["A"]);
  });
});

describe("nicht eingerichtet (Abend 21): leere Pfade werden nie gelesen", () => {
  // Der Vault-Wurzelordner liegt unter "" (wie getFolderByPath("") in Obsidian): würde er gelesen, zählte die Inbox den ganzen Vault.
  const wurzel = { "": { "a.md": "x", "b.md": "y", "2026-10-06.md": "z", "Index.md": '---\ngenerated_at: 2026-10-01T08:00:00\n---\n' } };
  const leer = { ...DEFAULT_SETTINGS, inboxDir: "", indexFile: "", dailyDir: "", briefingsDir: "  ", focusHeading: "Heute dran" };
  it("Vault-Lage: leere Einstellungen ergeben nichts statt der Wurzel", async () => {
    expect(await readVaultState(vault(wurzel), leer, NOW)).toEqual({ inbox: [], indexGeneratedAt: null, dailyToday: false });
  });
  it("Fokus: leerer Briefing-Ordner ergibt keinen Fokus", async () => {
    expect(await readFocus(vault({ "": { "2026-10-06.md": "## Heute dran\n- x\n" } }), leer, NOW)).toEqual([]);
  });
});
