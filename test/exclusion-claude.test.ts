import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planExclusion, type VaultEntry } from "../src/core/exclusion";

// Echt gegen claude (Abend 33): nur mit GLASSCOCKPIT_CLAUDE_PROBE=1, je Fall ein kurzer Haiku-Lauf.
// --setting-sources local: Nutzer-Einstellungen und Hooks bleiben aus. Gegenprobe: Schalter aus liest alles.
// Wächter gegen spätere claude-Versionen (gemessen 13.10.2026, claude 2.1.296): Symlink-Vault, /var statt /private/var und andere Groß-/Kleinschreibung sperren trotzdem.
const PROBE = process.env.GLASSCOCKPIT_CLAUDE_PROBE === "1";
const DIRS = ["Akte [alt] *", "Notizen (alt)", "Plan {a}?", "Wichtig!"];
const marker = (name: string) => `ZEICHEN-${name}-${Math.random().toString(36).slice(2, 10)}`;
const EXTRA = ["Privatordner/notiz.md", "Privatnotiz.md", "Archiv/geheim-1.md"];
const M = { geheim: marker("geheim"), offen: marker("offen"), offen2: marker("offen2"), ...Object.fromEntries([...DIRS, ...EXTRA].map((d, i) => [d, marker(`datei${i}`)])) } as Record<string, string>;
const RAW = ["vertraulich/", ...DIRS.map((d) => `${d}/`)];
const ENTRIES: VaultEntry[] = [
  { path: "Vertraulich", folder: true }, { path: "Vertraulich/geheim.md", folder: false },
  ...DIRS.flatMap((d) => [{ path: d, folder: true }, { path: `${d}/notiz.md`, folder: false }]),
  { path: "offen.md", folder: false },
  { path: "Privatordner", folder: true }, { path: "Privatordner/notiz.md", folder: false }, { path: "Privatnotiz.md", folder: false },
  { path: "Archiv", folder: true }, { path: "Archiv/geheim-1.md", folder: false }, { path: "Archiv/offen-2.md", folder: false },
];

