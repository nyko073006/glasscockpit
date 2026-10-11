import { ItemView, type Menu, Notice, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { ATTENTION_OSC, type AttentionSignal, bannerText, claudeIdChange, markedTitle, parseSignal, react, repeatsQuestion } from "../core/attention";
import type { ActivitySignal } from "../core/session-activity";
import { CSS_PREFIX, DIAG_SNAPSHOT_MS, TRANSCRIPT_POLL_MS, VIEW_TYPE_TERMINAL } from "../core/constants";
import type { PaneProbe, ViewDiagnosis } from "../core/diagnose";
import { classifyLoadError } from "../core/load-error";
import type { SessionHandle, SessionManager } from "../core/session-manager";
import { type Change, type SessionRecord, claudeIdOf } from "../core/session-model";
import { readSessionId } from "../core/session-state";
import { headerTitle, tabTitle } from "../core/claude-launch";
import type { CockpitSettings } from "../core/settings";
import { grayLine, redTerminalText, sessionEndedLine, startSize } from "../core/shell";
import { buildTestOutput } from "../core/test-output";
import type { CodeBlock } from "../core/transcript-code";
import type { HandoffKeeper } from "../core/transcript-poll";
import type { ViewTracker } from "../core/view-tracker";
import { playSound, showBanner } from "./attention-alert";
import { CodeBlockBar, copyCodeBlock } from "./code-block-bar";
import type { SpawnPlan } from "./launcher";
import type { NodePtyFactory } from "./pty-factory";
import { RenameModal } from "./rename-modal";
import type { TerminalOptions } from "../core/terminal-options";
import { TerminalPane } from "./terminal-pane";
import { TranscriptReader, type TranscriptResult } from "./transcript-reader";

/** Was die View vom Plugin bekommt. Die Sitzungen gehören dem Plugin, nicht der View. */
export interface TerminalDeps {
  manager: SessionManager;
  tracker: ViewTracker;
  ptyFactory: NodePtyFactory;
  /** Was für eine fehlende Sitzung gestartet wird: Shell oder claude. */
  plan: (sessionId: string) => Promise<SpawnPlan>;
  /** Vault-Basispfad für Notizen, die aus der Dateiliste hereingezogen werden. */
  vaultBase: () => string | null;
  /** Eintrag der Sitzung: Name und Ordner für Tab-Titel und Kopfzeile. */
  record: (id: string) => SessionRecord | null;
  rename: (id: string, name: string) => Change;
  /** Meldet Änderungen an Einträgen; null heißt „alle neu“ (prune). Gibt die Abmeldung zurück. */
  onRecordChange: (cb: (id: string | null) => void) => () => void;
  /** Alle Views der Sitzung lösen, PTY beenden, Views wieder anhängen (spawnt über plan neu). */
  restart: (id: string) => void;
  /** Alle Views der Sitzung lösen, PTY beenden. */
  stop: (id: string) => void;
  openInSplit: (id: string) => void;
  home: string;
  /** Wirksame Einstellungen, pro Signal frisch gelesen. */
  settings: () => CockpitSettings;
  /** Änderungen der Einstellungen (Schriftgröße, Scrollback wirken auf offene Panes). Gibt die Abmeldung zurück. */
  onSettingsChange: (cb: (s: CockpitSettings) => void) => () => void;
  /** Entprellung je Sitzung (über Splits hinweg): true, wenn jetzt ein Alarm fällig ist; setzt dabei den Zeitpunkt. */
  alertGate: (sessionId: string) => boolean;
  /** Telegram-Kanal (Abend 11): unabhängig von Sichtbarkeit und notifyOn*, entscheidet und sendet selbst. */
  telegram: (sessionId: string, signal: AttentionSignal) => void;
  /** Aktivität je Sitzung (Abend 18): jedes Signal mit Zeit melden, „angesehen“ setzen. */
  activity: {
    record: (sessionId: string, signal: ActivitySignal) => void;
    markSeen: (sessionId: string) => void;
    /** Letztes Signal der Sitzung, damit eine wiederholte Frage nichts meldet. */
    lastSignal: (sessionId: string) => ActivitySignal | undefined;
  };
  /** Sitzungswechsel (/clear, /resume): neue Claude-ID im Eintrag speichern. Meldet über onRecordChange. */
  adoptClaudeId: (sessionId: string, claudeId: string) => Change;
  /** Letzter Handoff-Block je Cockpit-Sitzung (Abend 19b), vom Plugin gehalten und von allen Views der Sitzung geteilt. */
  handoffs: HandoffKeeper;
}

/** Was zur Laufzeit am Leaf hängt, aber nicht in obsidian.d.ts steht. */
type LeafInternals = WorkspaceLeaf & {
  updateHeader?: () => void;
  tabHeaderEl?: HTMLElement;
  tabHeaderInnerTitleEl?: HTMLElement;
};

/**
 * Terminal-Ansicht. Leaf-State ist nur sessionId, die Sitzung lebt im SessionManager.
 * Ohne sessionId bleibt die View eine Pane mit Testdaten.
 */
export class TerminalView extends ItemView {
  private readonly deps: TerminalDeps;
  private pane: TerminalPane | null = null;
  private sessionId: string | null = null;
  private handle: SessionHandle | null = null;
  private tracked: string | null = null;
  private title: string | null = null;
  private readonly unsubscribe: Array<() => void> = [];
  // Diagnose „leere Pane“.
  private viewChunks = 0;
  private replayChars = 0;
  private early: PaneProbe | null = null;
  private snapshotTimer: number | null = null;
  // Codeblock-Leiste (nur Claude-Sitzungen).
  private bar: CodeBlockBar | null = null;
  // Blöcke der letzten Antwort, wie zuletzt gezeichnet: Beim Neuzeichnen ohne neuen Stand (Einstellung, Sitzungswechsel) nötig.
  private barBlocks: CodeBlock[] = [];
  private reader: TranscriptReader | null = null;
  private readerId: string | null = null;
  private pollTimer: number | null = null;
  private pollWin: Window | null = null;
  private polling = false;
  private unbindMigrate: (() => void) | null = null;
  private unbindRecords: (() => void) | null = null;
  private unbindSettings: (() => void) | null = null;
  // Benachrichtigung (nur Claude-Sitzungen).
  private attention: AttentionSignal | null = null;
  // Erst nach dem Parsen des Replays scharf: Der Ring-Puffer enthält alte Signale.
  private attentionArmed = false;
  private focusWin: Window | null = null;
  private readonly onWindowFocus = (): void => {
    if (this.app.workspace.getActiveViewOfType(TerminalView) === this) this.clearAttention();
  };

  constructor(leaf: WorkspaceLeaf, deps: TerminalDeps) {
    super(leaf);
    this.deps = deps;
  }

  getViewType(): string {
    return VIEW_TYPE_TERMINAL;
  }

  getDisplayText(): string {
    const record = this.sessionId ? this.deps.record(this.sessionId) : null;
    if (record && this.sessionId) return markedTitle(tabTitle(record.name, claudeIdOf(record)), this.attention);
    return markedTitle(this.title ?? "Glasscockpit Terminal", this.attention);
  }

  getIcon(): string {
    return "square-terminal";
  }

  getState(): Record<string, unknown> {
    const state = super.getState();
    if (this.sessionId) state.sessionId = this.sessionId;
    return state;
  }

  /** Obsidian ruft das nach onOpen auf, auch beim Wiederherstellen und Verschieben. */
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const id = readSessionId(state);
    if (id === null || id === this.sessionId) return;
    this.leave();
    this.sessionId = id;
    this.refreshTitle();
    await this.connect(id);
  }

  /** Tab-Menü (Rechtsklick, Mehr-Optionen): nur für Views mit Sitzung. */
  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    const id = this.sessionId;
    if (!id) return;
    menu.addItem((item) =>
      item.setSection("cockpit").setTitle("Umbenennen").setIcon("pencil").onClick(() => this.openRename()),
    );
    menu.addItem((item) =>
      item.setSection("cockpit").setTitle("Neu starten").setIcon("rotate-ccw").onClick(() => this.deps.restart(id)),
    );
    menu.addItem((item) =>
      item.setSection("cockpit").setTitle("Beenden").setIcon("square").onClick(() => this.deps.stop(id)),
    );
    menu.addItem((item) =>
      item
        .setSection("cockpit")
        .setTitle("Gleiche Sitzung in neuem Split")
        .setIcon("split")
        .onClick(() => this.deps.openInSplit(id)),
    );
  }

  /** Löst die View von der PTY, bleibt aber auf der Sitzung (Leaf-State behält sessionId). */
  detach(line: string): void {
    const id = this.sessionId;
    this.leave();
    this.sessionId = id;
    this.pane?.write(line);
  }

  /** Hängt die View wieder an ihre Sitzung; fehlt die PTY, spawnt connect über plan neu. */
  async reconnect(): Promise<void> {
    const id = this.sessionId;
    if (!id) return;
    this.leave();
    this.sessionId = id;
    await this.connect(id);
  }

  private openRename(): void {
    const id = this.sessionId;
    const record = id ? this.deps.record(id) : null;
    if (!id || !record) return;
    new RenameModal(this.app, record.name, (name) => this.deps.rename(id, name)).open();
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass(`${CSS_PREFIX}terminal-content`);
    // Flex-Spalte: oben die Leiste, darunter füllt der Wrapper den Rest und bemaßt den absolut
    // positionierten xterm-Host. Unten läge Obsidians Statusleiste darüber (Abnahme Abend 6).
    // Der ResizeObserver der Pane sieht das Ein-/Ausblenden als Host-Resize.
    this.bar = new CodeBlockBar(this.contentEl, () => this.contentEl.win);
    const body = this.contentEl.createDiv({ cls: `${CSS_PREFIX}terminal-body` });
    // Pop-out: der Poll-Timer gehört zum Fenster und zieht mit um.
    this.unbindMigrate = this.contentEl.onWindowMigrated(() => {
      if (this.pollTimer !== null) this.startPoll();
      this.bindWindowFocus();
    });
    this.bindWindowFocus();
    this.pane = new TerminalPane(
      body,
      (cols, rows) => this.handle?.resize(cols, rows),
      () => this.deps.vaultBase(),
      this.terminalOptions(),
    );
    // Schriftgröße und Scrollback wirken sofort auf offene Panes; ein leeres Handoff-Präfix blendet den festen Knopf sofort aus.
    this.unbindSettings = this.deps.onSettingsChange(() => {
      this.pane?.applyOptions(this.terminalOptions());
      if (this.reader) this.renderBar();
    });

    // Hell/Dunkel und Akzentfarbe: Obsidian meldet beides über css-change.
    // Name geändert (oder prune): Titel neu.
    this.unbindRecords = this.deps.onRecordChange((id) => {
      if (id === null || id === this.sessionId) {
        this.refreshTitle();
        this.syncReader();
      }
    });
    // Doppelklick auf den Tab-Titel oder die Kopfzeile benennt um. registerDomEvent meldet beim Schließen ab.
    const leaf = this.leaf as LeafInternals;
    const targets = [leaf.tabHeaderInnerTitleEl ?? leaf.tabHeaderEl, (this as { titleEl?: HTMLElement }).titleEl];
    if (!targets[0]) console.debug("Glasscockpit: Tab-Titel nicht gefunden, Doppelklick zum Umbenennen fehlt dort");
    for (const el of targets) {
      if (el) this.registerDomEvent(el, "dblclick", () => this.openRename());
    }
    this.refreshTitle();

    // Aufmerksamkeitsmarkierung weg, sobald der Tab aktiv wird.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (active) => {
        if (active === this.leaf) this.clearAttention();
      }),
    );
    this.registerEvent(this.app.workspace.on("css-change", () => this.pane?.refreshAppearance()));
    // Die Statusleiste kann sich mit dem Layout verschieben (Seitenleisten, Pop-out, Tabs).
    this.registerEvent(this.app.workspace.on("layout-change", () => this.pane?.updateInset()));
    // Kam setState vor onOpen, fehlte die Pane: jetzt verbinden.
    if (this.sessionId && this.tracked === null) await this.connect(this.sessionId);
  }

  async onClose(): Promise<void> {
    this.leave();
    this.unbindMigrate?.();
    this.unbindMigrate = null;
    this.unbindWindowFocus();
    this.unbindRecords?.();
    this.unbindRecords = null;
    this.unbindSettings?.();
    this.unbindSettings = null;
    this.pane?.dispose();
    this.pane = null;
    this.bar?.remove();
    this.bar = null;
  }

  /** Letzter Codeblock der letzten Claude-Antwort, frisch aus dem Transkript. null: kein Block. */
  async copyLastCodeBlock(): Promise<boolean> {
    const reader = this.reader;
    if (!reader) return false;
    const result = await reader.read(true, this.deps.settings().handoffPrefix);
    // Sitzungswechsel während des Lesens: nichts setzen, nichts kopieren.
    if (this.reader !== reader) return false;
    this.applyResult(result);
    const last: CodeBlock | undefined = result.blocks[result.blocks.length - 1];
    if (!last) return false;
    await copyCodeBlock(this.contentEl.win, last);
    return true;
  }

  /** Timer im aktuellen Fenster des Containers (nach Migration neu gesetzt). */
  private startPoll(): void {
    this.stopPoll();
    const win = this.contentEl.win as Window & typeof globalThis;
    this.pollWin = win;
    this.pollTimer = win.setInterval(() => void this.pollTranscript(), TRANSCRIPT_POLL_MS);
    void this.pollTranscript();
  }

  private stopPoll(): void {
    if (this.pollTimer !== null) this.pollWin?.clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.pollWin = null;
  }

  private async pollTranscript(): Promise<void> {
    const reader = this.reader;
    if (!reader || this.polling) return;
    this.polling = true;
    try {
      // Das Präfix pro Aufruf frisch aus den Einstellungen; der Handoff-Block entsteht auf dem ohnehin gelesenen Text.
      const result = await reader.read(false, this.deps.settings().handoffPrefix);
      // Sitzung kann während des Lesens gewechselt haben.
      if (this.reader === reader && result.changed) this.applyResult(result);
    } catch (fehler) {
      console.error("Glasscockpit: Transkript nicht lesbar", fehler);
    } finally {
      this.polling = false;
    }
  }

  /** Neuer Stand aus dem Transkript: Handoff-Block der Cockpit-Sitzung übernehmen (null lässt den alten stehen), Leiste zeichnen. */
  private applyResult(result: TranscriptResult): void {
    if (this.sessionId !== null) this.deps.handoffs.keep(this.sessionId, result.handoff);
    this.renderBar(result.blocks);
  }

  /**
   * Leiste zeichnen: Blöcke der letzten Antwort plus der feste Handoff-Knopf. Der Wert gehört zur Cockpit-Sitzung
   * (this.sessionId, Plugin-weit gehalten), nicht zum Leser und nicht zur Claude-ID; so übersteht er /clear, bis das neue
   * Transkript einen neueren Block liefert. Ein leeres Präfix schaltet den Knopf aus.
   */
  private renderBar(blocks: CodeBlock[] = this.barBlocks): void {
    this.barBlocks = blocks;
    const id = this.sessionId;
    const on = this.deps.settings().handoffPrefix.trim() !== "";
    this.bar?.set(blocks, on && id !== null ? this.deps.handoffs.get(id) : null);
  }

  currentSessionId(): string | null {
    return this.sessionId;
  }

  /** Die Claude-ID (nicht die Cockpit-id), wenn hier Claude Code läuft, sonst null (Shell oder keine Sitzung). */
  claudeSessionId(): string | null {
    const id = this.sessionId;
    if (!id || this.deps.manager.meta(id)?.kind !== "claude") return null;
    const record = this.deps.record(id);
    return record ? claudeIdOf(record) : id;
  }

  private terminalOptions(): TerminalOptions {
    const { fontSize, scrollback, minimumContrast } = this.deps.settings();
    return { fontSize, scrollback, minimumContrast };
  }

  writeTestOutput(): void {
    this.pane?.write(buildTestOutput());
  }

  diagnose(): ViewDiagnosis {
    return {
      sessionId: this.sessionId,
      session: this.sessionId ? this.deps.manager.stats(this.sessionId) : null,
      early: this.early,
      now: this.takeProbe(),
    };
  }

  /** Spawnt nur, wenn die Sitzung fehlt, hängt dann per attach an (Replay, danach live). */
  private async connect(id: string): Promise<void> {
    const { manager, tracker, ptyFactory } = this.deps;
    if (!this.pane) return;
    // Sofort anmelden: Ein Verschieben verwirft so den Timer der alten View.
    tracker.open(id);
    this.tracked = id;

    if (!manager.has(id)) {
      const loaded = await ptyFactory.prepare();
      // Während des Ladens kann die View geschlossen oder umgestellt worden sein.
      if (!this.pane || this.sessionId !== id) return;
      if (!loaded.ok) {
        const xattr = loaded.xattr ? `\n${loaded.xattr}` : "";
        this.showError(loaded.error.message + xattr);
        return;
      }
      const plan = await this.deps.plan(id);
      try {
        if (!this.pane || this.sessionId !== id) return;
        if (!plan.ok) {
          this.showError(plan.message);
          return;
        }
        // fit vor spawn: Shell oder claude startet gleich in der richtigen Größe.
        this.pane.fit();
        const { cols, rows } = startSize(this.pane.fittedSize());
        const spawned = manager.spawn({ id, ...plan.spawn, cols, rows, meta: plan.meta });
        if (!spawned.ok) {
          this.showError(classifyLoadError(spawned.error).message);
          return;
        }
        // Graue Zeile vor der Claude-Ausgabe (die PTY liefert ihre Daten erst später).
        if (plan.notice) this.pane.write(grayLine(plan.notice));
      } finally {
        // Der reservierte Limit-Platz ist ab jetzt durch die laufende PTY gedeckt (oder der Start ist gescheitert).
        if (plan.ok) plan.release();
      }
    }

    const pane = this.pane;
    const handle = manager.handle(id);
    if (!pane || !handle || this.sessionId !== id) return;
    this.handle = handle;
    this.setTitle(manager.meta(id)?.title ?? null);

    let replay = true;
    this.unsubscribe.push(
      handle.attach((chunk) => {
        if (replay) {
          this.replayChars = chunk.length;
          // attach liefert das Replay als ersten, synchronen Aufruf. xterm parst asynchron und
          // der Rückruf kommt erst nach dem Parsen; danach zählen Signale wieder.
          this.attentionArmed = false;
          pane.write(chunk, () => {
            if (this.pane === pane && this.handle === handle) this.attentionArmed = true;
          });
          return;
        }
        this.viewChunks++;
        pane.write(chunk);
      }),
      handle.onExit((exitCode) => pane.write(sessionEndedLine(exitCode))),
      pane.onInput((input) => handle.write(input)),
    );
    replay = false;

    // Danach sofort die Maße dieser Pane: Beim Resize gewinnt der letzte Aufrufer.
    pane.fit();
    const size = pane.fittedSize();
    if (size) handle.resize(size.cols, size.rows);
    pane.focus();

    // Leiste, Poll und Benachrichtigung nur bei Claude-Sitzungen.
    const claudeId = this.claudeSessionId();
    if (claudeId) {
      // Fremde OSC 777 (ohne cockpit:) gibt false zurück, xterm verarbeitet sie weiter.
      this.unsubscribe.push(
        pane.onOsc(ATTENTION_OSC, (data) => {
          const parsed = parseSignal(data);
          if (!parsed) return false;
          // Alte Signale aus dem Replay verschlucken, ohne Wirkung.
          if (this.attentionArmed) this.onSignal(parsed);
          return true;
        }),
      );
      this.reader = new TranscriptReader(claudeId);
      this.readerId = claudeId;
      // Ein gemerkter Handoff steht sofort da (etwa nach „Neu starten“), nicht erst mit dem ersten Poll.
      this.renderBar([]);
      this.startPoll();
    }

    this.snapshotTimer = window.setTimeout(() => {
      this.snapshotTimer = null;
      this.early = this.takeProbe();
    }, DIAG_SNAPSHOT_MS);
  }

  /** Löst die View von ihrer Sitzung. Die Sitzung selbst beendet der Tracker nach der Schonfrist. */
  private leave(): void {
    for (const stop of this.unsubscribe.splice(0)) stop();
    this.stopPoll();
    this.reader = null;
    this.readerId = null;
    this.barBlocks = [];
    this.bar?.clear();
    this.clearAttention();
    this.attentionArmed = false;
    if (this.snapshotTimer !== null) window.clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    if (this.tracked) this.deps.tracker.close(this.tracked);
    this.tracked = null;
    this.handle = null;
    this.title = null;
    this.viewChunks = 0;
    this.replayChars = 0;
    this.early = null;
  }

  /** Von außen ausgelöste Aufmerksamkeit (Diff-Ansicht, Abend 17): wirkt wie das Hook-Signal derselben Art, mit allen Einstellungen. */
  signalAttention(signal: AttentionSignal): void {
    this.onAttention(signal);
  }

  /** Signal aus dem PTY-Strom: busy nur merken, done/question benachrichtigen, session wechselt die Claude-ID. */
  private onSignal(parsed: NonNullable<ReturnType<typeof parseSignal>>): void {
    if (parsed.kind === "session") {
      this.adoptClaudeId(parsed.id);
    } else if (parsed.signal === "busy") {
      if (this.sessionId !== null) this.deps.activity.record(this.sessionId, "busy");
    } else {
      this.onAttention(parsed.signal);
    }
  }

  /** Nach /clear oder /resume: neue Claude-ID speichern. Titel und Leser ziehen über onRecordChange nach (alle Views der Sitzung). */
  private adoptClaudeId(signaled: string): void {
    const id = this.sessionId;
    const record = id ? this.deps.record(id) : null;
    if (!id || !record) return;
    const next = claudeIdChange(claudeIdOf(record), signaled);
    if (next === null) return;
    const result = this.deps.adoptClaudeId(id, next);
    if (!result.ok) console.warn(`Glasscockpit: Sitzungswechsel nicht übernommen (${result.reason})`);
  }

  /**
   * Der Leser folgt der Claude-ID des Eintrags: andere ID, neuer Leser, alte Codeblöcke weg, sofort neu lesen. Der feste
   * Handoff-Knopf bleibt (er hängt an der Cockpit-id), bis das neue Transkript einen neueren Block liefert.
   */
  private syncReader(): void {
    if (!this.reader) return;
    const next = this.claudeSessionId();
    if (!next || next === this.readerId) return;
    this.reader = new TranscriptReader(next);
    this.readerId = next;
    this.renderBar([]);
    this.startPoll();
  }

  /** Hook-Signal von Claude: markieren und, wenn der Tab verdeckt ist, Ton und Banner. */
  private onAttention(signal: AttentionSignal): void {
    if (this.sessionId !== null && repeatsQuestion(this.deps.activity.lastSignal(this.sessionId), signal)) return;
    const s = this.deps.settings();
    const r = react({
      active: this.app.workspace.getActiveViewOfType(TerminalView) === this,
      shown: this.contentEl.isShown(),
      windowFocused: this.contentEl.doc.hasFocus(),
    });
    if (this.sessionId !== null) {
      this.deps.activity.record(this.sessionId, signal);
      // Wer draufschaut, hat es schon gesehen.
      if (!r.mark) this.deps.activity.markSeen(this.sessionId);
      this.deps.telegram(this.sessionId, signal);
    }
    if (signal === "done" ? !s.notifyOnDone : !s.notifyOnQuestion) return;
    if (r.mark && s.markTab) this.setAttention(signal);
    if (r.alert && this.sessionId !== null && this.deps.alertGate(this.sessionId)) {
      if (s.alertSound) playSound(s.soundFile);
      if (s.alertBanner) {
        const id = this.sessionId;
        const name = (id ? this.deps.record(id)?.name : null) ?? this.title ?? "Claude";
        showBanner(this.contentEl.win, id, "Glasscockpit", bannerText(name, signal), () => this.bringToFront(), s.bannerSeconds);
      }
    }
  }

  private setAttention(signal: AttentionSignal): void {
    this.attention = signal;
    this.applyAttentionClass();
    this.refreshTitle();
  }

  private clearAttention(): void {
    // Wo die Markierung fällt, gilt die Sitzung als angesehen (auch wenn die Markierung aus ist).
    if (this.sessionId !== null) this.deps.activity.markSeen(this.sessionId);
    if (this.attention === null) return;
    this.attention = null;
    this.applyAttentionClass();
    this.refreshTitle();
  }

  /** Klasse am Tab-Kopf (undokumentiertes Feld, nur mit Existenzprüfung). */
  private applyAttentionClass(): void {
    const el = (this.leaf as LeafInternals).tabHeaderEl;
    if (!el) return;
    el.toggleClass(`${CSS_PREFIX}attention`, this.attention === "done");
    el.toggleClass(`${CSS_PREFIX}attention-question`, this.attention === "question");
  }

  /** Banner-Klick: Fenster nach vorn, Tab sichtbar und aktiv. Ob macOS mitzieht, zeigt die Abnahme. */
  bringToFront(): void {
    this.contentEl.win.focus();
    void this.app.workspace.revealLeaf(this.leaf);
    this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
  }

  /** Fokus-Listener am aktuellen Fenster des Containers; zieht beim Pop-out um. */
  private bindWindowFocus(): void {
    const win = this.contentEl.win;
    if (win === this.focusWin) return;
    this.unbindWindowFocus();
    win.addEventListener("focus", this.onWindowFocus);
    this.focusWin = win;
  }

  private unbindWindowFocus(): void {
    this.focusWin?.removeEventListener("focus", this.onWindowFocus);
    this.focusWin = null;
  }

  private setTitle(title: string | null): void {
    this.title = title;
    this.refreshTitle();
  }

  /**
   * Setzt Tab-Titel, Kopfzeile und Tooltip am Tab neu. Die Obsidian-Interna (updateHeader, titleEl,
   * tabHeaderEl) stehen nicht in obsidian.d.ts, deshalb nur mit Existenzprüfung.
   */
  private refreshTitle(): void {
    const leaf = this.leaf as LeafInternals;
    leaf.updateHeader?.();
    const id = this.sessionId;
    const record = id ? this.deps.record(id) : null;
    const full = id && record ? headerTitle(record.name, claudeIdOf(record), record.cwd, this.deps.home) : this.getDisplayText();
    (this as { titleEl?: HTMLElement }).titleEl?.setText(full);
    leaf.tabHeaderEl?.setAttr("aria-label", full);
  }

  private takeProbe(): PaneProbe | null {
    const probe = this.pane?.probe();
    return probe ? { viewChunks: this.viewChunks, replayChars: this.replayChars, ...probe } : null;
  }

  private showError(message: string): void {
    this.pane?.write(redTerminalText(message));
    new Notice(`Glasscockpit: ${message.split("\n")[0]}`, 10000);
  }
}
