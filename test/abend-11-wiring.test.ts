import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

function allSources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? allSources(`${dir}/${e.name}`) : e.name.endsWith(".ts") ? [`${dir}/${e.name}`] : [],
  );
}

describe("Abend 11: Verdrahtung", () => {
  it("Schriftgröße und Scrollback liest nichts mehr aus den alten Konstanten", () => {
    for (const file of allSources("src")) {
      const text = src(file);
      expect(text, file).not.toMatch(/TERMINAL_FONT_SIZE|TERMINAL_SCROLLBACK/);
    }
  });

  it("das Terminal bekommt Schriftgröße und Scrollback aus den Einstellungen und hört auf Änderungen", () => {
    const view = src("src/host/terminal-view.ts");
    expect(view).toMatch(/onSettingsChange/);
    expect(view).toMatch(/applyOptions\(/);
    expect(src("src/main.ts")).toMatch(/onSettingsChange:\s*\(cb\)\s*=>\s*store\.onSettingsChange\(cb\)/);
  });

  it("Transkript-Leser, Transkript-Prüfung und Tab-Titel nehmen die Claude-ID, nie die Cockpit-ID", () => {
    const view = src("src/host/terminal-view.ts");
    expect(view).not.toMatch(/new TranscriptReader\(\s*(this\.)?sessionId/);
    expect(view).not.toMatch(/new TranscriptReader\(\s*id\b/);
    expect(view).toMatch(/new TranscriptReader\(claudeId\)/);
    expect(view).toMatch(/claudeIdOf\(/);
    expect(view).not.toMatch(/tabTitle\(record\.name,\s*this\.sessionId\)/);
    expect(view).not.toMatch(/headerTitle\(record\.name,\s*id,/);
    const launcher = src("src/host/launcher.ts");
    expect(launcher).not.toMatch(/transcriptExists\(\s*record\.id/);
    expect(launcher).not.toMatch(/sessionId:\s*record\.id/);
    expect(launcher).toMatch(/claudeIdOf\(record\)/);
  });

  it("Kill nutzt die Eskalation: der Manager übergibt Timer des Fensters, nicht registerInterval", () => {
    const main = src("src/main.ts");
    expect(main).toMatch(/new SessionManager\([\s\S]*?timers:\s*\{[^}]*window\.setTimeout/);
    const manager = src("src/core/session-manager.ts");
    expect(manager).toMatch(/escalateKill\(/);
    expect(manager).not.toMatch(/pty\.kill\(\)/);
  });

  it("Sitzung frisch starten: Command vorhanden, nur für Claude-Sitzungen", () => {
    const main = src("src/main.ts");
    expect(main).toMatch(/id:\s*"restart-fresh"/);
    expect(main).toMatch(/Nur für Claude-Sitzungen/);
  });

  it("Limit-Platz: jeder Fehlweg in planFor gibt ihn frei, der Erfolgsweg reicht ihn an die View weiter", () => {
    const main = src("src/main.ts");
    const body = main.slice(main.indexOf("this.slots.reserve("), main.indexOf("release: reservation.release"));
    expect(body).toMatch(/catch \(fehler\) \{\s*reservation\.release\(\);/);
    expect(body).toMatch(/if \(!plan\.ok\) \{\s*reservation\.release\(\);/);
    expect(main).toMatch(/return \{ \.\.\.plan, release: reservation\.release \}/);
  });

  it("Neu starten setzt die Startart restart samt fresh, bevor die Views neu anhängen", () => {
    const main = src("src/main.ts");
    const body = main.slice(main.indexOf("private async restartSession("), main.indexOf("view.reconnect()"));
    expect(body).toMatch(/this\.pendingStart\.set\(id, \{ startKind: "restart", fresh \}\)/);
  });

  it("die Pane misst Obsidians Statusleiste, nicht irgendein .status-bar (Agentic OS hat eins)", () => {
    const pane = src("src/host/terminal-pane.ts");
    expect(pane).toMatch(/querySelector\(OBSIDIAN_STATUS_BAR\)/);
    expect(pane).not.toMatch(/querySelector\(\s*["'`]\.status-bar["'`]\s*\)/);
  });
});
