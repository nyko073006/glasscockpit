import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDayLog, startOfLocalDay } from "../src/core/day-stats";
import { parseGitStatus } from "../src/core/git-status";
import { groupByCommonDir } from "../src/core/day-stats";
import { listGitRepos, runGitDayLog, runGitIdentity, runGitStatus } from "../src/host/repo-status";

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "cockpit-repos-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "pipe" });
const env = process.env as Record<string, string>;

describe("listGitRepos", () => {
  it("nur direkte Unterordner mit .git (Ordner oder Datei), alphabetisch; Dateien, versteckte und Nicht-Repos fallen weg", async () => {
    await mkdir(join(dir, "b-repo", ".git"), { recursive: true });
    await mkdir(join(dir, "a-worktree"));
    await writeFile(join(dir, "a-worktree", ".git"), "gitdir: /irgendwo");
    await mkdir(join(dir, "kein-repo"));
    await mkdir(join(dir, ".versteckt", ".git"), { recursive: true });
    await writeFile(join(dir, "datei.txt"), "x");
    const repos = await listGitRepos(dir);
    expect(repos).toEqual([{ name: "a-worktree", dir: join(dir, "a-worktree") }, { name: "b-repo", dir: join(dir, "b-repo") }]);
  });
  it("Ordner fehlt: leer", async () => {
    expect(await listGitRepos(join(dir, "nix"))).toEqual([]);
  });
});

describe("runGitStatus (echtes git, kein Netz)", () => {
  it("liefert porcelain v2 mit Branch-Kopf; sauber, dann geändert", async () => {
    git(dir, "init", "-q", "-b", "main");
    await writeFile(join(dir, "a.txt"), "1");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "x");
    const sauber = await runGitStatus(dir, env);
    expect(sauber).toMatch(/^# branch\.oid /m);
    expect(parseGitStatus(sauber).dirty).toBe(false);
    await writeFile(join(dir, "a.txt"), "2");
    expect(parseGitStatus(await runGitStatus(dir, env)).dirty).toBe(true);
  });
  it("kein Repo oder Ordner fehlt: lehnt ab (RepoScan macht daraus status null)", async () => {
    await expect(runGitStatus(join(dir, "nix"), env)).rejects.toBeDefined();
    await expect(runGitStatus(dir, env)).rejects.toBeDefined();
  });
  it("Zeitlimit per Option: dasselbe Repo geht ohne Limit durch und scheitert mit 1 ms", async () => {
    git(dir, "init", "-q", "-b", "main");
    await expect(runGitStatus(dir, env)).resolves.toMatch(/branch\.head/);
    await expect(runGitStatus(dir, env, 1)).rejects.toBeDefined();
  });
});

describe("runGitDayLog (echtes git, kein Netz)", () => {
  const commitAt = (when: Date, msg: string) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], {
      cwd: dir, stdio: "pipe", env: { ...env, GIT_AUTHOR_DATE: when.toISOString(), GIT_COMMITTER_DATE: when.toISOString() },
    });
  it("nur Commits ab der Mitternacht, alle lokalen Branches, ohne Merges; Zählung per parseDayLog", async () => {
    const now = new Date();
    const heute = new Date(startOfLocalDay(now).getTime() + 60_000);
    const gestern = new Date(startOfLocalDay(now).getTime() - 60_000);
    git(dir, "init", "-q", "-b", "main");
    await writeFile(join(dir, "alt.ts"), "a\nb\nc\n");
    git(dir, "add", ".");
    commitAt(gestern, "gestern");
    await writeFile(join(dir, "neu.ts"), "1\n2\n");
    await writeFile(join(dir, "README.md"), "x\ny\nz\n");
    git(dir, "add", ".");
    commitAt(heute, "heute main");
    git(dir, "checkout", "-q", "-b", "nebenzweig");
    await writeFile(join(dir, "alt.ts"), "a\n");
    git(dir, "add", ".");
    commitAt(heute, "heute zweig");
    git(dir, "checkout", "-q", "main");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "merge", "-q", "--no-ff", "-m", "merge", "nebenzweig"], { cwd: dir, stdio: "pipe", env: { ...env, GIT_COMMITTER_DATE: heute.toISOString(), GIT_AUTHOR_DATE: heute.toISOString() } });
    const out = await runGitDayLog(dir, startOfLocalDay(now), env);
    // zwei Commits heute (der Merge fehlt, der gestrige auch); +2 (neu.ts, README.md zählt nicht) und -2 (alt.ts von 3 auf 1 Zeile)
    expect(parseDayLog(out, startOfLocalDay(now))).toEqual({ commits: 2, loc: 0 });
  });
  it("Repo-Pfad mit Leerzeichen und Umlaut funktioniert", async () => {
    const d = join(dir, "mit Leer zeichen ü");
    await mkdir(d);
    git(d, "init", "-q", "-b", "main");
    await writeFile(join(d, "a.ts"), "1\n2\n3\n");
    git(d, "add", ".");
    git(d, "commit", "-q", "-m", "x");
    const now = new Date();
    expect(parseDayLog(await runGitDayLog(d, startOfLocalDay(now), env), startOfLocalDay(now))).toEqual({ commits: 1, loc: 3 });
  });
  it("kein Repo: lehnt ab; Zeitlimit per Option", async () => {
    await expect(runGitDayLog(dir, new Date(), env)).rejects.toBeDefined();
    git(dir, "init", "-q", "-b", "main");
    await expect(runGitDayLog(dir, new Date(), env, 1)).rejects.toBeDefined();
  });
});

