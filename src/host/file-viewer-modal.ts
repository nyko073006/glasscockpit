import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, type KeyBinding, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { type App, Modal, Notice } from "obsidian";
import { shortPath } from "../core/claude-launch";
import { CSS_PREFIX } from "../core/constants";
import { imageInfo, lineSeparatorOf } from "../core/file-links";
import { MD_PARTS, type MdPart } from "../core/markdown-mode";
import { type Edge, type Rect, type View, WHEEL_RESET_MS, clampRect, fitPct, fontPx, imageSize, imageZoomStep, moveRect, resizeRect, startRect, wheelSteps, zoomStep } from "../core/file-viewer-frame";
import { EscGuard, codeExtensions, loadCodeModules } from "./code-editor";
import type { LinkTarget } from "./file-links";
import { openWithDefaultApp } from "./electron";
import { hostPlatform } from "./host-platform";
import { type LoadResult, loadFile, saveFile } from "./file-viewer-fs";

// Datei-Viewer (Abend 27): Fenster über Obsidian mit Rohtext-Editor (CodeMirror 6 aus Obsidian). Cmd+S speichert atomar,
// Esc oder X schließt. Geschrieben wird nur genau der geöffnete Pfad. Seit Abend 32 mit Syntaxfarben und Vorschlägen (code-editor.ts).

export interface FileViewerOptions {
  maxMb: number;
  /** Vorschläge beim Tippen (Einstellung fileViewerAutocomplete), gelesen beim Öffnen. */
  autocomplete: boolean;
  home: string;
  /** Grundschrift in px (Einstellung fileViewerFontSize), gelesen beim Öffnen; der Zoom im Fenster rechnet davon aus. */
  fontSize: number;
  /** Breite und Höhe des Startrahmens in Prozent des Obsidian-Fensters (Einstellungen fileViewerWidthPct, fileViewerHeightPct). */
  widthPct: number;
  heightPct: number;
  /** .md-Dateien färben (Einstellung fileViewerMarkdown), gelesen beim Öffnen. */
  markdown: boolean;
  /** Bilder anzeigen (Einstellung fileViewerImages), gelesen beim Öffnen; aus = Hinweis und Knopf. */
  images: boolean;
  /** Höchstgröße für Bilder in MB (Einstellung fileViewerImageMaxMb). */
  imageMaxMb: number;
  /** Befehlswörter für Text in Backticks (Einstellung fileViewerMdCommands). */
  mdCommands: string;
  /** Eigene Farben je Teil (Einstellungen fileViewerMd<Teil>); leer = Vorgabe des Themes aus dem CSS. */
  mdColors: Readonly<Record<MdPart, string>>;
  /** Nach dem Schließen: Fokus zurück ins Terminal. */
  onClosed: () => void;
}

/**
 * Undo, Standard-Tasten und Tab-Einrückung aus @codemirror/commands, das Obsidian zur Laufzeit mitbringt (im Build extern,
 * aber nicht in node_modules). Fehlt es, bleibt der Editor ohne diese Tasten benutzbar.
 */
function commandExtensions(): Extension[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Obsidian liefert @codemirror/commands erst zur Laufzeit, in node_modules fehlt es
    const cmd = require("@codemirror/commands") as {
      history: () => Extension; defaultKeymap: readonly KeyBinding[]; historyKeymap: readonly KeyBinding[]; indentWithTab: KeyBinding;
    };
    return [cmd.history(), keymap.of([...cmd.defaultKeymap, ...cmd.historyKeymap, cmd.indentWithTab])];
  } catch {
    return [];
  }
}

