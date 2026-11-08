import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_VIEWER_IMAGES, DEFAULT_FILE_VIEWER_IMAGE_MAX_MB } from "../src/core/constants";
import { DEFAULT_SETTINGS, parseSettings, validateSetting } from "../src/core/settings";
import { ROOT } from "./helpers/files";

const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

// Nachtrag 43c, Task 2: Einstellungen für Bilder im Datei-Viewer und der Knopf „Mit Standardprogramm öffnen“.
describe("Bilder im Datei-Viewer: Einstellungen", () => {
  it("Vorgaben: Bilder an, Höchstgröße 20 MB", () => {
    expect(DEFAULT_FILE_VIEWER_IMAGES).toBe(true);
    expect(DEFAULT_FILE_VIEWER_IMAGE_MAX_MB).toBe(20);
    expect(DEFAULT_SETTINGS.fileViewerImages).toBe(true);
    expect(DEFAULT_SETTINGS.fileViewerImageMaxMb).toBe(20);
  });

  it.each([0, 201, "20", 1.5])("fileViewerImageMaxMb: %j ist ungültig", (v) => {
    expect(validateSetting("fileViewerImageMaxMb", v)).toBe("ganze Zahl von 1 bis 200");
  });

  it("fileViewerImageMaxMb: Zahlen außerhalb werden beim Laden geklemmt, Text fällt auf die Vorgabe", () => {
    expect(parseSettings({ fileViewerImageMaxMb: 0 }).settings.fileViewerImageMaxMb).toBe(1);
    expect(parseSettings({ fileViewerImageMaxMb: 201 }).settings.fileViewerImageMaxMb).toBe(200);
    const r = parseSettings({ fileViewerImageMaxMb: "20" });
    expect([...r.invalid]).toEqual(["fileViewerImageMaxMb"]);
    expect(r.settings.fileViewerImageMaxMb).toBe(20);
  });

  it.each([1, 200])("fileViewerImageMaxMb nimmt %j", (v) => {
    const r = parseSettings({ fileViewerImageMaxMb: v });
    expect([...r.invalid]).toEqual([]);
    expect(r.settings.fileViewerImageMaxMb).toBe(v);
  });

  it("fileViewerImages nimmt nur Wahrheitswerte", () => {
    expect(parseSettings({ fileViewerImages: false }).settings.fileViewerImages).toBe(false);
    const r = parseSettings({ fileViewerImages: "ja" });
    expect([...r.invalid]).toEqual(["fileViewerImages"]);
    expect(r.settings.fileViewerImages).toBe(true);
  });
});

describe("Bilder im Datei-Viewer: Verkabelung", () => {
  it("Einstellungsseite: Schalter und Größe direkt nach der Höchstgröße, vor der Startbreite", () => {
    const tab = read("src/host/settings-tab.ts");
    const maxMb = tab.indexOf('"fileViewerMaxMb", "Datei-Viewer: Höchstgröße (MB)"');
    const images = tab.indexOf('"fileViewerImages", "Datei-Viewer: Bilder anzeigen"');
    const imageMax = tab.indexOf('"fileViewerImageMaxMb", "Datei-Viewer: Höchstgröße Bilder (MB)"');
    const width = tab.indexOf('"fileViewerWidthPct"');
    expect(maxMb).toBeGreaterThan(-1);
    expect(images).toBeGreaterThan(maxMb);
    expect(imageMax).toBeGreaterThan(images);
    expect(width).toBeGreaterThan(imageMax);
  });

  it("main: Fenster bekommt die Bild-Einstellungen zwischen markdown und mdCommands", () => {
    expect(read("src/main.ts")).toContain(
      "markdown: store.settings().fileViewerMarkdown, images: store.settings().fileViewerImages, imageMaxMb: store.settings().fileViewerImageMaxMb, mdCommands:",
    );
  });

  it("Fenster: Bildgrenze nur bei eingeschaltetem Schalter, Knopf, Fehlermeldung", () => {
    const modal = read("src/host/file-viewer-modal.ts");
    expect(modal).toContain("loadFile(this.target.path, this.options.maxMb, this.options.images ? this.options.imageMaxMb : null)");
    expect(modal).toContain("Mit Standardprogramm öffnen");
    expect(modal).toContain("openWithDefaultApp(this.target.path)");
    expect(modal).toContain("Öffnen fehlgeschlagen: ${msg}");
    expect(modal).toContain('if (result.kind !== "error") this.actionsRow(this.contentEl);');
    expect(modal).toContain("Binärdatei, keine Anzeige im Fenster.");
  });

  it("CSS: Knopfzeile", () => {
    expect(read("src/styles.css")).toContain(".cockpit-file-viewer-actions { display: flex; gap: var(--size-4-2); padding-top: var(--size-4-2); }");
  });
});

