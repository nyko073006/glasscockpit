import { describe, expect, it } from "vitest";
import { DAY_LOG_SEP, countsAsCode, dayTotals, groupByCommonDir, formatCount, parseDayLog, startOfLocalDay, topRepos } from "../src/core/day-stats";

const commit = (hash: string, ...files: string[]) => `${DAY_LOG_SEP}${hash}\n\n${files.join("\n")}\n`;

describe("parseDayLog", () => {
  it("leere Ausgabe: nichts", () => {
    expect(parseDayLog("")).toEqual({ commits: 0, loc: 0 });
    expect(parseDayLog("\n")).toEqual({ commits: 0, loc: 0 });
  });

  it("hinzugefügt minus gelöscht, über Commits und Dateien", () => {
    const out = commit("a1", "10\t2\tsrc/a.ts", "5\t0\tsrc/b.ts") + commit("b2", "1\t4\tsrc/c.swift");
    expect(parseDayLog(out)).toEqual({ commits: 2, loc: 10 });
  });

  it("negative Summe bleibt negativ", () => {
    expect(parseDayLog(commit("a1", "2\t30\tsrc/a.ts"))).toEqual({ commits: 1, loc: -28 });
  });

  it("Binärzeile (-) zählt nicht, der Commit schon", () => {
    expect(parseDayLog(commit("a1", "-\t-\tlogo.png", "3\t1\tsrc/a.ts"))).toEqual({ commits: 1, loc: 2 });
  });

  it("Lockdateien, .md und .txt zählen nicht, auch nicht in Unterordnern", () => {
    const out = commit(
      "a1",
      "900\t100\tpackage-lock.json", "50\t0\tapp/yarn.lock", "50\t0\tpnpm-lock.yaml", "70\t0\tX.xcodeproj/Package.resolved",
      "30\t0\tREADME.md", "30\t0\tdocs/a.txt", "4\t1\tsrc/a.ts",
    );
    expect(parseDayLog(out)).toEqual({ commits: 1, loc: 3 });
  });

  it("derselbe Hash zweimal zählt einmal (Zeilen und Commit)", () => {
    const out = commit("a1", "10\t0\tsrc/a.ts") + commit("a1", "10\t0\tsrc/a.ts") + commit("b2", "1\t0\tsrc/b.ts");
    expect(parseDayLog(out)).toEqual({ commits: 2, loc: 11 });
  });

  it("Commit ohne Dateien (leer) zählt als Commit", () => {
    expect(parseDayLog(`${DAY_LOG_SEP}a1\n`)).toEqual({ commits: 1, loc: 0 });
  });

  it("Umbenennung mit Klammer im Ordnerteil: {a => b}/c.md zählt nicht, {a => b}/c.ts schon", () => {
    expect(parseDayLog(commit("a1", "7\t0\t{old => new}/c.md"))).toEqual({ commits: 1, loc: 0 });
    expect(parseDayLog(commit("a1", "7\t0\t{old => new}/c.ts"))).toEqual({ commits: 1, loc: 7 });
    expect(parseDayLog(commit("a1", "7\t0\tsrc/{a.ts => a.md}"))).toEqual({ commits: 1, loc: 0 });
  });

  it("Umbenennung: der neue Name entscheidet", () => {
    const out = commit("a1", "2\t1\tsrc/{old.md => new.ts}", "9\t9\tnotes.ts => notes.md");
    expect(parseDayLog(out)).toEqual({ commits: 1, loc: 1 });
  });
});

describe("countsAsCode", () => {
  it("Endung und Dateiname, Groß-/Kleinschreibung der Endung egal", () => {
    expect(countsAsCode("a/b.ts")).toBe(true);
    expect(countsAsCode("a/b.md")).toBe(false);
    expect(countsAsCode("a/B.MD")).toBe(false);
    expect(countsAsCode("a.txt")).toBe(false);
    expect(countsAsCode("a/package-lock.json")).toBe(false);
    expect(countsAsCode("package.json")).toBe(true);
    expect(countsAsCode("notes.md.ts")).toBe(true);
  });
});

