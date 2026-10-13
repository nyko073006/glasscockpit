import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

/** Rumpf einer Klassenmethode: ab der Signatur bis zur schließenden Klammer in der Einrückung der Klasse (zwei Leerzeichen). */
function method(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `Methode ${signature} fehlt`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n  }\n", start);
  expect(end, `Ende von ${signature} nicht gefunden`).toBeGreaterThan(start);
  return source.slice(start, end);
}

const count = (text: string, part: string): number => text.split(part).length - 1;

// Abend 28: Stille Zwischenstände. Was nur in Obsidian läuft (Tab-Titel, Telegram, Ton, Banner), prüft die Abnahme; hier nur
// die Verkabelung, damit keine Meldung an der Prüfung vorbeigeht.
describe("Abend 28: Stille Zwischenstände verkabelt", () => {
  const view = read("src/host/terminal-view.ts");

  it("onAttention schickt nur ein done mit eingeschaltetem quietWhileAgents und vorhandenem Leser durch doneAfterCheck, alles andere direkt in notifyAttention", () => {
    const body = method(view, "private onAttention(");
    expect(body).toMatch(/if \(\s*signal === "done" && this\.deps\.settings\(\)\.quietWhileAgents && this\.reader\s*\) \{\s*void this\.doneAfterCheck\(\);\s*return;\s*\}/);
    expect(body).toMatch(/this\.notifyAttention\(signal\);/);
    // Der einzige Aufruf von außen: sonst käme eine Frage oder ein ausgeschalteter Schalter an der Prüfung vorbei.
    expect(count(view, "this.doneAfterCheck(")).toBe(1);
    expect(body).not.toMatch(/telegram|playSound|showBanner|setAttention/);
  });

  it("signalAttention (Diff-Ansicht, Frage) bleibt unverändert und geht über onAttention", () => {
    expect(method(view, "signalAttention(signal: AttentionSignal): void {")).toMatch(/this\.onAttention\(signal\);/);
  });

  it("doneAfterCheck liest frisch, rechnet doneIsQuiet vor dem einzigen notifyAttention und kennt kein Telegram", () => {
    const body = method(view, "private async doneAfterCheck(");
    expect(body).toMatch(/await reader\.read\(true, this\.deps\.settings\(\)\.handoffPrefix\)/);
    expect(body).toMatch(/if \(this\.reader === reader\)/);
    expect(body).toMatch(/this\.updateOpenTasks\(\)/);
    expect(body).toMatch(/doneIsQuiet\("done", this\.deps\.settings\(\)\.quietWhileAgents, this\.openTasks\)/);
    expect(count(body, "notifyAttention(")).toBe(1);
    expect(body.indexOf("doneIsQuiet(")).toBeGreaterThan(0);
    expect(body.indexOf("doneIsQuiet(")).toBeLessThan(body.indexOf("this.notifyAttention("));
    // Still heißt: nur die Lampe bleibt auf „arbeitet“, dann Schluss vor notifyAttention.
    expect(body).toMatch(/if \(quiet\) \{\s*if \(this\.sessionId !== null\) this\.deps\.activity\.record\(this\.sessionId, "busy"\);\s*return;\s*\}/);
    expect(body.indexOf("if (quiet)")).toBeLessThan(body.indexOf("this.notifyAttention("));
    expect(body).not.toMatch(/telegram/i);
    expect(body).not.toMatch(/markSeen|playSound|showBanner|setAttention/);
  });

  it("ein Lesefehler wird gemeldet statt verschluckt: catch ohne Rückkehr, danach läuft notifyAttention", () => {
    const body = method(view, "private async doneAfterCheck(");
    const fehler = body.slice(body.indexOf("catch"), body.indexOf("if (quiet)"));
    expect(fehler).toMatch(/console\.error\(/);
    expect(fehler).not.toMatch(/return/);
    expect(fehler).not.toMatch(/quiet = true/);
  });

  it("deps.telegram steht nur in notifyAttention", () => {
    expect(count(view, "deps.telegram")).toBe(1);
    const body = method(view, "private notifyAttention(");
    expect(body).toMatch(/this\.deps\.telegram\(this\.sessionId, signal\)/);
    expect(body.indexOf("repeatsQuestion(")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("repeatsQuestion(")).toBeLessThan(body.indexOf("deps.telegram"));
  });

  it("notifyAttention behält alles, was onAttention vorher tat: Frage-Entprellung, Markierung, Ton, Banner", () => {
    const body = method(view, "private notifyAttention(");
    for (const teil of ["repeatsQuestion(", "react({", "this.deps.activity.record(this.sessionId, signal)", "markSeen", "this.setAttention(signal)", "playSound(", "showBanner(", "this.deps.alertGate("]) {
      expect(body, teil).toContain(teil);
    }
  });

  it("pollTranscript rechnet updateOpenTasks nach jedem Poll, auch ohne neuen Stand und nach einem Lesefehler (finally), nur für den aktuellen Leser", () => {
    const body = method(view, "private async pollTranscript(");
    expect(body).toMatch(/if \(this\.reader === reader && result\.changed\) this\.applyResult\(result\);\s*\} finally \{\s*(\/\/[^\n]*\s*)*if \(this\.reader === reader\) this\.updateOpenTasks\(\);/);
  });

  it("updateOpenTasks fragt den aktuellen Leser mit Jetzt und Höchstalter in Minuten und frischt den Titel nur bei Änderung auf", () => {
    const body = method(view, "private updateOpenTasks(");
    expect(body).toMatch(/this\.reader\?\.openTasks\(Date\.now\(\), this\.deps\.settings\(\)\.quietMaxAgeMin \* 60_000\) \?\? 0/);
    expect(body).toMatch(/if \(open === this\.openTasks\) return;/);
    expect(body).toMatch(/this\.openTasks = open;\s*this\.refreshTitle\(\);/);
  });

  it("leave und syncReader setzen die Zahl zurück", () => {
    expect(method(view, "private leave(")).toMatch(/this\.resetOpenTasks\(\)/);
    expect(method(view, "private syncReader(")).toMatch(/this\.resetOpenTasks\(\)/);
    expect(method(view, "private resetOpenTasks(")).toMatch(/this\.openTasks = 0;\s*this\.refreshTitle\(\);/);
  });

  it("getDisplayText zeigt die Zahl nur mit showOpenTasks, in beiden Zweigen", () => {
    const body = method(view, "getDisplayText(): string {");
    expect(body).toMatch(/const open = this\.deps\.settings\(\)\.showOpenTasks \? this\.openTasks : 0;/);
    expect(count(body, "this.attention, open)")).toBe(2);
  });

  it("eine Änderung der Einstellungen frischt Zahl und Titel auf", () => {
    const start = view.indexOf("this.unbindSettings = this.deps.onSettingsChange(");
    expect(start).toBeGreaterThan(0);
    const block = view.slice(start, view.indexOf("});", start));
    expect(block).toMatch(/this\.updateOpenTasks\(\);/);
    expect(block).toMatch(/this\.refreshTitle\(\);/);
  });

  it("die View nimmt doneIsQuiet aus der Logik in core", () => {
    expect(view).toMatch(/import \{[^}]*\bdoneIsQuiet\b[^}]*\} from "\.\.\/core\/attention"/);
  });
});

