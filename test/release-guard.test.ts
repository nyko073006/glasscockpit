import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, closeSync, copyFileSync, openSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  entscheide,
  githubRepo,
  parsePrePush,
  parseReleases,
  pruefePush,
  relevanteZeilen,
  remoteUrl,
  RELEASE_JQ,
  type Release,
} from "../scripts/lib/release-guard";
import { HOOK_INHALT } from "../scripts/lib/export-public";
import { ROOT } from "./helpers/files";

const NULL = "0".repeat(40);
const SHA = "a".repeat(40);
const zeile = (ref: string, sha = SHA) => `refs/heads/x ${sha} ${ref} ${NULL}`;

describe("githubRepo", () => {
  it.each([
    ["https://github.com/o/r.git", "o/r"],
    ["https://github.com/o/r", "o/r"],
    ["https://github.com/o/r/", "o/r"],
    ["https://github.com/o/r.git/", "o/r"],
    ["git@github.com:o/r.git", "o/r"],
    ["git@github.com:o/r", "o/r"],
    ["ssh://git@github.com/o/r.git", "o/r"],
    ["ssh://git@github.com/o/r", "o/r"],
  ])("%s -> %s", (url, soll) => {
    expect(githubRepo(url)).toBe(soll);
  });
  it("Fremdhost und Unsinn -> null", () => {
    expect(githubRepo("https://gitlab.com/o/r.git")).toBeNull();
    expect(githubRepo("git@evil.com:o/r.git")).toBeNull();
    expect(githubRepo("/tmp/bare.git")).toBeNull();
    expect(githubRepo("https://github.com/o")).toBeNull();
  });
});

describe("remoteUrl", () => {
  const config = (tab: Record<string, string>) => (k: string) => tab[k] ?? null;
  it("pushurl geht vor url", () => {
    expect(remoteUrl("origin", config({ "remote.origin.pushurl": "P", "remote.origin.url": "U" }))).toBe("P");
  });
  it("sonst url", () => {
    expect(remoteUrl("origin", config({ "remote.origin.url": "U" }))).toBe("U");
  });
  it("Push direkt an URL -> Argument 1 selbst", () => {
    expect(remoteUrl("https://github.com/o/r.git", config({}))).toBe("https://github.com/o/r.git");
  });
});

describe("parsePrePush und relevanteZeilen", () => {
  it("leeres stdin -> keine Zeilen", () => {
    expect(parsePrePush("")).toEqual([]);
    expect(parsePrePush("\n\n")).toEqual([]);
  });
  it("parst Felder", () => {
    expect(parsePrePush(zeile("refs/heads/main"))).toEqual([
      { localRef: "refs/heads/x", localSha: SHA, remoteRef: "refs/heads/main", remoteSha: NULL },
    ]);
  });
  it("Löschzeile (local sha nur Nullen) ist nicht relevant", () => {
    expect(relevanteZeilen(parsePrePush(zeile("refs/heads/main", NULL)))).toEqual([]);
  });
  it("nur refs/heads/main ist relevant, mehrere Zeilen", () => {
    const z = parsePrePush([zeile("refs/heads/dev"), zeile("refs/heads/main"), zeile("refs/tags/1")].join("\n") + "\n");
    expect(z).toHaveLength(3);
    const r = relevanteZeilen(z);
    expect(r).toHaveLength(1);
    expect(r[0].remoteRef).toBe("refs/heads/main");
  });
});

describe("parseReleases", () => {
  it("liest eine JSON-Zeile je Release", () => {
    const text =
      '{"assets":["main.js"],"isDraft":false,"tagName":"0.4.0"}\n\n{"assets":[],"isDraft":true,"tagName":"0.5.0"}\n';
    expect(parseReleases(text)).toEqual([
      { assets: ["main.js"], isDraft: false, tagName: "0.4.0" },
      { assets: [], isDraft: true, tagName: "0.5.0" },
    ]);
  });
  it("leere Ausgabe -> keine Releases", () => {
    expect(parseReleases("")).toEqual([]);
  });
  it("Zeile ohne JSON wirft", () => {
    expect(() => parseReleases("kein json\n")).toThrow();
  });
  it("JSON ohne die Felder wirft", () => {
    expect(() => parseReleases('{"tagName":"1"}\n')).toThrow();
  });
});