/** Monospace und Farben aus dem Obsidian-Theme (eigene Klassen statt .cm-* im CSS: Präfix-Regel, fremde Plugins). Die Schriftgröße kommt aus der Variable am Modal (Zoom). */
const EDITOR_THEME = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--background-primary)", color: "var(--text-normal)", fontSize: "var(--cockpit-file-viewer-font-size)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-monospace)", lineHeight: "1.5" },
  ".cm-gutters": { backgroundColor: "var(--background-secondary)", color: "var(--text-faint)", borderRight: "1px solid var(--background-modifier-border)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--background-modifier-hover)" },
  ".cm-activeLineGutter": { color: "var(--text-muted)" },
  ".cm-cursor": { borderLeftColor: "var(--text-normal)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--text-selection)" },
  // Markdown-Farben (Nachtrag 43b): Obsidians Fork vergibt "cm-" + Token-Name; die Farben kommen aus den Variablen am Modal (CSS, Einstellung).
  ".cm-cockpit-md-text": { color: "var(--cockpit-md-text)" },
  ".cm-cockpit-md-code": { color: "var(--cockpit-md-code)" },
  ".cm-cockpit-md-command": { color: "var(--cockpit-md-command)" },
  ".cm-cockpit-md-heading": { color: "var(--cockpit-md-heading)", fontWeight: "bold" },
  ".cm-cockpit-md-link": { color: "var(--cockpit-md-link)" },
  ".cm-cockpit-md-marker": { color: "var(--cockpit-md-marker)" },
  ".cm-cockpit-md-frontmatter": { color: "var(--cockpit-md-frontmatter)" },
  ".cm-cockpit-md-strong": { fontWeight: "bold" },
  ".cm-cockpit-md-em": { fontStyle: "italic" },
});

/** Variable am Modal mit der Schriftgröße im Editor (EDITOR_THEME liest sie). */
const FONT_VAR = `--${CSS_PREFIX}file-viewer-font-size`;
/** Variablen am Bild mit Breite und Höhe in px (Nachtrag 43c); styles.css liest sie am Bild. */
const IMAGE_W_VAR = `--${CSS_PREFIX}image-width`;
const IMAGE_H_VAR = `--${CSS_PREFIX}image-height`;
/** So lange bleibt die Prozentanzeige nach einem Zoom stehen. */
const ZOOM_HINT_MS = 1500;

/** Die acht Griffe zum Größe ändern: Kanten und Ecken. */
const EDGES: readonly Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const mb = (bytes: number): string => (bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 });

/** Rückfrage mit eigenen Knöpfen; der erste ist der hervorgehobene. */
export class ChoiceModal extends Modal {
  private readonly message: string;
  private readonly choices: Array<{ label: string; warning?: boolean; action: () => void }>;

  constructor(app: App, title: string, message: string, choices: Array<{ label: string; warning?: boolean; action: () => void }>) {
    super(app);
    this.setTitle(title);
    this.message = message;
    this.choices = choices;
  }

