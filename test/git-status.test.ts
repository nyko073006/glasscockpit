import { describe, expect, it } from "vitest";
import { countRepos, parseGitStatus, repoNeedsAttention } from "../src/core/git-status";

const head = (ab: string | null, upstream = true) =>
  ["# branch.oid abc123", "# branch.head main", ...(upstream ? ["# branch.upstream origin/main"] : []), ...(ab !== null ? [`# branch.ab ${ab}`] : [])].join("\n") + "\n";

describe("parseGitStatus", () => {
  it("sauber, gleichauf", () => {
    expect(parseGitStatus(head("+0 -0"))).toEqual({ dirty: false, ahead: 0, noUpstream: false });
  });
  it("geändert: Eintrag 1, 2, u oder ?", () => {
    expect(parseGitStatus(head("+0 -0") + "1 .M N... 100644 100644 100644 a b src/x.ts\n").dirty).toBe(true);
    expect(parseGitStatus(head("+0 -0") + "2 R. N... 100644 100644 100644 a b R100 neu\talt\n").dirty).toBe(true);
    expect(parseGitStatus(head("+0 -0") + "u UU N... 1 2 3 4 a b c f\n").dirty).toBe(true);
    expect(parseGitStatus(head("+0 -0") + "? neu.txt\n").dirty).toBe(true);
  });
  it("ignorierte Dateien (!) machen nicht dreckig", () => {
    expect(parseGitStatus(head("+0 -0") + "! build/\n").dirty).toBe(false);
  });
  it("ahead aus branch.ab, behind zählt nicht", () => {
    expect(parseGitStatus(head("+3 -0")).ahead).toBe(3);
    expect(parseGitStatus(head("+0 -4")).ahead).toBe(0);
    expect(parseGitStatus(head("+12 -7")).ahead).toBe(12);
  });
  it("kein Upstream: keine branch.ab-Zeile, noUpstream, ahead 0", () => {
    expect(parseGitStatus(head(null, false))).toEqual({ dirty: false, ahead: 0, noUpstream: true });
  });
  it("kein Upstream und geändert", () => {
    expect(parseGitStatus(head(null, false) + "? x\n")).toEqual({ dirty: true, ahead: 0, noUpstream: true });
  });
  it("detached HEAD: kein Upstream", () => {
    expect(parseGitStatus("# branch.oid abc\n# branch.head (detached)\n").noUpstream).toBe(true);
  });
  it("CRLF und leere Eingabe", () => {
    expect(parseGitStatus(head("+2 -0").replace(/\n/g, "\r\n") + "? x\r\n")).toEqual({ dirty: true, ahead: 2, noUpstream: false });
    expect(parseGitStatus("")).toEqual({ dirty: false, ahead: 0, noUpstream: true });
  });
  it("Pfad mit Leerzeichen am Zeilenanfang einer #-Zeile stört nicht", () => {
    expect(parseGitStatus(head("+0 -0") + "? # komisch.txt\n").dirty).toBe(true);
  });
});

describe("repoNeedsAttention und countRepos", () => {
  it("dirty oder ahead > 0", () => {
    expect(repoNeedsAttention({ dirty: false, ahead: 0, noUpstream: false })).toBe(false);
    expect(repoNeedsAttention({ dirty: true, ahead: 0, noUpstream: false })).toBe(true);
    expect(repoNeedsAttention({ dirty: false, ahead: 1, noUpstream: false })).toBe(true);
    expect(repoNeedsAttention({ dirty: false, ahead: 0, noUpstream: true })).toBe(false);
  });
  it("zählt Repos, Aufmerksamkeit und unbekannte (null = Fehler)", () => {
    const ok = { dirty: false, ahead: 0, noUpstream: false };
    expect(countRepos([ok, { ...ok, dirty: true }, { ...ok, ahead: 2 }, null, ok])).toEqual({ total: 5, attention: 2, unknown: 1 });
    expect(countRepos([])).toEqual({ total: 0, attention: 0, unknown: 0 });
  });
});
