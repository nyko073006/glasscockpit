import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { EditorView } from "@codemirror/view";
import { type App, type Plugin } from "obsidian";
import { IDE_SELECTION_DEBOUNCE_MS } from "../core/constants";
import { type Debounced, createDebounce } from "../core/debounce";
import { VIEW_TYPE_DIFF } from "../core/constants";
import { clientForSession, sessionForClient } from "../core/ide-clients";
import { atMentionParams } from "../core/ide-protocol";
import type { CockpitSettings } from "../core/settings";
import { DiffTabs } from "./diff-tabs";
import { DiffView } from "./diff-view";
import { IdeDiff } from "./ide-diff";
import { readOldFile } from "./ide-diff-fs";
import { IdeEditor } from "./ide-editor";
import { IdeLifecycle } from "./ide-lifecycle";
import { IdeServer, pidAlive } from "./ide-server";

// IDE-Brücke (Abend 16), Verkabelung: Server, Editor-Anbindung und Start/Stopp nach der Einstellung `ideBridge`.
// Alles hier ist abschaltbar gekapselt: Fehler gehen in die Konsole, nie ins Plugin.

export type MentionResult = "ok" | "off" | "no-selection" | "no-client";

export interface IdeBridgeDeps {
  /** Einstellungen, bei jeder Nutzung frisch gelesen. */
  settings: () => CockpitSettings;
  vaultBase: () => string | null;
  /** pid der PTY dieser Sitzung (undefiniert, wenn es keine gibt). */
  ptyPid: (sessionId: string) => number | undefined;
  home: string;
  /** Sitzungen mit der pid ihrer PTY (Diff-Ansicht: zu welcher Sitzung gehört eine Verbindung?). */
  sessions: () => Array<{ id: string; pid: number | undefined }>;
  /** Ein Diff wartet: die Sitzung markieren (Frage). */
  attention: (sessionId: string) => void;
}

/** Eltern-pid über ps; null, wenn unbekannt. Nur der Rückfall, falls zwischen PTY und claude ein Prozess liegt. */
function parentPid(pid: number): number | null {
  try {
    const out = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8", timeout: 1000 }).trim();
    return Number(out) > 0 ? Number(out) : null;
  } catch {
    return null;
  }
}

export class IdeBridge {
  private readonly editor: IdeEditor;
  private readonly debounced: Debounced;
  private readonly lifecycle: IdeLifecycle<IdeServer>;
  private readonly diff: IdeDiff;
  private readonly tabs: DiffTabs;

  private readonly plugin: Plugin;
  private readonly app: App;
  private readonly deps: IdeBridgeDeps;

  constructor(plugin: Plugin, app: App, deps: IdeBridgeDeps) {
    this.plugin = plugin;
    this.app = app;
    this.deps = deps;
    // Diff-Ansicht (Abend 17): Tabs, Steuerung; die Handler hängen nur am Server und werden nur bei ideDiff angeboten.
    this.tabs = new DiffTabs(app, (id) => this.diff.viewClosed(id));
    this.diff = new IdeDiff({
      readOld: readOldFile,
      show: (req, id) => this.tabs.show(req, id),
      hide: (id) => this.tabs.hide(id),
      attention: (clientId) => this.attentionFor(clientId),
      clientAlive: (clientId) => clientId === null || (this.server?.clients().some((c) => c.id === clientId) ?? false),
      enabled: () => deps.settings().ideDiff && deps.settings().ideBridge,
    });
    this.lifecycle = new IdeLifecycle<IdeServer>({
      enabled: () => deps.settings().ideBridge,
      create: () =>
        new IdeServer({
          lockDir: join(deps.home, ".claude", "ide"),
          workspaceFolders: () => {
            const base = deps.vaultBase();
            return base ? [base] : [];
          },
          vaultBase: deps.vaultBase,
          handlers: { ...this.editor.handlers(), diff: this.diff.handlers() },
          diffEnabled: () => deps.settings().ideDiff,
          onClientClose: (clientId) => this.diff.closeClient(clientId),
          pid: process.pid,
          isPidAlive: pidAlive,
          newToken: () => randomBytes(16).toString("hex"),
          warn: (message) => console.warn(message),
        }),
    });
    this.editor = new IdeEditor(app, deps.vaultBase, (params) => void this.server?.broadcast("selection_changed", params));
    this.debounced = createDebounce(() => this.editor.check(), IDE_SELECTION_DEBOUNCE_MS, {
      set: (callback, ms) => window.setTimeout(callback, ms),
      clear: (handle) => window.clearTimeout(handle as number),
    });
  }

