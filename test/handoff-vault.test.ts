import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { readOpenHandoffs, type HandoffVaultLike } from "../src/host/handoff-vault";

function fake(files: Record<string, string>, failOn: string[] = []): HandoffVaultLike & { reads: string[] } {
  const reads: string[] = [];
  const paths = Object.keys(files);
  return {
    reads,
    getFolderByPath(path) {
      const pre = path === "" ? "" : `${path}/`;
      if (path !== "" && !paths.some((p) => p.startsWith(pre))) return null;
      const names = new Set(paths.filter((p) => p.startsWith(pre)).map((p) => p.slice(pre.length).split("/")[0]));
      return { children: [...names].map((n) => { const full = pre + n; const isFile = full in files; return isFile ? { name: n, path: full, extension: n.split(".").pop() } : { name: n, path: full }; }) };
    },
    async cachedRead(f) { reads.push(f.path); if (failOn.includes(f.path)) throw new Error("EIO"); return files[f.path]; },
  };
}
const S = { hubsDir: "P", handoffsDir: "Handoffs", hubSuffix: " - PMO HUB.md" };

describe("readOpenHandoffs", () => {
  it("je Projekt der neueste offene, repo aus dem HUB mit ~ aufgelöst", async () => {
    const v = fake({
      "P/A/A - PMO HUB.md": "---\nrepo: ~/dev/a\n---\n",
      "P/A/Handoffs/2026-01-02 x.md": "---\nstatus: offen\nnaechster_auftrag: a1\n---\n",
      "P/B/B - PMO HUB.md": "---\ntags: [x]\n---\n",
      "P/B/Handoffs/2026-01-04 y.md": "---\nstatus: offen\n---\n",
      "P/C/C - PMO HUB.md": "---\nrepo: /x\n---\n",
    });
    const r = await readOpenHandoffs(v, S, parse, "/Users/alex");
    expect(r.items.map((i) => [i.project, i.repo, i.created])).toEqual([["B", null, "2026-01-04"], ["A", "/Users/alex/dev/a", "2026-01-02"]]);
  });
  it("Ordner ohne HUB-Datei zählt nicht als Projekt", async () => {
    const v = fake({ "P/Z/Handoffs/2026-01-02 x.md": "---\nstatus: offen\n---\n" });
    expect((await readOpenHandoffs(v, S, parse, "/Users/alex")).items).toEqual([]);
  });
  it("nicht eingerichtet: liest nichts", async () => {
    const v = fake({ "P/A/A - PMO HUB.md": "---\n---\n" });
    expect(await readOpenHandoffs(v, { ...S, hubsDir: "" }, parse, "/h")).toEqual({ items: [], errors: [] });
    expect(await readOpenHandoffs(v, { ...S, handoffsDir: " " }, parse, "/h")).toEqual({ items: [], errors: [] });
    expect(v.reads).toEqual([]);
  });
  it("nur .md im Handoff-Ordner, Fehler werden gesammelt", async () => {
    const v = fake({
      "P/A/A - PMO HUB.md": "---\n---\n",
      "P/A/Handoffs/bild.png": "x",
      "P/A/Handoffs/kaputt.md": "ohne",
    });
    const r = await readOpenHandoffs(v, S, parse, "/h");
    expect(r.errors).toEqual(["Handoff ohne Frontmatter: P/A/Handoffs/kaputt.md"]);
    expect(v.reads).not.toContain("P/A/Handoffs/bild.png");
  });
  it("Lesefehler einer Datei bricht nicht alles ab: Fehler gemeldet, andere Projekte erscheinen", async () => {
    const v = fake({
      "P/A/A - PMO HUB.md": "---\n---\n",
      "P/A/Handoffs/2026-01-02 x.md": "---\nstatus: offen\n---\n",
      "P/B/B - PMO HUB.md": "---\n---\n",
      "P/B/Handoffs/2026-01-04 y.md": "---\nstatus: offen\n---\n",
      "P/C/C - PMO HUB.md": "---\n---\n",
      "P/C/Handoffs/2026-01-05 z.md": "---\nstatus: offen\n---\n",
    }, ["P/A/Handoffs/2026-01-02 x.md", "P/C/C - PMO HUB.md"]);
    const r = await readOpenHandoffs(v, S, parse, "/h");
    expect(r.items.map((i) => i.project)).toEqual(["B"]);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.join("\n")).toContain("P/A/Handoffs/2026-01-02 x.md");
    expect(r.errors.join("\n")).toContain("EIO");
    expect(r.errors.join("\n")).toContain("P/C/C - PMO HUB.md");
  });
});
