import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "../src/core/settings";
import { ROOT } from "./helpers/files";

const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

// Abend 32: Code-Editor im Datei-Viewer. Farben, Vorschläge und Esc prüft test/code-editor.test.ts mit echtem CodeMirror;
// hier Einstellung und Verkabelung. Das Fenster selbst läuft nur in Obsidian (Abnahme).
describe("Abend 32: Code-Editor verkabelt", () => {
  it("Einstellung fileViewerAutocomplete: Vorgabe an, nur Wahrheitswerte", () => {
    expect(DEFAULT_SETTINGS.fileViewerAutocomplete).toBe(true);
    expect(parseSettings({ fileViewerAutocomplete: false }).settings.fileViewerAutocomplete).toBe(false);
    const r = parseSettings({ fileViewerAutocomplete: "ja" });
    expect([...r.invalid]).toEqual(["fileViewerAutocomplete"]);
    expect(r.settings.fileViewerAutocomplete).toBe(true);
  });

  it("Einstellungsseite: Schalter im Abschnitt Terminal, direkt unter der Höchstgröße", () => {
    const tab = read("src/host/settings-tab.ts");
    const at = tab.indexOf('"fileViewerAutocomplete", "Datei-Viewer: Vorschläge beim Tippen"');
    expect(at).toBeGreaterThan(tab.indexOf('"fileViewerMaxMb", "Datei-Viewer: Höchstgröße (MB)"'));
    expect(at).toBeLessThan(tab.indexOf('this.group("Benachrichtigung", ['));
  });

  it("main: Fenster bekommt die Einstellung beim Öffnen", () => {
    expect(read("src/main.ts")).toMatch(
      /new FileViewerModal\(this\.app, t, \{ maxMb: store\.settings\(\)\.fileViewerMaxMb, autocomplete: store\.settings\(\)\.fileViewerAutocomplete, home: homedir\(\), onClosed: refocus \}\)/,
    );
  });

  it("Fenster: Module einmal laden, Erweiterungen und Esc-Wächter mit denselben Modulen", () => {
    const modal = read("src/host/file-viewer-modal.ts");
    expect(modal).toMatch(/const mods = loadCodeModules\(\);/);
    expect(modal).toMatch(/\.\.\.codeExtensions\(this\.target\.path, \{ autocomplete: this\.options\.autocomplete \}, mods\)/);
    expect(modal).toMatch(/this\.esc = new EscGuard\(this\.modalEl, this\.view, mods\);/);
  });

  it("close(): erst Rückfrage-Sperre, dann Esc-Wächter, dann ungespeicherte Änderungen", () => {
    expect(read("src/host/file-viewer-modal.ts")).toMatch(
      /close\(\): void \{\s*if \(this\.asking\) return;\s*if \(this\.esc\?\.consume\(\)\) return;\s*if \(!this\.dirty \|\| this\.discard\)/,
    );
  });

  it("onClose: Wächter ab, bevor der Editor zerstört wird", () => {
    const modal = read("src/host/file-viewer-modal.ts");
    const rest = modal.slice(modal.indexOf("export class FileViewerModal"));
    const close = rest.slice(rest.indexOf("onClose(): void {"));
    expect(close.indexOf("this.esc?.detach()")).toBeGreaterThan(0);
    expect(close.indexOf("this.esc?.detach()")).toBeLessThan(close.indexOf("this.view?.destroy()"));
  });
});
