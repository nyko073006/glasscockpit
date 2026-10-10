import { type App, type FuzzyMatch, FuzzySuggestModal, Notice } from "obsidian";
import { readdirSync } from "fs";
import { homedir } from "os";
import { type SessionChoice, loadProjectDirs, sessionChoices, vaultFirst } from "../core/new-session";

export interface NewSessionDeps {
  vaultPath: () => string;
  projectsRoot: () => string;
  /** Abend 19h: Einträge „Weiter: …“, beim Öffnen frisch gelesen. */
  handoffs: SessionChoice[];
  choose: (choice: SessionChoice) => void;
}

/** „Neue Sitzung“: Vault, Home und jeder Ordner unter dem Projekte-Ordner, bei jedem Öffnen neu gelesen. */
export class NewSessionModal extends FuzzySuggestModal<SessionChoice> {
  private readonly deps: NewSessionDeps;
  private warned = false; // getItems läuft bei jeder Eingabe, die Notice nur einmal je Modal

  constructor(app: App, deps: NewSessionDeps) {
    super(app);
    this.deps = deps;
    this.setPlaceholder("Wo soll claude starten?");
  }

  getItems(): SessionChoice[] {
    const home = homedir();
    const { root, dirs, error } = loadProjectDirs(this.deps.projectsRoot(), home, (r) =>
      readdirSync(r, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );
    if (error !== undefined) {
      console.warn(`Glasscockpit: Projekte-Ordner nicht lesbar (${root}), nur Vault und Home`, error);
      if (!this.warned) new Notice(`Projektordner nicht lesbar: ${root} (${error}). Einstellungen → Glasscockpit.`, 10000);
      this.warned = true;
    }
    return [...this.deps.handoffs, ...sessionChoices(this.deps.vaultPath(), home, root, dirs)];
  }

  /** „claude (Vault)“ steht vor den Projekten, offene Handoffs („Weiter“) stehen davor: Enter ohne Eingabe nimmt den obersten Eintrag, bei offenen Handoffs also „Weiter“, sonst den Vault. */
  getSuggestions(query: string): FuzzyMatch<SessionChoice>[] {
    const r = vaultFirst(super.getSuggestions(query), this.deps.vaultPath(), (m) => m.item.cwd);
    return [...r.filter((m) => m.item.handoff), ...r.filter((m) => !m.item.handoff)];
  }

  getItemText(item: SessionChoice): string {
    return item.label;
  }

  onChooseItem(item: SessionChoice): void {
    this.deps.choose(item);
  }
}
