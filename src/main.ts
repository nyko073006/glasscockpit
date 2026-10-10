import { FileSystemAdapter, Notice, Plugin, type WorkspaceLeaf, parseYaml } from "obsidian";
import { existsSync } from "fs";
import { homedir } from "os";
import { RecentSessions } from "./core/active-session";
import { alertDue } from "./core/attention";
import { type StartKind } from "./core/claude-start";
import { planCockpitSplit, planNewSessionPlacement } from "./core/cockpit-split";
import type { CockpitFeedActions } from "./core/cockpit-feed";
import { HANDOFF_RELOAD_DEBOUNCE_MS, HANDOFF_START_TIMEOUT_MS, PULL_TICK_MS, SESSION_FILES_DIR, THRESHOLDS_FILE, TOKENS_TODAY_FILE, TRANSCRIPTS_DIR, USAGE_TICK_MS, VIEW_TYPE_DASHBOARD, VIEW_TYPE_TERMINAL } from "./core/constants";
import { discover, type LaunchEntry, type LaunchKind } from "./core/discovery";
import { formatDiagnosis, formatLaunchInfo } from "./core/diagnose";
import { toggledSound, toggledTelegram, tokensToday } from "./core/feed-compose";
import { DayScan } from "./core/day-scan";
import { RepoScan } from "./core/repo-scan";
import { type SendStep, buildInsert, buildSend, checkTarget } from "./core/send";
import { ThresholdsSync } from "./core/thresholds-sync";
import { SessionManager } from "./core/session-manager";
import { SessionActivity, radarInputs, type RadarInput } from "./core/session-activity";
import { StartSlots } from "./core/start-slots";
import { type CockpitData, type DashboardArea, type DashboardMemo, type SessionKind, type SessionRecord, backupSuffix, claudeIdOf, limitReached, parseDataText, planAfterLoad, reopenNotice, uniqueName } from "./core/session-model";
import { readSessionId } from "./core/session-state";
import { SessionStore } from "./core/session-store";
import { expandHome } from "./core/settings";
import { isUnset } from "./core/unset";
import { openCockpitSettings } from "./host/open-settings";
import { HandoffKeeper } from "./core/transcript-poll";
import { TokenCounter, TranscriptScanner } from "./core/usage";
import { ViewTracker } from "./core/view-tracker";
import { stoppedLine } from "./core/shell";
import { DashboardView } from "./host/dashboard-view";
import { EffortModal } from "./host/effort-modal";
import { readOwnSessionFiles, readRadarFile } from "./host/feed-fs";
import { CockpitFeedSource } from "./host/feed-source";
import { readOpenHandoffs } from "./host/handoff-vault";
import { createDebounce } from "./core/debounce";
import { readFocus, readVaultState } from "./host/feed-vault";
import { listGitRepos, runGitDayLog, runGitIdentity, runGitStatus } from "./host/repo-status";
import { createTasksFile } from "./host/tasks-card";
import { nodeDiscoveryFs } from "./host/discovery-fs";
import { PullController } from "./host/git-pull";
import { IdeBridge } from "./host/ide-bridge";
import { Launcher, type SpawnPlan } from "./host/launcher";
import { LaunchModal } from "./host/launch-modal";
import { CockpitSettingTab } from "./host/settings-tab";
import { type SessionChoice, handoffChoices } from "./core/new-session";
import { awaitRunning, isoDay, markTakenUp, touchesHandoffs } from "./core/handoffs";
import { NewSessionModal } from "./host/new-session-modal";
import { NativeLoader } from "./host/native-loader";
import { NodePtyFactory } from "./host/pty-factory";
import { TelegramNotifier } from "./host/telegram-notify";
import { TerminalView } from "./host/terminal-view";
import { transcriptFs, writeFileAtomic } from "./host/usage-fs";

/** `app.commands` steht nicht in der öffentlichen obsidian.d.ts, die Funktion gibt es seit Jahren (Hotkeys, Befehlspalette). */

// Nur Verkabelung: Logik gehört nach src/core, Zugriffe auf Obsidian und Node nach src/host.
export default class GlasscockpitPlugin extends Plugin {
  private manager: SessionManager | null = null;
  private tracker: ViewTracker | null = null;
  private launcher: Launcher | null = null;
  private ide: IdeBridge | null = null;
  private usageTimer: number | null = null;
  private store: SessionStore | null = null;
  private readonly lastAlertAt = new Map<string, number>();
  // Letztes cockpit:-Signal je Sitzung (busy, done, question) mit Zeit und „angesehen“ (Abend 18).
  private readonly activity = new SessionActivity();
  // Letzter Handoff-Block je Cockpit-Sitzung (Abend 19b): Schlüssel ist die Cockpit-id, nicht die Claude-ID, damit der Knopf /clear übersteht.
  // Nur im Speicher: weg beim Neuladen von Obsidian, nicht beim Beenden oder Neustart einer Sitzung (auch nach „frisch starten“ soll der Block noch zu haben sein).
  private readonly handoffs = new HandoffKeeper();
  private readonly recent = new RecentSessions();
  // Limit ohne Lücke: Plätze für Starts, die noch auf Login-Shell und Transkript-Suche warten.
  private readonly slots = new StartSlots();
  // Wie die nächste Sitzung dieser id startet (new, restart, frisch); fehlt der Eintrag, ist es ein restore.
  private readonly pendingStart = new Map<string, { startKind: StartKind; fresh: boolean; prompt?: string }>();

  async onload(): Promise<void> {
    // Abend 19c: Beim plugin:reload sind die Terminal-Tabs nach registerView kurz weg (gemessen 07.10.2026, Obsidian 1.14.4:
    // 0 Tabs im onLayoutReady-Rückruf, einen Takt später wieder alle). Vorher sind sie noch da, darum hier festhalten.
    const leavesBeforeRegister = this.terminalLeafIds();
    // Abend 19e: Mit der Cockpit-Ansicht ist es dasselbe. Wer sie erst nach registerView zählt, öffnet beim plugin:reload eine zweite.
    const dashboardBeforeRegister = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD).length > 0;
    // Selbst lesen statt loadData: Obsidian loggt kaputtes JSON nur und liefert undefined wie bei fehlender Datei.
    // Kaputt heißt Vorgaben; die Datei bleibt bis zur ersten Änderung liegen.
    const pfad = `${this.manifest.dir}/data.json`;
    const adapter = this.app.vault.adapter;
    let data: CockpitData;
    let reason: string | null;
    try {
      ({ data, reason } = parseDataText((await adapter.exists(pfad)) ? await adapter.read(pfad) : null));
    } catch (fehler) {
      ({ data } = parseDataText(null));
      reason = `data.json nicht lesbar: ${fehler instanceof Error ? fehler.message : String(fehler)}`;
    }
    if (reason !== null) {
      console.warn(`Glasscockpit: ${reason}`);
      // Kaputte Datei sichern, bevor der erste Tab den Store beschreibt und sie überschreibt.
      let sicherung = "";
      try {
        if (await adapter.exists(pfad)) {
          const ziel = `${pfad}.${backupSuffix(new Date())}`;
          await adapter.copy(pfad, ziel);
          sicherung = ` Sicherung: ${ziel.slice(ziel.lastIndexOf("/") + 1)}.`;
        }
      } catch (fehler) {
        console.error("Glasscockpit: Sicherung der data.json fehlgeschlagen", fehler);
        sicherung = ` Sicherung fehlgeschlagen: ${fehler instanceof Error ? fehler.message : String(fehler)}.`;
      }
      new Notice(`Glasscockpit: ${reason}. Starte mit leerer Sitzungsliste.${sicherung}`, 15000);
    }
    const store = new SessionStore(
      data,
      (d) => this.saveData(d),
      { set: (callback, ms) => window.setTimeout(callback, ms), clear: (handle) => window.clearTimeout(handle as number) },
      undefined,
      (fehler) => {
        console.error("Glasscockpit: data.json nicht gespeichert", fehler);
        new Notice("Glasscockpit: Sitzungen nicht gespeichert (siehe Konsole)", 10000);
      },
    );
    this.store = store;
    const home = homedir();

