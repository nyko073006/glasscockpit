import { describe, expect, it } from "vitest";
import { DEFAULT_HIDDEN_PROJECT_DIRS } from "../src/core/constants";
import { claudeProjectDirName, handoffChoices, loadProjectDirs, parseHiddenDirs, sessionChoices, vaultFirst, type SessionChoice } from "../src/core/new-session";

it("Vault, Home, dann Projektordner sortiert ohne versteckte", () => {
  expect(sessionChoices("/v", "/h", "/h/Documents/Projects", ["zeta", ".git", "Ärger", "alpha"])).toEqual([
    { label: "claude (Vault)", cwd: "/v", baseName: "claude" },
    { label: "claude (Home)", cwd: "/h", baseName: "claude" },
    { label: "claude in alpha", cwd: "/h/Documents/Projects/alpha", baseName: "alpha" },
    { label: "claude in Ärger", cwd: "/h/Documents/Projects/Ärger", baseName: "Ärger" },
    { label: "claude in zeta", cwd: "/h/Documents/Projects/zeta", baseName: "zeta" },
  ]);
});

it("projectsRoot mit Schrägstrich am Ende ergibt keinen doppelten", () => {
  expect(sessionChoices("/v", "/h", "/p/", ["a"])[2].cwd).toBe("/p/a");
});

describe("vaultFirst: der Vault steht immer ganz oben", () => {
  const items = sessionChoices("/v", "/h", "/p", ["alpha"]);
  const wrap = (cwds: string[]) => cwds.map((cwd) => ({ cwd }));
  const cwds = (l: { cwd: string }[]) => l.map((x) => x.cwd);

  it("Gleichstand bei Eingabe „claude“: Home vor Vault wird gedreht, Vault zuerst", () => {
    expect(cwds(vaultFirst(wrap(["/h", "/v", "/p/alpha"]), "/v", (x) => x.cwd))).toEqual(["/v", "/h", "/p/alpha"]);
  });
  it("auch wenn ein Projekt besser passt, bleibt der Vault oben; Rest behält die Reihenfolge", () => {
    expect(cwds(vaultFirst(wrap(["/p/b", "/p/a", "/v", "/h"]), "/v", (x) => x.cwd))).toEqual(["/v", "/p/b", "/p/a", "/h"]);
  });
  it("ohne Vault in der Liste (Eingabe passt nicht) bleibt alles, wie es ist", () => {
    expect(cwds(vaultFirst(wrap(["/h", "/p/a"]), "/v", (x) => x.cwd))).toEqual(["/h", "/p/a"]);
  });
  it("die Ausgangsliste wird nicht verändert; ohne Eingabe steht der Vault schon vorn", () => {
    const l = wrap(["/h", "/v"]);
    vaultFirst(l, "/v", (x) => x.cwd);
    expect(cwds(l)).toEqual(["/h", "/v"]);
    expect(vaultFirst(items, "/v", (c) => c.cwd)[0].label).toBe("claude (Vault)");
  });
});

describe("loadProjectDirs: leere Vorgabe schaltet die Lesung ab", () => {
  it.each(["", "   "])("projectsRoot %j: nicht gelesen, kein Fehler, Auswahl nur Vault und Home", (leer) => {
    let gelesen = 0;
    const r = loadProjectDirs(leer, "/h", () => {
      gelesen++;
      throw new Error("ENOENT: readdir ''");
    });
    expect(gelesen).toBe(0);
    expect(r.error).toBeUndefined();
    expect(sessionChoices("/v", "/h", r.root, r.dirs).map((c) => c.cwd)).toEqual(["/v", "/h"]);
  });
  it("gesetzter Pfad wird gelesen, Fehler kommt als Text zurück", () => {
    expect(loadProjectDirs("/p", "/h", () => ["a"]).dirs).toEqual(["a"]);
    expect(loadProjectDirs("/p", "/h", () => { throw new Error("weg"); }).error).toBe("weg");
  });
});

