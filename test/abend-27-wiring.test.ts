import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

// Abend 27: Pfade im Terminal per Cmd+Klick. Was nur in Obsidian läuft, prüft die Abnahme; hier nur die Verkabelung.
describe("Abend 27: Datei-Viewer verkabelt", () => {
  it("TerminalView meldet je Pane einen FileLinkProvider an, Einstellung und Startordner frisch gelesen, Abmeldung in onClose", () => {
    const view = read("src/host/terminal-view.ts");
    expect(view).toMatch(/registerLinkProvider\(\s*new FileLinkProvider\(/);
    expect(view).toMatch(/enabled: \(\) => this\.deps\.settings\(\)\.fileLinks/);
    expect(view).toMatch(/cwd: \(\) => \(this\.sessionId \? this\.deps\.record\(this\.sessionId\)\?\.cwd/);
    expect(view).toMatch(/isFile: isFileSync/);
    const close = view.slice(view.indexOf("async onClose()"));
    expect(close.indexOf("this.unbindLinks?.()")).toBeGreaterThan(0);
    expect(close.indexOf("this.unbindLinks?.()")).toBeLessThan(close.indexOf("this.pane?.dispose()"));
  });
  it("main: Vault über openVaultFile, sonst FileViewerModal mit Höchstgröße aus den Einstellungen und Fokus zurück", () => {
    const main = read("src/main.ts");
    expect(main).toMatch(/openPath: \(target, refocus\) => void openTerminalPath\(target, \{/);
    expect(main).toMatch(/openInVault: async \(rel, t\) => \(await openVaultFile\(this\.app, rel,/);
    expect(main).toMatch(/new FileViewerModal\(this\.app, t, \{ maxMb: store\.settings\(\)\.fileViewerMaxMb, home: homedir\(\), onClosed: refocus \}\)/);
  });
  it("IDE-Brücke und Terminal-Links teilen dieselbe Öffnen-Funktion", () => {
    expect(read("src/host/ide-editor.ts")).toMatch(/await openVaultFile\(this\.app, path\)/);
    expect(read("src/host/ide-editor.ts")).not.toMatch(/leaf\.openFile\(/);
  });
  it("Fenster: Cmd+S am Fenster, Speichern über saveFile mit der mtime vom Öffnen, close fragt bei ungespeicherten Änderungen", () => {
    const modal = read("src/host/file-viewer-modal.ts");
    expect(modal).toMatch(/this\.scope\.register\(\["Mod"\], "s",/);
    expect(modal).toMatch(/saveFile\(this\.target\.path, view\.state\.sliceDoc\(\), this\.mtimeMs, force\)/);
    expect(modal).toMatch(/close\(\): void \{\s*if \(this\.asking\) return;\s*if \(!this\.dirty \|\| this\.discard\)/);
    expect(modal).toMatch(/this\.options\.onClosed\(\)/);
    expect(modal).toMatch(/EditorState\.lineSeparator\.of\(lineSeparatorOf\(/);
  });
  it("Einstellungsseite: beide Felder im Abschnitt Terminal", () => {
    const tab = read("src/host/settings-tab.ts");
    const terminal = tab.indexOf('setName("Terminal")');
    const next = tab.indexOf('setName("Benachrichtigung")');
    for (const field of ['"fileLinks", "Pfade per Cmd+Klick öffnen"', '"fileViewerMaxMb", "Datei-Viewer: Höchstgröße (MB)"']) {
      const at = tab.indexOf(field);
      expect(at, field).toBeGreaterThan(terminal);
      expect(at, field).toBeLessThan(next);
    }
  });
});

// Nachtrag 27b: relative Pfade über Claudes Ordner.
describe("Abend 27b: Claudes Ordner verkabelt", () => {
  it("TerminalView gibt dem Provider Einstellung und Basisordner des aktuellen Lesers, beides frisch bei jeder Abfrage", () => {
    const view = read("src/host/terminal-view.ts");
    expect(view).toMatch(/claudeDirs: \(\) => this\.deps\.settings\(\)\.fileLinksClaudeDirs/);
    expect(view).toMatch(/bases: \(\) => this\.reader\?\.linkBases\(\) \?\? \[\]/);
  });
  it("Einstellungsseite: Schalter im Abschnitt Terminal, direkt unter fileLinks", () => {
    const tab = read("src/host/settings-tab.ts");
    const field = '"fileLinksClaudeDirs", "Relative Pfade auch in Claudes Ordnern suchen"';
    const at = tab.indexOf(field);
    expect(at).toBeGreaterThan(tab.indexOf('"fileLinks", "Pfade per Cmd+Klick öffnen"'));
    expect(at).toBeLessThan(tab.indexOf('"fileViewerMaxMb", "Datei-Viewer: Höchstgröße (MB)"'));
    expect(at).toBeLessThan(tab.indexOf('setName("Benachrichtigung")'));
  });
});