    // Schwellen eine Quelle (Abend 18, Festlegung 1): contextWarn und contextHandoff gehen atomar an das Statuszeilen-Skript,
    // beim Laden und bei jeder Änderung; Schreibfehler nur in die Konsole.
    const thresholds = new ThresholdsSync({
      write: (text) => writeFileAtomic(expandHome(THRESHOLDS_FILE, home), text),
      log: (m) => console.warn(m),
    });
    void thresholds.sync(store.settings());
    this.register(store.onSettingsChange((s) => void thresholds.sync(s)));

    const ptyFactory = new NodePtyFactory(new NativeLoader(this.app, this.manifest));
    // Eskalation SIGHUP, nach KILL_ESCALATION_MS SIGKILL. Der Timer gehört dem Fenster, nicht dem Plugin
    // (registerInterval): Er muss auch nach dem Entladen noch feuern. SIGKILL geht an die Prozessgruppe.
    const manager = new SessionManager((spec) => ptyFactory.create(spec), undefined, {
      timers: { set: (callback, ms) => window.setTimeout(callback, ms), clear: (handle) => window.clearTimeout(handle as number) },
      signalGroup: (pid, signal) => process.kill(-pid, signal),
    });
    const tracker = new ViewTracker((id) => {
      this.activity.forget(id);
      return manager.kill(id);
    }, {
      set: (callback, ms) => window.setTimeout(callback, ms),
      clear: (handle) => window.clearTimeout(handle as number),
    });
    const launcher = new Launcher(
      (reason) => new Notice(`Glasscockpit: PATH der Login-Shell nicht lesbar (${reason}), nehme die feste Liste.`, 10000),
      // IDE-Brücke (Abend 16): erst nach dem Start des Servers, nur für Claude-Sitzungen.
      async () => {
        await this.ide?.ready();
        return this.ide?.env() ?? null;
      },
    );
    this.manager = manager;
    this.tracker = tracker;
    this.launcher = launcher;
    // Login-Shell einmal im Hintergrund lesen, bis zum ersten Claude-Start ist sie meist fertig.
    launcher.start();

    // IDE-Brücke (Abend 16): Server und Editor-Anbindung nach der Einstellung ideBridge; Fehler nur in der Konsole.
    const ide = new IdeBridge(this, this.app, {
      settings: () => store.settings(),
      vaultBase: () => {
        const adapter = this.app.vault.adapter;
        return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
      },
      ptyPid: (id) => manager.pidOf(id),
      home: homedir(),
      // Diff-Ansicht (Abend 17): Verbindung zu Sitzung über die pid; ein wartender Diff markiert die Sitzung als „Frage“.
      sessions: () => manager.ids().map((id) => ({ id, pid: manager.pidOf(id) })),
      attention: (id) => this.viewsOf(id)[0]?.signalAttention("question"),
    });
    this.ide = ide;
    ide.install();
    void ide.sync();
    this.register(store.onSettingsChange(() => void ide.sync()));

    const telegram = new TelegramNotifier({ settings: () => store.settings(), record: (id) => store.get(id), home: homedir() });

    this.registerView(
      VIEW_TYPE_TERMINAL,
      (leaf) =>
        new TerminalView(leaf, {
          manager,
          tracker,
          ptyFactory,
          plan: (id) => this.planFor(id),
          vaultBase: () => {
            const adapter = this.app.vault.adapter;
            return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
          },
          record: (id) => store.get(id),
          rename: (id, name) => store.rename(id, name),
          onRecordChange: (cb) => store.onChange(cb),
          restart: (id) => void this.restartSession(id),
          stop: (id) => this.stopSession(id),
          openInSplit: (id) => void this.openSession(id),
          home: homedir(),
          settings: () => store.settings(),
          onSettingsChange: (cb) => store.onSettingsChange(cb),
          telegram: (sessionId, signal) => void telegram.notify(sessionId, signal),
          activity: {
            record: (sessionId, signal) => { this.activity.record(sessionId, signal, Date.now()); feedSource.changed(); },
            markSeen: (sessionId) => { this.activity.markSeen(sessionId); feedSource.changed(); },
            lastSignal: (sessionId) => this.activity.get(sessionId)?.signal,
          },
          adoptClaudeId: (sessionId, claudeId) => store.setClaudeSessionId(sessionId, claudeId),
          handoffs: this.handoffs,
          alertGate: (sessionId) => {
            const now = Date.now();
            if (!alertDue(this.lastAlertAt.get(sessionId) ?? null, now, store.settings().alertGapMs)) return false;
            this.lastAlertAt.set(sessionId, now);
            return true;
          },
        }),
    );
    // Dashboard (Abend 9): Pull-Zustand und Takt gehören dem Plugin, eine Instanz für alle Dashboards.
    const pull = new PullController({
      vaultBase: () => {
        const adapter = this.app.vault.adapter;
        return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
      },
      settings: () => store.settings(),
      pathDirs: () => launcher.pathDirs(),
      now: () => Date.now(),
      // Repo-Ampel (Abend 18) im Takt des Pulls, kein zweiter Takt; der Pull läuft nur bei offenem Dashboard.
      afterPull: () => { void repoScan.run(); void dayScan.run(); void feedSource.refresh(); },
    });
    // Ein Zähler für das ganze Plugin, ab dem Laden, unabhängig vom Dashboard. Schreibt die Tagessumme für die
    // Statuszeile (writeTokensFile, bei jedem Lauf frisch aus dem Store); Schreibfehler gehen nur in die Konsole.
    const scanner = new TranscriptScanner(transcriptFs(expandHome(TRANSCRIPTS_DIR, home)));
    const tokensPath = expandHome(TOKENS_TODAY_FILE, home);
    const counter = new TokenCounter({
      settings: () => store.settings(),
      scan: (now) => scanner.scan(now),
      write: (content) => writeFileAtomic(tokensPath, content),
      now: () => new Date(),
      log: (m) => console.warn(m),
    });
    this.usageTimer = window.setInterval(() => void counter.requestRun(), USAGE_TICK_MS);
    void counter.requestRun();

