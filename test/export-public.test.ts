import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportPublic, HOOK_INHALT, HOOK_MARKE, HOOK_ZEILE } from "../scripts/lib/export-public";
import { ROOT } from "./helpers/files";

const aufraeumen: string[] = [];
const VORHER_ENV = process.env.COCKPIT_PUBLIC_DENYLIST;

function tmp(praefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `glasscockpit-${praefix}-`));
  aufraeumen.push(dir);
  return dir;
}
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
function schreibe(wurzel: string, datei: string, inhalt: string) {
  mkdirSync(dirname(join(wurzel, datei)), { recursive: true });
  writeFileSync(join(wurzel, datei), inhalt);
}
function neuesRepo(name: string): string {
  const dir = tmp(name);
  git(dir, "init", "-q");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "123+tester@users.noreply.github.com");
  return dir;
}

/** Quell-Repo mit Dateien, die nicht in den Export gehören, teils mit force-add getrackt. */
function quelle(): string {
  const dir = neuesRepo("quelle");
  schreibe(dir, "README.md", "# Test");
  schreibe(dir, "src/a.ts", "export const a = 1;\n");
  schreibe(dir, "handoffs/HANDOFF-1.md", "privat");
  schreibe(dir, "CLAUDE.local.md", "privat");
  schreibe(dir, "secret/x.md", "intern");
  schreibe(dir, "notiz.tmp", "intern");
  schreibe(dir, "docs/entwurf-intern.md", "intern");
  schreibe(dir, ".publicignore", "# Kommentar\n\nsecret/\nnotiz.tmp\ndocs/*-intern.md\n");
  // Wächter samt Kern wandert mit, wie im echten Repo
  cpSync(join(ROOT, "scripts", "check-public.mjs"), join(dir, "scripts", "check-public.mjs"), { recursive: true });
  mkdirSync(join(dir, "src", "core"), { recursive: true });
  cpSync(join(ROOT, "src", "core", "public-check.ts"), join(dir, "src", "core", "public-check.ts"));
  git(dir, "add", "-f", "-A");
  git(dir, "commit", "-q", "-m", "Basis");
  schreibe(dir, "deploy.local.json", '{"target":"/privat"}'); // ungetrackt
  return dir;
}

