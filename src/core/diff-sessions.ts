// Diff-Ansicht (Abend 17): Welche Diffs sind offen, und wer wartet auf die Entscheidung? Rein, ohne Obsidian: Die Ansicht
// hängt über show/hide an. openDiff blockiert über das Versprechen von open(), bis entschieden ist. Jede Art, einen Diff zu
// beenden (Annehmen, Ablehnen, Tab schließen, close_tab, Verbindung weg, Entladen), löst das Versprechen genau einmal auf;
// nichts bleibt hängen. Alles außer ausdrücklichem Annehmen heißt abgelehnt.
import type { Decision } from "./ide-diff";

export interface DiffRequest {
  tabName: string;
  oldFilePath: string;
  newFilePath: string;
  newFileContents: string;
  /** Inhalt der Datei vor der Änderung; null, wenn es sie noch nicht gibt (neue Datei). */
  oldContents: string | null;
  /** Verbindung, die den Diff angefordert hat (null, wenn unbekannt). */
  clientId: number | null;
}

export interface DiffSessionsDeps {
  /** Tab zeigen (oder den vorhandenen mit gleichem Namen ersetzen). Darf werfen: dann gilt der Diff als abgelehnt. */
  show(req: DiffRequest, id: string): void;
  /** Tab schließen, weil der Diff ohne Zutun des Nutzers endet. Nicht aufgerufen, wenn der Nutzer den Tab selbst schloss. */
  hide(id: string): void;
}

interface Entry { id: string; req: DiffRequest; resolve: (d: Decision) => void }

export class DiffSessions {
  private readonly entries = new Map<string, Entry>();
  private nextId = 1;
  private readonly deps: DiffSessionsDeps;
  private readonly run: string;

  /**
   * Die ids tragen eine Lauf-Kennung: Ein nach dem Neuladen wiederhergestellter Alt-Tab hält die id des früheren Laufs
   * (der Zähler beginnt je Lauf bei 1) und darf nie einen neuen Diff treffen.
   */
  constructor(deps: DiffSessionsDeps, run: string = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`) {
    this.deps = deps;
    this.run = run;
  }

  get size(): number {
    return this.entries.size;
  }

  has(tabName: string): boolean {
    return this.byName(tabName) !== null;
  }

  get(id: string): DiffRequest | null {
    return this.entries.get(id)?.req ?? null;
  }

  /** Diff öffnen. Ein offener Diff derselben Verbindung mit gleichem tab_name wird ersetzt und gilt als abgelehnt. */
  open(req: DiffRequest): Promise<Decision> {
    const previous = this.byName(req.tabName, req.clientId);
    if (previous) this.settle(previous, "rejected", false);
    return new Promise<Decision>((resolve) => {
      const entry: Entry = { id: `${this.run}:${this.nextId++}`, req, resolve };
      this.entries.set(entry.id, entry);
      try {
        this.deps.show(req, entry.id);
      } catch {
        this.settle(entry, "rejected", false);
      }
    });
  }

  /** Entscheidung des Nutzers. false: unbekannte oder schon beendete id (etwa ein ersetzter Tab). */
  decide(id: string, decision: Decision): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.settle(entry, decision, true);
    return true;
  }

  /** Der Nutzer hat den Tab geschlossen: ohne Entscheidung heißt das Ablehnen; der Tab ist schon zu. */
  viewClosed(id: string): void {
    const entry = this.entries.get(id);
    if (entry) this.settle(entry, "rejected", false);
  }

  /** close_tab: ablehnen und den Tab schließen. false: es gab keinen (eigenen) Diff mit diesem Namen. Mit clientId zählen nur Diffs dieser Verbindung. */
  closeTab(tabName: string, clientId?: number | null): boolean {
    const entry = this.byName(tabName, clientId);
    if (!entry) return false;
    this.settle(entry, "rejected", true);
    return true;
  }

  /** closeAllDiffTabs: alle ablehnen und schließen. Rückgabe: Zahl der geschlossenen. */
  closeAll(): number {
    const all = [...this.entries.values()];
    for (const entry of all) this.settle(entry, "rejected", true);
    return all.length;
  }

  /** Verbindung weg: ihre Diffs ablehnen und schließen (niemand wartet mehr). */
  closeClient(clientId: number): number {
    const own = [...this.entries.values()].filter((e) => e.req.clientId === clientId);
    for (const entry of own) this.settle(entry, "rejected", true);
    return own.length;
  }

  /** Schlüssel ist (Verbindung, tab_name); ohne clientId zählt der Name allein. */
  private byName(tabName: string, clientId?: number | null): Entry | null {
    for (const entry of this.entries.values()) {
      if (entry.req.tabName === tabName && (clientId === undefined || entry.req.clientId === clientId)) return entry;
    }
    return null;
  }

  /** Erst austragen, dann auflösen, dann den Tab schließen: Ein Schließen-Ereignis findet den Eintrag nicht mehr. */
  private settle(entry: Entry, decision: Decision, hide: boolean): void {
    if (!this.entries.delete(entry.id)) return;
    entry.resolve(decision);
    if (!hide) return;
    try {
      this.deps.hide(entry.id);
    } catch {
      // Der Tab ist nicht mehr zu schließen: Der Diff ist trotzdem beendet.
    }
  }
}