    // Cockpit füllen (Abend 18): Repo-Ampel (git status je Repo unter projectsRoot, ohne Netz, mit Zeitlimit) und die
    // Quelle des Feeds. Gelesen wird beim Öffnen, im Pull-Takt und im Zähler-Takt, nur bei offenem Dashboard.
    const repoScan = new RepoScan({
      list: () => listGitRepos(expandHome(store.settings().projectsRoot, home)),
      status: async (dir) => runGitStatus(dir, { ...(process.env as Record<string, string>), PATH: (await launcher.pathDirs()).join(":") }),
      log: (m) => console.warn(m),
    });
    // LOC und Commits heute (Abend 19): eigener Scanner neben der Repo-Ampel, gleiche Repo-Liste, gleiches Zeitlimit, gleicher Takt.
    const dayScan = new DayScan({
      list: () => listGitRepos(expandHome(store.settings().projectsRoot, home)),
      identity: async (dir) => runGitIdentity(dir, { ...(process.env as Record<string, string>), PATH: (await launcher.pathDirs()).join(":") }),
      dayLog: async (dir, since) => runGitDayLog(dir, since, { ...(process.env as Record<string, string>), PATH: (await launcher.pathDirs()).join(":") }),
      now: () => new Date(),
      log: (m) => console.warn(m),
    });
    const feedSource = new CockpitFeedSource({
      settings: () => store.settings(),
      now: () => Date.now(),
      radarInputs: () => this.radarInputs(),
      active: () => this.activeFeedSession(),
      ownClaudeIds: () => store.all().map((r) => claudeIdOf(r)),
      tokens: () => tokensToday(counter.state(), counter.asOf()),
      repos: () => repoScan.snapshot(),
      day: () => dayScan.snapshot(),
      readSessionFiles: (ids, now) => readOwnSessionFiles(expandHome(SESSION_FILES_DIR, home), ids, now),
      readVault: (s, now) => readVaultState(this.app.vault, s, now),
      readFocus: (s, now) => readFocus(this.app.vault, s, now),
      readHandoffs: async (s) => {
        const r = await readOpenHandoffs(this.app.vault, s, parseYaml, homedir());
        for (const e of r.errors) console.warn(`Glasscockpit: ${e}`);
        return r.items;
      },
      readRadar: (path, now) => readRadarFile(path, now),
      home,
      log: (m) => console.warn(m),
    });
    // Radar-Liste geändert (Einstellungsseite): sofort neu lesen, sonst bleiben die Lampen bis zum nächsten Takt alt.
    let radarKey = JSON.stringify(store.settings().radars);
    this.register(store.onSettingsChange((s) => {
      const key = JSON.stringify(s.radars);
      if (key === radarKey) return;
      radarKey = key;
      void feedSource.refresh();
    }));
    this.register(repoScan.subscribe(() => feedSource.changed()));
    this.register(dayScan.subscribe(() => feedSource.changed()));
    this.register(counter.subscribe(() => { if (pull.hasDashboard()) void feedSource.refresh(); }));
    // Handoff-Dateien oder HUBs im Vault geändert: Feed entprellt neu lesen (Abend 19h).
    const handoffReload = createDebounce(() => void feedSource.refresh(), HANDOFF_RELOAD_DEBOUNCE_MS, { set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(h as number) });
    this.register(() => handoffReload.cancel());
    const touches = (path: string): boolean => touchesHandoffs(path, store.settings());
    this.registerEvent(this.app.vault.on("create", (f) => { if (touches(f.path)) handoffReload(); }));
    this.registerEvent(this.app.vault.on("modify", (f) => { if (touches(f.path)) handoffReload(); }));
    this.registerEvent(this.app.vault.on("delete", (f) => { if (touches(f.path)) handoffReload(); }));
    this.registerEvent(this.app.vault.on("rename", (f, old) => { if (touches(f.path) || touches(old)) handoffReload(); }));

    this.registerView(
      VIEW_TYPE_DASHBOARD,
      (leaf) =>
        new DashboardView(leaf, {
          settings: () => store.settings(),
          onSettingsChange: (cb) => store.onSettingsChange(cb),
          pull,
          counter,
          send: (text) => this.sendToActive(buildSend(text)),
          discoverSkills: async () => (await this.discoverAll()).skills,
          recentSkills: () => store.recentSkills(),
          onRecentsChange: (cb) => store.onRecentsChange(cb),
          runSkill: (name) => this.sendSkill(name),
          openUrl: (url) => { window.open(url, "_blank"); },
          onSessionsChange: (cb) => manager.onChange(cb),
          feed: () => feedSource.feed(),
          actions: this.feedActions(store),
          onFeedChange: (cb) => feedSource.subscribe(cb),
          feedOpened: () => void feedSource.refresh(),
        }),
    );
    this.register(() => {
      // Abend 19c/19e: Aufräumer laufen rückwärts. Dieser steht hinter dem letzten registerView, läuft also vor beiden
      // detachLeavesOfType beim Abschalten in den Einstellungen und sieht Sitzungs-Tabs und Cockpit-Ansicht noch;
      // onunload sieht keine mehr. Davor registriert sähe er die Cockpit-Ansicht nie. save startet in flush synchron.
      store.setOpenAtUnload(this.terminalLeafIds());
      store.setDashboardAtUnload(this.dashboardArea());
      void store.flush();
    });
    // Der Takt läuft immer, pull.tick() tut nur etwas, solange ein Dashboard offen ist.
    this.registerInterval(window.setInterval(() => pull.tick(), PULL_TICK_MS));

    this.addSettingTab(new CockpitSettingTab(this.app, this, store));

    this.addRibbonIcon("layout-dashboard", "Glasscockpit: Dashboard öffnen", () => {
      void this.openDashboard();
    });

    this.addCommand({
      id: "open-dashboard",
      name: "Dashboard öffnen",
      callback: () => {
        void this.openDashboard();
      },
    });

    this.addRibbonIcon("square-terminal", "Glasscockpit: Terminal öffnen", () => {
      void this.openTerminal();
    });

    this.addCommand({
      id: "open-cockpit-split",
      name: "Cockpit-Ansicht öffnen",
      callback: () => {
        void this.openCockpitSplit();
      },
    });

    this.addCommand({
      id: "open-terminal",
      name: "Terminal öffnen",
      callback: () => {
        void this.openTerminal();
      },
    });

    this.addCommand({
      id: "create-tasks-file",
      name: "Aufgabenliste anlegen",
      // Danach das Dashboard nach vorn, dort steht die Liste (Abnahme 05.10.2026).
      callback: async () => {
        if (await createTasksFile(this.app, store.settings().tasksFile)) await this.openDashboard();
      },
    });

