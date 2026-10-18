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

// Abend 37: Hülle um jeden Link-Provider. Was nur in Obsidian läuft (echter Druck, Loslassen über einem Link), prüft die
// Abnahme; hier die Verkabelung: jeder Provider läuft durch die Hülle, die Druckverfolgung hängt an .xterm-screen (Rückfall Host) und endet im dispose.
describe("Abend 37: Link-Hülle verkabelt", () => {
  const pane = read("src/host/terminal-pane.ts");
  const paneCode = code(pane);

  it("TerminalPane meldet xterm nur Provider in der Hülle an, und zwar genau einmal", () => {
    expect(paneCode.split("this.term.registerLinkProvider(").length - 1).toBe(1);
    expect(paneCode).toContain("this.term.registerLinkProvider(guardLinkProvider(provider,");
    expect(paneCode).toMatch(/guardLinkProvider\(provider, \(\) => this\.presses\.active\(\)\)/);
  });

  it("die Druckverfolgung hängt nach term.open an .xterm-screen (Rückfall Host) und ist über dasselbe PressGuard-Objekt mit der Hülle verbunden", () => {
    const open = paneCode.indexOf("this.term.open(this.host)");
    const track = paneCode.search(/(?<![A-Za-z])trackPresses\(/);
    expect(open).toBeGreaterThanOrEqual(0);
    expect(track).toBeGreaterThan(open);
    // Nur dort setzt xterm _mouseDownLink; der Host ist größer (Randstreifen unten und rechts), ein Druck dort schaltete scharf.
    expect(paneCode).toMatch(
      /this\.untrackPresses = trackPresses\(\s*this\.host\.querySelector<HTMLElement>\("\.xterm-screen"\) \?\? this\.host,\s*this\.presses,?\s*\);/,
    );
    expect(paneCode.match(/(?<![A-Za-z])trackPresses\(/g)).toHaveLength(1);
    expect(paneCode).toMatch(/private readonly presses = new PressGuard\(\);/);
    expect(paneCode).toMatch(/private readonly untrackPresses: \(\) => void;/);
  });

  it("dispose meldet die Druckverfolgung vor term.dispose ab", () => {
    const body = code(method(pane, "dispose(): void"));
    const untrack = body.indexOf("this.untrackPresses()");
    expect(untrack).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("this.term.dispose()")).toBeGreaterThan(untrack);
  });

  it("setModifier geht an den Original-Provider, nicht an die Hülle", () => {
    const body = code(method(pane, "registerLinkProvider("));
    expect(body).toMatch(/const onKey = \(event: KeyboardEvent\): void => provider\.setModifier\?\.\(event\.metaKey\);/);
  });

  it("die View meldet Provider nur über die Pane an, nie direkt an xterm", () => {
    const view = code(read("src/host/terminal-view.ts"));
    expect(view).toContain("pane.registerLinkProvider(");
    expect(view).not.toMatch(/term\.registerLinkProvider\(/);
    // Ein Wächter, der keinen Anmeldeweg sähe, wäre vakuum: es gibt genau zwei Provider (Pfade, /clear).
    expect(view.split("registerLinkProvider(").length - 1).toBe(2);
  });

  it("kein anderer Ort in src/ meldet bei xterm einen Link-Provider an", () => {
    const hosts = ["src/host/terminal-view.ts", "src/host/terminal-input.ts", "src/host/file-links.ts", "src/host/clear-link.ts"];
    for (const file of hosts) expect(code(read(file)), file).not.toMatch(/term\.registerLinkProvider\(/);
  });
});
