import { type App, type FuzzyMatch, FuzzySuggestModal, Notice, setIcon } from "obsidian";
import { readdirSync } from "fs";
import { homedir } from "os";
import { hostPlatform } from "./host-platform";
import { ChoiceModal } from "./file-viewer-modal";
import { type SessionChoice, loadProjectDirs, parseHiddenDirs, sessionChoices, vaultFirst } from "../core/new-session";

export interface NewSessionDeps {
  vaultPath: () => string;
  projectsRoot: () => string;
  /** Nachtrag Abend 41: Einstellung „Ausgeblendete Ordner“ (Rohtext), bei jedem Öffnen frisch gelesen. */
  hiddenDirs: () => string;
  /** Abend 19h: Einträge „Weiter: …“, beim Öffnen frisch gelesen. */
  handoffs: SessionChoice[];
  /** Nachtrag 40a: Leser „zuletzt benutzt“ oder undefined (Einstellung „Alphabetisch“); bei jedem Aufruf frisch, innerhalb eines Dialogs derselbe Leser. */
  lastUsed: () => ((cwd: string) => number) | undefined;
  choose: (choice: SessionChoice) => void;
  /** Nachtrag 43g: Handoff wegmachen (status: verworfen). true = geschrieben, dann verschwindet der Eintrag aus dem Dialog. */
  dismiss: (choice: SessionChoice) => Promise<boolean>;
}

/** „Neue Sitzung“: Vault, Home und jeder Ordner unter dem Projekte-Ordner, bei jedem Öffnen neu gelesen. */
export class NewSessionModal extends FuzzySuggestModal<SessionChoice> {
  private readonly deps: NewSessionDeps;
  private warned = false; // getItems läuft bei jeder Eingabe, die Notice nur einmal je Modal
  /** Nachtrag 43g: Handoffs dieses Dialogs; weggemachte fallen hier raus, deps.handoffs bleibt unverändert. */
  private handoffs: SessionChoice[];

  constructor(app: App, deps: NewSessionDeps) {
    super(app);
    this.deps = deps;
    this.handoffs = [...deps.handoffs];
    this.setPlaceholder("Wo soll claude starten?");
  }

  getItems(): SessionChoice[] {
    const home = homedir();
    const { root, dirs, error } = loadProjectDirs(this.deps.projectsRoot(), home, (r) =>
      readdirSync(r, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
      hostPlatform(),
    );
    if (error !== undefined) {
      console.warn(`Glasscockpit: Projekte-Ordner nicht lesbar (${root}), nur Vault und Home`, error);
      if (!this.warned) new Notice(`Projektordner nicht lesbar: ${root} (${error}). Einstellungen → Glasscockpit.`, 10000);
      this.warned = true;
    }
    return [...this.handoffs, ...sessionChoices(this.deps.vaultPath(), home, root, dirs, this.deps.lastUsed(), parseHiddenDirs(this.deps.hiddenDirs()), hostPlatform())];
  }

  /** „claude (Vault)“ steht vor den Projekten, offene Handoffs („Weiter“) stehen davor: Enter ohne Eingabe nimmt den obersten Eintrag, bei offenen Handoffs also „Weiter“, sonst den Vault. */
  getSuggestions(query: string): FuzzyMatch<SessionChoice>[] {
    const r = vaultFirst(super.getSuggestions(query), this.deps.vaultPath(), (m) => m.item.cwd);
    return [...r.filter((m) => m.item.handoff), ...r.filter((m) => !m.item.handoff)];
  }

  getItemText(item: SessionChoice): string {
    return item.label;
  }

  /** Nachtrag 43g: „Weiter“-Einträge bekommen rechts ein x zum Wegmachen, mit Rückfrage. */
  renderSuggestion(match: FuzzyMatch<SessionChoice>, el: HTMLElement): void {
    super.renderSuggestion(match, el);
    const choice = match.item;
    if (!choice.handoff) return;
    el.addClass("cockpit-handoff-item");
    const button = el.createEl("button", { cls: "clickable-icon cockpit-handoff-dismiss", attr: { "aria-label": "Handoff wegmachen" } });
    setIcon(button, "x");
    // Klick und mousedown nicht an die Liste weitergeben, sonst startet der Eintrag die Sitzung.
    button.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.confirmDismiss(choice);
    });
  }

  private confirmDismiss(choice: SessionChoice): void {
    new ChoiceModal(this.app, "Handoff wegmachen?", `„${choice.label}“ bekommt status: verworfen und zählt nicht mehr als offen. Die Datei bleibt erhalten.`, [
      { label: "Abbrechen", action: () => this.inputEl.focus() },
      {
        label: "Wegmachen",
        warning: true,
        action: () => void this.deps.dismiss(choice).then((ok) => {
          if (ok) this.handoffs = this.handoffs.filter((h) => h.handoff?.path !== choice.handoff?.path);
          // Liste neu aufbauen, Eingabe behalten.
          this.inputEl.dispatchEvent(new Event("input"));
          this.inputEl.focus();
        }),
      },
    ]).open();
  }

  onChooseItem(item: SessionChoice): void {
    this.deps.choose(item);
  }
}