    this.addCommand({
      id: "new-session",
      name: "Neue Sitzung",
      callback: () => {
        void this.openNewSessionModal(store);
      },
    });

    this.addCommand({
      id: "new-shell",
      name: "Neue Shell",
      callback: () => {
        void this.createSession({ cwd: homedir(), baseName: "Shell", kind: "shell" });
      },
    });

    this.addCommand({
      id: "new-claude-session",
      name: "Neue Claude-Sitzung",
      callback: () => {
        void this.createSession({ cwd: this.vaultPath(), baseName: "claude", kind: "claude" });
      },
    });

    this.addCommand({
      id: "new-claude-session-home",
      name: "Neue Claude-Sitzung im Home",
      callback: () => {
        void this.createSession({ cwd: homedir(), baseName: "claude", kind: "claude" });
      },
    });

    this.addCommand({
      id: "restart-fresh",
      name: "Sitzung frisch starten",
      callback: () => {
        const id = this.activeSessionId();
        if (!id) {
          new Notice("Keine Terminal-Sitzung aktiv");
          return;
        }
        const kind = store.get(id)?.kind;
        if (kind !== "claude" && kind !== "agent") {
          new Notice("Nur für Claude-Sitzungen");
          return;
        }
        // Neue Claude-ID, die alte Unterhaltung bleibt erhalten, unabhängig von „Unterhaltung fortsetzen“.
        void this.restartSession(id, true);
      },
    });

    this.addCommand({
      id: "copy-session-id",
      name: "Session-ID kopieren",
      checkCallback: (checking) => {
        const id = this.app.workspace.getActiveViewOfType(TerminalView)?.claudeSessionId();
        if (!id) return false;
        if (!checking) void this.copySessionId(id);
        return true;
      },
    });

