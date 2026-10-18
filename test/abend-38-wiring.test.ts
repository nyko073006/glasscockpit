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

/** Quelltext ohne Kommentare: Erwähnungen in Doku zählen nicht. */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// Abend 38: Pfade mit Leerzeichen. Was nur in Obsidian läuft (Cmd+Klick auf einen echten Pfad im Terminal), prüft die Abnahme; hier
// die Verkabelung: Ordnerprüfung und Einstellung kommen in den Provider, die Einstellung wird bei jeder Abfrage gelesen, die
// Verlängerung sucht nie in Claudes Ordnern, und ohne die Einstellung bleibt es bei den Durchläufen von vor Abend 38.
describe("Abend 38: Pfade mit Leerzeichen verkabelt", () => {
  const source = read("src/host/file-links.ts");

  it("TerminalView gibt dem FileLinkProvider die Ordnerprüfung und die Einstellung, die Einstellung als Funktion", () => {
    const view = read("src/host/terminal-view.ts");
    const start = view.indexOf("new FileLinkProvider(");
    expect(start).toBeGreaterThanOrEqual(0);
    const block = code(view.slice(start, view.indexOf("\n    );", start)));
    expect(block).toMatch(/isDir: isDirSync,/);
    expect(block).toMatch(/spaces: \(\) => this\.deps\.settings\(\)\.fileLinksSpaces,/);
    expect(view).toMatch(/import \{ isDirSync, isFileSync \} from "\.\/file-viewer-fs";/);
  });

  it("der Provider liest die Einstellung in provideLinks (nicht im Konstruktor) und wählt daraus die Durchläufe", () => {
    const provide = code(method(source, "provideLinks(y: number"));
    expect(provide).toMatch(/const spaces = this\.deps\.spaces\(\);/);
    // Aus: genau die beiden Durchläufe von vor Abend 38.
    expect(provide).toMatch(/: \[logicalLine\(y, row, true\), logicalLine\(y, row\)\];/);
    expect(provide).toMatch(/\? \[wordLine\(y, row\), wordLine\(y, row, true\), logicalLine\(y, row\)\]/);
    expect(provide).toMatch(/const mode: SpaceMode \| null = spaces \? \{ y, budget: new ProbeBudget\(MAX_PATH_PROBES\) \} : null;/);
    expect(code(method(source, "constructor("))).not.toMatch(/spaces/);
  });

  it("ohne Einstellung gibt es weder Anführungs-Kandidaten noch Verlängerung noch Ordnerprüfung", () => {
    const collect = code(method(source, "private collect("));
    expect(collect).toMatch(/const candidates = mode \? candidatesWithQuotes\(line\.text\) : pathCandidates\(line\.text\)\.slice\(0, MAX_CANDIDATES\);/);
    expect(collect).toMatch(/if \(mode\) this\.extend\(line, links, mode\);/);
    expect(source.split("this.deps.isDir").length - 1).toBe(1); // nur in extend
  });

  it("die Verlängerung sucht nur im Startordner, nie in Claudes Ordnern (bekannte Grenze)", () => {
    const extend = code(method(source, "private extend("));
    expect(extend).not.toMatch(/bases|getBases|claudeDirs/);
    expect(extend).toMatch(/cwd: this\.deps\.cwd\(\),/);
  });

  it("Einstellungsseite: Schalter im Abschnitt Terminal, zwischen fileLinksClaudeDirs und clearLink, Wirkung sofort", () => {
    const tab = read("src/host/settings-tab.ts");
    const field = '"fileLinksSpaces", "Pfade mit Leerzeichen erkennen"';
    const at = tab.indexOf(field);
    expect(at).toBeGreaterThan(tab.indexOf('"fileLinksClaudeDirs", "Relative Pfade auch in Claudes Ordnern suchen"'));
    expect(at).toBeLessThan(tab.indexOf('"clearLink", "/clear per Klick einfügen"'));
    expect(at).toBeLessThan(tab.indexOf('this.group("Benachrichtigung", ['));
    expect(tab).toContain("Wirkt sofort.");
  });

  it("die Hülle aus Abend 37 bleibt die einzige Anmeldung bei xterm: kein neuer Provider, kein neuer Weg", () => {
    const view = code(read("src/host/terminal-view.ts"));
    expect(view.split("registerLinkProvider(").length - 1).toBe(2);
    expect(code(read("src/host/terminal-pane.ts")).split("this.term.registerLinkProvider(").length - 1).toBe(1);
  });
});
