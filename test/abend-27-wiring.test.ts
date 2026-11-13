import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MD_TOKEN } from "../src/core/markdown-mode";
import { ROOT } from "./helpers/files";

const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

// Abend 27: Pfade im Terminal per Cmd+Klick (Abend 42: unter Windows Ctrl+Klick, die Taste kommt aus modKeyName). Was nur in Obsidian läuft, prüft die Abnahme; hier nur die Verkabelung.
describe("Abend 27: Datei-Viewer verkabelt", () => {
  it("TerminalView meldet je Pane einen FileLinkProvider an, Einstellung und Startordner frisch gelesen, Abmeldung in onClose", () => {
    const view = read("src/host/terminal-view.ts");
    expect(view).toMatch(/registerLinkProvider\(\s*new FileLinkProvider\(/);
    expect(view).toMatch(/enabled: \(\) => this\.deps\.settings\(\)\.fileLinks/);
    expect(view).toMatch(/cwd: \(\) => \(this\.sessionId \? this\.deps\.record\(this\.sessionId\)\?\.cwd/);
    expect(view).toMatch(/isFile: isFileSync/);
    // Abend 42: Die Plattform erreicht Provider und Leser, damit Windows-Pfade und Ctrl+Klick dort ankommen.
    const provider = view.slice(view.indexOf("new FileLinkProvider("), view.indexOf("// Klick auf /clear"));
    expect(provider).toMatch(/platform: hostPlatform\(\),/);
    expect(view).toMatch(/new TranscriptReader\(claudeId, undefined, undefined, hostPlatform\(\)\)/);
    expect(view).toMatch(/new TranscriptReader\(next, undefined, undefined, hostPlatform\(\)\)/);
    const close = view.slice(view.indexOf("async onClose()"));
    expect(close.indexOf("this.unbindLinks?.()")).toBeGreaterThan(0);
    expect(close.indexOf("this.unbindLinks?.()")).toBeLessThan(close.indexOf("this.pane?.dispose()"));
  });
  it("main: Vault über openVaultFile, sonst FileViewerModal mit Höchstgröße aus den Einstellungen und Fokus zurück", () => {
    const main = read("src/main.ts");
    expect(main).toMatch(/openPath: \(target, refocus\) => void openTerminalPath\(target, \{/);
    expect(main).toMatch(/openTerminalPath\(target, \{\s*platform,/);
    expect(main).toMatch(/openInVault: async \(rel, t\) => \(await openVaultFile\(this\.app, rel,/);
    expect(main).toMatch(/new FileViewerModal\(this\.app, t, \{ maxMb: store\.settings\(\)\.fileViewerMaxMb, autocomplete: store\.settings\(\)\.fileViewerAutocomplete, fontSize: store\.settings\(\)\.fileViewerFontSize, widthPct: store\.settings\(\)\.fileViewerWidthPct, heightPct: store\.settings\(\)\.fileViewerHeightPct, markdown: [^}]*\}, home: homedir\(\), onClosed: refocus \}\)/);
  });
  it("IDE-Brücke und Terminal-Links teilen dieselbe Öffnen-Funktion", () => {
    expect(read("src/host/ide-editor.ts")).toMatch(/await openVaultFile\(this\.app, path\)/);
    expect(read("src/host/ide-editor.ts")).not.toMatch(/leaf\.openFile\(/);
  });
  it("Fenster: Cmd+S am Fenster, Speichern über saveFile mit der mtime vom Öffnen, close fragt bei ungespeicherten Änderungen", () => {
    const modal = read("src/host/file-viewer-modal.ts");
    expect(modal).toMatch(/this\.scope\.register\(\["Mod"\], "s",/);
    expect(modal).toMatch(/saveFile\(this\.target\.path, view\.state\.sliceDoc\(\), this\.mtimeMs, force\)/);
    expect(modal).toMatch(/close\(\): void \{\s*if \(this\.asking\) return;\s*if \(this\.esc\?\.consume\(\)\) return;\s*if \(!this\.dirty \|\| this\.discard\)/);
    expect(modal).toMatch(/this\.options\.onClosed\(\)/);
    expect(modal).toMatch(/EditorState\.lineSeparator\.of\(lineSeparatorOf\(/);
  });
  it("Einstellungsseite: beide Felder im Abschnitt Terminal", () => {
    const tab = read("src/host/settings-tab.ts");
    const terminal = tab.indexOf('this.group("Terminal", [');
    const next = tab.indexOf('this.group("Benachrichtigung", [');
    for (const field of ['"fileLinks", `Pfade per ${mod}+Klick öffnen`', '"fileViewerMaxMb", "Datei-Viewer: Höchstgröße (MB)"']) {
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
    const fileLinksAt = tab.indexOf('"fileLinks", `Pfade per ${mod}+Klick öffnen`');
    expect(fileLinksAt, "fileLinks fehlt").toBeGreaterThanOrEqual(0);
    expect(at).toBeGreaterThan(fileLinksAt);
    expect(at).toBeLessThan(tab.indexOf('"fileViewerMaxMb", "Datei-Viewer: Höchstgröße (MB)"'));
    expect(at).toBeLessThan(tab.indexOf('this.group("Benachrichtigung", ['));
  });
});

// Nachtrag 41d, Task 2: Zeilenumbruch und Zoom im Fenster. Das Verhalten in Obsidian (Tasten, Rad, Anzeige) prüft die Abnahme.
describe("Nachtrag 41d: Datei-Viewer lesbar und zoombar", () => {
  const modal = read("src/host/file-viewer-modal.ts");
  // onClose von FileViewerModal (ChoiceModal weiter oben hat auch eins): ab der Klasse gesucht, bis zur nächsten Methode.
  const klasse = modal.slice(modal.indexOf("export class FileViewerModal"));
  const closeBody = klasse.slice(klasse.indexOf("  onClose(): void {"), klasse.indexOf("  private render("));

  it("Zeilenumbruch: lineWrapping in den Erweiterungen des Editors", () => {
    const render = modal.slice(modal.indexOf("private render("), modal.indexOf("private jump("));
    expect(render).toMatch(/extensions: \[[^\]]*EditorView\.lineWrapping,/s);
  });
  it("Schrift: Theme liest die Variable am Modal, nicht --font-text-size; das Modal setzt sie aus fontPx und misst neu", () => {
    expect(modal).toMatch(/fontSize: "var\(--cockpit-file-viewer-font-size\)"/);
    expect(modal).not.toMatch(/--font-text-size/);
    expect(modal).toMatch(/const FONT_VAR = `--\$\{CSS_PREFIX\}file-viewer-font-size`;/);
    expect(modal).toMatch(/this\.modalEl\.style\.setProperty\(FONT_VAR, `\$\{fontPx\(this\.options\.fontSize, this\.zoom\)\}px`\);\s*this\.view\?\.requestMeasure\(\);/);
    expect(modal).toMatch(/private zoom = 100;/);
  });
  it("Zoom-Tasten: Plus (= und +), Minus und 0 mit Mod, jede gibt false zurück", () => {
    expect(modal).toMatch(/for \(const key of \["=", "\+"\]\) this\.scope\.register\(\["Mod"\], key, \(\) => this\.zoomBy\(1\)\);/);
    // Mod+Umschalt: Plus auf der US-Tastatur.
    expect(modal).toMatch(/for \(const key of \["=", "\+"\]\) this\.scope\.register\(\["Mod", "Shift"\], key, \(\) => this\.zoomBy\(1\)\);/);
    expect(modal).toMatch(/this\.scope\.register\(\["Mod"\], "-", \(\) => this\.zoomBy\(-1\)\);/);
    expect(modal).toMatch(/this\.scope\.register\(\["Mod"\], "0", \(\) => this\.image \? this\.zoomFit\(\) : this\.zoomTo\(100\)\);/);
    // Die Handler liefern false (preventDefault gegen den App-Zoom): Rückgabetyp false, nicht boolean.
    expect(modal).toMatch(/private zoomBy\(dir: 1 \| -1\): false \{[^}]*return false;/);
    expect(modal).toMatch(/private zoomTo\(pct: number\): false \{[^}]*return false;/);
  });
  it("Mausrad: Listener mit passive: false, preventDefault, Schritte über wheelSteps; in onClose entfernt", () => {
    expect(modal).toMatch(/this\.modalEl\.addEventListener\("wheel", this\.onWheel, \{ passive: false \}\);/);
    expect(closeBody).toMatch(/this\.modalEl\.removeEventListener\("wheel", this\.onWheel\);/);
    const wheel = modal.slice(modal.indexOf("private wheelZoom("), modal.indexOf("private applyZoom("));
    expect(wheel).toMatch(/event\.metaKey \|\| event\.ctrlKey : event\.ctrlKey/);
    // preventDefault für jedes Mod-Rad-Ereignis, vor jeder Rechnung; die Schritte kommen aus wheelSteps, Stille setzt die Summe zurück.
    expect(wheel).toMatch(/if \(!mod\) return;\s*event\.preventDefault\(\);/);
    expect(wheel).toMatch(/event\.timeStamp - this\.wheelAt > WHEEL_RESET_MS\) this\.wheelAcc = 0;/);
    expect(wheel).toMatch(/wheelSteps\(this\.wheelAcc, event\.deltaY, event\.deltaMode\)/);
    expect(wheel).toMatch(/this\.zoomTo\(pct\);/);
  });
  it("Prozentanzeige: neben dem Titel (nicht darin), Zeitgeber in onClose gelöscht, CSS fängt keine Mausereignisse ab", () => {
    expect(modal).toMatch(/this\.titleEl\.after\(this\.zoomEl\);/);
    expect(modal).toMatch(/this\.titleEl\.parentElement\?\.addClass\(`\$\{CSS_PREFIX\}file-viewer-header`\);/);
    expect(modal).toMatch(/const ZOOM_HINT_MS = 1500;/);
    expect(closeBody).toMatch(/window\.clearTimeout\(this\.zoomTimer\)/);
    expect(read("src/styles.css")).toMatch(/\.cockpit-file-viewer-zoom \{[^}]*pointer-events: none;/);
  });
  it("main: Grundschrift und Startgröße kommen aus den Einstellungen", () => {
    expect(read("src/main.ts")).toMatch(/fontSize: store\.settings\(\)\.fileViewerFontSize, widthPct: store\.settings\(\)\.fileViewerWidthPct, heightPct: store\.settings\(\)\.fileViewerHeightPct/);
  });
});

// Nachtrag 41d, Task 3: Startgröße, Verschieben, Größe ändern. Das Ziehen selbst (Zeiger, Rand des Fensters) prüft die Abnahme in Obsidian; die Rechnung dahinter testet file-viewer-frame.test.ts.
describe("Nachtrag 41d: Datei-Viewer verschieben und in der Größe ändern", () => {
  const modal = read("src/host/file-viewer-modal.ts");
  const css = read("src/styles.css");
  const klasse = modal.slice(modal.indexOf("export class FileViewerModal"));
  const closeBody = klasse.slice(klasse.indexOf("  onClose(): void {"), klasse.indexOf("  private render("));
  const frame = klasse.slice(klasse.indexOf("  private viewSize()"), klasse.indexOf("  /** Zoom-Taste"));
  const CURSORS: Record<string, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };

  it("Start: startRect aus Container-Maßen und den beiden Prozent-Optionen, Lage als Inline-Stil", () => {
    expect(frame).toMatch(/this\.containerEl\.clientWidth \|\| window\.innerWidth/);
    expect(frame).toMatch(/this\.containerEl\.clientHeight \|\| window\.innerHeight/);
    expect(frame).toMatch(/startRect\(this\.viewSize\(\), this\.options\.widthPct, this\.options\.heightPct\)/);
    expect(frame).toMatch(/private setupFrame\(header: HTMLElement \| null\): void \{\s*this\.applyRect\(this\.startFrame\(\)\);/);
    for (const prop of ["left", "top", "width", "height"]) expect(frame).toContain(`style.${prop} = `);
    expect(klasse).toMatch(/this\.setupFrame\(this\.titleEl\.parentElement\);/);
  });
  it("CSS: die festen min(1100px …)/min(85vh …) sind weg, das Fenster liegt absolut ohne Rand und Höchstmaße", () => {
    expect(css).not.toMatch(/min\(1100px/);
    expect(css).not.toMatch(/min\(85vh/);
    // Obsidians `.modal-container .modal { position: relative }` (0,2,0) schlägt ein einzelnes `.cockpit-file-viewer`: die Lage-Regeln stehen unter dem Containerselektor, nie unter der einen Klasse.
    expect(css).toMatch(/\.cockpit-file-viewer-container \.cockpit-file-viewer \{[^}]*position: absolute;[^}]*margin: 0;[^}]*max-width: none;[^}]*max-height: none;/);
    expect(css).not.toMatch(/(^|\n)\.cockpit-file-viewer \{[^}]*position:/);
    expect(css).toMatch(/(^|\n)\.cockpit-file-viewer \{[^}]*display: flex;[^}]*flex-direction: column;/);
    expect(klasse).toMatch(/this\.containerEl\.addClass\(`\$\{CSS_PREFIX\}file-viewer-container`\);/);
    expect(css).toMatch(/\.cockpit-file-viewer\.cockpit-file-viewer-dragging \{[^}]*user-select: none;/);
  });
  it("Griffe: acht Kanten und Ecken, je mit data-edge im Code und passendem Cursor im CSS", () => {
    expect(modal).toMatch(/const EDGES: readonly Edge\[\] = \["n", "s", "e", "w", "ne", "nw", "se", "sw"\];/);
    expect(frame).toMatch(/for \(const edge of EDGES\) \{\s*const handle = this\.modalEl\.createDiv\(\{ cls: `\$\{CSS_PREFIX\}file-viewer-handle`, attr: \{ "data-edge": edge \} \}\);/);
    for (const [edge, cursor] of Object.entries(CURSORS)) {
      expect(css, edge).toMatch(new RegExp(`\\.cockpit-file-viewer-handle\\[data-edge="${edge}"\\] \\{[^}]*cursor: ${cursor};`));
    }
    expect(css).toMatch(/\.cockpit-file-viewer-handle \{[^}]*position: absolute;/);
    // Kanten rund 6 px, Ecken rund 12 px.
    expect(css).toMatch(/\[data-edge="n"\] \{[^}]*height: 6px;/);
    expect(css).toMatch(/\[data-edge="e"\] \{[^}]*width: 6px;/);
    expect(css).toMatch(/\[data-edge="se"\] \{[^}]*width: 12px; height: 12px;/);
  });
  it("Ziehen: Pointer-Capture beim Anfassen, nur primäre Taste, Rechnung über moveRect und resizeRect, Freigabe beim Ende", () => {
    expect(frame).toMatch(/if \(event\.button !== 0 \|\| !this\.rect \|\| this\.drag\) return;/);
    expect(frame).toMatch(/\(event\.currentTarget as HTMLElement\)\.setPointerCapture\(event\.pointerId\);/);
    expect(frame).toMatch(/drag\.kind === "move" \? moveRect\(drag\.start, dx, dy, view\) : resizeRect\(drag\.start, drag\.kind, dx, dy, view\)/);
    expect(frame).toMatch(/releasePointerCapture\(event\.pointerId\)/);
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture"]) {
      expect(frame).toContain(`el.addEventListener("${type}"`);
      expect(frame).toContain(`el.removeEventListener("${type}"`);
    }
  });
  it("Kopfzeile: ganze Zeile ist Ziehfläche mit Cursor move (eine Regel); der Schließen-Knopf hängt am modalEl, nicht in der Kopfzeile, und wird nicht angefasst", () => {
    expect(frame).toMatch(/const onDown = \(event: PointerEvent\): void => this\.beginDrag\(event, "move"\);/);
    expect(frame).toMatch(/this\.bindDrag\(header, onDown\);/);
    expect(css).toMatch(/\.cockpit-file-viewer-header \{[^}]*cursor: move;[^}]*touch-action: none;/);
    expect(css.match(/(^|\n)\.cockpit-file-viewer-header \{/g)).toHaveLength(1);
    // Obsidian 1.14.4 nennt den Knopf modal-header-button (nicht modal-close-button); sein z-index (50) liegt über den Griffen (2), eine eigene Klasse dafür gibt es nicht.
    expect(modal).not.toContain("modal-close-button");
    expect(css).not.toContain("file-viewer-close");
    expect(css).toMatch(/\.cockpit-file-viewer-handle \{[^}]*z-index: 2;/);
  });
  it("Doppelklick auf die Kopfzeile: zurück auf den Startrahmen", () => {
    expect(frame).toMatch(/const onDouble = \(\): void => this\.applyRect\(this\.startFrame\(\)\);/);
    expect(frame).toMatch(/header\.addEventListener\("dblclick", onDouble\);/);
  });
  it("Fenstergröße: clampRect auf den neuen Container; Listener in onOpen an, in onClose ab, Griffe und Zeiger-Listener ebenso", () => {
    expect(klasse).toMatch(/private readonly onWindowResize = \(\): void => \{\s*if \(this\.rect\) this\.applyRect\(clampRect\(this\.rect, this\.viewSize\(\)\)\);/);
    expect(frame).toMatch(/window\.addEventListener\("resize", this\.onWindowResize\);/);
    expect(closeBody).toMatch(/window\.removeEventListener\("resize", this\.onWindowResize\);/);
    expect(closeBody).toMatch(/for \(const cleanup of this\.frameCleanups\) cleanup\(\);/);
    expect(frame).toMatch(/this\.frameCleanups\.push\(\(\) => handle\.remove\(\)\);/);
  });
  it("Nichts gespeichert: der Rahmen steht nur im Modal, keine Einstellung hält ihn fest", () => {
    expect(read("src/core/settings.ts")).not.toMatch(/fileViewer(Left|Top|Rect|Frame)/);
  });
});

// Nachtrag 43b: Markdown-Farben im Datei-Viewer verkabelt (Einstellungen, Modal, Editor-Theme, Farbvariablen).
describe("Nachtrag 43b: Markdown-Farben verkabelt", () => {
  const TEILE = ["text", "code", "command", "heading", "link", "marker", "frontmatter"] as const;
  const SCHLUESSEL = ["Text", "Code", "Command", "Heading", "Link", "Marker", "Frontmatter"] as const;

  it("main gibt Schalter, Befehlsliste und alle sieben Farben an FileViewerModal", () => {
    const main = read("src/main.ts");
    const call = main.slice(main.indexOf("new FileViewerModal("), main.indexOf("}).open()", main.indexOf("new FileViewerModal(")));
    expect(call).toContain("markdown: store.settings().fileViewerMarkdown");
    expect(call).toContain("mdCommands: store.settings().fileViewerMdCommands");
    TEILE.forEach((teil, i) => expect(call, teil).toContain(`${teil}: store.settings().fileViewerMd${SCHLUESSEL[i]}`));
  });

  it("EDITOR_THEME hat für jeden Wert aus MD_TOKEN eine Regel .cm-<token> mit Farbvariable", () => {
    const modal = read("src/host/file-viewer-modal.ts");
    const theme = modal.slice(modal.indexOf("const EDITOR_THEME"), modal.indexOf("/** Variable am Modal"));
    for (const token of Object.values(MD_TOKEN)) expect(theme, token).toContain(`".cm-${token}"`);
    for (const teil of TEILE) expect(theme, teil).toContain(`color: "var(--cockpit-md-${teil})"`);
    expect(theme).toMatch(/"\.cm-cockpit-md-heading": \{[^}]*fontWeight: "bold"/);
    expect(theme).toMatch(/"\.cm-cockpit-md-strong": \{[^}]*fontWeight: "bold"/);
    expect(theme).toMatch(/"\.cm-cockpit-md-em": \{[^}]*fontStyle: "italic"/);
  });

  it("styles.css definiert jede --cockpit-md-<teil> in hellem und dunklem Theme mit den vorgegebenen Farben", () => {
    const css = read("src/styles.css");
    const dunkel = { text: "#8fd18f", code: "#f0a35e", command: "#ff6b6b", heading: "#ffffff", link: "#6cb6ff", marker: "#9a9a9a", frontmatter: "#9a9a9a" };
    const hell = { text: "#2e7d32", code: "#b35400", command: "#c62828", heading: "#000000", link: "#1565c0", marker: "#6b6b6b", frontmatter: "#6b6b6b" };
    const block = (selector: string): string => {
      const at = css.indexOf(`${selector} {`);
      expect(at, selector).toBeGreaterThanOrEqual(0);
      return css.slice(at, css.indexOf("}", at));
    };
    const light = block(".cockpit-file-viewer");
    const dark = block("body.theme-dark .cockpit-file-viewer");
    for (const teil of TEILE) {
      expect(light, teil).toContain(`--cockpit-md-${teil}: ${hell[teil]};`);
      expect(dark, teil).toContain(`--cockpit-md-${teil}: ${dunkel[teil]};`);
    }
  });

  it("Modal setzt nicht leere Farben als Variable am modalEl", () => {
    const modal = read("src/host/file-viewer-modal.ts");
    expect(modal).toMatch(/for \(const part of MD_PARTS\)[\s\S]{0,200}if \(color\)[\s\S]{0,120}modalEl\.style\.setProperty\(`--\$\{CSS_PREFIX\}md-\$\{part\}`, color\)/);
  });

  it("Einstellungsseite: Texte wörtlich, Farben nach den Vorschlägen", () => {
    const tab = read("src/host/settings-tab.ts");
    const vorschlaege = tab.indexOf('"fileViewerAutocomplete"');
    expect(tab.indexOf('"fileViewerMarkdown", "Datei-Viewer: Markdown färben"')).toBeGreaterThan(vorschlaege);
    expect(tab).toContain("Färbt .md-Dateien: Fließtext, Code, Befehle, Überschriften, Links, Marker und Frontmatter. Der Text bleibt Rohtext. Wirkt beim nächsten Öffnen eines Fensters.");
    for (const name of ["Fließtext", "Code", "Befehle", "Überschriften", "Links", "Marker", "Frontmatter"]) expect(tab).toContain(`"Datei-Viewer: Farbe ${name}"`);
    expect(tab).toContain("Leer: Vorgabe des Themes. Sonst Farbe wie #ff6b6b, gilt in hellem und dunklem Theme. Wirkt beim nächsten Öffnen.");
    expect(tab).toContain('"fileViewerMdCommands", "Datei-Viewer: Befehle in Backticks"');
    expect(tab).toContain("Beginnt Text in Backticks mit einem dieser Wörter (oder mit $ oder ./), färbt das Fenster ihn als Befehl, sonst als Code. Wörter durch Leerzeichen getrennt. Wirkt beim nächsten Öffnen.");
  });
});

// Nachtrag 43j, Befund der Abnahme: Die Rückfrage „Trotzdem clearen?“ listet die Lücken je Zeile; ein <p> ohne pre-line
// verschluckte die Umbrüche, mehrere Lücken liefen in einer Zeile ineinander. Das Aussehen prüft die Abnahme.
describe("Nachtrag 43j: ChoiceModal behält Zeilenumbrüche", () => {
  it("Text im Absatz mit eigener Klasse, die Klasse setzt white-space: pre-line", () => {
    const modal = read("src/host/file-viewer-modal.ts");
    const open = modal.slice(modal.indexOf("export class ChoiceModal"), modal.indexOf('cls: "modal-button-container"'));
    expect(open).toMatch(/createEl\("p", \{ text: this\.message, cls: `\$\{CSS_PREFIX\}choice-message` \}\)/);
    expect(read("src/styles.css")).toMatch(/\.cockpit-choice-message \{\s*white-space: pre-line;\s*\}/);
  });
});