describe("handoffChoices (Abend 19h)", () => {
  const h = (project: string, repo: string | null, task = "weiter") => ({ project, path: `P/${project}/Handoffs/a.md`, created: "2026-01-01", task, repo });
  it("Label, Ordner und Startnachricht", () => {
    expect(handoffChoices([h("A", "/Users/alex/a")], "/Users/alex/vault", "Handoff: {datei} / {auftrag}", () => true)).toEqual([
      { label: "Weiter: A, weiter", cwd: "/Users/alex/a", baseName: "a", handoff: { path: "P/A/Handoffs/a.md", prompt: "Handoff: P/A/Handoffs/a.md / weiter", repoMissing: false } },
    ]);
  });
  it("ohne repo oder fehlender Ordner: Vault, Hinweis im Label", () => {
    const r = handoffChoices([h("A", null), h("B", "/weg")], "/Users/alex/vault", "{datei}", (d) => d !== "/weg");
    expect(r.map((c) => [c.label, c.cwd])).toEqual([
      ["Weiter: A, weiter", "/Users/alex/vault"],
      ["Weiter: B, weiter (Repo fehlt, Start im Vault)", "/Users/alex/vault"],
    ]);
  });
  it("repoMissing nur bei gesetztem, aber fehlendem Repo", () => {
    const r = handoffChoices([h("A", null), h("B", "/weg"), h("C", "/da")], "/v", "{datei}", (d) => d !== "/weg");
    expect(r.map((c) => c.handoff?.repoMissing)).toEqual([false, true, false]);
  });
  it("laufend aufgenommener Pfad erscheint nicht im Menü", () => {
    const r = handoffChoices([h("A", null), h("B", null)], "/v", "{datei}", () => true, new Set(["P/A/Handoffs/a.md"]));
    expect(r.map((c) => c.label)).toEqual(["Weiter: B, weiter"]);
  });
  it("leerer Auftrag: nur Projektname", () => {
    expect(handoffChoices([h("A", null, "")], "/v", "{datei}", () => true)[0].label).toBe("Weiter: A");
  });
});

describe("Windows-Pfade (Abend 42)", () => {
  const h = (project: string, repo: string | null) => ({ project, path: `P/${project}/Handoffs/a.md`, created: "2026-01-01", task: "t", repo });
  it("handoffChoices win32: baseName aus dem letzten Teil, auch mit Trenner am Ende", () => {
    expect(handoffChoices([h("A", "C:\\p\\Projekt")], "C:\\v", "{datei}", () => true, new Set(), "win32")[0]).toMatchObject({ cwd: "C:\\p\\Projekt", baseName: "Projekt" });
    expect(handoffChoices([h("A", "C:\\p\\Projekt\\")], "C:\\v", "{datei}", () => true, new Set(), "win32")[0].baseName).toBe("Projekt");
  });
  it("handoffChoices win32: fehlendes Repo startet im Vault, baseName aus dem Vault", () => {
    expect(handoffChoices([h("A", "C:\\weg")], "C:\\Users\\x\\Mein Vault", "{datei}", () => false, new Set(), "win32")[0]).toMatchObject({ cwd: "C:\\Users\\x\\Mein Vault", baseName: "Mein Vault" });
  });
  it("handoffChoices darwin: Backslash trennt keinen Namen", () => {
    expect(handoffChoices([h("A", "C:\\p\\Projekt")], "/v", "{datei}", () => true)[0].baseName).toBe("C:\\p\\Projekt");
  });
  it("sessionChoices win32: Ordner unter projectsRoot mit Backslash, Trenner am Ende fällt weg", () => {
    const r = sessionChoices("C:\\v", "C:\\Users\\x", "C:\\Dev\\", ["app"], undefined, [], "win32");
    expect(r.at(-1)).toEqual({ label: "claude in app", cwd: "C:\\Dev\\app", baseName: "app" });
    expect(sessionChoices("C:\\v", "C:\\h", "C:\\", ["app"], undefined, [], "win32").at(-1)?.cwd).toBe("C:\\app");
  });
  it("sessionChoices win32: lastUsed bekommt den Backslash-Pfad", () => {
    const seen: string[] = [];
    sessionChoices("C:\\v", "C:\\h", "C:\\Dev", ["app"], (cwd) => (seen.push(cwd), 1), [], "win32");
    expect(seen).toEqual(["C:\\Dev\\app"]);
  });
  it("loadProjectDirs win32: ~\\Dev wird über expandHome aufgelöst", () => {
    const read: string[] = [];
    const r = loadProjectDirs("~\\Dev", "C:\\Users\\x", (root) => (read.push(root), ["app"]), "win32");
    expect(r).toEqual({ root: "C:\\Users\\x\\Dev", dirs: ["app"] });
    expect(read).toEqual(["C:\\Users\\x\\Dev"]);
  });
  it("loadProjectDirs darwin: ~\\Dev bleibt, wie es ist", () => {
    expect(loadProjectDirs("~\\Dev", "/h", () => []).root).toBe("~\\Dev");
  });
});