    this.addCommand({
      id: "copy-last-code-block",
      name: "Letzten Codeblock kopieren",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(TerminalView);
        if (!view?.claudeSessionId()) return false;
        if (!checking) {
          void view.copyLastCodeBlock().then((found) => {
            if (!found) new Notice("Kein Codeblock in der letzten Antwort");
          });
        }
        return true;
      },
    });

    this.addCommand({
      id: "open-session-in-split",
      name: "Aktive Sitzung in neuem Split öffnen",
      checkCallback: (checking) => {
        const id = this.app.workspace.getActiveViewOfType(TerminalView)?.currentSessionId();
        if (!id) return false;
        if (!checking) void this.openSession(id);
        return true;
      },
    });

    this.addCommand({
      id: "write-test-output",
      name: "Testausgabe schreiben",
      checkCallback: (checking) => {
        const view = this.findTerminalView();
        if (!view) return false;
        if (!checking) view.writeTestOutput();
        return true;
      },
    });

    this.addCommand({
      id: "diagnose-sessions",
      name: "Diagnose",
      callback: () => {
        void this.showDiagnosis();
      },
    });

    this.addCommand({
      id: "mention-selection",
      name: "Auswahl an Claude erwähnen",
      callback: () => this.mentionSelection(),
    });

    // Launcher (Abend 8): Ziel ist die zuletzt aktive Terminal-Sitzung, nicht das aktive Leaf (ein Klick ins Dashboard ändert das).
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => this.touchLeaf(leaf)));

    this.addCommand({
      id: "next-effort",
      name: "Effort für nächste Sitzung",
      callback: () => {
        new EffortModal(this.app, store.settings().nextEffort, (step) => {
          const result = store.updateSetting("nextEffort", step);
          new Notice(result.ok ? `Effort für die nächste Sitzung: ${step}` : `Effort nicht gesetzt: ${result.reason}`);
        }).open();
      },
    });

    this.addCommand({
      id: "toggle-telegram",
      name: "Telegram an/aus",
      callback: () => {
        const on = this.toggleTelegram(store);
        new Notice(`Telegram ${on ? "an" : "aus"}`);
      },
    });

    this.addCommand({
      id: "toggle-sound",
      name: "Ton an/aus",
      callback: () => {
        const on = this.toggleSound(store);
        new Notice(`Ton ${on ? "an" : "aus"}`);
      },
    });

    this.addCommand({
      id: "launch-skill",
      name: "Skill starten",
      callback: () => {
        void this.openLauncher("skill");
      },
    });

    this.addCommand({
      id: "launch-agent",
      name: "Agent starten",
      callback: () => {
        void this.openLauncher("agent");
      },
    });

    this.addCommand({
      id: "insert-command",
      name: "Command einfügen",
      callback: () => {
        void this.openLauncher("command");
      },
    });

    // Eintrag ohne Tab wegräumen, oder nach dem Abschalten die Tabs und die Cockpit-Ansicht vom Merkzettel wieder öffnen (Abend 19c, 19e).
    this.app.workspace.onLayoutReady(() => {
      const records = store.all().map((r) => r.id);
      const leavesAtLoad = [...new Set([...leavesBeforeRegister, ...this.terminalLeafIds()])];
      const plan = planAfterLoad({
        openAtUnload: store.openAtUnload(),
        leavesAtLoad,
        records,
        reopenSetting: store.settings().reopenAfterDisable,
        dashboardAtUnload: store.dashboardAtUnload(),
        dashboardAtLoad: dashboardBeforeRegister || this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD).length > 0,
      });
      const dropped = new Set(plan.prune);
      const n = store.prune(records.filter((id) => !dropped.has(id)));
      if (n > 0) console.info(`Glasscockpit: ${n} Sitzungseinträge ohne Tab entfernt`);
      // Sofort leeren: Ein späterer Neustart soll nichts doppelt öffnen.
      store.setOpenAtUnload([]);
      store.setDashboardAtUnload(null);
      if (plan.reopen.length > 0 || plan.dashboard !== null) void this.reopenLayout(plan.dashboard, plan.reopen);
      // Abend 19g: Alle Sitzungs-Tabs vom Start merken, nicht nur das aktive; sonst geht die erste neue Sitzung als Split auf.
      this.recent.seed(leavesAtLoad);
      this.touchLeaf(this.app.workspace.getActiveViewOfType(TerminalView)?.leaf ?? null);
    });

    new Notice("Glasscockpit geladen");
  }

  onunload(): void {
    // IDE-Brücke: Das Lockfile fällt sofort (synchron), der Server schließt danach.
    void this.ide?.stop();
    // Der Zähler-Takt gehört dem Plugin und endet mit ihm.
    if (this.usageTimer !== null) window.clearInterval(this.usageTimer);
    this.usageTimer = null;
    // PTY-Kinder sterben sonst erst mit dem Renderer. Die Leaves selbst bleiben.
    this.tracker?.dispose();
    void this.store?.flush();
    // Eskalation läuft über Fenster-Timer weiter, auch wenn das Plugin schon entladen ist.
    void this.manager?.killAll();
  }

  /** Das aktive Terminal, sonst das erste offene. */
  private findTerminalView(): TerminalView | null {
    const active = this.app.workspace.getActiveViewOfType(TerminalView);
    if (active) return active;
    return this.terminalViews()[0] ?? null;
  }

  /**
   * Rohdaten für das Sitzungsradar: je Claude-Sitzung im Manager (laufend oder beendet) Name, Ordner, PTY-Zustand,
   * letztes Signal. Shell-Sitzungen senden keine Signale und fehlen hier. Quelle ist der SessionManager, nicht die Views.
   */
  radarInputs(): RadarInput[] {
    const manager = this.manager;
    const store = this.store;
    if (!manager || !store) return [];
    const sessions = manager.ids().flatMap((id) => {
      const record = store.get(id);
      if (!record || record.kind === "shell") return [];
      const stats = manager.stats(id);
      return [{ id, name: record.name, cwd: record.cwd, running: stats?.running ?? false, exitCode: stats?.exitCode ?? null }];
    });
    return radarInputs(sessions, this.activity);
  }

  /** Jüngste Sitzung aus RecentSessions für den Feed (Claude-ID ist der Schlüssel der Sitzungsdatei). */
  private activeFeedSession(): { id: string; name: string; claudeId: string } | null {
    const id = this.activeSessionId();
    const record = id ? this.store?.get(id) : null;
    return id && record ? { id, name: record.name, claudeId: claudeIdOf(record) } : null;
  }

  /**
   * Klicks und Tasten der Cockpit-Flächen (Abend 18, Vertrag `CockpitFeedActions`). Keine eigene Sendelogik: /lint geht
   * über sendToActive wie die Skill-Tasten, der Tab-Wechsel über bringToFront der View wie der Banner-Klick.
   */
  private feedActions(store: SessionStore): CockpitFeedActions {
    return {
      focusSession: (id) => this.focusSession(id),
      openBriefing: () => void this.openBriefing(),
      openNote: (path) => void this.openNote(path),
      startLint: () => {
        const cmd = store.settings().lintCommand;
        if (!isUnset(cmd)) this.sendToActive(buildSend(cmd));
      },
      setEffort: (step) => {
        const result = store.updateSetting("nextEffort", step);
        if (!result.ok) new Notice(`Effort nicht gesetzt: ${result.reason}`);
      },
      toggleTelegram: () => { this.toggleTelegram(store); },
      toggleSound: () => { this.toggleSound(store); },
      newSession: () => { void this.openNewSessionModal(store); },
      openSettings: () => openCockpitSettings(this.app, this.manifest.id),
    };
  }

  /** Abend 19h: Handoff-Pfade, die gerade aufgenommen werden (Schutz gegen doppeltes „Weiter“). */
  private readonly handoffsInFlight = new Set<string>();

  /** Dialog „Wo soll claude starten?“: Command „Neue Sitzung“ und das Plus auf dem Knauf des Schalthebels (Feld newSession). */
  private async openNewSessionModal(store: SessionStore): Promise<void> {
    const s = store.settings();
    let handoffs: SessionChoice[] = [];
    try {
      const r = await readOpenHandoffs(this.app.vault, s, parseYaml, homedir());
      for (const e of r.errors) console.warn(`Glasscockpit: ${e}`);
      handoffs = handoffChoices(r.items, this.vaultPath(), s.handoffPrompt, (d) => existsSync(d), this.handoffsInFlight);
    } catch (e) {
      console.warn("Glasscockpit: Handoffs nicht lesbar, Menü ohne Weiter-Einträge", e);
    }
    new NewSessionModal(this.app, {
      vaultPath: () => this.vaultPath(),
      projectsRoot: () => store.settings().projectsRoot,
      handoffs,
      choose: (choice) => {
        if (choice.handoff) { void this.takeUpHandoff(choice, choice.handoff); return; }
        void this.createSession({ cwd: choice.cwd, baseName: choice.baseName, kind: "claude" });
      },
    }).open();
  }

  /** Abend 19h: Sitzung mit Startnachricht starten; erst wenn sie läuft, den Handoff als aufgenommen markieren. */
  private async takeUpHandoff(choice: SessionChoice, h: { path: string; prompt: string; repoMissing: boolean }): Promise<void> {
    if (this.handoffsInFlight.has(h.path)) { new Notice("Glasscockpit: Handoff wird schon aufgenommen."); return; }
    this.handoffsInFlight.add(h.path);
    try {
      const manager = this.manager;
      const id = await this.createSession({ cwd: choice.cwd, baseName: choice.baseName, kind: "claude", prompt: h.prompt });
      if (!id || !manager) return;
      if (h.repoMissing) new Notice("Glasscockpit: Repo-Ordner aus dem HUB fehlt, Sitzung läuft im Vault.");
      const started = await awaitRunning({
        onChange: (cb) => manager.onChange(cb), isRunning: () => manager.isRunning(id), timeoutMs: HANDOFF_START_TIMEOUT_MS,
        setTimer: (fn, ms) => window.setTimeout(fn, ms), clearTimer: (t) => window.clearTimeout(t as number),
      });
      if (!started) { new Notice("Glasscockpit: Sitzung nicht gestartet, Handoff bleibt offen."); return; }
      const file = this.app.vault.getFileByPath(h.path);
      if (!file) { new Notice(`Glasscockpit: Handoff nicht gefunden: ${h.path}`); return; }
      try {
        await this.app.vault.process(file, (data) => { const m = markTakenUp(data, isoDay(new Date())); if (!m.ok) throw new Error(m.reason); return m.content; });
      } catch (e) {
        new Notice(`Glasscockpit: Handoff nicht markiert: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      this.handoffsInFlight.delete(h.path);
    }
  }

  /** Kippschalter: ist eine der beiden Telegram-Arten an, werden beide aus, sonst beide an. Gibt den neuen Zustand zurück. */
  private toggleTelegram(store: SessionStore): boolean {
    const on = toggledTelegram(store.settings());
    store.updateSetting("telegramOnDone", on);
    store.updateSetting("telegramOnQuestion", on);
    return on;
  }

  /** Kippschalter: ist Ton oder macOS-Banner an, werden beide aus, sonst beide an. Gibt den neuen Zustand zurück. */
  private toggleSound(store: SessionStore): boolean {
    const on = toggledSound(store.settings());
    store.updateSetting("alertSound", on);
    store.updateSetting("alertBanner", on);
    return on;
  }

  /** Tab der Cockpit-Sitzung nach vorn: wie der Banner-Klick (bringToFront); ein Hintergrund-Tab ohne geladene View per revealLeaf. */
  private focusSession(id: string): void {
    const view = this.viewsOf(id)[0];
    if (view) {
      view.bringToFront();
      return;
    }
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL).find((l) => readSessionId(l.getViewState().state) === id);
    if (!leaf) {
      new Notice("Kein Tab für diese Sitzung");
      return;
    }
    void this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  /** Kanzel: das Dashboard nach vorn, dort den Zoom (Cockpit) bzw. die aufgeklappte Karte (Liste) der Briefing-Karte. */
  private async openBriefing(): Promise<void> {
    await this.openDashboard();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0]?.view;
    if (view instanceof DashboardView) view.showBriefing();
  }

  /** Inbox-Notiz im Zoom der Vault-Lage: in einem neuen Tab öffnen (wie die IDE-Brücke Notizen öffnet). */
  private async openNote(path: string): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      new Notice(`Notiz nicht gefunden: ${path}`);
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  /** Sitzungs-ids aller Terminal-Tabs, aus dem gespeicherten State: Hintergrund-Tabs sind noch DeferredView. */
  private terminalLeafIds(): string[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_TERMINAL)
      .map((leaf) => readSessionId(leaf.getViewState().state))
      .filter((id): id is string => id !== null);
  }

  /**
   * Bereich der Cockpit-Ansicht (Abend 19e): Hauptbereich, linke oder rechte Seitenleiste. Ein ausgelöstes Fenster zählt als
   * Hauptbereich, weil Obsidian Gruppen beim Schließen auflöst und eine Split-Lage sich nicht nachbauen ließe.
   */
  private dashboardArea(): DashboardMemo {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
    return leaf ? { area: this.areaOfLeaf(leaf) } : null;
  }

  private areaOfLeaf(leaf: WorkspaceLeaf): DashboardArea {
    const root = leaf.getRoot();
    if (root === this.app.workspace.leftSplit) return "left";
    if (root === this.app.workspace.rightSplit) return "right";
    return "main";
  }

  /**
   * Nach dem Abschalten (Abend 19c, 19e): erst die Cockpit-Ansicht im gemerkten Bereich, dann die Sitzungen. Die erste Sitzung
   * wie eine neue (Split rechts vom Cockpit im Hauptbereich), die übrigen als Tabs daneben. Startart restore.
   */
  private async reopenLayout(area: DashboardArea | null, ids: readonly string[]): Promise<void> {
    if (area !== null) await this.openDashboard(area);
    let group: WorkspaceLeaf | undefined;
    for (const id of ids) {
      await this.openSession(id, group ?? this.newSessionTarget());
      group = this.leafOfSession(id) ?? group;
    }
    new Notice(reopenNotice(ids.length, area !== null));
  }

  private terminalViews(): TerminalView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_TERMINAL)
      .map((leaf) => leaf.view)
      .filter((view): view is TerminalView => view instanceof TerminalView);
  }

  private viewsOf(id: string): TerminalView[] {
    return this.terminalViews().filter((view) => view.currentSessionId() === id);
  }

  /** Beenden: Views lösen und Hinweis schreiben, dann PTY weg. kill entfernt die Abonnenten, onExit käme nicht an. */
  private stopSession(id: string): void {
    for (const view of this.viewsOf(id)) view.detach(stoppedLine());
    this.activity.forget(id);
    void this.manager?.kill(id);
  }

  /**
   * Neu starten: Views lösen, PTY weg (SIGHUP, nötigenfalls SIGKILL; gewartet wird bis der Prozess weg ist, damit
   * --resume die Unterhaltung nicht noch belegt findet), dann nacheinander anhängen (die erste spawnt, die anderen
   * hängen sich an). fresh: neue Claude-ID, unabhängig von der Einstellung „Unterhaltung fortsetzen“.
   */
  private async restartSession(id: string, fresh = false): Promise<void> {
    const views = this.viewsOf(id);
    for (const view of views) view.detach("\r\n");
    if (views.length > 0) this.pendingStart.set(id, { startKind: "restart", fresh });
    this.activity.forget(id);
    await this.manager?.kill(id);
    for (const view of views) await view.reconnect();
  }

  /** Vorhandenes Dashboard nach vorn, sonst neu im Bereich: Hauptbereich als Tab (Vorgabe), Seitenleisten über getLeftLeaf/getRightLeaf. */
  private async openDashboard(area: DashboardArea = "main"): Promise<void> {
    const ws = this.app.workspace;
    const leaf = ws.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0]
      ?? (area === "left" ? ws.getLeftLeaf(false) : area === "right" ? ws.getRightLeaf(false) : ws.getLeaf("tab"));
    if (!leaf) return;
    if (leaf.view.getViewType() !== VIEW_TYPE_DASHBOARD) await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
    await ws.revealLeaf(leaf);
  }

  /**
   * Cockpit-Ansicht: links das Dashboard (vorhandenes Leaf wird wiederverwendet), rechts die jüngste Terminal-Sitzung
   * (RecentSessions, nie das aktive Leaf: das ist hier das Dashboard), sonst eine neue Claude-Sitzung im Vault. Die
   * Entscheidung steht in planCockpitSplit, geteilt wird über Obsidian (getLeaf("split", "vertical") in openTerminal).
   */
  private async openCockpitSplit(): Promise<void> {
    const ws = this.app.workspace;
    const dashboardWasOpen = ws.getLeavesOfType(VIEW_TYPE_DASHBOARD).length > 0;
    await this.openDashboard();
    const dashboard = ws.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
    if (!dashboard) return;
    // Alle Sitzungen (jüngste zuerst, RecentSessions): Die Entscheidung trifft planCockpitSplit (19e: keine bleibt in der Dashboard-Gruppe).
    const candidates = this.sessionCandidates();
    const leafOf = new Map(candidates.map((c) => [c.sessionId, c.leaf]));
    const plan = planCockpitSplit({
      dashboardOpen: dashboardWasOpen,
      candidates: candidates.map(({ sessionId, inDashboardGroup }) => ({ sessionId, inDashboardGroup })),
    });
    // Das Dashboard ist aktiv, damit der Split rechts daneben entsteht.
    ws.setActiveLeaf(dashboard, { focus: false });
    const terminal = plan.terminal;
    if (terminal.kind === "new-session") {
      await this.createSession({ cwd: this.vaultPath(), baseName: "claude", kind: "claude" });
      return;
    }
    // reuse: Die jüngste Sitzung außerhalb bleibt und kommt nach vorn; ihre Gruppe nimmt die umziehenden Tabs auf.
    const stay = terminal.kind === "reuse" ? leafOf.get(terminal.sessionId) : undefined;
    if (stay) await ws.revealLeaf(stay);
    let group: WorkspaceLeaf | undefined = stay;
    const moving = terminal.kind === "move" ? terminal.sessionIds : terminal.move;
    for (const id of moving) {
      // Umzug statt Doppel: erst die neue View (sie zählt schon im ViewTracker), dann den alten Tab zu; das Schließen beendet die Sitzung nicht.
      // Die erste landet im Split rechts (Dashboard aktiv), die übrigen als Tabs in dieser Gruppe.
      const moved = await this.openSession(id, group);
      group = group ?? moved;
      leafOf.get(id)?.detach();
    }
    // Vorn liegt die jüngste Sitzung: ihre Gruppe gewinnt am Ende die Anzeige.
    if (stay) await ws.revealLeaf(stay);
    else if (terminal.kind === "move") {
      const first = this.leafOfSession(terminal.sessionIds[0]);
      if (first) await ws.revealLeaf(first);
    }
  }

  /**
   * Terminal-View öffnen. Ohne intoGroupOf als vertikaler Split vom aktiven Leaf; mit intoGroupOf als weiterer Tab in
   * dessen Tab-Gruppe (getLeaf("tab") legt den Tab in der Gruppe des aktiven Leafs an, daher vorher aktiv setzen).
   */
  private async openTerminal(state?: Record<string, unknown>, intoGroupOf?: WorkspaceLeaf): Promise<WorkspaceLeaf> {
    if (intoGroupOf) this.app.workspace.setActiveLeaf(intoGroupOf, { focus: false });
    const leaf = intoGroupOf ? this.app.workspace.getLeaf("tab") : this.app.workspace.getLeaf("split", "vertical");
    await leaf.setViewState({ type: VIEW_TYPE_TERMINAL, state, active: true });
    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  /** Neuer Eintrag im Store, dann ein Tab dazu. Die Cockpit-ID ist zugleich die Session-ID von Claude Code; null bei Abbruch. */
  private async createSession(choice: { cwd: string; baseName: string; kind: SessionKind; agentName?: string; prompt?: string }): Promise<string | null> {
    const store = this.store;
    if (!store) return null;
    const id = crypto.randomUUID();
    const record: SessionRecord = {
      id,
      name: uniqueName(choice.baseName, store.names()),
      kind: choice.kind,
      cwd: choice.cwd,
      createdAt: new Date().toISOString(),
      // Eigene Claude-ID im Eintrag; bei Neuanlage gleich der Cockpit-id.
      claudeSessionId: id,
      ...(choice.agentName ? { agentName: choice.agentName } : {}),
    };
    const added = store.add(record);
    if (!added.ok) {
      new Notice(`Glasscockpit: ${added.reason}`);
      return null;
    }
    this.pendingStart.set(record.id, { startKind: "new", fresh: false, ...(choice.prompt ? { prompt: choice.prompt } : {}) });
    // Vor dem Öffnen bestimmen: danach ist das aktive Leaf schon die neue View.
    const target = this.newSessionTarget();
    await this.openSession(record.id, target);
    // active-leaf-change kommt, bevor die neue View ihre ID kennt.
    this.recent.touch(record.id);
    return record.id;
  }

  /** Plan für eine View: Eintrag aus dem Store, bei unbekannter ID ein neuer im Vault; Begrenzung der laufenden Sitzungen. */
  private async planFor(id: string): Promise<SpawnPlan> {
    const store = this.store;
    const manager = this.manager;
    const launcher = this.launcher;
    if (!store || !manager || !launcher) return { ok: false, message: "Glasscockpit ist nicht geladen" };
    // Die Startart gilt für genau diesen Plan.
    const start = this.pendingStart.get(id) ?? { startKind: "restore" as StartKind, fresh: false };
    this.pendingStart.delete(id);
    let record = store.get(id);
    if (!record) {
      record = {
        id,
        name: uniqueName("claude", store.names()),
        kind: "claude",
        cwd: this.vaultPath(),
        createdAt: new Date().toISOString(),
      };
      store.add(record);
      new Notice(`Sitzung ${id.slice(0, 8)} war unbekannt, starte claude im Vault`);
    }
    // Platz synchron reservieren, vor dem ersten await: sonst bestehen zwei gleichzeitige Starts dieselbe Prüfung.
    const max = store.settings().maxSessions;
    const running = manager.ids().filter((i) => manager.isRunning(i)).length;
    const reservation = this.slots.reserve(running, max);
    if (!reservation.ok) {
      return { ok: false, message: `Höchstens ${max} laufende Sitzungen (Einstellung). Beende erst eine.` };
    }
    let plan: SpawnPlan;
    try {
      plan = await launcher.plan(record, { ...start, resumeConversations: store.settings().resumeConversations, fullscreen: store.settings().fixedPrompt, effort: store.settings().nextEffort, skipPermissions: store.settings().skipPermissions });
    } catch (fehler) {
      reservation.release();
      throw fehler;
    }
    if (!plan.ok) {
      reservation.release();
      return plan;
    }
    // Neue Claude-Unterhaltung: ID im Eintrag speichern, die Cockpit-id bleibt.
    if (plan.adoptClaudeId) store.setClaudeSessionId(record.id, plan.adoptClaudeId);
    return { ...plan, release: reservation.release };
  }

  /** Aktives Leaf ist ein Terminal mit Sitzung: merken. */
  private touchLeaf(leaf: WorkspaceLeaf | null): void {
    const view = leaf?.view;
    if (!(view instanceof TerminalView)) return;
    const id = view.currentSessionId();
    if (id) this.recent.touch(id);
  }

  /** Aktive Sitzung: die jüngste, die noch einen Tab hat. */
  private activeSessionId(): string | null {
    return this.recent.current((id) => this.viewsOf(id).length > 0);
  }

  /** Prüft, ob blind gesendet werden darf. Gibt die Sitzungs-ID zurück, sonst Notice und null. */
  private sendTarget(): string | null {
    const manager = this.manager;
    const store = this.store;
    if (!manager || !store) return null;
    const id = this.activeSessionId();
    const result = checkTarget({
      sessionId: id,
      kind: id ? (store.get(id)?.kind ?? null) : null,
      running: id ? manager.isRunning(id) : false,
    });
    if (result === "ok") return id;
    if (result === "no-session") {
      const notice = new Notice("Keine Terminal-Sitzung aktiv. ", 10000);
      const button = notice.messageEl.createEl("button", { text: "Claude-Sitzung öffnen" });
      button.addEventListener("click", () => {
        notice.hide();
        void this.createSession({ cwd: this.vaultPath(), baseName: "claude", kind: "claude" });
      });
    } else if (result === "exited") {
      new Notice(`Sitzung beendet: ${id ? (store.get(id)?.name ?? id.slice(0, 8)) : ""}`);
    } else {
      new Notice("Aktive Sitzung ist eine Shell");
    }
    return null;
  }

  /** „Auswahl an Claude erwähnen“ (Abend 16): at_mentioned an die Verbindung der jüngsten Terminal-Sitzung (RecentSessions). */
  private mentionSelection(): void {
    const id = this.sendTarget();
    if (!id) return;
    const result = this.ide?.mention(id) ?? "off";
    if (result === "ok") {
      const leaf = this.viewsOf(id)[0]?.leaf;
      if (leaf) {
        void this.app.workspace.revealLeaf(leaf);
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
      }
    } else if (result === "off") {
      new Notice("IDE-Brücke ist aus oder läuft nicht (Einstellung „IDE-Brücke für Claude-Sitzungen“)");
    } else if (result === "no-selection") {
      new Notice("Keine Auswahl in einer Notiz");
    } else {
      new Notice("Diese Claude-Sitzung ist nicht mit der IDE-Brücke verbunden (nur Sitzungen, die nach dem Einschalten gestartet wurden)");
    }
  }

  /** Liste frisch von der Platte, dann Auswahl. Skills und Commands brauchen vorher ein sendefähiges Ziel. */
  private async openLauncher(kind: LaunchKind): Promise<void> {
    const store = this.store;
    if (!store) return;
    const needsTarget = kind !== "agent";
    let activeId: string | null = null;
    if (needsTarget) {
      activeId = this.sendTarget();
      if (!activeId) return;
    } else {
      activeId = this.activeSessionId();
    }
    const found = await this.discoverAll();
    const list = kind === "skill" ? found.skills : kind === "agent" ? found.agents : found.commands;
    if (list.length === 0) {
      new Notice(`Keine ${kind === "skill" ? "Skills" : kind === "agent" ? "Agents" : "Commands"} gefunden`);
      return;
    }
    new LaunchModal(this.app, kind, list, (entry) => this.chooseEntry(kind, entry)).open();
  }

  /** Skills, Agents und Commands frisch von der Platte; Projekt = Ordner der aktiven Sitzung. */
  private async discoverAll(): Promise<Awaited<ReturnType<typeof discover>>> {
    const id = this.activeSessionId();
    return discover(
      nodeDiscoveryFs,
      { home: homedir(), vault: this.vaultPath(), project: id ? (this.store?.get(id)?.cwd ?? null) : null },
      (text) => parseYaml(text),
    );
  }

  private chooseEntry(kind: LaunchKind, entry: LaunchEntry): void {
    if (kind === "agent") {
      void this.createSession({ cwd: this.vaultPath(), baseName: entry.name, kind: "agent", agentName: entry.name });
      return;
    }
    // Ziel noch einmal prüfen: Zwischen Öffnen und Auswahl kann die Sitzung geendet sein.
    if (kind === "skill") this.sendSkill(entry.name);
    else this.sendToActive(buildInsert(`/${entry.name} `));
  }

  /** Skill starten (`/name` plus Enter). Die einzige Stelle, die „zuletzt benutzt“ fortschreibt: nur nach erfolgreichem Senden. */
  private sendSkill(name: string): void {
    if (this.sendToActive(buildSend(`/${name}`))) this.store?.useSkill(name);
  }

  /** Das eine Sende-Primitiv für Launcher und Dashboard: Ziel prüfen (sonst Notice), dann schreiben. true = Ziel ok und geschrieben. */
  private sendToActive(steps: SendStep[]): boolean {
    const id = this.sendTarget();
    if (!id) return false;
    return this.deliver(id, steps);
  }

  /** Schritte in die PTY schreiben; verzögerte Schritte prüfen vorher erneut, ob die Sitzung noch läuft. Danach den Tab nach vorn. */
  private deliver(id: string, steps: SendStep[]): boolean {
    const manager = this.manager;
    if (!manager) return false;
    let wrote = false;
    for (const step of steps) {
      const write = (): boolean => {
        if (!manager.isRunning(id)) {
          new Notice("Sitzung beendet");
          return false;
        }
        manager.handle(id)?.write(step.data);
        return true;
      };
      if (step.delayMs <= 0) wrote = write() || wrote;
      else window.setTimeout(write, step.delayMs);
    }
    const leaf = this.viewsOf(id)[0]?.leaf;
    if (leaf) {
      void this.app.workspace.revealLeaf(leaf);
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
    }
    return wrote;
  }

  private vaultPath(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : homedir();
  }

  private async copySessionId(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      new Notice(`Session-ID kopiert: ${id}`);
    } catch (fehler) {
      console.error("Glasscockpit: Zwischenablage nicht beschrieben", fehler);
      new Notice(`Session-ID: ${id} (Zwischenablage nicht beschrieben)`, 15000);
    }
  }

  /** Neuer Split mit dieser Sitzung. Die View holt sich ihren Plan über planFor. */
  private openSession(sessionId: string, intoGroupOf?: WorkspaceLeaf): Promise<WorkspaceLeaf> {
    return this.openTerminal({ sessionId }, intoGroupOf);
  }

  /** Leaf einer Sitzung: die geladene View, sonst ein Hintergrund-Tab über seinen gespeicherten Zustand. */
  private leafOfSession(id: string): WorkspaceLeaf | undefined {
    return (
      this.viewsOf(id)[0]?.leaf ??
      this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL).find((l) => readSessionId(l.getViewState().state) === id)
    );
  }

  /** Offene Sitzungen mit auffindbarem Leaf, jüngste zuerst; `inDashboardGroup` = Tab liegt in der Gruppe des Dashboards. */
  private sessionCandidates(): { sessionId: string; leaf: WorkspaceLeaf; inDashboardGroup: boolean }[] {
    const dashboard = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
    const out: { sessionId: string; leaf: WorkspaceLeaf; inDashboardGroup: boolean }[] = [];
    // Abend 19g: Hintergrund-Tabs (noch ohne geladene View) zählen mit, leafOfSession findet sie über den gespeicherten Zustand.
    for (const id of this.recent.open((i) => this.leafOfSession(i) !== undefined)) {
      const leaf = this.leafOfSession(id);
      if (leaf) out.push({ sessionId: id, leaf, inDashboardGroup: dashboard !== undefined && leaf.parent === dashboard.parent });
    }
    return out;
  }

  /**
   * Neue Sitzungen (18f): Leaf der jüngsten offenen Sitzung außerhalb der Dashboard-Gruppe (neuer Tab in ihrer Gruppe),
   * sonst undefined: Split. Bei einem Split wird das Dashboard aktiv gesetzt, damit er rechts daneben entsteht.
   */
  private newSessionTarget(): WorkspaceLeaf | undefined {
    const candidates = this.sessionCandidates();
    const plan = planNewSessionPlacement({ candidates });
    if (plan.kind === "tab") return candidates.find((c) => c.sessionId === plan.sessionId)?.leaf;
    const dashboard = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
    // Liegt das Cockpit in einer Seitenleiste, entstünde der Split dort drin: dann vom jüngsten Leaf des Hauptbereichs aus.
    if (dashboard) {
      const from = this.areaOfLeaf(dashboard) === "main" ? dashboard : this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
      if (from) this.app.workspace.setActiveLeaf(from, { focus: false });
    }
    return undefined;
  }

  /** Bericht über Claude-Start und leere Pane: in die Konsole, die Zwischenablage und als Hinweis. */
  private async showDiagnosis(): Promise<void> {
    const launch = this.launcher ? formatLaunchInfo(await this.launcher.info()) : "Launcher fehlt.";
    const text = `${launch}\n\n${formatDiagnosis(this.terminalViews().map((view) => view.diagnose()))}`;
    console.info(`Glasscockpit, Diagnose:\n${text}`);
    let copied = "";
    try {
      await navigator.clipboard.writeText(text);
      copied = "\n(in der Zwischenablage)";
    } catch (fehler) {
      console.error("Glasscockpit: Zwischenablage nicht beschrieben", fehler);
    }
    new Notice(text + copied, 30000);
  }
}
