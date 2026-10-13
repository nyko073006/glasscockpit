import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** Text ohne Kommentare, damit Hinweise in Kommentaren keine Treffer erzeugen. */
const ohneKommentare = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Rumpf einer Klassenmethode: von der Signatur bis zur schließenden Klammer in Spalte 2. */
function methode(text: string, signatur: string): string {
  const start = text.indexOf(signatur);
  if (start === -1) throw new Error(`Methode nicht gefunden: ${signatur}`);
  const ende = text.indexOf("\n  }\n", start);
  return text.slice(start, ende === -1 ? undefined : ende);
}

describe("Abend 19b Handoff-Knopf: Verdrahtung (Host nur per Textprüfung, echte Wirkung prüft die Abnahme in Obsidian)", () => {
  const view = src("src/host/terminal-view.ts");
  const bar = src("src/host/code-block-bar.ts");
  const reader = src("src/host/transcript-reader.ts");
  const main = src("src/main.ts");
  const tab = src("src/host/settings-tab.ts");
  const css = src("src/styles.css");

  it("der Wert hängt an der Cockpit-id: die View schreibt und liest ihn über this.sessionId, nie über Claude-ID oder Leser-ID", () => {
    expect(view).toMatch(/this\.deps\.handoffs\.keep\(this\.sessionId, result\.handoff\)/);
    expect(view).toMatch(/const id = this\.sessionId;[^}]*this\.deps\.handoffs\.get\(id\)/);
    expect(view).not.toMatch(/handoffs\.(keep|get)\(\s*(this\.)?(readerId|claudeId|claudeSessionId)/);
    expect(view).not.toMatch(/handoffs\.(keep|get)\([^)]*claudeIdOf/);
  });

  it("jeder neue Stand geht durch applyResult: Poll und Command „Letzten Codeblock kopieren“", () => {
    // Abend 28: dazu die Prüfung beim Antwortende (doneAfterCheck), die frisch liest.
    expect(view.match(/this\.applyResult\(result\)/g)).toHaveLength(3);
    expect(methode(view, "private async pollTranscript()")).toMatch(/result\.changed\) this\.applyResult\(result\)/);
    expect(methode(view, "async copyLastCodeBlock()")).toMatch(/this\.applyResult\(result\)/);
    expect(methode(view, "private async doneAfterCheck()")).toMatch(/this\.applyResult\(result\)/);
    // Die Leiste wird nirgends mehr ohne den Handoff gesetzt.
    expect(ohneKommentare(view).match(/this\.bar\?\.set\(/g)).toHaveLength(1);
  });

  it("ein Sitzungswechsel lässt den Wert stehen: syncReader zeichnet nur neu und fasst den Keeper nicht an", () => {
    const sync = methode(view, "private syncReader(): void {");
    expect(sync).toMatch(/this\.renderBar\(\[\]\)/);
    expect(sync).not.toMatch(/handoffs|keep\(|forget/);
  });

  it("verlässt die View die Sitzung (leave), wird die Leiste ganz versteckt, sonst bliebe der Knopf einer fremden Sitzung stehen", () => {
    expect(methode(view, "private leave(): void {")).toMatch(/this\.barBlocks = \[\];\s*this\.bar\?\.clear\(\);/);
  });

  it("ein gemerkter Handoff steht beim Verbinden sofort da, nicht erst mit dem ersten Poll", () => {
    expect(view).toMatch(/this\.readerId = claudeId;\s*(\/\/[^\n]*\n\s*)*this\.renderBar\(\[\]\);\s*this\.startPoll\(\);/);
  });

  it("ein leeres Präfix schaltet den Knopf aus: beim Zeichnen geprüft, und eine Einstellungsänderung zeichnet sofort neu (nur mit Leser)", () => {
    expect(view).toMatch(/const on = this\.deps\.settings\(\)\.handoffPrefix\.trim\(\) !== "";\s*this\.bar\?\.set\(blocks, on && id !== null \? this\.deps\.handoffs\.get\(id\) : null\);/);
    expect(view).toMatch(/onSettingsChange\(\(\) => \{\s*this\.pane\?\.applyOptions\(this\.terminalOptions\(\)\);\s*if \(this\.reader\) this\.renderBar\(\);\s*(this\.updateOpenTasks\(\);\s*this\.refreshTitle\(\);\s*)?\}\)/);
  });

  it("Rechnen nur im vorhandenen Poll: das Präfix kommt pro Aufruf frisch, der Leser rechnet auf dem gelesenen Text und öffnet die Datei nicht noch einmal", () => {
    // Drei Leser mit frischem Präfix: Poll, Command „Letzten Codeblock kopieren“ und (Abend 28) die Prüfung beim Antwortende.
    expect(view.match(/read\((true|false), this\.deps\.settings\(\)\.handoffPrefix\)/g)).toHaveLength(3);
    expect(reader).toMatch(/const answer = lastAnswerText\(text\);[\s\S]*lastHandoffBlock\(text, handoffPrefix\)/);
    expect(reader.match(/this\.readTail\(/g)).toHaveLength(1);
    // Der Dateiaufruf open(path, "r"); ein Methodenaufruf wie this.tasks.open(…) (Abend 28) öffnet keine Datei.
    expect(ohneKommentare(reader).match(/(?<![.\w])open\(/g)).toHaveLength(1);
    // Kein neuer Timer in der View: der Poll-Takt ist der eine, der schon da war.
    expect(ohneKommentare(view).match(/setInterval/g)).toHaveLength(1);
    expect(ohneKommentare(view)).not.toMatch(/setTimeout\([^)]*[Hh]andoff/);
  });

  it("Tooltip-Konvention (101ba13, 01d67bd): jeder Knopf der Leiste trägt genau einen Tooltip, Obsidians aria-label, nie zusätzlich title", () => {
    const code = ohneKommentare(bar);
    expect(code).toMatch(/attr: \{ "aria-label": item\.tooltip \}/);
    expect(code).not.toMatch(/\btitle\b/);
  });

  it("die Leiste nimmt Auswahl und Reihenfolge aus barItems (core); der feste Knopf hat seine Klasse; der Kommentar nennt die Leiste über der Pane", () => {
    const code = ohneKommentare(bar);
    expect(code).toMatch(/barItems\(blocks, handoff\)/);
    expect(code).toMatch(/item\.kind === "handoff"\)\s*cls\.push\(`\$\{CSS_PREFIX\}code-button-handoff`\)/);
    expect(bar).not.toMatch(/unter der Pane/);
    expect(bar).toMatch(/über der Pane/);
  });

  it("das Plugin hält genau einen HandoffKeeper und reicht ihn an die Views; er wird nicht beim Beenden oder Neustart verworfen", () => {
    expect(main.match(/new HandoffKeeper\(\)/g)).toHaveLength(1);
    expect(main).toMatch(/handoffs: this\.handoffs,/);
    expect(ohneKommentare(main)).not.toMatch(/handoffs\.(forget|delete|clear)/);
  });

  it("Einstellung: ein Textfeld im Abschnitt „Terminal“ der Seite", () => {
    const marker = 'this.group("Terminal", [';
    const start = tab.indexOf(marker);
    const ende = tab.indexOf('this.group("', start + marker.length);
    expect(start).toBeGreaterThan(-1);
    expect(tab.slice(start, ende)).toMatch(/this\.textField\(\s*"handoffPrefix"/);
  });

  it("CSS: der feste Knopf hat eine eigene Klasse, die vor -last steht (die Akzentfläche des letzten Blocks gewinnt)", () => {
    const handoff = css.indexOf(".cockpit-code-button-handoff {");
    const last = css.indexOf(".cockpit-code-button-last {");
    expect(handoff).toBeGreaterThan(-1);
    expect(last).toBeGreaterThan(handoff);
  });
});