describe("claudeProjectDirName (Nachtrag 40a)", () => {
  it("jedes Zeichen außer A-Z, a-z, 0-9 wird zu -", () => {
    expect(claudeProjectDirName("/Users/anna/.claude/radar-tool")).toBe("-Users-anna--claude-radar-tool");
    expect(claudeProjectDirName("/p/meinprojekt (alt 2026-10-16)")).toBe("-p-meinprojekt--alt-2026-10-16-");
    expect(claudeProjectDirName("/p/Ärger")).toBe("-p--rger");
  });
});

describe("sessionChoices mit lastUsed (Nachtrag 40a)", () => {
  const t: Record<string, number> = { "/p/zeta": 300, "/p/beta": 100 };
  const lastUsed = (cwd: string) => t[cwd] ?? 0;
  const labels = (l: SessionChoice[]) => l.map((c) => c.label);

  it("benutzte zuerst nach Zeit, unbenutzte alphabetisch dahinter; Vault und Home bleiben oben", () => {
    expect(labels(sessionChoices("/v", "/h", "/p", ["alpha", "beta", "gamma", "zeta"], lastUsed))).toEqual([
      "claude (Vault)", "claude (Home)", "claude in zeta", "claude in beta", "claude in alpha", "claude in gamma",
    ]);
  });
  it("Gleichstand behält die alphabetische Reihenfolge", () => {
    expect(labels(sessionChoices("/v", "/h", "/p", ["b", "a"], () => 5)).slice(2)).toEqual(["claude in a", "claude in b"]);
  });
  it("ohne lastUsed exakt wie bisher (Gegentest alphabetisch)", () => {
    expect(sessionChoices("/v", "/h", "/p", ["zeta", "alpha"])).toEqual(sessionChoices("/v", "/h", "/p", ["zeta", "alpha"], () => 0));
    expect(labels(sessionChoices("/v", "/h", "/p", ["zeta", "alpha"])).slice(2)).toEqual(["claude in alpha", "claude in zeta"]);
  });
  it("lastUsed bekommt den vollen cwd des Projekts", () => {
    const seen: string[] = [];
    sessionChoices("/v", "/h", "/p/", ["a"], (c) => { seen.push(c); return 0; });
    expect(seen).toEqual(["/p/a"]);
  });
  it("Werte ≤ 0, NaN und Infinity gelten als unbenutzt und stehen alphabetisch hinter benutzten", () => {
    const v: Record<string, number> = { "/p/a": -5, "/p/b": NaN, "/p/c": 7, "/p/d": Infinity, "/p/e": 0 };
    expect(labels(sessionChoices("/v", "/h", "/p", ["a", "b", "c", "d", "e"], (c) => v[c])).slice(2)).toEqual([
      "claude in c", "claude in a", "claude in b", "claude in d", "claude in e",
    ]);
  });
});

