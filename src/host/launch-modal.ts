import { type App, type FuzzyMatch, FuzzySuggestModal } from "obsidian";
import type { LaunchEntry, LaunchKind, LaunchSource } from "../core/discovery";

const PLACEHOLDER: Record<LaunchKind, string> = {
  skill: "Skill starten …",
  agent: "Agent starten …",
  command: "Slash-Befehl einfügen …",
};

const SOURCE_LABEL: Record<LaunchSource, string> = {
  user: "Nutzer",
  vault: "Vault",
  project: "Projekt",
  plugin: "Plugin",
  builtin: "eingebaut",
};

/** Auswahl aus Skills, Agents oder Commands. Die Liste kommt fertig, gelesen wird vor dem Öffnen. */
export class LaunchModal extends FuzzySuggestModal<LaunchEntry> {
  private readonly entries: LaunchEntry[];
  private readonly choose: (entry: LaunchEntry) => void;

  constructor(app: App, kind: LaunchKind, entries: LaunchEntry[], choose: (entry: LaunchEntry) => void) {
    super(app);
    this.entries = entries;
    this.choose = choose;
    this.setPlaceholder(PLACEHOLDER[kind]);
  }

  getItems(): LaunchEntry[] {
    return this.entries;
  }

  getItemText(item: LaunchEntry): string {
    return `${item.name} ${item.description}`;
  }

  renderSuggestion(match: FuzzyMatch<LaunchEntry>, el: HTMLElement): void {
    const entry = match.item;
    el.addClass("cockpit-launch-item");
    const head = el.createDiv({ cls: "cockpit-launch-head" });
    head.createSpan({ cls: "cockpit-launch-name", text: entry.kind === "agent" ? entry.name : `/${entry.name}` });
    head.createSpan({ cls: "cockpit-launch-source", text: SOURCE_LABEL[entry.source] });
    if (entry.description) el.createDiv({ cls: "cockpit-launch-desc", text: entry.description });
  }

  onChooseItem(item: LaunchEntry): void {
    this.choose(item);
  }
}
