import { execFile } from "child_process";
import { REMINDERS_TIMEOUT_MS } from "../core/constants";
import { Observable } from "../core/observable";
import type { Platform } from "../core/platform-path";
import { pullDue } from "../core/pull-state";
import { REMINDERS_LIST_SCRIPT, REMINDERS_SET_SCRIPT, type Reminder, parseReminders, reminderErrorText } from "../core/reminders";
import type { CockpitSettings } from "../core/settings";

/**
 * Führt ein AppleScript über `/usr/bin/osascript` aus (Abend 44); Werte nur als argv hinter dem Skript, nie im Skripttext.
 * Liefert stdout ohne den abschließenden Zeilenumbruch. Lehnt mit stderr ab (die Meldung von execFile beginnt mit der ganzen
 * Befehlszeile samt Skript); ein Zeitlimit trägt „killed“, damit reminderErrorText es erkennt.
 */
export function runOsascript(script: string, args: string[], timeoutMs: number = REMINDERS_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      execFile(
        "/usr/bin/osascript",
        ["-e", script, ...args],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (!err) {
            resolve(String(stdout).replace(/\r?\n$/, ""));
            return;
          }
          const e = err as Error & { killed?: boolean; signal?: string | null };
          const text = String(stderr ?? "").trim() || e.message;
          const timedOut = e.killed === true || (typeof e.signal === "string" && e.signal !== "");
          reject(new Error(timedOut ? `${text} (killed ${e.signal ?? ""})`.replace(/ \)$/, ")") : text));
        },
      );
    } catch (fehler) {
      reject(fehler instanceof Error ? fehler : new Error(String(fehler)));
    }
  });
}

export type RemindersState =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "ok"; items: Reminder[] }
  | { kind: "error"; message: string; items: Reminder[] };

export interface RemindersDeps {
  /** Wirksame Einstellungen, bei jeder Nutzung frisch. */
  settings: () => CockpitSettings;
  /** Meldet jede Einstellungsänderung, liefert die Abmeldung. */
  onSettingsChange: (cb: (s: CockpitSettings) => void) => () => void;
  platform: Platform;
  now: () => number;
  /** Ersatz für Tests, sonst runOsascript. */
  run?: typeof runOsascript;
}

function messageOf(fehler: unknown): string {
  return fehler instanceof Error ? fehler.message : String(fehler);
}

/**
 * Erinnerungen-Zustand und Takt, eine Instanz im Plugin für alle Dashboards (Muster PullController). Aktiv nur auf macOS und
 * bei eingeschalteter Einstellung; sonst Zustand `off` und kein osascript-Aufruf. Fehler stehen im Zustand, nie als Notice.
 */
export class RemindersController {
  readonly state: Observable<RemindersState>;
  private readonly deps: RemindersDeps;
  private readonly run: typeof runOsascript;
  private readonly unsubscribe: () => void;
  private open = 0;
  private lastAttempt: number | null = null;
  private running = false;
  /**
   * Der laufende Leselauf ist veraltet: Während er lief, wurde erfolgreich gesetzt. Sein Ergebnis
   * zeigt den Stand von vorher; refresh verwirft es und liest unter derselben Sperre neu.
   */
  private stale = false;
  /** Nach dispose: keine Läufe und keine Meldungen mehr. */
  private disposed = false;
  /** Gab es schon ein Ergebnis seit dem Einschalten? Nur der erste Lauf zeigt `loading`. */
  private loaded = false;
  private items: Reminder[] = [];
  private readonly busy = new Set<string>();
  private wasActive: boolean;

  constructor(deps: RemindersDeps) {
    this.deps = deps;
    this.run = deps.run ?? runOsascript;
    this.wasActive = this.active();
    this.state = new Observable<RemindersState>(this.wasActive ? { kind: "loading" } : { kind: "off" }, (fehler) =>
      console.warn("Glasscockpit: Abonnent der Erinnerungen gescheitert", fehler),
    );
    this.unsubscribe = deps.onSettingsChange(() => this.settingsChanged());
  }