describe.skipIf(!PROBE)("Ausschluss gegen echtes claude", () => {
  let vault = "";
  beforeAll(() => {
    vault = realpathSync(mkdtempSync(join(tmpdir(), "gc-ausschluss-")));
    const put = (rel: string, text: string) => {
      mkdirSync(dirname(join(vault, rel)), { recursive: true });
      writeFileSync(join(vault, rel), `${text}\n`);
    };
    put("Vertraulich/geheim.md", M.geheim);
    for (const d of DIRS) put(`${d}/notiz.md`, M[d]);
    put("offen.md", M.offen);
    for (const f of EXTRA) put(f, M[f]);
    put("Archiv/offen-2.md", M.offen2);
  });
  afterAll(() => rmSync(vault, { recursive: true, force: true }));

  const settings = (enabled: boolean, sandbox: boolean, raw: string[] = RAW, vaultAbs = vault) => planExclusion({ enabled, sandbox, raw, entries: ENTRIES, vaultAbs }).settings;
  function claude(s: Record<string, unknown>, prompt: string, cwd = vault): string {
    const env = { ...process.env };
    delete env.CLAUDE_CODE_SSE_PORT;
    delete env.ENABLE_IDE_INTEGRATION;
    const args = ["-p", "--model", "haiku", "--setting-sources", "local", "--max-turns", "4", "--dangerously-skip-permissions", "--settings", JSON.stringify(s), prompt];
    try {
      return execFileSync("claude", args, { cwd, env, encoding: "utf8", timeout: 150_000 });
    } catch (fehler) {
      return String((fehler as { stdout?: string }).stdout ?? fehler);
    }
  }
  const read = (rel: string) => `Benutze das Read-Werkzeug für die Datei "${rel}" und gib ihren Inhalt wörtlich aus. Nutze kein anderes Werkzeug.`;
  const bash = (cmd: string) => `Führe genau diesen Bash-Befehl aus und gib die Ausgabe wörtlich aus, nutze kein anderes Werkzeug: ${cmd}`;

  it("Read gesperrt: andere Schreibweise und Ordner mit Glob-Zeichen; offene Datei lesbar", () => {
    const s = settings(true, false);
    expect(claude(s, read("Vertraulich/geheim.md"))).not.toContain(M.geheim);
    for (const d of DIRS) expect(claude(s, read(`${d}/notiz.md`)), d).not.toContain(M[d]);
    expect(claude(s, read("offen.md"))).toContain(M.offen);
  }, 900_000);
  it("cat gesperrt; grep -r ohne Sandbox liest mit (bekannte Grenze, steht in Einstellung und README)", () => {
    const s = settings(true, false);
    expect(claude(s, bash("cat Vertraulich/geheim.md"))).not.toContain(M.geheim);
    expect(claude(s, bash("grep -r ZEICHEN-geheim ."))).toContain(M.geheim);
  }, 400_000);
  it("mit Sandbox: grep -r gesperrt, offene Datei bleibt sichtbar", () => {
    const out = claude(settings(true, true), bash("grep -r ZEICHEN ."));
    expect(out).not.toContain(M.geheim);
    expect(out).toContain(M.offen);
  }, 300_000);
  it("Pfadanfang ohne / (Privat*, Privat*/**) und Muster-Eintrag (Einzeldatei): gesperrt, Positivkontrolle liest", () => {
    const s = settings(true, false, ["Privat", "/geheim-\\d+\\.md$/"]);
    for (const f of EXTRA) {
      expect(claude({}, read(f)), `Kontrolle ${f}`).toContain(M[f]);
      expect(claude(s, read(f)), f).not.toContain(M[f]);
    }
    expect(claude(s, read("Archiv/offen-2.md"))).toContain(M.offen2);
  }, 600_000);
  it("Vault über unaufgelösten Pfad (tmpdir, auf macOS /var statt /private/var) und Symlink: gesperrt", () => {
    const real = mkdtempSync(join(tmpdir(), "gc-ausschluss-var-"));
    const link = join(tmpdir(), `gc-ausschluss-link-${Math.random().toString(36).slice(2, 10)}`);
    try {
      mkdirSync(join(real, "Vertraulich"));
      writeFileSync(join(real, "Vertraulich/geheim.md"), `${M.geheim}\n`);
      symlinkSync(real, link);
      // Regeln aus der unaufgelösten Form; claude arbeitet im aufgelösten Pfad.
      for (const dir of [real, link]) {
        const s = settings(true, false, ["Vertraulich/"], dir);
        expect(claude({}, read("Vertraulich/geheim.md"), dir), `Kontrolle ${dir}`).toContain(M.geheim);
        expect(claude(s, read("Vertraulich/geheim.md"), dir), dir).not.toContain(M.geheim);
        expect(claude(s, read(join(dir, "Vertraulich/geheim.md")), dir), `absolut ${dir}`).not.toContain(M.geheim);
      }
    } finally {
      rmSync(link, { force: true });
      rmSync(real, { recursive: true, force: true });
    }
  }, 600_000);
  // APFS unterscheidet Groß-/Kleinschreibung nicht; auf anderen Systemen fände die Kontrolle die Datei nicht.
  it.skipIf(process.platform !== "darwin")("andere Groß-/Kleinschreibung im Pfad: gesperrt (Read und cat)", () => {
    const s = settings(true, false, ["Vertraulich/"]);
    expect(claude({}, read("vertraulich/geheim.md")), "Kontrolle").toContain(M.geheim);
    for (const rel of ["vertraulich/geheim.md", "VERTRAULICH/geheim.md"]) {
      expect(claude(s, read(rel)), rel).not.toContain(M.geheim);
      expect(claude(s, bash(`cat ${rel}`)), `cat ${rel}`).not.toContain(M.geheim);
    }
  }, 600_000);
  it("Gegenprobe: Schalter aus, Claude liest die Datei und jede Sonderordner-Notiz", () => {
    expect(settings(false, false)).toEqual({});
    expect(claude({}, read("Vertraulich/geheim.md"))).toContain(M.geheim);
    // Positivkontrolle je Sonderordner: sonst bliebe Test 1 bei falschem Pfad oder Prompt grün.
    for (const d of DIRS) expect(claude({}, read(`${d}/notiz.md`)), d).toContain(M[d]);
  }, 900_000);
});