describe("runGitDayLog zählt nur lokale Arbeit von heute (Abend 31, echtes git)", () => {
  const commitAt = (author: Date, committer: Date, msg: string) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], {
      cwd: dir, stdio: "pipe", env: { ...env, GIT_AUTHOR_DATE: author.toISOString(), GIT_COMMITTER_DATE: committer.toISOString() },
    });
  const count = async () => {
    const since = startOfLocalDay(new Date());
    return parseDayLog(await runGitDayLog(dir, since, env), since);
  };
  const basis = async () => {
    git(dir, "init", "-q", "-b", "main");
    await writeFile(join(dir, "a.ts"), "1\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "basis");
  };

  it("ein Commit nur auf einem Remote-Branch zählt nicht (Squash-Merge mit stehengebliebenem PR-Branch)", async () => {
    await basis();
    git(dir, "checkout", "-q", "-b", "pr");
    await writeFile(join(dir, "b.ts"), "1\n2\n3\n4\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "pr");
    git(dir, "checkout", "-q", "main");
    git(dir, "update-ref", "refs/remotes/origin/pr", "pr");
    git(dir, "branch", "-q", "-D", "pr");
    // Vorbedingung: git log --all sähe beide Commits
    expect(String(git(dir, "log", "--all", "--format=%H")).trim().split("\n")).toHaveLength(2);
    expect(await count()).toEqual({ commits: 1, loc: 1 });
  });

  it("ein Stash zählt nicht", async () => {
    await basis();
    await writeFile(join(dir, "a.ts"), "1\n2\n3\n");
    git(dir, "add", ".");
    git(dir, "stash", "-q");
    expect(String(git(dir, "stash", "list")).trim()).not.toBe("");
    expect(await count()).toEqual({ commits: 1, loc: 1 });
  });

  it("ein heute rebaseter Commit von gestern zählt nicht, der heutige auf main schon", async () => {
    const mitternacht = startOfLocalDay(new Date()).getTime();
    const gestern = new Date(mitternacht - 3_600_000);
    const heute = new Date(mitternacht + 60_000);
    git(dir, "init", "-q", "-b", "main");
    await writeFile(join(dir, "a.ts"), "1\n");
    git(dir, "add", ".");
    commitAt(gestern, gestern, "basis");
    git(dir, "checkout", "-q", "-b", "alt");
    await writeFile(join(dir, "b.ts"), "1\n2\n3\n4\n5\n");
    git(dir, "add", ".");
    commitAt(gestern, gestern, "von gestern");
    git(dir, "checkout", "-q", "main");
    await writeFile(join(dir, "c.ts"), "1\n2\n");
    git(dir, "add", ".");
    commitAt(heute, heute, "von heute");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "rebase", "-q", "main", "alt"], {
      cwd: dir, stdio: "pipe", env: { ...env, GIT_COMMITTER_DATE: heute.toISOString() },
    });
    git(dir, "checkout", "-q", "main");
    // Vorbedingung: der rebasete Commit trägt Autor gestern, Committer heute
    const [at, ct] = String(git(dir, "log", "-1", "--format=%at %ct", "alt")).trim().split(" ").map(Number);
    expect(at * 1000).toBeLessThan(mitternacht);
    expect(ct * 1000).toBeGreaterThanOrEqual(mitternacht);
    expect(await count()).toEqual({ commits: 1, loc: 2 });
  });
});

describe("Worktree zählt mit seinem Hauptrepo einmal (echtes git)", () => {
  it("runGitIdentity: gleiches commonDir, Hauptrepo erkannt; DayScan-Gruppierung lässt eines übrig", async () => {
    const main = join(dir, "haupt");
    const wt = join(dir, "haupt-etappe");
    await mkdir(main);
    git(main, "init", "-q", "-b", "main");
    await writeFile(join(main, "a.ts"), "1\n2\n");
    git(main, "add", ".");
    git(main, "commit", "-q", "-m", "x");
    git(main, "worktree", "add", "-q", "-b", "zweig", wt);
    const a = await runGitIdentity(main, env);
    const b = await runGitIdentity(wt, env);
    expect(b.commonDir).toBe(a.commonDir);
    expect([a.isMain, b.isMain]).toEqual([true, false]);
    // beide sehen dieselben Commits (der Grund für die Gruppierung)
    const since = startOfLocalDay(new Date());
    expect(parseDayLog(await runGitDayLog(wt, since, env), since)).toEqual(parseDayLog(await runGitDayLog(main, since, env), since));
    const repos = (await listGitRepos(dir)).map((r) => ({ ...r, commonDir: "", isMain: false }));
    expect(repos).toHaveLength(2);
    repos[0].commonDir = a.commonDir; repos[0].isMain = repos.find((r) => r.name === "haupt") === repos[0];
    repos[1].commonDir = a.commonDir; repos[1].isMain = repos[1].name === "haupt";
    expect(groupByCommonDir(repos)).toEqual([{ name: "haupt", dir: main }]);
  });
});
