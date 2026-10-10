// Eigener Namensraum, damit das Original-Plugin parallel laufen kann (Festlegung vom 04.10.2026).
export const PLUGIN_ID = "glasscockpit";
export const VIEW_TYPE_TERMINAL = `${PLUGIN_ID}-terminal`;
export const VIEW_TYPE_DASHBOARD = `${PLUGIN_ID}-dashboard`;
export const CSS_PREFIX = "cockpit-";

// Terminal-Pane (Abend 2). Schriftgröße und Scrollback sind seit Abend 11 Einstellungen (DEFAULT_FONT_SIZE, DEFAULT_SCROLLBACK).
export const TERMINAL_LINE_HEIGHT = 1.25;
// Entscheidung vom 04.10.2026: Monaco, fest, unabhängig von Obsidians Monospace-Einstellung.
export const TERMINAL_FONT_FAMILY = "Monaco, Menlo, monospace";
// Option bleibt Option: Option+L tippt auf der deutschen Mac-Tastatur das @.
export const TERMINAL_MAC_OPTION_IS_META = false;

// Shell (Abend 3).
export const SHELL_FALLBACK = "/bin/zsh";
export const PTY_FALLBACK_SIZE = { cols: 120, rows: 30 } as const;

// Sitzungen (Abend 4).
export const RING_MAX_CHARS = 262144;
// Schonfrist nach dem Schließen der letzten View: Obsidian baut Views beim Verschieben neu auf.
export const KILL_GRACE_MS = 3000;
// Diagnose „leere Pane“: Momentaufnahme so lange nach dem Anhängen.
export const DIAG_SNAPSHOT_MS = 2000;

// Claude Code starten (Abend 5).
export const CLAUDE_BINARY = "claude";
// `$SHELL -i -l -c` liefert den PATH der Login-Shell, länger wird nicht gewartet.
export const LOGIN_SHELL_TIMEOUT_MS = 5000;

// Eingabe (Abend 6).
// Zeilenumbruch im Claude-Prompt: Ctrl+J (LF). Laut Doku `chat:newline`-Standard, geht in jedem Terminal ohne Setup.
// Das Kitty-Protokoll (`\x1b[13;2u`) kann xterm.js nicht, Option+Enter scheidet aus (macOptionIsMeta aus).
export const SHIFT_ENTER_SEQUENCE = "\n";
// Zweites Cmd+V (Tastenhandler und paste-Ereignis feuern beide) innerhalb dieser Zeit wird verworfen.
export const PASTE_DEBOUNCE_MS = 200;

// Codeblock-Leiste (Abend 6).
// Vom Transkript wird nur das Ende gelesen; die halbe erste Zeile überspringt lastAnswerText.
export const TRANSCRIPT_TAIL_BYTES = 524288;
export const TRANSCRIPT_POLL_MS = 2000;
// Fehlt die Transkriptdatei (Claude legt sie erst mit der ersten Nachricht an), Ordnerliste höchstens so oft lesen.
export const TRANSCRIPT_SEARCH_MS = 10000;
export const CODE_LABEL_MAX = 40;
// Tooltip eines Knopfs: so viele Zeilen mit so vielen Zeichen.
export const CODE_TOOLTIP_LINES = 6;
export const CODE_TOOLTIP_LINE_LEN = 100;
// Handoff-Knopf (Abend 19b): fester Knopf vorn in der Leiste. Das Präfix ist die Vorgabe der Einstellung handoffPrefix
// (gelesen wird store.settings()), die Beschriftung bleibt fest.
export const DEFAULT_HANDOFF_PREFIX = "Handoff:";
export const HANDOFF_BUTTON_LABEL = "Handoff kopieren";

// Sitzungen speichern (Abend 7).
// Feste Technik-Invarianten, keine Einstellungen.
export const SAVE_DEBOUNCE_MS = 300;
export const SESSION_NAME_MAX = 40;
// Vorgaben der Einstellungen; gelesen wird immer store.settings(), nie diese Konstanten direkt.
// Leer = nicht eingerichtet (Abend 21): Repo-Ampel, LOC und Commits bleiben aus, „Neue Sitzung“ bietet nur Vault und Home.
export const DEFAULT_PROJECTS_ROOT = "";
export const DEFAULT_MAX_SESSIONS = 10;
export const DEFAULT_NOTIFY_ON_DONE = true;
export const DEFAULT_NOTIFY_ON_QUESTION = true;
export const DEFAULT_MARK_TAB = true;
export const DEFAULT_ALERT_SOUND = true;
export const DEFAULT_ALERT_BANNER = true;
export const DEFAULT_SOUND_FILE = "/System/Library/Sounds/Glass.aiff";
export const DEFAULT_ALERT_GAP_MS = 3000;

