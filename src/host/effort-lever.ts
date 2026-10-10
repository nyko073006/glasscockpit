import { EFFORT_STEPS } from "../core/constants";
import type { EffortStep } from "../core/effort";
import { leverKeyStep, leverMarks, leverValueText, pointerPosition, positionStep, stepPosition } from "../core/effort-lever";

/**
 * Effort-Schieber auf dem Bildschirm (Abend 19e, Teil A; Grundlage der Hebel aus 18b): senkrechter Schlitz mit flachem Griff und
 * sechs beschrifteten Stufen als DOM, nur DOM-APIs (das Dokument kommt vom Aufrufer, Pop-out-Fenster haben ein eigenes). Die Rechnung
 * steht in `src/core/effort-lever.ts`.
 *
 * Bedienung: Den Griff ziehen (Pointer-Events mit Capture, Maus, Stift und Finger), beim Loslassen rastet er auf der nächsten
 * Stufe ein; während des Ziehens leuchtet die Beschriftung der Stufe unter dem Griff. Auf eine Beschriftung klicken springt dorthin;
 * als `role="slider"` auch mit den Pfeiltasten, Pos1 und Ende. Gemeldet wird erst beim Loslassen, höchstens einmal je Zug und nur,
 * wenn die Stufe eine andere ist: `onSet` kommt nie mitten aus einem Zug.
 */
export interface EffortLeverOptions {
  doc: Document;
  /** Der Schieber wird hier eingehängt (Inhalt des Feldes `effort`). */
  host: HTMLElement;
  /** Eine andere Stufe wurde gewählt (loslassen, Klick auf die Beschriftung, Taste). */
  onSet: (step: EffortStep) => void;
}

export interface EffortLever {
  /** Stand von außen (Feed): setzt Griff und Anzeige, außer der Griff wird gerade gezogen (dann gilt der Stand beim Loslassen als alte Stufe). */
  show(step: EffortStep): void;
  /** Der Schieber selbst (der Slider). */
  readonly el: HTMLElement;
}

export function mountEffortLever(opts: EffortLeverOptions): EffortLever {
  const { doc } = opts;
  const make = (tag: string, cls: string, text?: string): HTMLElement => {
    const e = doc.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const lever = make("div", "cockpit-effort-lever");
  lever.setAttribute("role", "slider");
  lever.setAttribute("tabindex", "0");
  lever.setAttribute("aria-label", "Effort der nächsten Sitzung");
  lever.setAttribute("aria-orientation", "vertical");
  lever.setAttribute("aria-valuemin", "0");
  lever.setAttribute("aria-valuemax", String(EFFORT_STEPS.length - 1));

  // Der Schlitz ist der Weg der Griffmitte; Marken, Beschriftungen und Griff sitzen darin über `--pos` (Anteil von oben).
  const rail = make("div", "cockpit-effort-rail");
  rail.append(make("div", "cockpit-effort-slot"));
  const marks = new Map<EffortStep, HTMLElement>();
  for (const m of leverMarks()) {
    const tick = make("div", "cockpit-effort-tick");
    tick.style.setProperty("--pos", String(m.position));
    const label = make("div", "cockpit-effort-mark", m.step);
    label.dataset.step = m.step;
    label.style.setProperty("--pos", String(m.position));
    label.addEventListener("click", () => choose(m.step));
    marks.set(m.step, label);
    rail.append(tick, label);
  }
  const knob = make("div", "cockpit-effort-knob");
  knob.append(make("div", "cockpit-effort-grip"));
  rail.append(knob);
  lever.append(rail);
  opts.host.append(lever);

  /** Gewählte Stufe (zuletzt vom Feed oder von hier); der Vergleichswert für „geändert“. */
  let committed: EffortStep | null = null;
  let dragging: { id: number; offset: number; pos: number } | null = null;

  const markOn = (step: EffortStep | null) => {
    for (const [s, e] of marks) e.classList.toggle("cockpit-effort-mark-on", s === step);
  };
  const placeKnob = (pos: number) => knob.style.setProperty("--pos", String(pos));

  function render(step: EffortStep): void {
    placeKnob(stepPosition(step));
    markOn(step);
    lever.setAttribute("aria-valuenow", String(EFFORT_STEPS.indexOf(step)));
    lever.setAttribute("aria-valuetext", leverValueText(step));
    lever.dataset.step = step;
  }

  function choose(step: EffortStep): void {
    const changed = step !== committed;
    committed = step;
    render(step);
    if (changed) opts.onSet(step);
  }

  const posOf = (e: PointerEvent, offset: number): number | null => {
    const r = rail.getBoundingClientRect();
    return pointerPosition(e.clientY, r.top, r.height, offset);
  };
  const capture = (e: PointerEvent, on: boolean) => {
    try {
      if (on) lever.setPointerCapture(e.pointerId);
      else if (lever.hasPointerCapture?.(e.pointerId)) lever.releasePointerCapture(e.pointerId);
    } catch { /* Capture ist nur eine Hilfe: ohne sie läuft das Ziehen über die Fläche */ }
  };
  /** Im Zug wandert nur die Anzeige (Griff frei, Beschriftung der Stufe darunter); gemeldet wird beim Loslassen. */
  const drag = (pos: number) => {
    if (dragging === null) return;
    dragging.pos = pos;
    placeKnob(pos);
    markOn(positionStep(pos));
  };

  lever.addEventListener("pointerdown", (e) => {
    // Vor dem ersten Stand aus dem Feed hat der Schieber keine Stufe, die er verlassen könnte.
    if (committed === null || dragging !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
    // Auf einer Beschriftung zieht niemand, sie springt per Klick.
    if (e.target instanceof Element && e.target.closest(".cockpit-effort-mark")) return;
    const r = rail.getBoundingClientRect();
    if (!(r.height > 0)) return;
    e.preventDefault();
    // Am Griff gefasst bleibt der Griff unter dem Finger; irgendwo im Schlitz springt er unter den Zeiger.
    const onKnob = e.target instanceof Element && e.target.closest(".cockpit-effort-knob") !== null;
    const centre = r.top + stepPosition(committed) * r.height;
    const offset = onKnob ? e.clientY - centre : 0;
    dragging = { id: e.pointerId, offset, pos: 0 };
    lever.classList.add("cockpit-effort-dragging");
    capture(e, true);
    try { lever.focus({ preventScroll: true }); } catch { /* ohne Fokus weiter */ }
    drag(posOf(e, offset) ?? stepPosition(committed));
  });

  lever.addEventListener("pointermove", (e) => {
    if (dragging === null || e.pointerId !== dragging.id) return;
    const pos = posOf(e, dragging.offset);
    if (pos !== null) drag(pos);
  });

  const finish = (e: PointerEvent, cancelled: boolean) => {
    if (dragging === null || e.pointerId !== dragging.id) return;
    const { pos } = dragging;
    dragging = null;
    lever.classList.remove("cockpit-effort-dragging");
    capture(e, false);
    // Abbruch (Fenster verliert den Zeiger) lässt den Schieber, wo er war.
    if (cancelled || committed === null) {
      if (committed !== null) render(committed);
      return;
    }
    choose(positionStep(pos));
  };
  lever.addEventListener("pointerup", (e) => finish(e, false));
  lever.addEventListener("pointercancel", (e) => finish(e, true));

  lever.addEventListener("keydown", (e) => {
    if (committed === null || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = leverKeyStep(committed, e.key);
    if (step === null) return;
    e.preventDefault();
    e.stopPropagation();
    choose(step);
  });

  return {
    el: lever,
    show(step: EffortStep): void {
      committed = step;
      if (dragging === null) render(step);
    },
  };
}
