import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, listFilesRecursive } from "./helpers/files";

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
// Auch Zugriff über Klammern (globalThis["setInterval"]) zählt als Takt.
const INTERVAL = /\bsetInterval\s*\(|\[\s*["'`]setInterval["'`]\s*\]/;
const SRC = listFilesRecursive(join(ROOT, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).map((f) => relative(ROOT, f));
const filesWith = (re: RegExp): string[] => SRC.filter((f) => re.test(read(f))).sort();
const count = (re: RegExp): number => SRC.reduce((n, f) => n + (read(f).match(re)?.length ?? 0), 0);

// Abend 15, „Eine Quelle“: Die Instrumente der Cockpit-Ansicht lesen den Stand der Karten. Kein zweiter Scanner,
// kein zweiter Takt, kein zweiter Pull, kein zweites requestUrl (Doppelzähler vermeiden).
describe("Cockpit-Ansicht: eine Quelle, kein zweiter Lader", () => {
  it("genau ein Zähler, ein Scanner, ein PullController im ganzen Quelltext", () => {
    expect(filesWith(/new TranscriptScanner\(/)).toEqual(["src/main.ts"]);
    expect(count(/new TranscriptScanner\(/g)).toBe(1);
    expect(count(/new TokenCounter\(/g)).toBe(1);
    expect(count(/new PullController\(/g)).toBe(1);
  });

  it("jede Karte wird genau einmal gebaut, nur im Dashboard", () => {
    for (const card of ["UsageCard", "TasksCard", "SkillsCard", "ResearchCard"]) {
      expect(filesWith(new RegExp(`new ${card}\\(`))).toEqual(["src/host/dashboard-view.ts"]);
      expect(count(new RegExp(`new ${card}\\(`, "g"))).toBe(1);
    }
  });

  it("die Lader stehen nur an ihrem Ort: Schnappschuss, Research-Speicher, GitHub-Abruf, git pull", () => {
    expect(filesWith(/\breadSnapshotFile\(/)).toEqual(["src/host/usage-card.ts", "src/host/usage-fs.ts"]);
    expect(filesWith(/\bfetchSearch\(/)).toEqual(["src/host/research-card.ts", "src/host/research-fetch.ts"]);
    expect(filesWith(/\brunGitPull\(/)).toEqual(["src/host/git-pull.ts"]);
    expect(filesWith(/\breadResearchCache\(/)).toEqual(["src/host/research-card.ts", "src/host/research-fs.ts"]);
    expect(filesWith(/\brequestUrl\b/)).toEqual(["src/host/native-download-fetch.ts", "src/host/research-fetch.ts", "src/host/telegram-send.ts"]);
  });

  it("kein neuer Takt: setInterval nur dort, wo es schon vor Abend 15 stand", () => {
    expect(filesWith(INTERVAL)).toEqual(["src/host/research-card.ts", "src/host/terminal-view.ts", "src/main.ts"]);
    expect(count(new RegExp(INTERVAL.source, "g"))).toBe(4);
    expect('globalThis["setInterval"](f, 1)').toMatch(INTERVAL);
  });

  it("Layout und Panels haben weder Timer noch Lader noch Obsidian-Wert-Import", () => {
    const verboten = /setInterval|setTimeout|globalThis|requestAnimationFrame|requestUrl|fetch\s*\(|child_process|node:fs|execFile|TranscriptScanner|TokenCounter|PullController|readSnapshotFile|readResearchCache|cachedRead/;
    for (const f of ["src/host/cockpit-layout.ts", "src/host/dashboard-layout-controller.ts", "src/core/cockpit-panels.ts", "src/core/cockpit-split.ts"]) {
      const text = read(f);
      expect([f, verboten.test(text)]).toEqual([f, false]);
      expect([f, /from\s+["']obsidian["']/.test(text)]).toEqual([f, false]);
    }
    expect(read("src/core/cockpit-panels.ts")).not.toMatch(/\bdocument\b|\bwindow\b/);
  });

  it("das Dashboard importiert keinen Lader als Wert (nur Typen)", () => {
    const dash = read("src/host/dashboard-view.ts");
    for (const mod of ["usage-fs", "research-fs", "research-fetch", "git-pull"]) {
      const imports = [...dash.matchAll(new RegExp(`^import\\s+(type\\s+)?[^;]*from\\s+["']\\./${mod}["']`, "gm"))];
      for (const m of imports) expect([mod, m[1]?.trim()]).toEqual([mod, "type"]);
    }
    expect(dash).not.toMatch(/homedir|node:fs|from "fs"/);
  });

  it("jede Karte, die ein Instrument speist, hält ihren Stand als abonnierbares data; das Dashboard liest daraus (seit 19b ohne die Skill-Karte)", () => {
    for (const f of ["usage-card", "tasks-card", "research-card"]) {
      expect([f, /readonly data = new Observable</.test(read(`src/host/${f}.ts`))]).toEqual([f, true]);
    }
    // Der Skills-Schirm ist weg: Die Skill-Karte hält keinen Stand mehr für ein Instrument und niemand liest ihn.
    expect(read("src/host/skills-card.ts")).not.toMatch(/readonly data = new Observable|\bObservable\b/);
    const dash = read("src/host/dashboard-view.ts");
    for (const card of ["usage", "tasks", "research"]) {
      expect([card, new RegExp(`this\\.${card}\\??\\.data\\.get\\(\\)`).test(dash)]).toEqual([card, true]);
      expect([card, new RegExp(`(?:this\\.)?${card}\\??\\.data\\.subscribe\\(`).test(dash)]).toEqual([card, true]);
    }
    expect(dash).not.toMatch(/skillsCard\??\.data/);
    expect(dash).toMatch(/this\.deps\.pull\.state\.subscribe\(/);
  });

  it("die Instrumente abonnieren genau die Quellen, die sie noch lesen: drei Karten, Briefing, Pull, Sitzungen und Feed (kein Zähler, keine Recents, keine Skill-Karte)", () => {
    const dash = read("src/host/dashboard-view.ts");
    const quellen = [
      /\(cb\) => usage\.data\.subscribe\(cb\)/, /\(cb\) => tasks\.data\.subscribe\(cb\)/, /\(cb\) => research\.data\.subscribe\(cb\)/,
      /\(cb\) => this\.briefing\.subscribe\(cb\)/, /\(cb\) => this\.deps\.pull\.state\.subscribe\(cb\)/,
      /\(cb\) => this\.deps\.onSessionsChange\(cb\)/, /\(cb\) => this\.deps\.onFeedChange\(cb\)/,
    ];
    for (const q of quellen) expect([q.source, q.test(dash)]).toEqual([q.source, true]);
    const sources = dash.slice(dash.indexOf("sources: ["), dash.indexOf("inputs: () =>"));
    expect(sources).not.toMatch(/counter|onRecentsChange|skillsCard/);
    expect(sources.match(/\(cb\) =>/g)).toHaveLength(7);
  });

  it("das Briefing-Instrument zeigt nur das Datum: kein Text, keine Überschrift; gelesen wird nur aufgeklappt (ein cachedRead)", () => {
    const dash = read("src/host/dashboard-view.ts");
    expect(dash.match(/cachedRead\(/g)).toHaveLength(1);
    expect(dash).not.toMatch(/firstHeading|headline/);
    expect(dash).toMatch(/if \(this\.expanded && this\.selected !== null\)/);
    expect(dash).not.toMatch(/dashboardLayout === "cockpit"/);
    expect(read("src/core/briefings.ts")).not.toMatch(/firstHeading/);
  });

  it("die Instrumente kennen keine Tokens und keine Sitzungszahl mehr (OUT und Radar zeigen sie aus dem Feed)", () => {
    const dash = read("src/host/dashboard-view.ts");
    const inputs = dash.slice(dash.indexOf("private cockpitInputs()"), dash.indexOf("private showPull("));
    expect(inputs).not.toMatch(/counter|runningSessions|skills|sessions:/);
    expect(dash).not.toMatch(/runningSessions/);
    expect(read("src/main.ts")).not.toMatch(/runningSessions|runningCount/);
  });

  it("die Skill-Karte sendet über runSkill, also sendSkill (kein eigener Sendeweg); die Bühne hat keinen Weg zu Skills mehr", () => {
    const dash = read("src/host/dashboard-view.ts");
    expect(dash).toMatch(/run:\s*this\.deps\.runSkill/);
    for (const f of ["src/host/dashboard-layout-controller.ts", "src/host/cockpit-layout.ts"]) {
      expect([f, /onSkill|runSkill/.test(read(f))]).toEqual([f, false]);
    }
    expect(read("src/main.ts")).toMatch(/runSkill:\s*\(name\)\s*=>\s*this\.sendSkill\(name\)/);
  });

  it("Effort-Schieber (Abend 19e): Rechnung in core, DOM in host, cockpit-layout hängt ihn in den Inhalt des Feldes effort; ohne Plattenkulisse und ohne nextEffortStep", () => {
    for (const f of ["src/host/effort-lever.ts", "src/core/effort-lever.ts", "test/effort-lever.test.ts"]) expect([f, existsSync(join(ROOT, f))]).toEqual([f, true]);
    const layout = read("src/host/cockpit-layout.ts");
    expect(layout).toMatch(/mountEffortLever\(\{[^}]*host:\s*F\("effort"\)\.content/s);
    expect(layout).toMatch(/onSet:/);
    expect(layout).not.toMatch(/cockpit-effort-list|cockpit-effort-step|effortRows|buildEffortRows/);
    for (const f of SRC) expect([f, /nextEffortStep|effortFrame|roundedPath/.test(read(f))]).toEqual([f, false]);
    expect(read("src/core/effort-lever.ts")).not.toMatch(/from "\.\/effort"[^;]*nextEffortStep/);
    expect(read("src/core/effort-lever.ts")).not.toMatch(/document|window|HTMLElement/); // reine Logik
  });
});

describe("Cockpit-Ansicht: ohne Tastenfeld, Command bleiben in der Befehlspalette", () => {
  const main = read("src/main.ts");
  it("die Befehle der früheren Tasten bleiben als Commands des Plugins registriert", () => {
    for (const id of ["new-session", "launch-skill", "insert-command"]) expect([id, main.includes(`id: "${id}"`)]).toEqual([id, true]);
  });
  it("kein Weg mehr von der Bühne zu Commands: weder runCommand noch onKey noch reloadResearch im Dashboard", () => {
    for (const f of ["src/host/dashboard-view.ts", "src/host/dashboard-layout-controller.ts", "src/host/cockpit-layout.ts"]) {
      expect([f, /runCommand|\bonKey\b|reloadResearch|executeCommandById/.test(read(f))]).toEqual([f, false]);
    }
    expect(main).not.toMatch(/runCommand|AppWithCommands/);
  });
  it("Command open-cockpit-split „Cockpit-Ansicht öffnen“ ist registriert", () => {
    expect(main).toMatch(/id: "open-cockpit-split",\s*name: "Cockpit-Ansicht öffnen"/);
  });
  it("die Entscheidung kommt aus planCockpitSplit, Ziel der Sitzung kommt aus RecentSessions (sessionCandidates)", () => {
    expect(main).toMatch(/planCockpitSplit\(/);
    const fn = /private async openCockpitSplit\(\)[\s\S]*?\n  \}\n/.exec(main)?.[0] ?? "";
    expect(fn).toMatch(/this\.sessionCandidates\(\)/);
    expect(fn).not.toMatch(/getActiveViewOfType/);
    expect(fn).toMatch(/getLeaf\("split", "vertical"\)|openTerminal\(|createSession\(/);
  });
  it("move: erst die Sitzung rechts öffnen, dann den alten Tab in der Dashboard-Gruppe schließen (kein Doppel), für jede Sitzung der Liste", () => {
    const fn = /private async openCockpitSplit\(\)[\s\S]*?\n  \}\n/.exec(main)?.[0] ?? "";
    expect(fn).toMatch(/for \(const id of moving\)\s*\{[\s\S]*?await this\.openSession\(id, group\);[\s\S]*?leafOf\.get\(id\)\?\.detach\(\);/);
    expect(fn).toMatch(/terminal\.kind === "move" \? terminal\.sessionIds : terminal\.move/);
  });
});

describe("Cockpit-Ansicht: Schalter und Optik", () => {
  const dash = read("src/host/dashboard-view.ts");
  const css = read("src/styles.css");
  it("das Dashboard schaltet nach settings().dashboardLayout und reagiert auf onSettingsChange", () => {
    expect(dash).toMatch(/settings\(\)\.dashboardLayout/);
    expect(dash).toMatch(/onSettingsChange\(/);
    expect(dash).toMatch(/new DashboardLayoutController\(/);
    expect(dash).toMatch(/layout:\s*\(\)\s*=>\s*this\.deps\.settings\(\)\.dashboardLayout/);
    // 19b: Der Ausschnitt kommt bei jeder Nutzung frisch aus den Einstellungen.
    expect(dash).toMatch(/crop:\s*\(\)\s*=>\s*this\.deps\.settings\(\)\.cockpitCrop/);
    const ctl = read("src/host/dashboard-layout-controller.ts");
    expect(ctl).toMatch(/createCockpitLayout\(/);
    expect(ctl).not.toMatch(/from\s+["']obsidian["']/);
    // Nur „cockpit“ zeigt die Bühne; list (und alles andere) bleibt das Listen-Dashboard.
    expect(ctl).toMatch(/const wantCockpit = d\.layout\(\) === "cockpit";/);
    expect(dash).toMatch(/researchForPanel\(/);
    expect(dash).toMatch(/this\.layoutCtl\?\.destroy\(\)/);
  });
  it("die Einstellung „Dashboard-Ansicht“ steht im Abschnitt „Dashboard“ der Seite", () => {
    const tab = read("src/host/settings-tab.ts");
    const dashboard = tab.indexOf('setName("Dashboard")');
    const research = tab.indexOf('setName("Research")');
    const field = tab.search(/this\.choiceField\(\s*"dashboardLayout"/);
    expect(field).toBeGreaterThan(dashboard);
    expect(field).toBeLessThan(research);
    expect(tab).toMatch(/Dashboard-Ansicht/);
  });
  it("die Einstellung „Cockpit-Ausschnitt“ (zugeschnitten | voll) steht im Abschnitt „Dashboard“ gleich hinter der Dashboard-Ansicht", () => {
    const tab = read("src/host/settings-tab.ts");
    const layout = tab.search(/this\.choiceField\(\s*"dashboardLayout"/);
    const crop = tab.search(/this\.choiceField\(\s*"cockpitCrop"/);
    const next = tab.indexOf("this.textField(\"briefingsDir\"");
    expect(crop).toBeGreaterThan(layout);
    expect(crop).toBeLessThan(next);
    const block = tab.slice(crop, next);
    expect(block).toMatch(/"Cockpit-Ausschnitt"/);
    expect(block).toMatch(/\{\s*crop:\s*"zugeschnitten",\s*full:\s*"voll"\s*\}/);
    expect(tab).toMatch(/type ChoiceKey = "dashboardLayout" \| "nextEffort" \| "cockpitCrop";/);
  });
  it("alle neuen Klassen tragen das Präfix cockpit-", () => {
    // Ohne Kommentare; erlaubt sind nur Klassen von Obsidian, an die schon vor Abend 15 Regeln hingen (und „css“ aus @import).
    const ohneKommentare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const obsidian = ["css", "setting-item-control", "view-content", "workspace-leaf-content", "workspace-tab-header", "workspace-tab-header-inner-title"];
    const klassen = [...ohneKommentare.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]).filter((c) => !c.startsWith("cockpit-") && !obsidian.includes(c));
    expect(klassen).toEqual([]);
  });
  it("Schrift in cqw, Monospace, Hover-Glow und prefers-reduced-motion", () => {
    expect(css).toMatch(/\.cockpit-inst-bar-fill \{[^}]*background:\s*var\(--tone\)/);
    expect(css).toMatch(/\.cockpit-inst-big \{[^}]*font-size:[^;}]*cqw/);
    expect(css).toMatch(/\.cockpit-stage \{[^}]*font-family:[^;}]*(Monaco|Menlo)/);
    expect(css).toMatch(/\.cockpit-panel:hover[^{]*\{[^}]*drop-shadow/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.cockpit-panel[^@]*transition:\s*none/);
  });
  it("Ausrufezeichen der Warnungen: leuchtet in der Tonfarbe, pulsiert, und steht still bei reduzierter Bewegung", () => {
    expect(css).toMatch(/\.cockpit-panel-warnings \.cockpit-inst-big \{[^}]*text-shadow:[^;}]*var\(--tone\)/);
    expect(css).toMatch(/\.cockpit-panel-warnings \.cockpit-inst-big \{[^}]*animation:[^;}]*cockpit-warn-pulse/);
    expect(css).toMatch(/@keyframes cockpit-warn-pulse/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.cockpit-panel-warnings \.cockpit-inst-big[^}]*\{[^}]*animation:\s*none/);
  });
  it("die Bühne ist schwarz und füllt die View, contain über Container-Einheiten", () => {
    expect(css).toMatch(/\.cockpit-stage-wrap \{[^}]*background:\s*#000/);
    expect(css).toMatch(/\.cockpit-stage-wrap \{[^}]*container-type:\s*size/);
    // 19b: Das Fenster passt den Ausschnitt ein (contain), die Bühne steht absolut darin und wird vom Host verschoben und skaliert.
    expect(css).toMatch(/\.cockpit-window \{[^}]*min\(100cqw,\s*calc\(100cqh \* var\(--cockpit-view-aspect/);
    expect(css).toMatch(/\.cockpit-window \{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.cockpit-stage \{[^}]*position:\s*absolute/);
  });
});