// Härtung (Abend 11). Vorgaben der Einstellungen im Abschnitt „Terminal“; gelesen wird store.settings().
export const DEFAULT_RESUME_CONVERSATIONS = true;
// Abend 19c: Sitzungen, die beim Abschalten des Plugins offen waren, beim Einschalten wieder öffnen.
export const DEFAULT_REOPEN_AFTER_DISABLE = true;
export const DEFAULT_FONT_SIZE = 13;
export const DEFAULT_SCROLLBACK = 5000;
// Beenden mit Eskalation: SIGHUP sofort, lebt der Prozess nach dieser Zeit noch, folgt SIGKILL. Technik-Invariante,
// keine Einstellung: Gemessen am 05.10.2026 endet claude auf SIGHUP in unter 1 s; die Frist deckt nur Prozesse ab,
// die SIGHUP ignorieren oder gerade beschäftigt sind. Eine längere Frist hält Neu starten nur unnötig auf.
export const KILL_ESCALATION_MS = 2000;

// Launcher (Abend 8).
// Pause zwischen eingefügtem Mehrzeiler und Enter. Technik-Invariante, keine Einstellung: Claude Code muss das
// Bracketed Paste erst verarbeitet haben, sonst wird das Enter als Teil des Einfügens geschluckt.
export const SEND_ENTER_DELAY_MS = 80;

// Dashboard (Abend 9).
// Leer = nicht eingerichtet (Abend 21).
export const DEFAULT_BRIEFINGS_DIR = "";
export const DEFAULT_PULL_INTERVAL_MIN = 5;
// Platzhalter {ordner} wird beim Senden durch briefingsDir ersetzt.
export const DEFAULT_CONTINUE_PROMPT =
  "Lies die neueste Datei in {ordner}/ (mein Briefing). Hilf mir, die Handlungsschritte abzuarbeiten: Antworten entwerfen, erst nach meinem OK senden. Womit fangen wir an?";
// Feste Technik-Invarianten, keine Einstellungen: git schreibt mehrere Dateien nacheinander (Neuladen sammeln),
// und ein hängender Pull darf den Takt nicht für immer sperren.
export const BRIEFING_RELOAD_DEBOUNCE_MS = 400;
/** Nachlauf, bis Handoff-Änderungen im Vault den Feed neu lesen lassen (Abend 19h). */
export const HANDOFF_RELOAD_DEBOUNCE_MS = 1500;
export const GIT_PULL_TIMEOUT_MS = 30000;
// Repo-Ampel (Abend 18): Zeitlimit je Repo für `git status`, feste Technik-Invariante (ein hängendes Repo hält die anderen nicht auf).
export const GIT_STATUS_TIMEOUT_MS = 10000;
// Takt, in dem der Plugin-Timer prüft, ob ein Pull fällig ist (Abstand selbst: Einstellung pullIntervalMin).
export const PULL_TICK_MS = 30000;

// Tasks und Skill-Karte (Abend 10).
export const DEFAULT_TASKS_FILE = "Cockpit Tasks.md";
export const DEFAULT_SKILL_BUTTONS = 12;
// Feste Technik-Invarianten, keine Einstellungen: Obsidian meldet bei einem Schreibvorgang mehrere Ereignisse
// (modify, changed), die zu einem Neuladen zusammenlaufen; und die Liste „zuletzt benutzt“ in data.json bleibt
// begrenzt, damit die Datei nicht ohne Ende wächst (die Zahl der Knöpfe ist die Einstellung skillButtons, max. 30).
export const TASKS_RELOAD_DEBOUNCE_MS = 300;
export const RECENT_SKILLS_MAX = 30;

