import { DiffSessions, type DiffRequest } from "../core/diff-sessions";
import { type Decision, type DiffToolResult, type OpenDiffArgs, closeAllResult, closeTabResult, openDiffResult } from "../core/ide-diff";

// Diff-Ansicht (Abend 17): Steuerung der Diff-Tools ohne Obsidian-Typen (darum testbar). Tabs, Datei und Aufmerksamkeit
// hängen über IdeDiffDeps an. Hier wird nie eine Datei geschrieben: Beim Annehmen schreibt Claude selbst, aus dem Inhalt,
// den openDiff zurückgibt.

export interface IdeDiffDeps {
  /** Alte Fassung (null: Datei neu); wirft bei allen anderen Fehlern. */
  readOld(path: string): Promise<string | null>;
  /** Tab zeigen oder den mit gleichem Namen ersetzen (im Hintergrund). */
  show(req: DiffRequest, id: string): void;
  hide(id: string): void;
  /** Ein neuer Diff wartet: die Sitzung der Verbindung markieren („Frage“). Darf werfen. */
  attention(clientId: number | null): void;
  /** Lebt die Verbindung noch? Nach dem Lesen der alten Fassung geprüft; fehlt sie, gilt ja. */
  clientAlive?(clientId: number | null): boolean;
  /** Ist ideDiff noch an? Nach dem Lesen geprüft; fehlt sie, gilt ja. */
  enabled?(): boolean;
}

const errorResult = (text: string): DiffToolResult => ({ content: [{ type: "text", text }], isError: true });

export class IdeDiff {
  private readonly sessions: DiffSessions;
  private readonly deps: IdeDiffDeps;
  private disposed = false;
  // Zähler, die beim Aufräumen steigen: Ein openDiff, das noch die alte Fassung liest, merkt es danach und öffnet nichts mehr.
  private globalEpoch = 0;
  private readonly clientEpochs = new Map<number | null, number>();

  constructor(deps: IdeDiffDeps) {
    this.deps = deps;
    this.sessions = new DiffSessions({
      show: (req, id) => {
        deps.show(req, id);
        try {
          deps.attention(req.clientId);
        } catch {
          // Die Markierung ist nur ein Hinweis; der Diff läuft auch ohne.
        }
      },
      hide: (id) => deps.hide(id),
    });
  }

  get pending(): number {
    return this.sessions.size;
  }

  handlers(): {
    openDiff: (args: OpenDiffArgs, clientId: number | null) => Promise<DiffToolResult>;
    closeTab: (tabName: string, clientId: number | null) => DiffToolResult;
    closeAllDiffTabs: (clientId: number | null) => DiffToolResult;
  } {
    return {
      openDiff: (args, clientId) => this.openDiff(args, clientId),
      closeTab: (tabName, clientId) => {
        this.sessions.closeTab(tabName, clientId);
        return closeTabResult();
      },
      closeAllDiffTabs: (clientId) => closeAllResult(clientId === null ? this.closeAll() : this.closeClient(clientId)),
    };
  }

  /** Die offene Anfrage zu einer Tab-id (für die Ansicht); null, wenn der Diff schon beendet ist. */
  request(id: string): DiffRequest | null {
    return this.sessions.get(id);
  }

  decide(id: string, decision: Decision): boolean {
    return this.sessions.decide(id, decision);
  }

  /** Der Nutzer hat den Tab geschlossen. */
  viewClosed(id: string): void {
    this.sessions.viewClosed(id);
  }

  closeClient(clientId: number): number {
    this.clientEpochs.set(clientId, (this.clientEpochs.get(clientId) ?? 0) + 1);
    return this.sessions.closeClient(clientId);
  }

  /** Alle offenen Diffs ablehnen und schließen (Einstellung aus). */
  closeAll(): number {
    this.globalEpoch++;
    return this.sessions.closeAll();
  }

  /** Beim Entladen: alles ablehnen und schließen; neue Aufrufe werden sofort abgelehnt. */
  dispose(): number {
    this.disposed = true;
    this.globalEpoch++;
    return this.sessions.closeAll();
  }

  private async openDiff(args: OpenDiffArgs, clientId: number | null): Promise<DiffToolResult> {
    if (this.disposed) return openDiffResult("rejected", "");
    const globalEpoch = this.globalEpoch;
    const clientEpoch = this.clientEpochs.get(clientId) ?? 0;
    let oldContents: string | null;
    try {
      oldContents = await this.deps.readOld(args.oldFilePath);
    } catch (fehler) {
      return errorResult(`Alte Fassung nicht lesbar: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
    }
    // Während des Lesens kann aufgeräumt worden sein (Verbindung zu, Einstellung aus, Entladen): dann niemand mehr bedienen,
    // sonst bliebe ein Waisen-Diff mit Tab, auf den keiner wartet.
    if (
      this.disposed || this.globalEpoch !== globalEpoch || (this.clientEpochs.get(clientId) ?? 0) !== clientEpoch ||
      this.deps.enabled?.() === false || this.deps.clientAlive?.(clientId) === false
    ) return openDiffResult("rejected", "");
    const decision = await this.sessions.open({
      tabName: args.tabName,
      oldFilePath: args.oldFilePath,
      newFilePath: args.newFilePath,
      newFileContents: args.newFileContents,
      oldContents,
      clientId,
    });
    return openDiffResult(decision, args.newFileContents);
  }
}