describe("entscheide", () => {
  const alle = ["main.js", "manifest.json", "styles.css"];
  const rel = (tagName: string, isDraft: boolean, assets = alle): Release => ({ tagName, isDraft, assets });
  it("veröffentlicht mit Dateien -> 0, Release vorhanden", () => {
    const u = entscheide("9.9.9", [rel("9.9.9", false)]);
    expect(u.exitCode).toBe(0);
    expect(u.meldungen.join("\n")).toContain("Release 9.9.9 vorhanden");
  });
  it("nur Entwurf mit Dateien -> 0 mit Hinweis", () => {
    const u = entscheide("9.9.9", [rel("9.9.9", true)]);
    expect(u.exitCode).toBe(0);
    const t = u.meldungen.join("\n");
    expect(t).toContain("Release 9.9.9 ist ein Entwurf");
    expect(t).toContain("gh release edit 9.9.9 --draft=false --latest");
  });
  it("Entwurf und veröffentlicht gleichzeitig -> veröffentlicht", () => {
    const u = entscheide("9.9.9", [rel("9.9.9", true), rel("9.9.9", false)]);
    expect(u.exitCode).toBe(0);
    expect(u.meldungen.join("\n")).toContain("Release 9.9.9 vorhanden");
    expect(u.meldungen.join("\n")).not.toContain("Entwurf");
  });
  it("veröffentlicht, aber Datei fehlt -> 1, nennt Datei", () => {
    const u = entscheide("9.9.9", [rel("9.9.9", false, ["main.js", "manifest.json"])]);
    expect(u.exitCode).toBe(1);
    expect(u.meldungen.join("\n")).toContain("styles.css");
    expect(u.meldungen.join("\n")).not.toContain("main.js");
  });
  it("Entwurf ohne Dateien -> 1", () => {
    expect(entscheide("9.9.9", [rel("9.9.9", true, [])]).exitCode).toBe(1);
  });
  it("v9.9.9 zählt nicht für 9.9.9", () => {
    const u = entscheide("9.9.9", [rel("v9.9.9", false)]);
    expect(u.exitCode).toBe(1);
  });
  it("kein Release -> 1 mit Version, neuestem Release, Weg und Notausgang", () => {
    const u = entscheide("9.9.9", [rel("0.9.0", false), rel("0.10.0", false), rel("0.11.0", true), rel("nightly", false)]);
    expect(u.exitCode).toBe(1);
    const t = u.meldungen.join("\n");
    expect(t).toContain("9.9.9");
    expect(t).toContain("0.10.0");
    expect(t).not.toContain("0.11.0");
    expect(t).toContain("Release-Entwurf");
    expect(t).toContain("git push --no-verify");
  });
  it("veröffentlicht unvollständig, Entwurf vollständig -> 1 (nur das veröffentlichte zählt)", () => {
    const u = entscheide("9.9.9", [rel("9.9.9", false, ["main.js"]), rel("9.9.9", true)]);
    expect(u.exitCode).toBe(1);
    expect(u.meldungen.join("\n")).toContain("styles.css");
    const u2 = entscheide("9.9.9", [rel("9.9.9", true), rel("9.9.9", false, ["main.js"])]);
    expect(u2.exitCode).toBe(1);
  });
  it("neuestes veröffentlichtes Release vergleicht auch die Patch-Stelle", () => {
    for (const liste of [
      [rel("0.4.0", false), rel("0.4.1", false)],
      [rel("0.4.1", false), rel("0.4.0", false)],
      [rel("0.4.9", false), rel("0.4.10", false)],
    ]) {
      const t = entscheide("9.9.9", liste).meldungen.join("\n");
      const soll = liste.some((r) => r.tagName === "0.4.10") ? "0.4.10" : "0.4.1";
      expect(t).toContain(`Neuestes veröffentlichtes Release: ${soll}.`);
    }
  });
  it("kein Release und keine Vorgänger -> neuestes „keins“", () => {
    const u = entscheide("1.0.0", []);
    expect(u.exitCode).toBe(1);
    expect(u.meldungen.join("\n")).toContain("keins");
  });
});