describe("startOfLocalDay", () => {
  it("lokale Mitternacht des übergebenen Zeitpunkts", () => {
    const s = startOfLocalDay(new Date(2026, 9, 6, 15, 20, 30));
    expect([s.getFullYear(), s.getMonth(), s.getDate(), s.getHours(), s.getMinutes(), s.getSeconds(), s.getMilliseconds()]).toEqual([2026, 9, 6, 0, 0, 0, 0]);
    const knapp = startOfLocalDay(new Date(2026, 9, 6, 0, 0, 0, 0));
    expect(knapp.getDate()).toBe(6);
    expect(startOfLocalDay(new Date(2026, 9, 5, 23, 59, 59, 999)).getDate()).toBe(5);
  });
});

describe("formatCount", () => {
  it("unter 1000 ganz, ab 1000 mit einer Nachkommastelle und Komma", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1,0k");
    expect(formatCount(1234)).toBe("1,2k");
    expect(formatCount(12345)).toBe("12,3k");
  });
  it("negativ mit Minus", () => {
    expect(formatCount(-5)).toBe("-5");
    expect(formatCount(-1234)).toBe("-1,2k");
    expect(formatCount(-999)).toBe("-999");
  });
});

describe("dayTotals und topRepos", () => {
  const repos = [
    { name: "a", loc: 100, commits: 2 }, { name: "b", loc: -40, commits: 1 }, { name: "c", loc: 0, commits: 0 },
    { name: "d", loc: 300, commits: 7 }, { name: "e", loc: 20, commits: 1 }, { name: "f", loc: 60, commits: 3 }, { name: "g", loc: 10, commits: 4 },
  ];
  it("Summen über alle Repos", () => {
    expect(dayTotals(repos)).toEqual({ loc: 450, commits: 18, repos });
    expect(dayTotals([])).toEqual({ loc: 0, commits: 0, repos: [] });
  });
  it("höchstens fünf, absteigend, Repos ohne Commits fehlen, Gleichstand nach Name", () => {
    expect(topRepos(repos, "loc")).toEqual(["d: 300", "a: 100", "f: 60", "e: 20", "g: 10"]);
    expect(topRepos(repos, "commits")).toEqual(["d: 7", "g: 4", "f: 3", "a: 2", "b: 1"]);
    expect(topRepos([{ name: "z", loc: 1, commits: 1 }, { name: "y", loc: 1, commits: 1 }], "loc")).toEqual(["y: 1", "z: 1"]);
    expect(topRepos([{ name: "z", loc: 0, commits: 0 }], "loc")).toEqual([]);
  });
});

describe("groupByCommonDir", () => {
  const r = (name: string, commonDir: string, isMain: boolean) => ({ name, dir: `/p/${name}`, commonDir, isMain });
  it("Hauptrepo plus Worktree zählt einmal, unter dem Namen des Hauptrepos (auch wenn der Worktree zuerst kommt)", () => {
    expect(groupByCommonDir([r("app-etappe1", "/p/app/.git", false), r("app", "/p/app/.git", true)])).toEqual([{ name: "app", dir: "/p/app" }]);
    expect(groupByCommonDir([r("app", "/p/app/.git", true), r("app-etappe1", "/p/app/.git", false)])).toEqual([{ name: "app", dir: "/p/app" }]);
  });
  it("Hauptrepo fehlt unter projectsRoot: der erste Name der Gruppe", () => {
    expect(groupByCommonDir([r("w-b", "/x/.git", false), r("w-a", "/x/.git", false)])).toEqual([{ name: "w-b", dir: "/p/w-b" }]);
  });
  it("verschiedene Repos bleiben getrennt, Reihenfolge nach erstem Auftreten", () => {
    expect(groupByCommonDir([r("b", "/p/b/.git", true), r("a", "/p/a/.git", true), r("b-wt", "/p/b/.git", false)]).map((x) => x.name)).toEqual(["b", "a"]);
    expect(groupByCommonDir([])).toEqual([]);
  });
});