  onOpen(): void {
    // Umbrüche im Text bleiben stehen (pre-line), etwa eine Lücke je Zeile in der Rückfrage vor /clear (Nachtrag 43j).
    this.contentEl.createEl("p", { text: this.message, cls: `${CSS_PREFIX}choice-message` });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    this.choices.forEach((choice, i) => {
      const button = row.createEl("button", { text: choice.label, cls: choice.warning ? "mod-warning" : i === 0 ? "mod-cta" : "" });
      button.addEventListener("click", () => {
        this.close();
        choice.action();
      });
      if (i === 0) button.focus();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class FileViewerModal extends Modal {
  private readonly target: LinkTarget;
  private readonly options: FileViewerOptions;
  private view: EditorView | null = null;
  /** Esc bei offener Vorschlagsliste schließt erst die Liste (Abend 32). */
  private esc: EscGuard | null = null;
  private mtimeMs = 0;
  private dirty = false;
  private saving = false;
  /** Läuft gerade eine Rückfrage? Dann kein zweites Fenster darüber (Esc kann mehrfach kommen). */
  private asking = false;
  private discard = false;
  /** Zoom in Prozent der Grundschrift; beginnt bei jedem Öffnen bei 100 und wird nicht gespeichert. */
  private zoom = 100;
  /** Bildmodus (Nachtrag 43c): natürliche Maße und Zoom, bei dem das Bild eingepasst ist; null im Textmodus und vor dem Laden des Bildes. */
  private image: { natural: View; fit: number } | null = null;
  /** Blob-URL des Bildes; null vor dem Aufbau und nach dem Schließen (onload prüft das). */
  private imageUrl: string | null = null;
  /** Dateigröße in Bytes und SVG-Kennzeichen für den Titel. */
  private imageBytes = 0;
  private imageSvg = false;
  /** Das Bild-Element, an dem die Größenvariablen hängen. */
  private imageEl: HTMLImageElement | null = null;
  private zoomEl: HTMLElement | null = null;
  private zoomTimer: number | null = null;
  /** Aufsummierter deltaY-Rest des Mausrads und Zeitstempel des letzten Rad-Ereignisses (wheelSteps). */
  private wheelAcc = 0;
  private wheelAt = 0;
  private readonly onWheel = (event: WheelEvent): void => this.wheelZoom(event);
  /** Aktueller Rahmen in CSS-px im Container; null vor dem Öffnen. Wird nicht gespeichert, jedes Öffnen beginnt mit startRect. */
  private rect: Rect | null = null;
  /** Laufendes Ziehen (Verschieben oder Größe ändern): Art, Zeigerstart und Rahmen beim Anfassen. */
  private drag: { kind: "move" | Edge; pointerId: number; x: number; y: number; start: Rect } | null = null;
  /** Abbau der Zeiger-Listener an Kopfzeile und Griffen (onClose). */
  private frameCleanups: Array<() => void> = [];
  /** Obsidian-Fenster ändert die Größe, solange der Viewer offen ist: Rahmen in den neuen Container zurückholen. */
  private readonly onWindowResize = (): void => {
    if (this.rect) this.applyRect(clampRect(this.rect, this.viewSize()));
  };

  constructor(app: App, target: LinkTarget, options: FileViewerOptions) {
    super(app);
    this.target = target;
    this.options = options;
  }

  onOpen(): void {
    // ASSUMPTION: Die Klasse am Container (nicht am Modal) trägt die Lage-Regeln im CSS, weil Obsidians `.modal-container .modal { position: relative }` ein einzelnes `.cockpit-file-viewer` überstimmt (gemessen 22.10.2026).
    this.containerEl.addClass(`${CSS_PREFIX}file-viewer-container`);
    this.modalEl.addClass(`${CSS_PREFIX}file-viewer`);
    this.titleEl.addClass(`${CSS_PREFIX}file-viewer-title`);
    this.contentEl.addClass(`${CSS_PREFIX}file-viewer-content`);
    for (const part of MD_PARTS) {
      const color = this.options.mdColors[part];
      if (color) this.modalEl.style.setProperty(`--${CSS_PREFIX}md-${part}`, color);
    }
    this.updateTitle();
    // ASSUMPTION: Die Anzeige hängt direkt hinter titleEl in dieselbe Kopfzeile (modal-header), weil setTitle nur titleEl leert. Der Schließen-Knopf (modal-header-button) hängt am modalEl, nicht in der Kopfzeile (gemessen 23.10.2026).
    this.zoomEl = createDiv({ cls: `${CSS_PREFIX}file-viewer-zoom` });
    this.titleEl.parentElement?.addClass(`${CSS_PREFIX}file-viewer-header`);
    this.titleEl.after(this.zoomEl);
    this.applyZoom(false);
    this.setupFrame(this.titleEl.parentElement);
    // Cmd+S am Fenster; Esc und X rufen close() (unten), das bei ungespeicherten Änderungen erst fragt.
    this.scope.register(["Mod"], "s", () => {
      void this.save(false);
      return false;
    });
    // Zoom: Mod+Plus (deutsch "+", US "="), Mod+Minus, Mod+0. false = preventDefault, damit der App-Zoom von Obsidian nicht mitläuft.
    for (const key of ["=", "+"]) this.scope.register(["Mod"], key, () => this.zoomBy(1));
    // ASSUMPTION: Zusätzlich Mod+Umschalt+Plus, weil Plus auf der US-Tastatur nur mit Umschalt erreichbar ist und der Scope die Modifier genau vergleicht.
    for (const key of ["=", "+"]) this.scope.register(["Mod", "Shift"], key, () => this.zoomBy(1));
    this.scope.register(["Mod"], "-", () => this.zoomBy(-1));
    this.scope.register(["Mod"], "0", () => this.image ? this.zoomFit() : this.zoomTo(100));
    this.modalEl.addEventListener("wheel", this.onWheel, { passive: false });
    void loadFile(this.target.path, this.options.maxMb, this.options.images ? this.options.imageMaxMb : null).then((result) => this.render(result));
  }

  close(): void {
    if (this.asking) return;
    if (this.esc?.consume()) return;
    if (!this.dirty || this.discard) {
      super.close();
      return;
    }
    this.ask("Ungespeicherte Änderungen", "Die Datei hat ungespeicherte Änderungen.", [
      { label: "Speichern", action: () => void this.save(false).then((saved) => saved && this.close()) },
      { label: "Verwerfen", warning: true, action: () => { this.discard = true; this.close(); } },
      { label: "Weiter bearbeiten", action: () => this.view?.focus() },
    ]);
  }

  onClose(): void {
    this.modalEl.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("resize", this.onWindowResize);
    for (const cleanup of this.frameCleanups) cleanup();
    this.frameCleanups = [];
    this.drag = null;
    if (this.zoomTimer !== null) window.clearTimeout(this.zoomTimer);
    this.zoomTimer = null;
    this.zoomEl?.remove();
    this.zoomEl = null;
    this.esc?.detach();
    this.esc = null;
    this.view?.destroy();
    this.view = null;
    if (this.imageUrl !== null) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = null;
    this.image = null;
    this.imageEl = null;
    this.contentEl.empty();
    this.options.onClosed();
  }

  private render(result: LoadResult): void {
    // Schon wieder zu (schnelles Esc): nichts mehr aufbauen.
    if (!this.containerEl.isConnected) return;
    this.contentEl.empty();
    if (result.kind === "image") {
      this.renderImage(result);
      return;
    }
    if (result.kind !== "text") {
      this.contentEl.createDiv({ cls: `${CSS_PREFIX}file-viewer-hint`, text: hintFor(result, this.options.maxMb, this.options.imageMaxMb) });
      if (result.kind !== "error") this.actionsRow(this.contentEl);
      return;
    }
    this.mtimeMs = result.mtimeMs;
    const host = this.contentEl.createDiv({ cls: `${CSS_PREFIX}file-viewer-editor` });
    const mods = loadCodeModules();
    this.view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: result.text,
        extensions: [
          EditorState.lineSeparator.of(lineSeparatorOf(result.text)),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          EditorView.lineWrapping,
          EDITOR_THEME,
          ...commandExtensions(),
          ...codeExtensions(this.target.path, { autocomplete: this.options.autocomplete, markdown: this.options.markdown, mdCommands: this.options.mdCommands }, mods),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.dirty) {
              this.dirty = true;
              this.updateTitle();
            }
          }),
        ],
      }),
    });
    this.esc = new EscGuard(this.modalEl, this.view, mods);
    this.jump();
  }

  /** Bildansicht (Nachtrag 43c): Blob-URL statt file:// (dort blockiert, gemessen), eingepasst beim Laden, danach Zoom in Prozent der natürlichen Größe. */
  private renderImage(result: Extract<LoadResult, { kind: "image" }>): void {
    this.imageBytes = result.size;
    this.imageSvg = result.mime === "image/svg+xml";
    const url = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }));
    this.imageUrl = url;
    const host = this.contentEl.createDiv({ cls: `${CSS_PREFIX}file-viewer-image` });
    const img = host.createEl("img", { cls: `${CSS_PREFIX}file-viewer-img`, attr: { alt: this.target.path.split(/[\\/]/).pop() ?? "" } });
    this.imageEl = img;
    this.actionsRow(this.contentEl);
    img.onload = () => {
      // Schon wieder zu (onClose gab die URL frei): nichts mehr aufbauen.
      if (!this.imageUrl) return;
      const natural = { width: img.naturalWidth, height: img.naturalHeight };
      const fit = fitPct(natural, { width: host.clientWidth, height: host.clientHeight });
      this.image = { natural, fit };
      this.zoom = fit;
      this.updateTitle();
      this.applyZoom(false);
    };
    img.onerror = () => {
      if (!this.imageUrl) return;
      this.imageEl = null;
      this.contentEl.empty();
      this.contentEl.createDiv({ cls: `${CSS_PREFIX}file-viewer-hint`, text: "Bild nicht lesbar." });
      this.actionsRow(this.contentEl);
    };
    img.src = url;
  }

  /** Sichtbereich für den Rahmen: der Obsidian-Modal-Container über dem ganzen Fenster (CSS-px). */
  private viewSize(): { width: number; height: number } {
    // ASSUMPTION: Ist der Container noch nicht gemessen (0), gilt das Fenster, weil startRect sonst ein Fenster der Größe 0 liefert.
    const width = this.containerEl.clientWidth || window.innerWidth;
    const height = this.containerEl.clientHeight || window.innerHeight;
    return { width, height };
  }

  private startFrame(): Rect {
    return startRect(this.viewSize(), this.options.widthPct, this.options.heightPct);
  }

  /** Rahmen als Inline-Stil setzen; das Modal liegt per CSS absolut im Container, unabhängig von Obsidians Zentrierung. */
  private applyRect(rect: Rect): void {
    this.rect = rect;
    const style = this.modalEl.style;
    style.left = `${rect.left}px`;
    style.top = `${rect.top}px`;
    style.width = `${rect.width}px`;
    style.height = `${rect.height}px`;
  }

  /** Startgröße, Verschieben an der Kopfzeile, Größe ändern an acht Griffen, Doppelklick auf die Kopfzeile = zurück auf die Startgröße. */
  private setupFrame(header: HTMLElement | null): void {
    this.applyRect(this.startFrame());
    window.addEventListener("resize", this.onWindowResize);
    if (header) {
      // Ziehfläche ist die ganze Kopfzeile. Der Schließen-Knopf (Obsidian 1.14.4: modal-header-button, gemessen) hängt direkt am modalEl, nicht in der Kopfzeile; sein Klick erreicht diese Listener nicht, eine Ausnahme dafür ist unnötig.
      const onDown = (event: PointerEvent): void => this.beginDrag(event, "move");
      const onDouble = (): void => this.applyRect(this.startFrame());
      this.bindDrag(header, onDown);
      header.addEventListener("dblclick", onDouble);
      this.frameCleanups.push(() => header.removeEventListener("dblclick", onDouble));
    }
    // Der Schließen-Knopf liegt per Obsidian-z-index (--layer-modal, 50) über den Griffen (z-index 2) und bleibt klickbar.
    for (const edge of EDGES) {
      const handle = this.modalEl.createDiv({ cls: `${CSS_PREFIX}file-viewer-handle`, attr: { "data-edge": edge } });
      this.bindDrag(handle, (event) => this.beginDrag(event, edge));
      this.frameCleanups.push(() => handle.remove());
    }
  }

  /**
   * Zeiger-Listener für Ziehen an einem Element. setPointerCapture am Element, das den Pointer-Down bekam: Bewegung und Loslassen
   * kommen dann auch außerhalb des Modals dort an, ein Loslassen über dem Hintergrund-Overlay (.modal-bg) löst also keinen Klick
   * auf das Overlay aus, der das Modal schließen würde.
   */
  private bindDrag(el: HTMLElement, down: (event: PointerEvent) => void): void {
    const move = (event: PointerEvent): void => this.dragTo(event);
    const end = (event: PointerEvent): void => this.endDrag(event, el);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
    this.frameCleanups.push(() => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.removeEventListener("lostpointercapture", end);
    });
  }

  private beginDrag(event: PointerEvent, kind: "move" | Edge): void {
    // Nur die primäre Taste; ein zweiter Zeiger während des Ziehens startet nichts.
    if (event.button !== 0 || !this.rect || this.drag) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag = { kind, pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: this.rect };
    this.modalEl.addClass(`${CSS_PREFIX}file-viewer-dragging`);
  }

  private dragTo(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const view = this.viewSize();
    this.applyRect(drag.kind === "move" ? moveRect(drag.start, dx, dy, view) : resizeRect(drag.start, drag.kind, dx, dy, view));
  }

  private endDrag(event: PointerEvent, el: HTMLElement): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    this.modalEl.removeClass(`${CSS_PREFIX}file-viewer-dragging`);
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  }

  /** Zoom-Taste: ein Schritt; Rückgabe false für den Scope (preventDefault). */
  private zoomBy(dir: 1 | -1): false {
    this.zoomTo(this.step(this.zoom, dir));
    return false;
  }

  /** Nächster Zoomwert: Bild-Leiter im Bildmodus, sonst die Textstufen. */
  private step(pct: number, dir: 1 | -1): number {
    return this.image ? imageZoomStep(pct, dir) : zoomStep(pct, dir);
  }

  /** Mod+0 im Bildmodus: Einpasswert gegen die aktuelle Größe der Bildfläche neu rechnen und darauf zoomen. */
  private zoomFit(): false {
    const host = this.imageEl?.parentElement;
    if (this.image && host) this.image.fit = fitPct(this.image.natural, { width: host.clientWidth, height: host.clientHeight });
    return this.zoomTo(this.image ? this.image.fit : 100);
  }

  private zoomTo(pct: number): false {
    this.zoom = pct;
    this.applyZoom(true);
    return false;
  }

  /** Mod+Mausrad (Mac: Cmd, Windows: Strg), auf dem Mac auch Strg+Rad (Trackpad-Pinch kommt so an). Schritte nach wheelSteps. */
  private wheelZoom(event: WheelEvent): void {
    const mac = hostPlatform() === "darwin";
    const mod = mac ? event.metaKey || event.ctrlKey : event.ctrlKey;
    if (!mod) return;
    event.preventDefault();
    // Nach einer Pause beginnt die Summe neu (Zeitstempel statt Timer).
    if (event.timeStamp - this.wheelAt > WHEEL_RESET_MS) this.wheelAcc = 0;
    this.wheelAt = event.timeStamp;
    const { steps, acc } = wheelSteps(this.wheelAcc, event.deltaY, event.deltaMode);
    this.wheelAcc = acc;
    if (steps === 0) return;
    // Alle fälligen Schritte auf einmal rechnen, damit Schrift und Anzeige nur einmal wechseln.
    let pct = this.zoom;
    for (let i = 0; i < Math.abs(steps); i++) pct = this.step(pct, steps > 0 ? 1 : -1);
    this.zoomTo(pct);
  }

  /** Schrift am Modal setzen, Editor neu messen und (nach einem Zoom) die Prozentanzeige kurz zeigen. */
  private applyZoom(announce: boolean): void {
    if (this.image && this.imageEl) {
      const size = imageSize(this.image.natural, this.zoom);
      this.imageEl.style.setProperty(IMAGE_W_VAR, `${size.width}px`);
      this.imageEl.style.setProperty(IMAGE_H_VAR, `${size.height}px`);
    } else {
      this.modalEl.style.setProperty(FONT_VAR, `${fontPx(this.options.fontSize, this.zoom)}px`);
      this.view?.requestMeasure();
    }
    const el = this.zoomEl;
    if (!announce || !el) return;
    el.setText(`${this.zoom} %`);
    el.addClass(`${CSS_PREFIX}file-viewer-zoom-on`);
    if (this.zoomTimer !== null) window.clearTimeout(this.zoomTimer);
    this.zoomTimer = window.setTimeout(() => {
      el.removeClass(`${CSS_PREFIX}file-viewer-zoom-on`);
      this.zoomTimer = null;
    }, ZOOM_HINT_MS);
  }

  /** Cursor an :zeile[:spalte], mittig in den Blick; ohne Zeile an den Anfang. */
  private jump(): void {
    const view = this.view;
    if (!view) return;
    const doc = view.state.doc;
    const line = doc.line(Math.min(Math.max(this.target.line ?? 1, 1), doc.lines));
    const pos = line.from + Math.min(Math.max((this.target.col ?? 1) - 1, 0), line.length);
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    view.focus();
  }

  /** true, wenn gespeichert wurde. Bei fremder Änderung seit dem Öffnen erst Rückfrage, dann mit force. */
  private async save(force: boolean): Promise<boolean> {
    const view = this.view;
    if (!view || this.saving) return false;
    this.saving = true;
    try {
      // sliceDoc nimmt den Zeilentrenner der Datei (lineSeparator), toString immer \n.
      const result = await saveFile(this.target.path, view.state.sliceDoc(), this.mtimeMs, force);
      if (result.status === "changed") {
        this.ask("Datei wurde geändert", "Die Datei hat sich seit dem Öffnen geändert, etwa weil Claude sie bearbeitet hat. Deine Fassung überschreibt diese Änderung.", [
          { label: "Abbrechen", action: () => this.view?.focus() },
          { label: "Überschreiben", warning: true, action: () => void this.save(true) },
        ]);
        return false;
      }
      this.mtimeMs = result.mtimeMs;
      this.dirty = false;
      this.updateTitle();
      new Notice("Gespeichert");
      return true;
    } catch (e) {
      new Notice(`Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      this.saving = false;
    }
  }

  private ask(title: string, message: string, choices: Array<{ label: string; warning?: boolean; action: () => void }>): void {
    this.asking = true;
    const modal = new ChoiceModal(this.app, title, message, choices.map((c) => ({ ...c, action: () => { this.asking = false; c.action(); } })));
    const closeChoice = modal.onClose.bind(modal);
    // Mit Esc weggeklickt: keine Wahl, zurück in den Editor.
    modal.onClose = () => {
      closeChoice();
      if (this.asking) {
        this.asking = false;
        this.view?.focus();
      }
    };
    modal.open();
  }

  private actionsRow(parent: HTMLElement): void {
    const row = parent.createDiv({ cls: `${CSS_PREFIX}file-viewer-actions` });
    const button = row.createEl("button", { text: "Mit Standardprogramm öffnen" });
    button.addEventListener("click", () => {
      void openWithDefaultApp(this.target.path).then((msg) => {
        if (msg !== null) new Notice(`Öffnen fehlgeschlagen: ${msg}`);
      });
    });
  }

  private updateTitle(): void {
    const info = this.image ? ` — ${imageInfo(this.image.natural.width, this.image.natural.height, this.imageBytes, this.imageSvg)}` : "";
    this.setTitle(`${this.dirty ? "● " : ""}${shortPath(this.target.path, this.options.home, hostPlatform())}${info}`);
  }
}

function hintFor(result: Exclude<LoadResult, { kind: "text" | "image" }>, maxMb: number, imageMaxMb: number): string {
  switch (result.kind) {
    case "tooLarge":
      if (result.image) return `Das Bild ist ${mb(result.size)} MB groß, die Höchstgröße für Bilder liegt bei ${imageMaxMb} MB (Einstellung „Datei-Viewer: Höchstgröße Bilder (MB)“).`;
      return `Die Datei ist ${mb(result.size)} MB groß, die Höchstgröße liegt bei ${maxMb} MB (Einstellung „Datei-Viewer: Höchstgröße (MB)“).`;
    case "binary":
      return "Binärdatei, keine Anzeige im Fenster.";
    case "notUtf8":
      return "Kein gültiges UTF-8, keine Anzeige: Speichern würde die Datei verändern.";
    case "error":
      return `Datei nicht lesbar: ${result.message}`;
  }
}
