import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const USAGE_FILES = ["src/core/usage.ts", "src/host/usage-card.ts", "src/host/usage-fs.ts"];

/** Kindprozess, Paketstart aus dem Netz oder Netzzugriff. */
export const VERBOTEN = /child_process|\bnpx\b|ccusage|requestUrl|\bfetch\s*\(|XMLHttpRequest|node:https?\b|\bspawn\b|\bexecFile\b/;

describe("Usage-Karte: kein Kindprozess, kein Netz", () => {
  it("das Muster trifft die verbotenen Stellen", () => {
    for (const zeile of ['import { execFile } from "node:child_process";', "npx -y ccusage@latest", "await requestUrl({ url })", "await fetch(url)", 'import https from "node:https";']) {
      expect(zeile).toMatch(VERBOTEN);
    }
    expect('import { readFile } from "node:fs/promises";').not.toMatch(VERBOTEN);
  });
  it.each(USAGE_FILES)("%s enthält nichts davon", (p) => {
    expect(read(p)).not.toMatch(VERBOTEN);
  });
  it.each(USAGE_FILES)("%s importiert nur fs/promises, path, os, obsidian und eigene Module", (p) => {
    const mods = Array.from(read(p).matchAll(/\bfrom\s+["']([^"']+)["']/g), (m) => m[1]);
    for (const m of mods) expect(["node:fs/promises", "node:path", "node:os", "obsidian"].includes(m) || m.startsWith(".")).toBe(true);
  });
});

describe("Usage-Karte im Dashboard", () => {
  const src = read("src/host/dashboard-view.ts");
  it("steht unter „Briefing“ und vor „Aufgaben“", () => {
    const briefing = src.indexOf('this.cardEl = root.createDiv');
    const usage = src.indexOf("new UsageCard(");
    const tasks = src.indexOf("new TasksCard(");
    expect(briefing).toBeGreaterThan(-1);
    expect(usage).toBeGreaterThan(briefing);
    expect(tasks).toBeGreaterThan(usage);
  });
  it("wird beim Schließen gestoppt (abgemeldet)", () => {
    expect(src).toMatch(/this\.usage\?\.stop\(\)/);
    expect(read("src/host/usage-card.ts")).toMatch(/this\.unsubscribe\?\.\(\)/);
  });
});

describe("Zähler auf Plugin-Ebene (Abend 13)", () => {
  const card = read("src/host/usage-card.ts");
  const main = read("src/main.ts");
  const fsSrc = read("src/host/usage-fs.ts");
  const tab = read("src/host/settings-tab.ts");

  it("die Karte hat keinen eigenen Scanner und keinen eigenen Takt, sie abonniert den Zähler", () => {
    expect(card).not.toMatch(/TranscriptScanner|transcriptFs|setInterval|usagePollDue/);
    expect(card).toMatch(/counter\.subscribe\(/);
  });
  it("Öffnen der Karte stößt einen Lauf an (requestRun)", () => {
    expect(card).toMatch(/counter\.requestRun\(\)/);
  });
  it("das Plugin hält genau eine Zählerinstanz und gibt sie an das Dashboard", () => {
    expect(main.match(/new TokenCounter\(/g)).toHaveLength(1);
    expect(main).toMatch(/new TranscriptScanner\(/);
    expect(main).toMatch(/counter,?\s*\n/);
  });
  it("der Takt läuft ab dem Laden mit USAGE_TICK_MS über requestRun und wird in onunload gestoppt", () => {
    expect(main).toMatch(/setInterval\(\(\) => void counter\.requestRun\(\), USAGE_TICK_MS\)/);
    const unload = main.slice(main.indexOf("onunload()"));
    expect(unload).toMatch(/clearInterval\(/);
  });
  it("Einstellungen kommen bei jeder Nutzung aus dem Store, Schreibfehler gehen in die Konsole", () => {
    const block = main.slice(main.indexOf("new TokenCounter("));
    expect(block.slice(0, 600)).toMatch(/settings: \(\) => store\.settings\(\)/);
    expect(main).toMatch(/log: \(m\) => console\.(warn|error)\(m\)/);
  });
  it("geschrieben wird atomar: temporäre Datei im selben Ordner, dann rename", () => {
    expect(fsSrc).toMatch(/writeFile\(tmp/);
    expect(fsSrc).toMatch(/rename\(tmp/);
  });
  it("Pfad der Datei ist eine Konstante neben dem Schnappschuss", () => {
    const c = read("src/core/constants.ts");
    expect(c).toMatch(/TOKENS_TODAY_FILE = "~\/\.claude\/cockpit\/tokens-today\.json"/);
    expect(c.indexOf("TOKENS_TODAY_FILE")).toBeGreaterThan(c.indexOf("USAGE_SNAPSHOT_FILE"));
  });
  it("Schalter im Abschnitt Dashboard der Einstellungen", () => {
    const dashboard = tab.slice(tab.indexOf('setName("Dashboard")'));
    expect(dashboard).toMatch(/toggleField\("writeTokensFile", "Tokens für die Statuszeile schreiben"/);
  });
});