// Task 3: Bildansicht im Modal (Quelltext-Wächter, das Fenster läuft nur in Obsidian).
describe("Bilder im Datei-Viewer: Bildansicht", () => {
  const modal = read("src/host/file-viewer-modal.ts");
  const body = (start: string, end: string): string => {
    const from = modal.indexOf(start);
    expect(from).toBeGreaterThan(-1);
    const to = modal.indexOf(end, from + start.length);
    expect(to).toBeGreaterThan(from);
    return modal.slice(from, to);
  };

  it("render verzweigt bei image zu renderImage, vor dem Hinweiszweig", () => {
    const branch = modal.indexOf('if (result.kind === "image")');
    expect(branch).toBeGreaterThan(-1);
    expect(modal.slice(branch, branch + 80)).toContain("this.renderImage(result)");
    expect(branch).toBeLessThan(modal.indexOf('if (result.kind !== "text")'));
  });

  it("Blob-URL aus den Bytes mit dem MIME-Typ, onClose gibt sie frei", () => {
    expect(body("private renderImage(", "private viewSize")).toContain("URL.createObjectURL(new Blob([result.bytes], { type: result.mime }))");
    const close = body('this.modalEl.removeEventListener("wheel"', "private render(");
    expect(close).toContain("URL.revokeObjectURL(this.imageUrl)");
    expect(close).toContain("this.imageUrl = null");
    expect(close).toContain("this.image = null");
  });

  it("onload prüft imageUrl, bevor eingepasst wird", () => {
    const onload = body("img.onload = ", "img.onerror = ");
    const check = onload.search(/if \(!this\.imageUrl\)|if \(this\.imageUrl === null\)/);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(onload.indexOf("fitPct("));
  });

  it("onerror zeigt den Hinweis und den Knopf", () => {
    const onerror = body("img.onerror = ", "private viewSize");
    expect(onerror).toContain("Bild nicht lesbar.");
    expect(onerror).toContain("this.actionsRow(");
  });

  it("Mod+0 passt im Bildmodus ein, Tasten und Rad nutzen die Bild-Leiter", () => {
    expect(modal).toContain('this.scope.register(["Mod"], "0", () => this.image ? this.zoomFit() : this.zoomTo(100));');
    const fit = body("private zoomFit(", "private zoomTo(");
    expect(fit).toContain("fitPct(this.image.natural, { width: host.clientWidth, height: host.clientHeight })");
    expect(fit).toContain("this.image.fit =");
    expect(body("private step(", "private zoomFit(")).toContain("this.image ? imageZoomStep(pct, dir) : zoomStep(pct, dir)");
    expect(body("private zoomBy(", "private step(")).toContain("this.step(this.zoom, dir)");
    expect(body("private wheelZoom(", "private applyZoom(")).toContain("this.step(pct, steps > 0 ? 1 : -1)");
    // Nur Mod+0 rechnet neu, nicht das Ziehen oder Vergrößern des Fensters.
    expect(modal.split("this.image.fit =").length - 1).toBe(1);
  });

  it("applyZoom setzt im Bildmodus Breite und Höhe per Variable statt der Schrift", () => {
    const apply = body("private applyZoom(", "/** Cursor an");
    expect(apply).toContain("imageSize(this.image.natural, this.zoom)");
    expect(apply).toContain("setProperty(IMAGE_W_VAR");
    expect(apply).toContain("setProperty(IMAGE_H_VAR");
    expect(modal).not.toMatch(/img\.style\.(width|height)\s*=/);
  });

  it("Titel hängt Maße und Größe über imageInfo an", () => {
    expect(body("private updateTitle(", "function hintFor")).toContain("imageInfo(this.image.natural.width, this.image.natural.height, this.imageBytes, this.imageSvg)");
  });

  it("save tut ohne Editor nichts (keine Meldung im Bildmodus)", () => {
    expect(body("private async save(", "this.saving = true")).toContain("if (!view || this.saving) return false;");
  });

  it("hintFor nennt bei zu großem Bild die Einstellung und nutzt imageMaxMb", () => {
    const hint = body("function hintFor(", "\n}\n");
    expect(hint).toContain("if (result.image)");
    expect(hint).toContain("Einstellung „Datei-Viewer: Höchstgröße Bilder (MB)“");
    expect(hint).toContain("${imageMaxMb} MB");
  });

  it("Variablennamen im Modal stimmen mit der CSS überein", () => {
    const css = read("src/styles.css");
    const w = /const IMAGE_W_VAR = `--\$\{CSS_PREFIX\}(image-width)`/.exec(modal);
    const h = /const IMAGE_H_VAR = `--\$\{CSS_PREFIX\}(image-height)`/.exec(modal);
    expect(w).not.toBeNull();
    expect(h).not.toBeNull();
    expect(css).toContain(`var(--cockpit-${w?.[1]}`);
    expect(css).toContain(`var(--cockpit-${h?.[1]}`);
  });

  it("CSS: Scrollfläche, Bild mit Variablen, keine .cm-Regel", () => {
    const css = read("src/styles.css");
    expect(css).toMatch(/\.cockpit-file-viewer-img \{[^}]*width: var\(--cockpit-image-width/);
    expect(css).toMatch(/\.cockpit-file-viewer-image \{[^}]*overflow: auto/);
    expect(css).not.toMatch(/\.cm-/);
  });
});