  private active(): boolean {
    return !this.disposed && this.deps.platform === "darwin" && this.deps.settings().remindersEnabled;
  }

  /** Zustandsmeldung, nach dispose stumm. */
  private publish(s: RemindersState): void {
    if (!this.disposed) this.state.set(s);
  }

  private settingsChanged(): void {
    const now = this.active();
    if (now === this.wasActive) return;
    this.wasActive = now;
    if (!now) {
      this.loaded = false;
      this.items = [];
      this.lastAttempt = null;
      this.publish({ kind: "off" });
      return;
    }
    this.publish({ kind: "loading" });
    if (this.open > 0) void this.refresh();
  }

  dashboardOpened(): void {
    this.open++;
    void this.refresh();
  }

  dashboardClosed(): void {
    this.open = Math.max(0, this.open - 1);
  }

  /** Vom 30-s-Takt des Plugins; Abstand wird hier frisch gelesen (0 = nur beim Öffnen und per Knopf). */
  tick(): void {
    if (this.open === 0 || !this.active()) return;
    if (pullDue(this.lastAttempt, this.deps.now(), this.deps.settings().remindersIntervalMin)) void this.refresh();
  }

  /**
   * Liest neu. Läuft nie doppelt: ein zweiter Aufruf während eines Laufs kehrt sofort zurück. Wird der Lauf unterwegs veraltet
   * (erfolgreiches Setzen), verwirft er sein Ergebnis, Erfolg wie Fehler, und liest in derselben Schleife neu.
   */
  async refresh(): Promise<void> {
    if (!this.active()) {
      if (this.state.get().kind !== "off") this.publish({ kind: "off" });
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      if (!this.loaded) this.publish({ kind: "loading" });
      for (;;) {
        this.stale = false;
        this.lastAttempt = this.deps.now();
        let out: string | null = null;
        let fehler: unknown = null;
        try {
          out = await this.run(REMINDERS_LIST_SCRIPT, []);
        } catch (e) {
          fehler = e ?? new Error("unbekannter Fehler");
        }
        // Während des Laufs ausgeschaltet oder abgebaut: Ergebnis verwerfen, `off` bleibt.
        if (!this.active()) return;
        if (this.stale) continue;
        this.loaded = true;
        if (out !== null) {
          this.items = parseReminders(out);
          this.publish({ kind: "ok", items: this.items });
        } else {
          this.publish({ kind: "error", message: reminderErrorText(messageOf(fehler)), items: this.items });
        }
        return;
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Setzt den Zielzustand einer Erinnerung (nie kippen). true bei Erfolg; erledigt nimmt den Eintrag aus der Liste (die Art des
   * Zustands bleibt), zurückgesetzt liest danach neu. Läuft für dieselbe id schon ein Aufruf, false ohne zweiten Aufruf.
   * Fehler: Zustand `error`, false. Die id ist vor jeder Zustandsmeldung wieder frei.
   */
  async setCompleted(id: string, done: boolean): Promise<boolean> {
    if (!this.active() || this.busy.has(id)) return false;
    this.busy.add(id);
    let ok = true;
    let fehler: unknown = null;
    try {
      await this.run(REMINDERS_SET_SCRIPT, [id, done ? "true" : "false"]);
    } catch (e) {
      ok = false;
      fehler = e;
    }
    this.busy.delete(id);
    if (!this.active()) return false;
    if (!ok) {
      this.publish({ kind: "error", message: reminderErrorText(messageOf(fehler)), items: this.items });
      return false;
    }
    // Ein laufender Leselauf zeigt den Stand von vor dem Setzen.
    if (this.running) this.stale = true;
    if (done) {
      this.items = this.items.filter((r) => r.id !== id);
      const cur = this.state.get();
      if (cur.kind === "ok" || cur.kind === "error") this.publish({ ...cur, items: this.items });
    } else {
      void this.refresh();
    }
    return true;
  }

  isBusy(id: string): boolean {
    return this.busy.has(id);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
  }
}