describe("Abend 28: Leser und Einstellungen verkabelt", () => {
  it("TranscriptReader merged die Aufgaben auf dem ohnehin gelesenen Text, ohne zweites Lesen", () => {
    const reader = read("src/host/transcript-reader.ts");
    expect(reader).toMatch(/this\.tasks\.merge\(scanBackgroundTasks\(text\)\)/);
    expect(count(reader, "readTail(")).toBe(2); // Aufruf und Definition
  });

  it("Einstellungsseite: drei Felder im Abschnitt Benachrichtigung, direkt nach notifyOnQuestion", () => {
    const tab = read("src/host/settings-tab.ts");
    const felder = [
      '"notifyOnQuestion", "Wenn eine Sitzung eine Frage hat"',
      '"quietWhileAgents", "Zwischenstände bei laufenden Agents nicht melden"',
      '"quietMaxAgeMin", "Höchstalter einer Hintergrundaufgabe (Minuten)"',
      '"showOpenTasks", "Laufende Hintergrundaufgaben im Tab zeigen (⏳)"',
      '"markTab", "Markierung am Tab"',
    ];
    const orte = felder.map((f) => tab.indexOf(f));
    orte.forEach((ort, i) => expect(ort, felder[i]).toBeGreaterThan(tab.indexOf('this.group("Benachrichtigung", [')));
    for (let i = 1; i < orte.length; i++) expect(orte[i], felder[i]).toBeGreaterThan(orte[i - 1]);
    expect(orte[orte.length - 1]).toBeLessThan(tab.indexOf('this.group("Telegram", ['));
  });
});
