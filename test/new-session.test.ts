import { describe, expect, it } from "vitest";
import { handoffChoices, loadProjectDirs, sessionChoices, vaultFirst } from "../src/core/new-session";

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