// Cockpit-Ansicht (Abend 15). Vorgabe der Einstellung „Dashboard-Ansicht“ (Abschnitt „Dashboard“): cockpit = Bild mit
// Instrumenten, list = die Karten untereinander (das Dashboard bis Abend 14, unverändert).
export const DEFAULT_DASHBOARD_LAYOUT = "cockpit";
export const DASHBOARD_LAYOUTS = ["cockpit", "list"] as const;
// Ausschnitt der Cockpit-Ansicht (Abend 19b), Einstellung „Cockpit-Ausschnitt“ (Abschnitt „Dashboard“): crop = zugeschnitten
// (`VIEW_CROP` in core/cockpit-panels), full = das ganze Bild.
export const DEFAULT_COCKPIT_CROP = "crop";
export const COCKPIT_CROPS = ["crop", "full"] as const;

// Telegram (Abend 11). Nach außen gehende Nachrichten nur nach ausdrücklichem Einschalten.
export const DEFAULT_TELEGRAM_ON_DONE = false;
export const DEFAULT_TELEGRAM_ON_QUESTION = false;
export const DEFAULT_TELEGRAM_ENV_FILE = "~/.claude/channels/telegram/.env";
// Leer = allowFrom[0] aus access.json im Ordner der .env-Datei.
export const DEFAULT_TELEGRAM_CHAT_ID = "";
export const DEFAULT_TELEGRAM_IDLE_MIN = 2;
// Feste Technik-Invarianten, keine Einstellungen: Zeitlimits für ioreg und den Versand.
export const IDLE_PROBE_TIMEOUT_MS = 3000;
export const TELEGRAM_TIMEOUT_MS = 10000;

// Usage-Karte (Abend 12). Abstand zwischen zwei Lesevorgängen (Schnappschuss und Transkripte), nur bei sichtbarem Dashboard.
export const DEFAULT_USAGE_POLL_SEC = 60;
// Feste Technik-Invarianten, keine Einstellungen: Die Schnappschussdatei schreibt das Statuszeilen-Skript
// (~/.claude/statusline-command.sh), beide Seiten müssen denselben Pfad nennen; die Transkripte liegen dort,
// wo Claude Code sie ablegt. USAGE_TICK_MS ist nur der Prüftakt, der Abstand selbst ist usagePollSec.
export const USAGE_SNAPSHOT_FILE = "~/.claude/cockpit/usage.json";
export const TRANSCRIPTS_DIR = "~/.claude/projects";
export const USAGE_TICK_MS = 5000;

// Zähler und Statuszeile (Abend 13). Der Zähler läuft ab dem Laden des Plugins, nicht nur bei offenem Dashboard.
// Die Tagessumme für die Statuszeile (~/.claude/statusline-command.sh liest sie); beide Seiten nennen denselben Pfad.
export const DEFAULT_WRITE_TOKENS_FILE = true;
export const TOKENS_TODAY_FILE = "~/.claude/cockpit/tokens-today.json";

// IDE-Brücke (Abend 16). Aus heißt: kein Server, kein Lockfile, keine Variablen; wirkt für neu gestartete Sitzungen.
export const DEFAULT_IDE_BRIDGE = true;
// Diff-Ansicht (Abend 17). An heißt: Claude wartet bei jeder Dateiänderung auf Annehmen oder Ablehnen in Obsidian. Deshalb
// Vorgabe aus; nur mit ideBridge zusammen wirksam.
export const DEFAULT_IDE_DIFF = false;
// Eingabezeile fest (Abend 19f): an startet Claude im Vollbild (Alternate Screen, Maus in Claude). Vorgabe aus = klassisch mit
// xterm-Scrollback und xterm-Textauswahl. Wirkt für neu gestartete Sitzungen.
export const DEFAULT_FIXED_PROMPT = false;
// Rechteabfragen überspringen (Abend 20, vorher fest an): an startet Claude mit --dangerously-skip-permissions und führt Befehle
// ohne Rückfrage aus. Vorgabe aus; wirkt für neu gestartete Sitzungen.
export const DEFAULT_SKIP_PERMISSIONS = false;
// Obsidian-Ansicht der Diffs (Abend 17).
export const VIEW_TYPE_DIFF = `${PLUGIN_ID}-diff`;
// Feste Technik-Invariante, keine Einstellung: Auswahländerungen kommen in dichter Folge (jede Cursorbewegung), Claude
// bekommt nur den Stand nach dem letzten Ereignis.
export const IDE_SELECTION_DEBOUNCE_MS = 250;
// Feste Technik-Invariante: So lange wartet ein Claude-Start auf den Server der Brücke (Plugin-Start); danach startet die
// Sitzung ohne die Variablen, statt zu hängen.
export const IDE_ENV_WAIT_MS = 3000;