describe("RELEASE_JQ", () => {
  it("zählt nur Assets mit Status uploaded", () => {
    expect(RELEASE_JQ).toContain('[.assets[] | select(.state == "uploaded") | .name]');
  });
});

describe("pruefePush mit Stubs", () => {
  const alle = ["main.js", "manifest.json", "styles.css"];
  const releasesText = (tag: string, assets = alle, draft = false) =>
    JSON.stringify({ assets, isDraft: draft, tagName: tag }) + "\n";
  function lauf(opts: { stdin: string; arg1?: string; version?: string; releases?: string | Error; manifest?: string | Error }) {
    const aufrufe = { releases: [] as string[], manifest: [] as string[] };
    const urteil = pruefePush({
      stdin: opts.stdin,
      arg1: opts.arg1 ?? "origin",
      liesConfig: (k) => (k === "remote.origin.url" ? "https://github.com/o/r.git" : null),
      manifestAn: (sha) => {
        aufrufe.manifest.push(sha);
        if (opts.manifest instanceof Error) throw opts.manifest;
        return opts.manifest ?? JSON.stringify({ version: opts.version ?? "9.9.9" });
      },
      releases: (repo) => {
        aufrufe.releases.push(repo);
        if (opts.releases instanceof Error) throw opts.releases;
        return opts.releases ?? "";
      },
    });
    return { urteil, aufrufe };
  }
  it("keine relevante Zeile: 0, still, kein Aufruf", () => {
    const { urteil, aufrufe } = lauf({ stdin: zeile("refs/heads/dev") });
    expect(urteil).toEqual({ exitCode: 0, meldungen: [] });
    expect(aufrufe.releases).toEqual([]);
    expect(aufrufe.manifest).toEqual([]);
  });
  it("leeres stdin: 0", () => {
    expect(lauf({ stdin: "" }).urteil).toEqual({ exitCode: 0, meldungen: [] });
  });
  it("Release vorhanden: 0, fragt owner/repo ab", () => {
    const { urteil, aufrufe } = lauf({ stdin: zeile("refs/heads/main"), releases: releasesText("9.9.9") });
    expect(urteil.exitCode).toBe(0);
    expect(aufrufe.releases).toEqual(["o/r"]);
    expect(aufrufe.manifest).toEqual([SHA]);
  });
  it("kein Release: 1", () => {
    expect(lauf({ stdin: zeile("refs/heads/main"), releases: "" }).urteil.exitCode).toBe(1);
  });
  it("mehrere relevante Zeilen: Releases höchstens einmal abgefragt, sperrt sobald eine sperrt", () => {
    const sha2 = "b".repeat(40);
    const aufrufe: string[] = [];
    const urteil = pruefePush({
      stdin: [zeile("refs/heads/main", SHA), zeile("refs/heads/main", sha2)].join("\n"),
      arg1: "origin",
      liesConfig: () => "https://github.com/o/r.git",
      manifestAn: (sha) => JSON.stringify({ version: sha === SHA ? "1.0.0" : "2.0.0" }),
      releases: (repo) => {
        aufrufe.push(repo);
        return releasesText("1.0.0");
      },
    });
    expect(urteil.exitCode).toBe(1);
    expect(aufrufe).toHaveLength(1);
  });
  it("mehrere relevante Zeilen: sperrende Version zuerst bleibt gesperrt", () => {
    const sha2 = "b".repeat(40);
    const urteil = pruefePush({
      stdin: [zeile("refs/heads/main", SHA), zeile("refs/heads/main", sha2)].join("\n"),
      arg1: "origin",
      liesConfig: () => "https://github.com/o/r.git",
      manifestAn: (sha) => JSON.stringify({ version: sha === SHA ? "2.0.0" : "1.0.0" }),
      releases: () => releasesText("1.0.0"),
    });
    expect(urteil.exitCode).toBe(1);
  });
  it.each([
    ["Manifest wirft", { manifest: new Error("kaputt") }],
    ["Manifest ohne JSON", { manifest: "kein json" }],
    ["version fehlt", { manifest: "{}" }],
    ["version leer", { manifest: '{"version":""}' }],
    ["version keine Zeichenkette", { manifest: '{"version":1}' }],
    ["gh scheitert", { releases: new Error("gh exit 1") }],
    ["gh liefert Nicht-JSON", { releases: "oops\n" }],
  ])("sperrt: %s", (_n, extra) => {
    const { urteil } = lauf({ stdin: zeile("refs/heads/main"), releases: releasesText("9.9.9"), ...extra });
    expect(urteil.exitCode).toBe(1);
    expect(urteil.meldungen.length).toBeGreaterThan(0);
  });
  it("Fremdhost sperrt ohne gh-Aufruf", () => {
    const aufrufe: string[] = [];
    const urteil = pruefePush({
      stdin: zeile("refs/heads/main"),
      arg1: "origin",
      liesConfig: () => "https://gitlab.com/o/r.git",
      manifestAn: () => '{"version":"1.0.0"}',
      releases: (r) => {
        aufrufe.push(r);
        return "";
      },
    });
    expect(urteil.exitCode).toBe(1);
    expect(aufrufe).toEqual([]);
  });
});

