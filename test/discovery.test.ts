import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { BUILTIN_COMMANDS } from "../src/core/builtin-commands";
import { type DiscoveryRoots, discover, parsePlugins } from "../src/core/discovery";
import { type FakeTree, fakeFs } from "./helpers/fake-fs";

const H = "/h";
const V = "/v";
const roots: DiscoveryRoots = { home: H, vault: V };
const md = (fm: string, body = "Text") => `---\n${fm}\n---\n${body}\n`;
const run = (tree: FakeTree, r: DiscoveryRoots = roots) => discover(fakeFs(tree), r, parse);
const names = (list: { name: string }[]) => list.map((e) => e.name);

describe("Skills", () => {
  it("Ordner mit SKILL.md erscheint, Name aus Frontmatter, sonst Ordnername", async () => {
    const r = await run({
      files: {
        [`${H}/.claude/skills/a/SKILL.md`]: md("name: alpha\ndescription: Eins"),
        [`${H}/.claude/skills/b/SKILL.md`]: "ohne Frontmatter",
      },
    });
    expect(r.skills.map((s) => [s.name, s.description, s.source])).toEqual([
      ["alpha", "Eins", "user"],
      ["b", "", "user"],
    ]);
  });
  it("Ordner ohne SKILL.md fehlt", async () => {
    const r = await run({ files: { [`${H}/.claude/skills/synced/x/SKILL.md`]: "x", [`${H}/.claude/skills/ok/SKILL.md`]: "y" } });
    expect(names(r.skills)).toEqual(["ok"]);
  });
  it("Ordner mit . oder _ vorn fehlen", async () => {
    const r = await run({
      files: {
        [`${H}/.claude/skills/.hidden/SKILL.md`]: "x",
        [`${H}/.claude/skills/_arch/SKILL.md`]: "x",
        [`${H}/.claude/skills/ok/SKILL.md`]: "y",
      },
    });
    expect(names(r.skills)).toEqual(["ok"]);
  });
  it("Symlink-Ordner wird als Skill erkannt", async () => {
    const r = await run({
      files: { [`${H}/.agents/skills/emil/SKILL.md`]: md("description: Design") },
      links: { [`${H}/.claude/skills/emil`]: `${H}/.agents/skills/emil` },
    });
    expect(r.skills.map((s) => [s.name, s.description])).toEqual([["emil", "Design"]]);
  });
  it("user-invocable: false fehlt", async () => {
    const r = await run({
      files: {
        [`${H}/.claude/skills/a/SKILL.md`]: md("user-invocable: false"),
        [`${H}/.claude/skills/b/SKILL.md`]: md("user-invocable: true"),
      },
    });
    expect(names(r.skills)).toEqual(["b"]);
  });
  it("Blockskalar-Beschreibung als Text, Zeilen zu einem Leerzeichen", async () => {
    const r = await run({
      files: {
        [`${H}/.claude/skills/handoff/SKILL.md`]: md("name: handoff\ndescription: >-\n  Erste Zeile\n  zweite Zeile"),
        [`${H}/.claude/skills/lint/SKILL.md`]: md("name: lint\ndescription: >\n  Woechentlich\n  pruefen\n"),
        [`${H}/.claude/skills/pipe/SKILL.md`]: md("description: |\n  Eins\n\n  Zwei"),
      },
    });
    const d = Object.fromEntries(r.skills.map((s) => [s.name, s.description]));
    expect(d).toEqual({ handoff: "Erste Zeile zweite Zeile", lint: "Woechentlich pruefen", pipe: "Eins Zwei" });
  });
  it("Vorrang user vor vault vor project, Dedupe nach Name", async () => {
    const r = await run(
      {
        files: {
          [`${H}/.claude/skills/x/SKILL.md`]: md("description: user"),
          [`${V}/.claude/skills/x/SKILL.md`]: md("description: vault"),
          [`${V}/.claude/skills/y/SKILL.md`]: md("description: vault"),
          [`/p/.claude/skills/y/SKILL.md`]: md("description: project"),
          [`/p/.claude/skills/z/SKILL.md`]: md("description: project"),
        },
      },
      { ...roots, project: "/p" },
    );
    expect(r.skills.map((s) => [s.name, s.source])).toEqual([
      ["x", "user"],
      ["y", "vault"],
      ["z", "project"],
    ]);
  });
  it("project gleich vault: nur einmal gelesen", async () => {
    const r = await run({ files: { [`${V}/.claude/skills/a/SKILL.md`]: "x" } }, { ...roots, project: V });
    expect(r.skills.map((s) => s.source)).toEqual(["vault"]);
  });
  it("nach Name sortiert", async () => {
    const r = await run({ files: { [`${H}/.claude/skills/b/SKILL.md`]: "", [`${H}/.claude/skills/a/SKILL.md`]: "" } });
    expect(names(r.skills)).toEqual(["a", "b"]);
  });
});