// Research-Karte (Abend 14). Vorgaben der Einstellungen im Abschnitt „Research“; gelesen wird store.settings().
// Eine Suche je Zeile: `<anfrage> | stars|updated | anzahl`.
export const DEFAULT_RESEARCH_SEARCHES = [
  "claude-code stars:>8 | updated | 8",
  "claude skill OR claude subagent stars:>5 | stars | 8",
  "claude-code OR claude-agent stars:>30 | stars | 8",
].join("\n");
// So lange gilt der Stand einer Suche, bevor die Karte GitHub erneut fragt.
export const DEFAULT_RESEARCH_MAX_AGE_MIN = 120;
// Feste Technik-Invarianten, keine Einstellungen: Der Zwischenspeicher liegt neben usage.json und tokens-today.json.
// RESEARCH_TICK_MS ist nur der Prüftakt (fällig wird nach researchMaxAgeMin), und die GitHub-Suche ohne Token erlaubt
// nur wenige Anfragen je Minute, ein hängender Abruf darf den Lauf aber nicht sperren.
export const RESEARCH_CACHE_FILE = "~/.claude/cockpit/research.json";
export const RESEARCH_TICK_MS = 30 * 60 * 1000;
export const RESEARCH_TIMEOUT_MS = 15000;

// Cockpit füllen (Abend 18). Vorgaben der Einstellungen im Abschnitt „Dashboard“ (Schwellen, Pfade) und „Terminal“ (Effort).
// Kontext-Schwellen: dieselben Werte wie CTX_WARN und CTX_HANDOFF im Statuszeilen-Skript, aus einer Quelle (thresholds.json).
export const DEFAULT_CONTEXT_WARN = 150000;
export const DEFAULT_CONTEXT_HANDOFF = 175000;
// Output-Tokens je Tag: Median und p90 aus „Output-Kennzahlen.md“ (gemessen am 03.10.2026).
export const DEFAULT_TOKENS_DAY_MEDIAN = 340000;
export const DEFAULT_TOKENS_DAY_P90 = 870000;
export const DEFAULT_FOCUS_HEADING = "Heute dran";
// Leer = nicht eingerichtet (Abend 21): inboxDir, indexFile, dailyDir.
export const DEFAULT_INBOX_DIR = "";
// Handoffs (Abend 19h): Leer = nicht eingerichtet. hubsDir im Vault, handoffsDir je Projektordner.
export const DEFAULT_HUBS_DIR = "";
export const DEFAULT_HANDOFFS_DIR = "";
export const DEFAULT_HUB_SUFFIX = " - PMO HUB.md";
export const DEFAULT_HANDOFF_PROMPT = "Handoff: {datei}\nNächster Auftrag: {auftrag}";
// Nach so vielen ms ohne laufende Sitzung bleibt der Handoff offen.
export const HANDOFF_START_TIMEOUT_MS = 60_000;
export const DEFAULT_INDEX_FILE = "";
export const DEFAULT_LINT_AFTER_DAYS = 7;
export const DEFAULT_DAILY_DIR = "";
// Effort der nächsten Cockpit-Sitzung: aus = kein Flag (es gilt settings.json), sonst `--effort <stufe>`.
export const EFFORT_STEPS = ["aus", "low", "medium", "high", "xhigh", "max"] as const;
export const DEFAULT_NEXT_EFFORT = "aus";
// Radare (Abend 21): Liste `radars` in den Einstellungen, Vorgabe leer; so viele sind höchstens sichtbar (Platz im Bild).
export const RADAR_SLOTS = 2;
// Lint-Taste im Zoom der Vault-Lage: gesendeter Text, leer = Taste aus.
export const DEFAULT_LINT_COMMAND = "";
// Feste Technik-Invarianten, keine Einstellungen: Der Pfad der Schwellendatei, die das Statuszeilen-Skript liest, und die
// Zeilenzahl des Sitzungsradars (Platz im HUD-Rahmen), die Länge der Namen darin.
export const THRESHOLDS_FILE = "~/.claude/cockpit/thresholds.json";
// Ordner der Sitzungsdateien, die das Statuszeilen-Skript je Claude-Sitzung schreibt (<COCKPIT_DIR>/sessions); beide Seiten nennen denselben Pfad.
export const SESSION_FILES_DIR = "~/.claude/cockpit/sessions";
export const RADAR_MAX_ROWS = 5;
export const RADAR_NAME_MAX = 18;
