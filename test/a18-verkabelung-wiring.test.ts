import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

// Host-Verdrahtung nur per Textprüfung; die Wirkung in Obsidian prüft die Abnahme.
describe("Abend 18 Verkabelung: main.ts", () => {
  const main = src("src/main.ts");

  it("Schwellen: beim Laden und bei jeder Einstellungsänderung atomar nach THRESHOLDS_FILE", () => {
    expect(main).toMatch(/new ThresholdsSync\(\{[\s\S]*?write:\s*\(text\)\s*=>\s*writeFileAtomic\(expandHome\(THRESHOLDS_FILE, home\), text\)/);
    expect(main).toMatch(/void thresholds\.sync\(store\.settings\(\)\)/);
    expect(main).toMatch(/store\.onSettingsChange\(\(s\)\s*=>\s*void thresholds\.sync\(s\)\)/);
  });

  it("die View bekommt Feed und Actions als Deps; der Feed kommt aus einer Quelle", () => {
    expect(main).toMatch(/new CockpitFeedSource\(/);
    expect(main).toMatch(/feed:\s*\(\)\s*=>\s*feedSource\.feed\(\)/);
    expect(main).toMatch(/onFeedChange:\s*\(cb\)\s*=>\s*feedSource\.subscribe\(cb\)/);
    expect(main).toMatch(/actions:\s*this\.feedActions\(/);
    expect(main).toMatch(/feedOpened:\s*\(\)\s*=>\s*void feedSource\.refresh\(\)/);
  });

  it("LOC und Commits heute (Abend 19): eigener Scanner, im Pull-Takt, gleiche Repo-Liste, Quelle und Abonnement", () => {
    expect(main).toMatch(/const dayScan = new DayScan\(\{\s*list:\s*\(\)\s*=>\s*listGitRepos\(expandHome\(store\.settings\(\)\.projectsRoot, home\)\)/);
    expect(main).toMatch(/dayLog:\s*async \(dir, since\)\s*=>\s*runGitDayLog\(dir, since,/);
    expect(main).toMatch(/now:\s*\(\)\s*=>\s*new Date\(\)/);
    expect(main).toMatch(/afterPull:\s*\(\)\s*=>\s*\{[^}]*void dayScan\.run\(\)/);
    expect(main).toMatch(/day:\s*\(\)\s*=>\s*dayScan\.snapshot\(\)/);
    expect(main).toMatch(/this\.register\(dayScan\.subscribe\(\(\)\s*=>\s*feedSource\.changed\(\)\)\)/);
  });

  it("alle Actions sind belegt", () => {
    const block = main.slice(main.indexOf("private feedActions("));
    for (const name of ["focusSession", "openBriefing", "openNote", "startLint", "setEffort", "toggleTelegram", "toggleSound", "newSession", "openSettings"]) {
      expect(block, name).toMatch(new RegExp(`${name}:`));
    }
  });

  it("startLint nutzt das eine Sende-Primitiv, keine neue Sendelogik", () => {
    expect(main).toMatch(/startLint:\s*\(\)\s*=>\s*\{[^}]*this\.sendToActive\(buildSend\(cmd\)\);/);
    expect(main).not.toContain('buildSend("/lint")');
  });

  it("focusSession holt den Tab wie der Banner-Klick (bringToFront der View)", () => {
    expect(main).toMatch(/focusSession:\s*\(id\)\s*=>\s*this\.focusSession\(id\)/);
    expect(main).toMatch(/private focusSession\(id: string\): void \{\s*const view = this\.viewsOf\(id\)\[0\];\s*if \(view\) \{\s*view\.bringToFront\(\)/);
    expect(src("src/host/terminal-view.ts")).toMatch(/^\s*bringToFront\(\): void/m);
    expect(src("src/host/terminal-view.ts")).not.toMatch(/private bringToFront/);
  });

  it("Effort: die gewählte Stufe direkt, gespeichert über store.updateSetting; Telegram über toggledTelegram, beide Schalter", () => {
    expect(main).toMatch(/setEffort:\s*\(step\)\s*=>\s*\{\s*const result = store\.updateSetting\("nextEffort", step\)/);
    expect(main).toMatch(/store\.updateSetting\("nextEffort"/);
    expect(main).toMatch(/toggledTelegram\(store\.settings\(\)\)/);
    expect(main).toMatch(/updateSetting\("telegramOnDone", on\)/);
    expect(main).toMatch(/updateSetting\("telegramOnQuestion", on\)/);
  });

  it("Ton: toggledSound, beide Einstellungen, Command „Ton an/aus“ mit Notice", () => {
    expect(main).toMatch(/toggledSound\(store\.settings\(\)\)/);
    expect(main).toMatch(/updateSetting\("alertSound", on\)/);
    expect(main).toMatch(/updateSetting\("alertBanner", on\)/);
    expect(main).toMatch(/toggleSound:\s*\(\)\s*=>\s*\{\s*this\.toggleSound\(store\)/);
    expect(main).toMatch(/id:\s*"toggle-sound",\s*name:\s*"Ton an\/aus"/);
    expect(main).toMatch(/new Notice\(`Ton \$\{on \? "an" : "aus"\}`\)/);
  });

  it("newSession (Plus auf dem Knauf) öffnet denselben Dialog wie der Command „Neue Sitzung“", () => {
    expect(main).toMatch(/newSession:\s*\(\)\s*=>\s*\{\s*void this\.openNewSessionModal\(store\)/);
    expect(main).toMatch(/id:\s*"new-session",\s*name:\s*"Neue Sitzung",\s*callback:\s*\(\)\s*=>\s*\{\s*void this\.openNewSessionModal\(store\)/);
    expect(main).toMatch(/private async openNewSessionModal\(store: SessionStore\): Promise<void> \{[\s\S]*?new NewSessionModal\(/);
    expect(src("src/host/cockpit-layout.ts")).toMatch(/makeButton\("newSession",\s*"Neue Sitzung",\s*\(\)\s*=>\s*actions\?\.newSession\(\)\)/);
  });

  it("der Dialog sortiert den Vault nach oben (vaultFirst über getSuggestions)", () => {
    const modal = src("src/host/new-session-modal.ts");
    expect(modal).toMatch(/getSuggestions\(query: string\)/);
    expect(modal).toMatch(/vaultFirst\(super\.getSuggestions\(query\)/);
  });

  it("neue Sitzungen kommen als Tab in die Gruppe der jüngsten Sitzung (planNewSessionPlacement), nur ohne Sitzung als Split", () => {
    expect(main).toMatch(/planNewSessionPlacement\(/);
    const create = main.slice(main.indexOf("private async createSession("), main.indexOf("private async planFor("));
    expect(create).toMatch(/this\.newSessionTarget\(\)/);
    expect(create).toMatch(/this\.openSession\(record\.id,\s*target\)/);
    const open = main.slice(main.indexOf("private async openTerminal("), main.indexOf("private async createSession("));
    expect(open).toMatch(/getLeaf\("tab"\)/);
    expect(open).toMatch(/getLeaf\("split", "vertical"\)/);
    // Die ausdrücklichen Split-Wege bleiben Splits.
    expect(main).toMatch(/openInSplit:\s*\(id\)\s*=>\s*void this\.openSession\(id\)/);
  });

  it("Commands „Effort für nächste Sitzung“ und „Telegram an/aus“", () => {
    expect(main).toMatch(/id:\s*"next-effort",\s*name:\s*"Effort für nächste Sitzung"/);
    expect(main).toMatch(/id:\s*"toggle-telegram",\s*name:\s*"Telegram an\/aus"/);
  });

  it("der Launcher bekommt die Stufe aus den Einstellungen bei jedem Start frisch", () => {
    expect(main).toMatch(/effort:\s*store\.settings\(\)\.nextEffort/);
  });

  it("Repo-Ampel im Takt des Pulls: PullController ruft nach dem Lauf, kein eigener Timer für Git", () => {
    expect(main).toMatch(/afterPull:\s*\(\)\s*=>\s*\{[^}]*repoScan\.run\(\)/);
    expect(main).toMatch(/new RepoScan\(/);
    expect(main.match(/setInterval\(/g)?.length).toBe(2);
    const pull = src("src/host/git-pull.ts");
    expect(pull).toMatch(/finally\s*\{\s*try\s*\{\s*this\.deps\.afterPull\?\.\(\)/);
    expect(pull).toMatch(/hasDashboard\(\): boolean/);
  });

  it("Zähler-Takt und Signale stoßen die Aktualisierung nur bei offenem Dashboard an; Aktivität meldet sich", () => {
    expect(main).toMatch(/counter\.subscribe\(\(\)\s*=>\s*\{\s*if \(pull\.hasDashboard\(\)\) void feedSource\.refresh\(\)/);
    expect(main).toMatch(/record:[^\n]*feedSource\.changed\(\)/);
    expect(main).toMatch(/markSeen:[^\n]*feedSource\.changed\(\)/);
  });

  it("this.app, nie window.app", () => {
    expect(main).not.toMatch(/window\.app\b/);
  });
});

describe("Abend 18 Verkabelung: Git-Abfrage", () => {
  // Kommentare erwähnen „kein fetch“; geprüft wird nur der Code.
  const repo = src("src/host/repo-status.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("porcelain v2 mit Branch, ohne Passwort-Prompt, ohne fetch, Zeitlimit als execFile-Option", () => {
    expect(repo).toMatch(/"status",\s*"--porcelain=v2",\s*"--branch"/);
    expect(repo).toMatch(/GIT_TERMINAL_PROMPT:\s*"0"/);
    expect(repo).toMatch(/timeout:\s*timeoutMs/);
    expect(repo).not.toMatch(/fetch|"pull"/);
    expect(repo).not.toMatch(/execFile\(\s*"timeout"/);
  });
});

describe("Abend 18 Verkabelung: Launcher und Argumente", () => {
  it("Launcher reicht effort an buildArgs; buildArgs nutzt effortArgs", () => {
    expect(src("src/host/launcher.ts")).toMatch(/effort:\s*start\.effort/);
    expect(src("src/core/claude-launch.ts")).toMatch(/effortArgs\(/);
  });
});

describe("Abend 18 Verkabelung: View und Layout-Controller", () => {
  const view = src("src/host/dashboard-view.ts");
  const ctl = src("src/host/dashboard-layout-controller.ts");
  it("die View hat feed, actions, onFeedChange, feedOpened als Deps und reicht sie dem Controller", () => {
    expect(view).toMatch(/feed:\s*\(\)\s*=>\s*CockpitFeed/);
    expect(view).toMatch(/actions:\s*CockpitFeedActions/);
    expect(view).toMatch(/onFeedChange:\s*\(cb:\s*\(\)\s*=>\s*void\)\s*=>\s*\(\)\s*=>\s*void/);
    expect(view).toMatch(/feed:\s*\(\)\s*=>\s*this\.deps\.feed\(\)/);
    expect(view).toMatch(/actions:\s*this\.deps\.actions/);
    expect(view).toMatch(/\(cb\)\s*=>\s*this\.deps\.onFeedChange\(cb\)/);
    expect(view).toMatch(/this\.deps\.feedOpened\(\)/);
  });
  it("refresh zeichnet den Feed direkt nach den alten Instrumenten, Actions gehen ans Layout", () => {
    expect(ctl).toMatch(/this\.layout\.update\(panelValues[^\n]*\n[^\n]*\n\s*if \(feed && settings\) this\.layout\.updateFeed\(feed\(\), settings\(\)/);
    expect(ctl).toMatch(/actions: d\.actions/);
    expect(view).toMatch(/settings: this\.deps\.settings,/);
  });
  it("die View baut keinen eigenen Sendeweg für die neuen Actions", () => {
    expect(view).not.toMatch(/buildSend|\.write\(|getActiveViewOfType/);
  });
});

describe("Abend 18 Verkabelung: Einstellungsseite", () => {
  const tab = src("src/host/settings-tab.ts");
  const section = (name: string): string => {
    const marker = `setName("${name}").setHeading()`;
    const start = tab.indexOf(marker);
    const next = tab.indexOf(".setHeading()", start + marker.length);
    return tab.slice(start, next === -1 ? undefined : next);
  };
  it("Dashboard: alle neuen Werte, Radare und Fokus eingeschlossen", () => {
    const dash = section("Dashboard");
    for (const key of ["contextWarn", "contextHandoff", "tokensDayMedian", "tokensDayP90", "focusHeading", "inboxDir", "indexFile", "lintAfterDays", "dailyDir"]) {
      expect(dash, key).toMatch(new RegExp(`"${key}"`));
    }
  });
  it("Terminal: Effort der nächsten Sitzung als Auswahl", () => {
    expect(section("Terminal")).toMatch(/choiceField\(\s*"nextEffort"/);
  });
  it("Speichern nur über store.updateSetting (dort sitzen Prüfung und dependencyReason)", () => {
    expect(tab).not.toMatch(/saveData|\.settings\(\)\.\w+\s*=/);
  });
});
