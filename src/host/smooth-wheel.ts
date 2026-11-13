import { SmoothWheel, type WheelTuning, cellAt, takesOverWheel, wheelSequence } from "../core/smooth-wheel";

// Weich scrollen (Nachtrag 43f): Übernahme von Trackpad und Mausrad am xterm. Im Vollbild (Maus-Modus mit SGR) schickt xterm je
// Ereignis eine Zeile; hier zählt der Kern (core/smooth-wheel.ts) den Weg des Rads und je Bild gehen die ganzen Zeilen als
// SGR-Meldungen in einem Schreibvorgang an die PTY. Zeitgeber kommen eingespeist (Fenster des Containers, je Aufruf gelesen).

export interface SmoothWheelSource { enabled(): boolean; tuning(): WheelTuning }

export interface WheelTerm {
  readonly cols: number;
  readonly rows: number;
  readonly modes: { readonly mouseTrackingMode: string };
  attachCustomWheelEventHandler(handler: (event: WheelEvent) => boolean): void;
}

export interface WheelTakeoverDeps {
  term: WheelTerm;
  /** Das Element `.xterm-screen`; seine Höhe geteilt durch die Zeilenzahl ist die Zellhöhe. */
  screen(): HTMLElement | null;
  /** Ist SGR-Mausformat (1006) an? */
  sgr(): boolean;
  source: SmoothWheelSource;
  write(data: string): void;
  schedule(cb: () => void): number;
  cancel(handle: number): void;
}

export class WheelTakeover {
  private readonly wheel = new SmoothWheel();
  private frame: number | null = null;
  private cell = { col: 1, row: 1 };
  private disposed = false;
  private readonly deps: WheelTakeoverDeps;

  /** Meldet den Handler am xterm an (xterm hält nur einen). */
  constructor(deps: WheelTakeoverDeps) {
    this.deps = deps;
    deps.term.attachCustomWheelEventHandler((event) => this.handle(event));
  }

  /** Rückgabe false: das Cockpit hat das Ereignis übernommen, xterm tut nichts; true: xterm wie bisher. */
  handle(event: WheelEvent): boolean {
    if (this.disposed) return true;
    const { term, source } = this.deps;
    const screen = this.deps.screen();
    const rect = screen?.getBoundingClientRect();
    // Breite 0 würde in cellAt NaN ergeben: dann keine Übernahme.
    const measurable = rect !== undefined && rect.width > 0 && term.rows > 0;
    const cellHeight = measurable ? rect.height / term.rows : 0;
    const takes = measurable && takesOverWheel({
      enabled: source.enabled(), tracking: term.modes.mouseTrackingMode !== "none", sgr: this.deps.sgr(),
      deltaY: event.deltaY, cellHeight,
      shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,
    });
    if (!takes || !rect) {
      this.wheel.reset();
      return true;
    }
    event.preventDefault();
    event.stopPropagation();
    this.cell = cellAt(event.clientX, event.clientY, rect, term.cols, term.rows);
    const ready = this.wheel.add(event, cellHeight, term.rows, source.tuning());
    if (ready && this.frame === null) this.frame = this.deps.schedule(() => this.run());
    return false;
  }

  /** Offenes Bild abbrechen; danach reicht der Handler alles an xterm durch. */
  dispose(): void {
    this.disposed = true;
    if (this.frame !== null) this.deps.cancel(this.frame);
    this.frame = null;
    this.wheel.reset();
  }

  private fullscreen(): boolean {
    const { term, source } = this.deps;
    return source.enabled() && term.modes.mouseTrackingMode !== "none" && this.deps.sgr();
  }

  private run(): void {
    this.frame = null;
    if (this.disposed) return;
    // Vollbild und Schalter frisch lesen: Endet es vor dem Bild, geht nichts mehr an die PTY und der Rest verfällt.
    if (!this.fullscreen()) {
      this.wheel.reset();
      return;
    }
    const lines = this.wheel.take(this.deps.source.tuning().maxPerFrame);
    if (lines !== 0) this.deps.write(wheelSequence(lines, this.cell.col, this.cell.row));
    if (this.wheel.due()) this.frame = this.deps.schedule(() => this.run());
  }
}
