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

// Abend 35: Klick auf /clear. Was nur in Obsidian läuft (Hover, echter Klick, Enter in Claude), prüft die Abnahme; hier die
// Verkabelung: richtige Sitzung, Reihenfolge der Provider, Einstellung, Abmeldung.
describe("Abend 35: Klick auf /clear verkabelt", () => {
  const view = read("src/host/terminal-view.ts");
  const start = view.indexOf("new ClearLinkProvider(");
  /** Der Provider-Block: vom Konstruktor bis zur Klammer, die registerLinkProvider schließt. */
  const block = view.slice(start, view.indexOf("\n    );", start)).replace(/\/\/.*$/gm, "");

  it("der ClearLinkProvider wird NACH dem FileLinkProvider registriert (bei Überlappung gewinnt der frühere)", () => {
    const file = view.indexOf("new FileLinkProvider(");
    expect(file).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThan(file);
    // Nur zwei Provider, keiner dazwischen.
    expect(view.split("registerLinkProvider(").length - 1).toBe(2);
  });

  it("der Klick schreibt über das SessionHandle dieser View und fokussiert, nie über das Ziel der jüngsten Sitzung (Kommentare zählen nicht)", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toMatch(/insert: \(\) => \{\s*this\.handle\?\.write\(CLEAR_INSERT\);\s*this\.pane\?\.focus\(\);\s*\}/);
    expect(block).not.toMatch(/sendToActive|deliver/);
    expect(view).toMatch(/import \{ CLEAR_INSERT \} from "\.\.\/core\/clear-link";/);
  });

  it("enabled liest die Einstellung frisch, verlangt eine Sitzung und schließt Shell aus", () => {
    // Alles innerhalb der Funktion, nicht beim Anlegen des Providers gelesen.
    expect(block).toMatch(/enabled: \(\) => \{[\s\S]*?return this\.deps\.settings\(\)\.clearLink && kind !== undefined && kind !== "shell";\s*\}/);
    expect(block).toMatch(/const kind = this\.sessionId \? this\.deps\.record\(this\.sessionId\)\?\.kind : undefined;/);
    expect(block).toMatch(/hasSelection: \(\) => pane\.hasSelection\(\)/);
    expect(block).toMatch(/row: \(y\) => pane\.bufferRow\(y\)/);
  });

  it("onClose löst den Provider wie den der Pfade", () => {
    const body = method(view, "async onClose()");
    expect(body).toMatch(/this\.unbindClearLink\?\.\(\);\s*this\.unbindClearLink = null;/);
    expect(view).toMatch(/private unbindClearLink: \(\(\) => void\) \| null = null;/);
    expect(view).toMatch(/this\.unbindClearLink = pane\.registerLinkProvider\(/);
  });

  it("TerminalPane.hasSelection fragt xterm", () => {
    const pane = read("src/host/terminal-pane.ts");
    expect(pane).toMatch(/hasSelection\(\): boolean \{\s*return !this\.disposed && this\.term\.hasSelection\(\);\s*\}/);
  });

  it("Einstellungsseite: Schalter im Abschnitt Terminal, direkt unter fileLinksClaudeDirs", () => {
    const tab = read("src/host/settings-tab.ts");
    const field = '"clearLink", "/clear per Klick einfügen"';
    const at = tab.indexOf(field);
    expect(at).toBeGreaterThan(tab.indexOf('"fileLinksClaudeDirs", "Relative Pfade auch in Claudes Ordnern suchen"'));
    expect(at).toBeLessThan(tab.indexOf('"fileViewerMaxMb", "Datei-Viewer: Höchstgröße (MB)"'));
    expect(at).toBeLessThan(tab.indexOf('this.group("Benachrichtigung", ['));
    expect(tab).toContain("Ein Klick auf /clear im Terminal einer Claude-Sitzung schreibt es in die Eingabezeile. Enter drückst du selbst.");
  });
});
