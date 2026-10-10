import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

describe("Abend 18 Signale: Verdrahtung (Host nur per Textprüfung, echte Wirkung prüft die Abnahme)", () => {
  const view = src("src/host/terminal-view.ts");
  const main = src("src/main.ts");
  it("die View liest alle cockpit:-Signale über parseSignal", () => {
    expect(view).toMatch(/parseSignal\(data\)/);
    expect(view).not.toMatch(/parseAttention\(/);
  });
  it("eine Frage, während die Sitzung schon auf Antwort wartet, meldet nichts (vor activity, Telegram, Ton, Banner)", () => {
    expect(view).toMatch(/private onAttention\(signal: AttentionSignal\): void \{\s*if \(this\.sessionId !== null && repeatsQuestion\(this\.deps\.activity\.lastSignal\(this\.sessionId\), signal\)\) return;/);
    expect(main).toMatch(/lastSignal: \(sessionId\) => this\.activity\.get\(sessionId\)\?\.signal/);
  });
  it("busy löst keine Benachrichtigung aus: onAttention bekommt nur done und question", () => {
    expect(view).toMatch(/parsed\.signal === "busy"\)\s*\{\s*if \(this\.sessionId !== null\) this\.deps\.activity\.record\(this\.sessionId, "busy"\);\s*\}\s*else\s*\{\s*this\.onAttention\(parsed\.signal\)/);
  });
  it("Sitzungswechsel: Eintrag speichern, Leser folgt der Claude-ID bei jeder Änderung des Eintrags", () => {
    expect(view).toMatch(/this\.deps\.adoptClaudeId\(id, next\)/);
    expect(view).toMatch(/this\.refreshTitle\(\);\s*this\.syncReader\(\);/);
    // Abend 19b: statt bar.clear() zeichnet renderBar([]) die Leiste ohne die alten Blöcke, der feste Handoff-Knopf bleibt.
    expect(view).toMatch(/this\.reader = new TranscriptReader\(next\);\s*this\.readerId = next;\s*this\.renderBar\(\[\]\);/);
    expect(main).toMatch(/adoptClaudeId: \(sessionId, claudeId\) => store\.setClaudeSessionId\(sessionId, claudeId\)/);
  });
  it("angesehen: überall, wo die Markierung fällt", () => {
    expect(view).toMatch(/private clearAttention\(\): void \{[^}]*activity\.markSeen\(this\.sessionId\)/);
  });
  it("das Plugin hält eine SessionActivity und stellt radarInputs bereit", () => {
    expect(main).toMatch(/private readonly activity = new SessionActivity\(\)/);
    expect(main).toMatch(/radarInputs\(\): RadarInput\[\]/);
  });
});