describe("Agents", () => {
  it("rekursiv, Unterordner ohne Namensraum, Name aus Frontmatter, sonst Dateiname", async () => {
    const r = await run({
      files: {
        [`${H}/.claude/agents/alex/skeptiker.md`]: md("name: skeptiker\ndescription: Prueft"),
        [`${H}/.claude/agents/gsd-planner.md`]: "ohne",
        [`${H}/.claude/agents/alex/tief/x.md`]: md("name: xx"),
        [`${H}/.claude/agents/notes.txt`]: "kein md",
      },
    });
    expect(r.agents.map((a) => [a.name, a.description])).toEqual([
      ["gsd-planner", ""],
      ["skeptiker", "Prueft"],
      ["xx", ""],
    ]);
  });
  it("Symlink-Duplikat (stefan.md -> alex/stefan.md) nur einmal", async () => {
    const r = await run({
      files: { [`${H}/.claude/agents/alex/stefan.md`]: md("name: stefan") },
      links: { [`${H}/.claude/agents/stefan.md`]: `${H}/.claude/agents/alex/stefan.md` },
    });
    expect(names(r.agents)).toEqual(["stefan"]);
  });
  it("Zyklus endet", async () => {
    const r = await run({
      files: { [`${H}/.claude/agents/a.md`]: md("name: a") },
      links: { [`${H}/.claude/agents/loop`]: `${H}/.claude/agents` },
    });
    expect(names(r.agents)).toEqual(["a"]);
  });
  it("tiefer Zyklus über Unterordner endet", async () => {
    const r = await run({
      files: { [`${H}/.claude/agents/sub/a.md`]: md("name: a") },
      links: { [`${H}/.claude/agents/sub/back`]: `${H}/.claude/agents` },
    });
    expect(names(r.agents)).toEqual(["a"]);
  });
  it("versteckte Ordner und Dateien fehlen", async () => {
    const r = await run({
      files: { [`${H}/.claude/agents/.git/x.md`]: "x", [`${H}/.claude/agents/.h.md`]: "x", [`${H}/.claude/agents/ok.md`]: "y" },
    });
    expect(names(r.agents)).toEqual(["ok"]);
  });
  it("Tiefe höchstens 8", async () => {
    const tief = (n: number) => `${H}/.claude/agents/${Array.from({ length: n }, (_, i) => `d${i}`).join("/")}/x.md`;
    const r = await run({ files: { [tief(8)]: md("name: acht"), [tief(9)]: md("name: neun") } });
    expect(names(r.agents)).toEqual(["acht"]);
  });
  it("Vorrang project vor vault vor user", async () => {
    const r = await run(
      {
        files: {
          [`${H}/.claude/agents/x.md`]: md("description: user"),
          [`${V}/.claude/agents/x.md`]: md("description: vault"),
          [`/p/.claude/agents/x.md`]: md("description: project"),
        },
      },
      { ...roots, project: "/p" },
    );
    expect(r.agents.map((a) => [a.name, a.source])).toEqual([["x", "project"]]);
  });
});

describe("Commands", () => {
  it("eingebaute sind dabei, source builtin", async () => {
    const r = await run({});
    expect(r.commands).toHaveLength(BUILTIN_COMMANDS.length);
    expect(r.commands.every((c) => c.source === "builtin")).toBe(true);
    expect(BUILTIN_COMMANDS.length).toBeGreaterThan(100);
  });
  it("Unterordner als Namensraum sub:name, Name aus Dateiname", async () => {
    const r = await run({
      files: { [`${H}/.claude/commands/gsd/plan.md`]: md("name: ignoriert\ndescription: Plant"), [`${V}/.claude/commands/top.md`]: "x" },
    });
    const own = r.commands.filter((c) => c.source !== "builtin");
    expect(own.map((c) => [c.name, c.description, c.source])).toEqual([
      ["gsd:plan", "Plant", "user"],
      ["top", "", "vault"],
    ]);
  });
  it("Datei-Command überschreibt eingebauten gleichen Namens", async () => {
    const r = await run({ files: { [`${H}/.claude/commands/clear.md`]: md("description: Meins") } });
    const clear = r.commands.filter((c) => c.name === "clear");
    expect(clear).toHaveLength(1);
    expect(clear[0]).toMatchObject({ source: "user", description: "Meins" });
  });
  it("user vor vault", async () => {
    const r = await run({ files: { [`${H}/.claude/commands/q.md`]: "x", [`${V}/.claude/commands/q.md`]: "y" } });
    expect(r.commands.filter((c) => c.name === "q").map((c) => c.source)).toEqual(["user"]);
  });
});