describe.skipIf(process.platform === "win32")("Prozesstest: echter git push mit Hook", () => {
  const aufraeumen: string[] = [];
  afterAll(() => {
    for (const d of aufraeumen) rmSync(d, { recursive: true, force: true });
  });

  const HOOK = HOOK_INHALT;
  const ALLE = ["main.js", "manifest.json", "styles.css"];
  const rel = (tag: string, isDraft: boolean, assets = ALLE) => JSON.stringify({ assets, isDraft, tagName: tag }) + "\n";

  function umgebung(bin: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      PATH: `${bin}:${process.env.PATH}`,
      ...extra,
    };
  }

  function aufbau() {
    const dir = mkdtempSync(join(tmpdir(), "glasscockpit-guard-"));
    aufraeumen.push(dir);
    const repo = join(dir, "repo");
    const bare = join(dir, "bare.git");
    const bin = join(dir, "bin");
    const log = join(dir, "gh.log");
    mkdirSync(repo);
    mkdirSync(bin);
    const env = umgebung(bin, { GH_STUB_LOG: log });
    const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env, encoding: "utf8" }).trim();
    git(dir, "init", "-q", "--bare", bare);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "user.email", "123+tester@users.noreply.github.com");
    writeFileSync(join(repo, "manifest.json"), JSON.stringify({ version: "9.9.9" }));
    git(repo, "add", "manifest.json");
    git(repo, "commit", "-q", "-m", "x");
    git(repo, "remote", "add", "origin", "https://github.com/o/r.git");
    git(repo, "config", `url.${bare}.insteadOf`, "https://github.com/o/r.git");
    mkdirSync(join(repo, "scripts/lib"), { recursive: true });
    copyFileSync(join(ROOT, "scripts/release-guard.mjs"), join(repo, "scripts/release-guard.mjs"));
    copyFileSync(join(ROOT, "scripts/lib/release-guard.ts"), join(repo, "scripts/lib/release-guard.ts"));
    writeFileSync(join(repo, ".git/hooks/pre-push"), HOOK);
    chmodSync(join(repo, ".git/hooks/pre-push"), 0o755);
    writeFileSync(
      join(bin, "gh"),
      '#!/bin/sh\necho "$@" >> "$GH_STUB_LOG"\nif [ -n "$GH_STUB_ERR" ]; then printf "%s\\n" "$GH_STUB_ERR" >&2; fi\nif [ -n "$GH_STUB_EXIT" ]; then exit "$GH_STUB_EXIT"; fi\nprintf %s "$GH_STUB_OUT"\n',
    );
    chmodSync(join(bin, "gh"), 0o755);
    const push = (refspec: string, extra: Record<string, string>) => {
      const r = spawnSync("git", ["push", "origin", refspec], {
        cwd: repo,
        env: { ...env, ...extra },
        encoding: "utf8",
      });
      return { code: r.status, stderr: r.stderr };
    };
    const bareHat = (ref: string) => {
      try {
        execFileSync("git", ["--git-dir", bare, "rev-parse", "--verify", "-q", ref], { env, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    };
    const ghLog = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
    return { push, bareHat, ghLog };
  }

  it("kein Release -> abgelehnt, Bare unverändert", () => {
    const t = aufbau();
    const r = t.push("main", { GH_STUB_OUT: rel("0.4.0", false) });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("release-guard: ");
    expect(t.bareHat("refs/heads/main")).toBe(false);
    expect(t.ghLog()).toContain("repos/o/r/releases");
  });
  it("veröffentlicht mit Dateien -> durch", () => {
    const t = aufbau();
    const r = t.push("main", { GH_STUB_OUT: rel("9.9.9", false) });
    expect(r.code).toBe(0);
    expect(t.bareHat("refs/heads/main")).toBe(true);
    expect(t.ghLog()).toContain("repos/o/r/releases");
  });
  it("nur Entwurf mit Dateien -> durch, Hinweis auf stderr", () => {
    const t = aufbau();
    const r = t.push("main", { GH_STUB_OUT: rel("9.9.9", true) });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("Release 9.9.9 ist ein Entwurf");
    expect(t.bareHat("refs/heads/main")).toBe(true);
  });
  it("veröffentlicht ohne styles.css -> abgelehnt", () => {
    const t = aufbau();
    const r = t.push("main", { GH_STUB_OUT: rel("9.9.9", false, ["main.js", "manifest.json"]) });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("styles.css");
    expect(t.bareHat("refs/heads/main")).toBe(false);
  });
  it("gh Exit 1 -> abgelehnt", () => {
    const t = aufbau();
    const r = t.push("main", { GH_STUB_EXIT: "1" });
    expect(r.code).not.toBe(0);
    expect(t.bareHat("refs/heads/main")).toBe(false);
  });
  it("mehrzeiliger Fehlertext: jede Zeile trägt das Präfix", () => {
    const t = aufbau();
    const r = t.push("main", { GH_STUB_EXIT: "1", GH_STUB_ERR: "gh-zeile-eins\ngh-zeile-zwei" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("gh-zeile-zwei");
    const zeilen = r.stderr.split("\n").filter((z) => z.startsWith("release-guard: ") || z.includes("gh-zeile"));
    expect(zeilen.length).toBeGreaterThan(2);
    for (const z of zeilen) expect(z.startsWith("release-guard: ")).toBe(true);
  });
  it("Push eines anderen Branches -> durch ohne gh-Aufruf", () => {
    const t = aufbau();
    const r = t.push("main:refs/heads/dev", { GH_STUB_EXIT: "1" });
    expect(r.code).toBe(0);
    expect(t.bareHat("refs/heads/dev")).toBe(true);
    expect(t.ghLog()).toBe("");
  });
});

describe.skipIf(process.platform === "win32")("Stdin-Lesefehler sperrt", () => {
  it("stdin ist ein Ordner (EISDIR) -> Exit 1 mit Grund, kein Durchlass", () => {
    const fd = openSync(tmpdir(), "r");
    try {
      const r = spawnSync("node", [join(ROOT, "scripts/release-guard.mjs"), "origin"], {
        cwd: ROOT,
        stdio: [fd, "pipe", "pipe"],
        encoding: "utf8",
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("release-guard: ");
      expect(r.stderr).toContain("git push --no-verify");
    } finally {
      closeSync(fd);
    }
  });
});