describe("Ausgeblendete Ordner (Nachtrag Abend 41)", () => {
  const labels = (l: SessionChoice[]) => l.map((c) => c.label);
  const dirs = ["alpha", "worktrees", "beta"];

  it("parseHiddenDirs: an Kommas trennen, trimmen, leere Teile weg", () => {
    expect(parseHiddenDirs(" a , ,b ")).toEqual(["a", "b"]);
    expect(parseHiddenDirs("worktrees")).toEqual(["worktrees"]);
    expect(parseHiddenDirs("")).toEqual([]);
    expect(parseHiddenDirs(" , ,")).toEqual([]);
  });
  it("Vorgabe worktrees blendet den Ordner aus, die übrigen bleiben deutsch sortiert", () => {
    expect(labels(sessionChoices("/v", "/h", "/p", dirs, undefined, parseHiddenDirs(DEFAULT_HIDDEN_PROJECT_DIRS)))).toEqual([
      "claude (Vault)", "claude (Home)", "claude in alpha", "claude in beta",
    ]);
  });
  it("leere Einstellung zeigt alle", () => {
    expect(labels(sessionChoices("/v", "/h", "/p", dirs, undefined, parseHiddenDirs(""))).slice(2)).toEqual(["claude in alpha", "claude in beta", "claude in worktrees"]);
  });
  it("ohne sechsten Parameter wird nichts ausgeblendet (wie bisher)", () => {
    expect(labels(sessionChoices("/v", "/h", "/p", dirs)).slice(2)).toContain("claude in worktrees");
  });
  it("mehrere Namen: „ a , ,b “ blendet a und b aus", () => {
    expect(labels(sessionChoices("/v", "/h", "/p", ["a", "b", "c"], undefined, parseHiddenDirs(" a , ,b "))).slice(2)).toEqual(["claude in c"]);
  });
  it("Groß- und Kleinschreibung zählt nicht, in beide Richtungen", () => {
    expect(labels(sessionChoices("/v", "/h", "/p", ["worktrees", "Äpfel"], undefined, ["Worktrees"])).slice(2)).toEqual(["claude in Äpfel"]);
    expect(labels(sessionChoices("/v", "/h", "/p", ["WorkTrees"], undefined, ["worktrees"])).slice(2)).toEqual([]);
    expect(labels(sessionChoices("/v", "/h", "/p", ["Äpfel", "b"], undefined, ["äpfel"])).slice(2)).toEqual(["claude in b"]);
  });
  it("nur ganzer Name: worktrees-alt und mein-worktrees bleiben", () => {
    expect(labels(sessionChoices("/v", "/h", "/p", ["worktrees", "worktrees-alt", "mein-worktrees"], undefined, ["worktrees"])).slice(2)).toEqual([
      "claude in mein-worktrees", "claude in worktrees-alt",
    ]);
  });
  it("Vault und Home bleiben, auch wenn ihr Name in der Liste steht", () => {
    const r = sessionChoices("/x/worktrees", "/y/worktrees", "/p", ["worktrees"], undefined, ["worktrees", "/x/worktrees", "claude (Vault)", "claude (Home)"]);
    expect(r.map((c) => c.cwd)).toEqual(["/x/worktrees", "/y/worktrees"]);
    expect(r.map((c) => c.baseName)).toEqual(["claude", "claude"]);
  });
  it("„Weiter“-Einträge hängen nicht an sessionChoices und fallen nie weg (Handoff im Ordner worktrees)", () => {
    const h = handoffChoices([{ path: "/h.md", project: "worktrees", created: "2026-10-21", task: "x", repo: "/p/worktrees" }], "/v", "{datei}", () => true);
    expect(h).toHaveLength(1);
    expect(h[0].cwd).toBe("/p/worktrees");
  });
  it("mit lastUsed bleibt die Zeitsortierung der übrigen gleich", () => {
    const t: Record<string, number> = { "/p/zeta": 300, "/p/beta": 100, "/p/worktrees": 999 };
    const r = sessionChoices("/v", "/h", "/p", ["alpha", "beta", "worktrees", "zeta"], (c) => t[c] ?? 0, ["worktrees"]);
    expect(labels(r)).toEqual(["claude (Vault)", "claude (Home)", "claude in zeta", "claude in beta", "claude in alpha"]);
  });
  it("lastUsed wird für ausgeblendete Ordner nicht gelesen", () => {
    const seen: string[] = [];
    sessionChoices("/v", "/h", "/p", ["a", "worktrees"], (c) => { seen.push(c); return 0; }, ["worktrees"]);
    expect(seen).toEqual(["/p/a"]);
  });
});
