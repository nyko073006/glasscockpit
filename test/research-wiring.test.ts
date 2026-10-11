import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RESEARCH_CACHE_FILE } from "../src/core/constants";
import { listFilesRecursive, relativeToRoot, ROOT } from "./helpers/files";

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const RESEARCH_FILES = ["src/core/research.ts", "src/host/research-fs.ts", "src/host/research-fetch.ts", "src/host/research-card.ts"];
const VERBOTEN = /child_process|\bfetch\s*\(|XMLHttpRequest|node:https?\b|Authorization|\.agentic-os|innerHTML/;

describe("Research: Netz nur an zwei Stellen, ohne Token", () => {
  it("das Muster trifft die verbotenen Stellen", () => {
    for (const zeile of ['import { exec } from "node:child_process";', "await fetch(url)", "new XMLHttpRequest()", 'import https from "node:https";',
      'headers: { Authorization: "x" }', "~/.agentic-os/x", "el.innerHTML = x"]) {
      expect(zeile).toMatch(VERBOTEN);
    }
    expect("await requestUrl({ url })").not.toMatch(VERBOTEN);
  });
  it("requestUrl kommt in src/ nur in research-fetch.ts, telegram-send.ts und (Abend 26) native-download-fetch.ts vor", () => {
    const hits = listFilesRecursive(join(ROOT, "src"))
      .filter((f) => /requestUrl/.test(readFileSync(f, "utf8")))
      .map(relativeToRoot);
    expect(hits).toEqual(["src/host/native-download-fetch.ts", "src/host/research-fetch.ts", "src/host/telegram-send.ts"]);
  });
  it.each(RESEARCH_FILES)("%s enthält nichts Verbotenes", (p) => {
    expect(read(p)).not.toMatch(VERBOTEN);
  });
  it("research-fetch.ts: GET, throw: false, Zeitlimit per Promise.race", () => {
    const src = read("src/host/research-fetch.ts");
    expect(src).toMatch(/method:\s*"GET"/);
    expect(src).toMatch(/throw:\s*false/);
    expect(src).toMatch(/Promise\.race\(/);
    expect(src).toMatch(/clearTimeout\(/);
  });
});

describe("Research: Zwischenspeicher", () => {
  it("RESEARCH_CACHE_FILE liegt unter ~/.claude/cockpit/", () => {
    expect(RESEARCH_CACHE_FILE.startsWith("~/.claude/cockpit/")).toBe(true);
  });
  it("research-fs.ts schreibt nur über writeFileAtomic", () => {
    const src = read("src/host/research-fs.ts");
    expect(src).toMatch(/writeFileAtomic\(/);
    expect(src).not.toMatch(/\bwriteFile\s*\(|appendFile|createWriteStream/);
  });
});

describe("Research-Karte im Dashboard", () => {
  const dash = read("src/host/dashboard-view.ts");
  const card = read("src/host/research-card.ts");
  it("steht als letzte Karte nach „Skills“", () => {
    const skills = dash.indexOf("new SkillsCard(");
    const research = dash.indexOf("new ResearchCard(");
    expect(skills).toBeGreaterThan(-1);
    expect(research).toBeGreaterThan(skills);
  });
  it("wird nach skillsCard.start() gestartet und in onClose gestoppt", () => {
    expect(dash.indexOf("this.research.start()")).toBeGreaterThan(dash.indexOf("this.skillsCard.start()"));
    expect(dash).toMatch(/this\.research\?\.stop\(\)/);
  });
  it("Klick öffnet nur über safeRepoUrl", () => {
    expect(card).toMatch(/safeRepoUrl\(/);
    expect(card.indexOf("safeRepoUrl(")).toBeLessThan(card.indexOf("openUrl("));
  });
  it("isFirstRun( steht genau einmal und vor dem Abruf in der Schleife", () => {
    expect(card.match(/isFirstRun\(/g)).toHaveLength(1);
    expect(card.indexOf("isFirstRun(")).toBeGreaterThan(-1);
    expect(card.indexOf("isFirstRun(")).toBeLessThan(card.indexOf("fetchSearch("));
  });
  it("hat keinen href mit fremder URL und setzt Beschreibungen nur als Text", () => {
    expect(card).not.toMatch(/href/);
  });
  it("fehlerhafte Abschnitte fragen ohne Knopf höchstens im Prüftakt erneut (kein Abruf je Tab-Wechsel)", () => {
    expect(card).toMatch(/const retryErrors = force \|\| lastAttemptAt === null \|\| now - lastAttemptAt >= RESEARCH_TICK_MS;/);
    expect(card).toMatch(/\.filter\(\(s\) => retryErrors \|\| !hasError\(cache, s\)\)/);
    expect(card.indexOf("lastAttemptAt = Date.now();")).toBeLessThan(card.indexOf("await fetchSearch("));
    expect(card.indexOf("lastAttemptAt = Date.now();")).toBeGreaterThan(card.indexOf("for (const s of due)"));
  });
  it("„Lädt …“ nur, wenn etwas fällig ist", () => {
    expect(card).toMatch(/if \(due\.length > 0\) \{\s*this\.busy = true;/);
  });
});

// Abnahme 05.10.2026: Im schmalen Feld (rund zehn Zeichen) brach jede Suche auf mehrere Zeilen um, ein fehlender
// Zeilenumbruch fiel nicht auf. Das Feld steht deshalb unter der Beschreibung in voller Breite.
describe("Research: Feld der Suchen in voller Breite", () => {
  const css = read("src/styles.css");
  const block = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/\./g, "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";

  it("die Zeile des Feldes trägt die Klasse cockpit-research-setting", () => {
    expect(read("src/host/settings-tab.ts")).toMatch(/settingEl\.addClass\("cockpit-research-setting"\)/);
  });
  it("die Zeile bricht um, die Bedienspalte nimmt die volle Breite", () => {
    expect(block(".cockpit-research-setting")).toMatch(/flex-wrap:\s*wrap/);
    expect(block(".cockpit-research-setting .setting-item-control")).toMatch(/flex:\s*1 1 100%/);
  });
});
