import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

// Klick ins Dashboard macht das Dashboard zum aktiven Leaf. Wer die Sitzung dort mit getActiveViewOfType sucht,
// findet nie ein Terminal. Sendeziel ist die jüngste Terminal-Sitzung (RecentSessions), über das eine Sende-Primitiv.
describe("Dashboard sendet an die zuletzt aktive Sitzung", () => {
  const view = readFileSync(join(ROOT, "src/host/dashboard-view.ts"), "utf8");
  const main = readFileSync(join(ROOT, "src/main.ts"), "utf8");

  it("die View benutzt nicht getActiveViewOfType und baut keinen eigenen Sendeweg", () => {
    expect(view).not.toMatch(/getActiveViewOfType|getActiveFile|activeLeaf/);
    expect(view).not.toMatch(/manager|\.write\(|buildSend|checkTarget/);
    expect(view).toMatch(/deps\.send\(/);
  });

  it("main.ts verdrahtet send über sendToActive, und das nutzt sendTarget (RecentSessions)", () => {
    expect(main).toMatch(/send:\s*\(text\)\s*=>\s*this\.sendToActive\(buildSend\(text\)\)/);
    expect(main).toMatch(/private sendToActive\([^)]*\)[^{]*\{[^}]*this\.sendTarget\(\)/);
    expect(main).toMatch(/private activeSessionId\(\)[^{]*\{[^}]*this\.recent\.current\(/);
  });

  it("Launcher und Dashboard teilen sendToActive", () => {
    expect(main.match(/this\.sendToActive\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

// Karte „Heute“ (Abend 44): eine Erinnerungen-Instanz im Plugin, Takt am Pull-Takt (kein neues setInterval), das Dashboard meldet
// Öffnen und Schließen wie beim Pull und reicht die Store-Funktionen durch.
describe("Karte „Heute“: Verdrahtung", () => {
  const view = readFileSync(join(ROOT, "src/host/dashboard-view.ts"), "utf8");
  const main = readFileSync(join(ROOT, "src/main.ts"), "utf8");

  it("main.ts baut genau einen RemindersController, mit der Plattform aus host-platform, nie process.platform", () => {
    expect(main.match(/new RemindersController\(/g)).toHaveLength(1);
    const ctor = main.slice(main.indexOf("new RemindersController("), main.indexOf("});", main.indexOf("new RemindersController(")));
    expect(ctor).toMatch(/\bplatform\b/);
    expect(ctor).not.toMatch(/process\.platform/);
    expect(main).toMatch(/reminders\.dispose\(\)/);
  });

  it("der Pull-Takt ruft auch reminders.tick(), kein eigener Takt", () => {
    expect(main).toMatch(/window\.setInterval\(\(\) => \{ pull\.tick\(\); reminders\.tick\(\); \}, PULL_TICK_MS\)/);
    expect(main).not.toMatch(/setInterval\([^\n]*reminders\.tick\(\)[^\n]*REMINDERS/);
  });

  it("main.ts reicht Controller und Store-Funktionen ans Dashboard", () => {
    const dash = main.slice(main.indexOf("new DashboardView(leaf, {"), main.indexOf("}),", main.indexOf("new DashboardView(leaf, {")));
    for (const re of [
      /\breminders,/, /briefingDone: \(today\) => store\.briefingDone\(today\)/,
      /setBriefingDone: \(today, key, done\) => store\.setBriefingDone\(today, key, done\)/,
      /remindersDone: \(today\) => store\.remindersDone\(today\)/,
      /setReminderDone: \(today, item, done\) => store\.setReminderDone\(today, item, done\)/,
      /onTodayChange: \(cb\) => store\.onTodayChange\(cb\)/,
    ]) expect([re.source, re.test(dash)]).toEqual([re.source, true]);
  });

  it("das Dashboard meldet Öffnen und Schließen beim Erinnerungen-Controller neben dem Pull", () => {
    expect(view).toMatch(/this\.deps\.pull\.dashboardOpened\(\);\s*this\.deps\.reminders\.dashboardOpened\(\);/);
    // Fix-Runde 1: gezählt wird direkt nach dem Öffnen, geschlossen nur gezählt und im finally von onClose.
    expect(view).toMatch(/this\.deps\.reminders\.dashboardOpened\(\);\s*this\.remindersCounted = true;/);
    const close = view.slice(view.indexOf("async onClose()"), view.indexOf("\n  }\n", view.indexOf("async onClose()")));
    expect(close).toMatch(/finally \{[^]*if \(this\.remindersCounted\) \{[^}]*this\.deps\.reminders\.dashboardClosed\(\);/);
    // Der Pull-Zähler schließt weiter in onClose (Fix-Runde 2: vor Fix-Runde 1 stand das im Regex).
    expect(close).toMatch(/this\.deps\.pull\.dashboardClosed\(\);/);
  });

  it("das Dashboard reicht der Karte die Uhr, den Controller und den Zustand von „Erledigt“", () => {
    const card = view.slice(view.indexOf("new TasksCard("), view.indexOf("});", view.indexOf("new TasksCard(")));
    for (const re of [/now: \(\) => new Date\(\)/, /reminders: this\.deps\.reminders/, /doneOpen: \(\) => this\.doneOpen/, /onTodayChange: this\.deps\.onTodayChange/]) {
      expect([re.source, re.test(card)]).toEqual([re.source, true]);
    }
    expect(card).toMatch(/setDoneOpen: \(open\) => \{[^}]*requestSaveLayout\(\)/);
  });
});

// Abhaken im Briefing (Abend 44): nur das Briefing von heute bekommt Checkboxen mit dem Erledigt-Stand aus dem Store;
// ältere Tage bleiben unverändert, und in den Briefing-Ordner schreibt das Dashboard nie.
describe("Briefing-Karte: Abhaken mit gemeinsamem Stand", () => {
  const view = readFileSync(join(ROOT, "src/host/dashboard-view.ts"), "utf8");
  const checks = readFileSync(join(ROOT, "src/host/briefing-checks.ts"), "utf8");

  it("d) markBriefing steht genau einmal, im Zweig für das heutige Briefing (todayBriefingPath, gemeinsam mit der Karte „Heute“)", () => {
    expect(view.match(/markBriefing\(/g)).toHaveLength(1);
    const at = view.indexOf("markBriefing(");
    const branch = view.slice(view.lastIndexOf("if (", at), at);
    expect(branch).toMatch(/^if \(todayPath === file\.path\) \{/);
    expect(branch).not.toMatch(/\n\s*\}/);
    expect(view).toMatch(/const today = localDayString\(new Date\(\)\);\s*const todayPath = todayBriefingPath\(s, today\);/);
    expect(branch).toMatch(/new Set\(this\.deps\.briefingDone\(today\)\)/);
  });

  it("I1) loadBriefings entscheidet über renderBriefingWithChecks, nicht selbst", () => {
    expect(view).not.toMatch(/attachBriefingChecks/);
    expect(view.match(/renderBriefingWithChecks\(/g)).toHaveLength(1);
    const call = view.slice(view.indexOf("renderBriefingWithChecks("), view.indexOf("});", view.indexOf("renderBriefingWithChecks(")));
    expect(call).toMatch(/stale: \(\) => gen !== this\.generation/);
  });

  it("M2) der eigene Klick lädt sofort neu und verwirft die angestoßene Entprellung", () => {
    expect(view).toMatch(/onToggle: \(key, done\) => \{\s*this\.deps\.setBriefingDone\(today, key, done\);\s*this\.reload\?\.cancel\(\);\s*void this\.loadBriefings\(\);/);
  });

  it("I5) die Karte zeigt den Hinweis des Rückfalls als cockpit-hint über dem Text", () => {
    expect(view).toMatch(/this\.briefingHint = [^;]*\.hint/);
    const card = view.slice(view.indexOf("private renderCard("));
    const hint = card.indexOf('createDiv({ cls: "cockpit-hint", text: this.briefingHint })');
    expect(hint).toBeGreaterThan(-1);
    expect(hint).toBeLessThan(card.indexOf("body.append(content)"));
  });

  it("auf onTodayChange lädt die Briefing-Karte entprellt neu", () => {
    expect(view).toMatch(/this\.register\(this\.deps\.onTodayChange\(\(\) => \{[^}]*this\.reload\?\.\(\)/);
  });

  it("I2) Schalter der Briefing-Karte lösen das Neuladen aus: Merker briefingLoadKey statt nur briefingsDir", () => {
    expect(view).toMatch(/onSettingsChange\(\(s\) => \{\s*if \(briefingLoadKey\(s\) !== this\.loadedKey\) this\.reload\?\.\(\);/);
    expect(view).toMatch(/this\.loadedKey = briefingLoadKey\(/);
    expect(view).not.toMatch(/loadedDir/);
  });

  it("M7) der Zeiger-Cursor greift auch für die Checkbox im Absatz einer lockeren Liste", () => {
    const css = readFileSync(join(ROOT, "src/styles.css"), "utf8");
    const rule = css.match(/([^{}]*)\{\s*cursor: pointer;\s*\}[^{}]*\.cockpit-briefing-point\.cockpit-briefing-done/)?.[1] ?? "";
    expect(rule).toMatch(/\.cockpit-briefing-point > input\[type="checkbox"\]:not\(:disabled\)/);
    expect(rule).toMatch(/\.cockpit-briefing-point > p > input\[type="checkbox"\]:not\(:disabled\)/);
  });

  it("I2) die Karte „Heute“ nutzt dieselbe Bedingung todayBriefingPath", () => {
    const card = readFileSync(join(ROOT, "src/host/tasks-card.ts"), "utf8");
    expect(card).toMatch(/const path = todayBriefingPath\(s, today\);/);
    expect(card).not.toMatch(/!s\.todayBriefing \|\|/);
  });

  it("e) kein Schreibweg im Dashboard und in der Checkbox-Zuordnung", () => {
    for (const src of [view, checks]) expect(src).not.toMatch(/vault\.process|vault\.modify|vault\.create|adapter\.write/);
    expect(checks).not.toMatch(/\bvault\b|from "obsidian"/);
  });
});

// Das Dashboard ist eine Flex-Spalte mit fester Höhe, die Karten schneiden mit overflow: hidden ab. Dürften sie
// schrumpfen, stauchte langer Inhalt alle Karten auf Fensterhöhe und schnitt ihr Ende ab, statt die Seite scrollen zu lassen.
describe("Dashboard-Karten schrumpfen nicht", () => {
  const css = readFileSync(join(ROOT, "src/styles.css"), "utf8");
  const block = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/\./g, "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";

  it(".cockpit-card hat flex-shrink 0", () => {
    expect(block(".cockpit-card")).toMatch(/overflow:\s*hidden/);
    expect(block(".cockpit-card")).toMatch(/flex-shrink:\s*0|flex:\s*none/);
  });
});
