import { type App, type FuzzyMatch, FuzzySuggestModal } from "obsidian";
import { EFFORT_STEPS } from "../core/constants";
import type { EffortStep } from "../core/effort";

const HINT: Record<EffortStep, string> = {
  aus: "kein Flag, es gilt settings.json",
  low: "--effort low",
  medium: "--effort medium",
  high: "--effort high",
  xhigh: "--effort xhigh",
  max: "--effort max",
};

/** Auswahl der Stufe für die nächste Claude-Sitzung; die aktuelle ist markiert. Gespeichert wird im Aufrufer. */
export class EffortModal extends FuzzySuggestModal<EffortStep> {
  private readonly current: EffortStep;
  private readonly choose: (step: EffortStep) => void;

  constructor(app: App, current: EffortStep, choose: (step: EffortStep) => void) {
    super(app);
    this.current = current;
    this.choose = choose;
    this.setPlaceholder("Effort für nächste Sitzung …");
  }

  getItems(): EffortStep[] {
    return [...EFFORT_STEPS];
  }

  getItemText(item: EffortStep): string {
    return item;
  }

  renderSuggestion(match: FuzzyMatch<EffortStep>, el: HTMLElement): void {
    const step = match.item;
    el.addClass("cockpit-launch-item");
    const head = el.createDiv({ cls: "cockpit-launch-head" });
    head.createSpan({ cls: "cockpit-launch-name", text: step });
    if (step === this.current) head.createSpan({ cls: "cockpit-launch-source", text: "aktuell" });
    el.createDiv({ cls: "cockpit-launch-desc", text: HINT[step] });
  }

  onChooseItem(item: EffortStep): void {
    this.choose(item);
  }
}