beforeEach(() => {
  const liste = join(tmp("liste"), "denylist.txt");
  writeFileSync(liste, "GEHEIMBEGRIFF\n");
  process.env.COCKPIT_PUBLIC_DENYLIST = liste;
});
afterEach(() => {
  if (VORHER_ENV === undefined) delete process.env.COCKPIT_PUBLIC_DENYLIST;
  else process.env.COCKPIT_PUBLIC_DENYLIST = VORHER_ENV;
  for (const d of aufraeumen.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("Abend 25 (4): Export ins öffentliche Repo", () => {
  it("handoffs/ und CLAUDE.local.md fehlen im Ziel, auch wenn sie im Quell-Repo getrackt sind", () => {
    const q = quelle();
    expect(git(q, "ls-files")).toContain("handoffs/HANDOFF-1.md");
    expect(git(q, "ls-files")).toContain("CLAUDE.local.md");
    const z = neuesRepo("ziel");
    exportPublic({ root: q, target: z });
    expect(existsSync(join(z, "handoffs"))).toBe(false);
    expect(existsSync(join(z, "CLAUDE.local.md"))).toBe(false);
    expect(git(z, "ls-files")).not.toMatch(/handoffs|CLAUDE\.local/);
  });

  it(".publicignore: Datei, Ordner und Muster fehlen, der Rest ist da und byte-gleich", () => {
    const q = quelle();
    const z = neuesRepo("ziel");
    exportPublic({ root: q, target: z });
    for (const weg of ["secret/x.md", "notiz.tmp", "docs/entwurf-intern.md", ".publicignore"]) {
      expect(existsSync(join(z, weg)), weg).toBe(false);
    }
    expect(readFileSync(join(z, "src/a.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(existsSync(join(z, "README.md"))).toBe(true);
    expect(existsSync(join(z, "scripts/check-public.mjs"))).toBe(true);
  });

  it("nur getrackte Dateien: ungetrackte wie deploy.local.json bleiben draußen", () => {
    const q = quelle();
    const z = neuesRepo("ziel");
    exportPublic({ root: q, target: z });
    expect(existsSync(join(q, "deploy.local.json"))).toBe(true);
    expect(existsSync(join(z, "deploy.local.json"))).toBe(false);
  });

  it("legt den Erst-Commit mit der Nachricht an, Autor ist die lokale user.email", () => {
    const q = quelle();
    const z = neuesRepo("ziel");
    const r = exportPublic({ root: q, target: z, message: "Erst-Export\n\nClaude-Session: x" });
    expect(r.committed).toBe(true);
    expect(git(z, "rev-list", "--count", "HEAD")).toBe("1");
    expect(git(z, "log", "-1", "--format=%ae")).toBe("123+tester@users.noreply.github.com");
    expect(git(z, "log", "-1", "--format=%B")).toContain("Claude-Session: x");
  });

  it("check:public läuft im Ziel: ein Sperrbegriff bricht ab, ohne Commit", () => {
    const q = quelle();
    schreibe(q, "src/b.ts", "// enthält GEHEIMBEGRIFF\n");
    git(q, "add", "src/b.ts");
    const z = neuesRepo("ziel");
    expect(() => exportPublic({ root: q, target: z })).toThrow("check:public");
    expect(() => git(z, "rev-parse", "--verify", "-q", "HEAD")).toThrow();
  });

  it("ein Sperrbegriff in einer ausgeschlossenen Datei stört den Export nicht", () => {
    const q = quelle();
    schreibe(q, "handoffs/HANDOFF-1.md", "GEHEIMBEGRIFF");
    git(q, "add", "-f", "handoffs/HANDOFF-1.md");
    const z = neuesRepo("ziel");
    expect(exportPublic({ root: q, target: z }).committed).toBe(true);
  });

  it("zweiter Export: gelöschte Quelldatei verschwindet, ohne Änderung kein neuer Commit", () => {
    const q = quelle();
    const z = neuesRepo("ziel");
    exportPublic({ root: q, target: z });
    expect(exportPublic({ root: q, target: z }).committed).toBe(false);
    expect(git(z, "rev-list", "--count", "HEAD")).toBe("1");
    git(q, "rm", "-q", "src/a.ts");
    const r = exportPublic({ root: q, target: z });
    expect(r.committed).toBe(true);
    expect(existsSync(join(z, "src/a.ts"))).toBe(false);
    expect(existsSync(join(z, "src"))).toBe(true); // check-public.mjs liegt noch dort
  });

  it("ein Ziel ohne git-Repo wird abgelehnt, ohne etwas zu schreiben", () => {
    const q = quelle();
    const z = tmp("ziel-ohne-git");
    expect(() => exportPublic({ root: q, target: z })).toThrow("git init");
    expect(existsSync(join(z, "README.md"))).toBe(false);
  });

  it("das Ziel darf nicht das Quell-Repo selbst sein", () => {
    const q = quelle();
    expect(() => exportPublic({ root: q, target: q })).toThrow("Quell-Repo");
  });
});

describe("Release-Wächter: Hook-Einrichtung im Export", () => {
  const VORHER = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_NOSYSTEM };
  beforeEach(() => {
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_NOSYSTEM = "1";
  });
  afterEach(() => {
    if (VORHER.g === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = VORHER.g;
    if (VORHER.s === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = VORHER.s;
  });

  it("A1: Export legt den Hook im Ziel an (Marke, Modus 0755), nicht im Quell-Repo, zweiter Export überschreibt ohne Fehler", () => {
    const q = quelle();
    const z = neuesRepo("ziel");
    exportPublic({ root: q, target: z });
    const hook = join(z, ".git/hooks/pre-push");
    expect(existsSync(hook)).toBe(true);
    expect(readFileSync(hook, "utf8")).toBe(HOOK_INHALT);
    expect(HOOK_INHALT).toContain(HOOK_MARKE);
    expect(HOOK_INHALT.startsWith("#!/bin/sh\n")).toBe(true);
    expect(statSync(hook).mode & 0o777).toBe(0o755);
    expect(existsSync(join(q, ".git/hooks/pre-push"))).toBe(false);
    writeFileSync(hook, `#!/bin/sh\n${HOOK_ZEILE}\nexit 0\n`);
    expect(() => exportPublic({ root: q, target: z })).not.toThrow();
    expect(readFileSync(hook, "utf8")).toBe(HOOK_INHALT);
    expect(statSync(hook).mode & 0o777).toBe(0o755);
  });

  /** Entfernt README.md aus dem Quell-Repo (git rm, Commit): „Ziel unverändert“ deckt dann auch das Entfernen alter Dateien ab. */
  function entferneQuelldatei(q: string) {
    git(q, "rm", "-q", "README.md");
    git(q, "commit", "-q", "-m", "README entfernt");
  }

  function stand(z: string) {
    return {
      status: git(z, "status", "--porcelain"),
      dateien: git(z, "ls-files"),
      inhalt: readFileSync(join(z, "src/a.ts"), "utf8"),
      readme: existsSync(join(z, "README.md")),
      commits: git(z, "rev-list", "--count", "HEAD"),
    };
  }

  it("A2: fremder pre-push-Hook bricht den Export ab, Ziel unverändert", () => {
    const q = quelle();
    const z = neuesRepo("ziel");
    exportPublic({ root: q, target: z });
    const hook = join(z, ".git/hooks/pre-push");
    const fremd = "#!/bin/sh\necho fremd\n";
    writeFileSync(hook, fremd);
    const vorher = stand(z);
    schreibe(q, "src/a.ts", "export const a = 2;\n");
    git(q, "add", "src/a.ts");
    entferneQuelldatei(q);
    expect(() => exportPublic({ root: q, target: z })).toThrow(hook);
    expect(readFileSync(hook, "utf8")).toBe(fremd);
    expect(vorher.status).toBe("");
    expect(stand(z)).toEqual(vorher);
    expect(vorher.inhalt).toBe("export const a = 1;\n");
  });

  it("A2: gesetztes core.hooksPath bricht den Export ab, Ziel unverändert", () => {
    const q = quelle();
    const z = neuesRepo("ziel");
    exportPublic({ root: q, target: z });
    const vorher = stand(z);
    git(z, "config", "core.hooksPath", join(tmp("hooks")));
    schreibe(q, "src/a.ts", "export const a = 2;\n");
    git(q, "add", "src/a.ts");
    entferneQuelldatei(q);
    expect(() => exportPublic({ root: q, target: z })).toThrow("core.hooksPath");
    expect(vorher.status).toBe("");
    expect(stand(z)).toEqual(vorher);
    expect(vorher.inhalt).toBe("export const a = 1;\n");
  });

  it("A2: fremder Hook, der die Marke nur irgendwo erwähnt, wird nicht überschrieben", () => {
    for (const fremd of [
      `#!/bin/sh\necho "${HOOK_MARKE}"\n`,
      `#!/bin/sh\n${HOOK_MARKE}-alt\nexit 0\n`,
      `#!/bin/sh\necho fremd\n${HOOK_ZEILE}\n`,
    ]) {
      const q = quelle();
      const z = neuesRepo("ziel");
      exportPublic({ root: q, target: z });
      const hook = join(z, ".git/hooks/pre-push");
      writeFileSync(hook, fremd);
      schreibe(q, "src/a.ts", "export const a = 2;\n");
      git(q, "add", "src/a.ts");
      expect(() => exportPublic({ root: q, target: z }), fremd).toThrow(hook);
      expect(readFileSync(hook, "utf8")).toBe(fremd);
      expect(readFileSync(join(z, "src/a.ts"), "utf8")).toBe("export const a = 1;\n");
    }
  });

  it("A2: Hook-Pfad als hängender Symlink bricht ab, Symlink-Ziel wird nicht angelegt", () => {
    const q = quelle();
    const z = neuesRepo("ziel");
    const ziel = join(tmp("symziel"), "angelegt");
    mkdirSync(join(z, ".git/hooks"), { recursive: true });
    const hook = join(z, ".git/hooks/pre-push");
    symlinkSync(ziel, hook);
    expect(() => exportPublic({ root: q, target: z })).toThrow("Symlink");
    expect(existsSync(ziel)).toBe(false);
    expect(lstatSync(hook).isSymbolicLink()).toBe(true);
    expect(existsSync(join(z, "README.md"))).toBe(false);
  });

  it("A2: core.hooksPath in der globalen Konfiguration bricht den Export ab", () => {
    const q = quelle();
    const z = neuesRepo("ziel");
    const global = join(tmp("global"), "gitconfig");
    writeFileSync(global, `[core]\n\thooksPath = ${tmp("globalhooks")}\n`);
    process.env.GIT_CONFIG_GLOBAL = global;
    expect(() => exportPublic({ root: q, target: z })).toThrow("core.hooksPath");
    expect(existsSync(join(z, "README.md"))).toBe(false);
  });
});
