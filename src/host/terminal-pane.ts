import { FitAddon } from "@xterm/addon-fit";
import { type ILinkProvider, Terminal } from "@xterm/xterm";
import {
  CSS_PREFIX,
  TERMINAL_FONT_FAMILY,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_MAC_OPTION_IS_META,
} from "../core/constants";
import { type FoundLine, firstNonEmptyLine } from "../core/diagnose";
import { bufferRowOf, type CellRow } from "../core/file-links";
import { OBSIDIAN_STATUS_BAR, bottomOverlap } from "../core/status-bar";
import { type TerminalOptions, changedXtermOptions, xtermOptions } from "../core/terminal-options";
import { type Dimensions, usableDimensions } from "../core/terminal-size";
import { type ReadVar, buildTheme } from "../core/xterm-theme";
import { createCssColorReader } from "./css-vars";
import { TerminalInput } from "./terminal-input";

export type ResizeCallback = (cols: number, rows: number) => void;
export type InputCallback = (data: string) => void;


/**
 * xterm-Pane in einem Container. Nur FitAddon, kein WebGL: Es rendert der DOM-Renderer.
 * Listener kommen vom Fenster des Containers, nie vom globalen window (Pop-out-Fenster).
 */
export class TerminalPane {
  private readonly onResize: ResizeCallback;
  private readonly host: HTMLElement;
  private readonly container: HTMLElement;
  // Pixel, die Obsidians Statusleiste unten in die Pane ragt; so viel Abstand hält der Host unten frei.
  private inset = 0;
  private readonly term: Terminal;
  private readonly fitAddon = new FitAddon();
  private readonly observer: ResizeObserver;
  private readonly readColor: ReadVar;
  private lastReported: string | null = null;
  private disposed = false;
  private renders = 0;

  /** Ziel für Paste, Tasten-Sequenzen und Drop; gesetzt, sobald eine Sitzung hängt. */
  private sink: InputCallback | null = null;
  private readonly input: TerminalInput;

  constructor(container: HTMLElement, onResize: ResizeCallback, vaultBase: () => string | null, options: TerminalOptions) {
    this.onResize = onResize;
    this.container = container;
    // Der Container muss bemaßt sein (position absolute, inset 0), sonst misst xterm 0 px.
    this.host = container.createDiv({ cls: `${CSS_PREFIX}terminal-host` });
    this.readColor = createCssColorReader(container);

    this.term = new Terminal({
      ...xtermOptions(options),
      cursorBlink: true,
      // Die PTY liefert später selbst CRLF.
      convertEol: false,
      lineHeight: TERMINAL_LINE_HEIGHT,
      fontFamily: TERMINAL_FONT_FAMILY,
      macOptionIsMeta: TERMINAL_MAC_OPTION_IS_META,
      theme: buildTheme(this.readColor),
    });
    this.term.loadAddon(this.fitAddon);
    this.term.open(this.host);
    this.input = new TerminalInput({
      term: this.term,
      container,
      write: (data) => this.sink?.(data),
      vaultBase,
    });
    // Diagnose „leere Pane“: Zeichnet xterm überhaupt?
    this.term.onRender(() => this.renders++);

    const win = container.win as Window & typeof globalThis;
    this.observer = new win.ResizeObserver(() => {
      this.updateInset();
      this.fit();
    });
    this.observer.observe(this.host);
    this.updateInset();
    this.fit();
  }

  /**
   * Obsidians Statusleiste (.status-bar) schwebt unten rechts über der Pane und verdeckte dort die unterste
   * Zeile. Hier wird gemessen, wie weit sie hineinragt, und der Host unten um genau so viel gekürzt. Die Leiste
   * wird im Dokument der Pane gesucht (Pop-out-Fenster); fehlt sie dort, bleibt der Abstand 0.
   * Aufrufen bei Größenänderung und layout-change.
   */
  updateInset(): void {
    if (this.disposed) return;
    const bar = this.container.ownerDocument.querySelector(OBSIDIAN_STATUS_BAR);
    const px = bar ? Math.ceil(bottomOverlap(this.container.getBoundingClientRect(), bar.getBoundingClientRect())) : 0;
    if (px === this.inset) return;
    this.inset = px;
    this.host.style.bottom = `${px}px`;
    this.fit();
  }