  /** Auswahl-Abonnement einhängen (jede Änderung der Auswahl in einem Editor, auch in Pop-out-Fenstern). */
  install(): void {
    try {
      this.plugin.registerView(
        VIEW_TYPE_DIFF,
        (leaf) =>
          new DiffView(leaf, {
            lookup: (id) => this.diff.request(id),
            decide: (id, decision) => void this.diff.decide(id, decision),
            closed: (id) => {
              this.tabs.forget(id);
              this.diff.viewClosed(id);
            },
            vaultBase: this.deps.vaultBase,
          }),
      );
    } catch (fehler) {
      console.warn("Glasscockpit, IDE-Brücke: Diff-Ansicht nicht registriert", fehler);
    }
    try {
      this.plugin.registerEditorExtension(
        EditorView.updateListener.of((update) => {
          if (this.server && update.selectionSet) this.debounced();
        }),
      );
      this.plugin.registerEvent(this.app.workspace.on("active-leaf-change", () => { if (this.server) this.debounced(); }));
    } catch (fehler) {
      console.warn("Glasscockpit, IDE-Brücke: Auswahl nicht abonniert", fehler);
    }
  }

  /** Server nach der Einstellung starten oder stoppen. Aufrufe laufen nacheinander. */
  async sync(): Promise<void> {
    await this.lifecycle.sync();
    // Ist die Diff-Ansicht aus, wartet niemand mehr: offene Diffs gelten als abgelehnt, die Tabs schließen.
    if (!this.deps.settings().ideDiff) this.diff.closeAll();
  }

  /** Erst wenn der Start (oder Stopp) durch ist: Sitzungen beim Laden sollen die Variablen noch bekommen. */
  ready(): Promise<void> {
    return this.lifecycle.ready();
  }

  /** Variablen für neue Claude-Sitzungen, null solange die Brücke aus ist oder nicht läuft. */
  env(): Record<string, string> | null {
    return this.lifecycle.env();
  }

  /** Die Auswahl (aktiv, sonst die letzte) als at_mentioned an die Verbindung dieser Sitzung. */
  mention(sessionId: string): MentionResult {
    const server = this.server;
    if (!server || server.port === null) return "off";
    const target = this.editor.mention();
    if (!target) return "no-selection";
    const client = clientForSession(server.clients(), this.deps.ptyPid(sessionId), parentPid);
    if (!client) return "no-client";
    return server.send(client.id, "at_mentioned", atMentionParams(target.filePath, target.lineStart, target.lineEnd)) ? "ok" : "no-client";
  }

  /** Beim Entladen: Lockfile sofort weg (synchron im Server), offene Diffs abgelehnt und Tabs zu, dann Server schließen. */
  stop(): Promise<void> {
    this.debounced.cancel();
    this.diff.dispose();
    return this.lifecycle.stop();
  }

  /** Sitzung zur Verbindung markieren („Frage“): über die pid aus ide_connected gegen die PTY-pid der Sitzungen. */
  private attentionFor(clientId: number | null): void {
    const server = this.server;
    if (clientId === null || !server) return;
    const client = server.clients().find((c) => c.id === clientId);
    if (!client) return;
    const session = sessionForClient(client, this.deps.sessions(), parentPid);
    if (session) this.deps.attention(session);
  }

  private get server(): IdeServer | null {
    return this.lifecycle.server;
  }
}