describe("Plugins", () => {
  const installed = JSON.stringify({
    version: 2,
    plugins: {
      "sp@mp": [{ scope: "user", installPath: "/pl/sp" }],
      "off@mp": [{ scope: "user", installPath: "/pl/off" }],
      "loc@mp": [{ scope: "local", projectPath: "/fremd", installPath: "/pl/loc" }],
      "mine@mp": [{ scope: "local", projectPath: V, installPath: "/pl/mine" }],
      "dup@mp": [{ scope: "user", installPath: "/pl/dup1" }, { scope: "user", installPath: "/pl/dup2" }],
    },
  });
  const settings = JSON.stringify({ enabledPlugins: { "sp@mp": true, "off@mp": false, "loc@mp": true, "mine@mp": true, "dup@mp": true } });

  it("parsePlugins: aktiv, user immer, local nur im eigenen Projekt, Duplikate einmal", () => {
    expect(parsePlugins(installed, settings, roots)).toEqual([
      { name: "sp", installPath: "/pl/sp" },
      { name: "mine", installPath: "/pl/mine" },
      { name: "dup", installPath: "/pl/dup1" },
    ]);
  });
  it("parsePlugins: local im project-Root zählt", () => {
    const j = JSON.stringify({ plugins: { "a@m": [{ scope: "local", projectPath: "/p", installPath: "/x" }] } });
    const s = JSON.stringify({ enabledPlugins: { "a@m": true } });
    expect(parsePlugins(j, s, { ...roots, project: "/p" })).toHaveLength(1);
    expect(parsePlugins(j, s, roots)).toHaveLength(0);
  });
  it("parsePlugins: nicht true (fehlt, \"true\") zählt nicht", () => {
    const j = JSON.stringify({ plugins: { "a@m": [{ scope: "user", installPath: "/x" }], "b@m": [{ scope: "user", installPath: "/y" }] } });
    expect(parsePlugins(j, JSON.stringify({ enabledPlugins: { "b@m": "true" } }), roots)).toEqual([]);
  });
  it.each([null, "", "{kaputt", "[]", "42", '{"plugins":5}'])("parsePlugins: kaputt/fehlend (%s) → []", (x) => {
    expect(parsePlugins(x, settings, roots)).toEqual([]);
    expect(parsePlugins(installed, x, roots)).toEqual([]);
  });

  const files = {
    "/pl/sp/skills/brain/SKILL.md": md("description: Denken"),
    "/pl/sp/skills/hidden/SKILL.md": md("user-invocable: false"),
    "/pl/sp/agents/rev/code.md": md("description: Prueft"),
    "/pl/sp/agents/top.md": md("name: topper"),
    "/pl/sp/commands/hello.md": md("description: Gruss"),
    "/pl/off/skills/nope/SKILL.md": "x",
    "/pl/loc/skills/nope/SKILL.md": "x",
    "/pl/mine/SKILL.md": md("name: solo\ndescription: Einzeln"),
    "/h/.claude/plugins/installed_plugins.json": installed,
    "/h/.claude/settings.json": settings,
  };

  it("Plugin-Skill, -Agent, -Command mit Präfix; Unterordner im Agent-Namen", async () => {
    const r = await run({ files });
    expect(r.skills.map((s) => [s.name, s.source])).toEqual([
      ["mine:solo", "plugin"],
      ["sp:brain", "plugin"],
    ]);
    expect(r.agents.map((a) => a.name)).toEqual(["sp:rev:code", "sp:topper"]);
    expect(r.commands.filter((c) => c.source === "plugin").map((c) => c.name)).toEqual(["sp:hello"]);
  });
  it("deaktiviertes Plugin und fremdes local fehlen", async () => {
    const r = await run({ files });
    const all = [...r.skills, ...r.agents, ...r.commands].map((e) => e.name).join(" ");
    expect(all).not.toContain("nope");
  });
  it("kaputte JSON → keine Plugins, kein Throw", async () => {
    const r = await run({ files: { ...files, "/h/.claude/plugins/installed_plugins.json": "{kaputt" } });
    expect(r.skills).toEqual([]);
    expect(r.agents).toEqual([]);
  });
  it("fehlende JSON-Dateien → keine Plugins", async () => {
    const r = await run({});
    expect(r.skills).toEqual([]);
  });
});