  /** fit() nur mit tauglichen Maßen: Versteckte Tabs messen 0 px. */
  fit(): void {
    if (this.disposed) return;
    const dims = usableDimensions(this.fitAddon.proposeDimensions(), {
      width: this.host.clientWidth,
      height: this.host.clientHeight,
    });
    if (!dims) return;

    this.fitAddon.fit();
    const key = `${this.term.cols}x${this.term.rows}`;
    if (key !== this.lastReported) {
      this.lastReported = key;
      this.onResize(this.term.cols, this.term.rows);
    }
  }

  /** Schriftgröße, Scrollback und Mindestkontrast live setzen, danach neu einpassen (die Zeichenzelle ändert sich). */
  applyOptions(options: TerminalOptions): void {
    if (this.disposed) return;
    Object.assign(this.term.options, changedXtermOptions(this.term.options, options));
    this.fit();
  }

  /** Theme neu aus den Obsidian-Variablen lesen (Workspace-Event css-change). */
  refreshAppearance(): void {
    if (this.disposed) return;
    this.term.options.theme = buildTheme(this.readColor);
  }

  /** onParsed kommt, sobald xterm diese Portion (und damit alles davor) geparst hat; xterm parst asynchron. */
  write(data: string, onParsed?: () => void): void {
    if (!this.disposed) this.term.write(data, onParsed);
  }

  /**
   * Tastatureingaben aus xterm und alles, was die Pane selbst eingibt (Paste, Sequenzen, Drop),
   * gehen an denselben Rückruf. Gibt eine Abmeldung zurück.
   */
  onInput(callback: InputCallback): () => void {
    const sub = this.term.onData(callback);
    this.sink = callback;
    return () => {
      sub.dispose();
      if (this.sink === callback) this.sink = null;
    };
  }

  /**
   * OSC-Handler für `ident`. data kommt ohne „ident;“. Rückgabe false lässt xterm die Sequenz
   * weiter verarbeiten (fremde Sequenzen). Gibt die Abmeldung zurück.
   */
  onOsc(ident: number, handler: (data: string) => boolean): () => void {
    const sub = this.term.parser.registerOscHandler(ident, handler);
    return () => sub.dispose();
  }

  /**
   * Link-Provider anmelden (Datei-Viewer, Abend 27). setModifier hört Cmd an der Pane (keydown/keyup in der Capture-Phase,
   * vor xterm), damit ein Link unter der Maus beim Drücken unterstrichen wird. Gibt die Abmeldung zurück.
   */
  registerLinkProvider(provider: ILinkProvider & { setModifier?: (meta: boolean) => void }): () => void {
    const sub = this.term.registerLinkProvider(provider);
    const onKey = (event: KeyboardEvent): void => provider.setModifier?.(event.metaKey);
    this.container.addEventListener("keydown", onKey, true);
    this.container.addEventListener("keyup", onKey, true);
    return () => {
      sub.dispose();
      this.container.removeEventListener("keydown", onKey, true);
      this.container.removeEventListener("keyup", onKey, true);
    };
  }

  /** Pufferzeile y (ab 1, wie xterms IBufferRange) als Zellen; null außerhalb des Puffers. */
  bufferRow(y: number): CellRow | null {
    if (this.disposed) return null;
    const line = this.term.buffer.active.getLine(y - 1);
    return line ? bufferRowOf(line, this.term.cols) : null;
  }

  /** Maße nach dem letzten tauglichen fit(), sonst null. */
  fittedSize(): Dimensions | null {
    if (this.disposed || this.lastReported === null) return null;
    return { cols: this.term.cols, rows: this.term.rows };
  }

  /** Messwerte für die Diagnose: Puffer, gezeichnete DOM-Zeilen, Maße. */
  probe(): {
    bufferLine: FoundLine | null;
    domLine: FoundLine | null;
    cols: number;
    rows: number;
    widthPx: number;
    heightPx: number;
    renders: number;
  } | null {
    if (this.disposed) return null;
    const buffer = this.term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
    const rows = this.host.querySelector(".xterm-rows");
    const domLines = rows ? Array.from(rows.children, (row) => row.textContent ?? "") : [];
    return {
      bufferLine: firstNonEmptyLine(lines),
      domLine: firstNonEmptyLine(domLines),
      cols: this.term.cols,
      rows: this.term.rows,
      widthPx: this.host.clientWidth,
      heightPx: this.host.clientHeight,
      renders: this.renders,
    };
  }

  focus(): void {
    if (!this.disposed) this.term.focus();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    this.input.dispose();
    this.sink = null;
    this.term.dispose();
    this.host.remove();
  }
}
