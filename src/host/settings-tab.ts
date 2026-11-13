import { type App, Notice, type Plugin, PluginSettingTab, type Setting, type SettingDefinitionItem, type SettingGroupItem } from "obsidian";
import { homedir } from "os";
import { parseSearches } from "../core/research";
import { EFFORT_STEPS } from "../core/constants";
import { DEFAULT_SETTINGS, effectiveSoundFile, invalidMessage, parseNumberInput, type CockpitSettings } from "../core/settings";
import type { SessionStore } from "../core/session-store";
import { TEST_TEXT } from "../core/telegram";
import { addRadar, canAddRadar, removeRadar, renameRadar, setRadarFile, RADAR_FULL_HINT, RADAR_VISIBLE_HINT } from "../core/radar-list";
import { sendTelegram } from "./telegram-send";
import { downloadDoneText, nativeDownloadHint, nativeStatusText } from "../core/native-verify";
import { downloadNative, nativeInstalled } from "./native-download";
import { hostTarget } from "./host-platform";
import { modKeyName } from "../core/keymap";
import type { Platform } from "../core/platform-path";
import { pluginDirOf, realDownloadDeps } from "./native-download-fetch";
import type { NativeLoader } from "./native-loader";

/** Das Plugin, wie die Seite es braucht (Abend 40): dazu der Lader von node-pty, denn die Meldung nach dem Download hängt davon ab, ob er schon geladen ist. */
type SettingsPlugin = Plugin & { nativeLoader: Pick<NativeLoader, "isLoaded"> };

type BoolKey = { [K in keyof CockpitSettings]: CockpitSettings[K] extends boolean ? K : never }[keyof CockpitSettings];
type TextKey = { [K in keyof CockpitSettings]: CockpitSettings[K] extends string ? K : never }[keyof CockpitSettings];
type ChoiceKey = "dashboardLayout" | "nextEffort" | "cockpitCrop" | "newSessionOrder";
/** Farbfelder des Markdown-Modus: Schlüssel, Titel und Platzhalter (die dunkle Vorgabe aus dem CSS). */
const MD_COLOR_FIELDS: ReadonlyArray<readonly [TextKey, string, string]> = [
  ["fileViewerMdText", "Datei-Viewer: Farbe Fließtext", "#8fd18f"],
  ["fileViewerMdCode", "Datei-Viewer: Farbe Code", "#f0a35e"],
  ["fileViewerMdCommand", "Datei-Viewer: Farbe Befehle", "#ff6b6b"],
  ["fileViewerMdHeading", "Datei-Viewer: Farbe Überschriften", "#ffffff"],
  ["fileViewerMdLink", "Datei-Viewer: Farbe Links", "#6cb6ff"],
  ["fileViewerMdMarker", "Datei-Viewer: Farbe Marker", "#9a9a9a"],
  ["fileViewerMdFrontmatter", "Datei-Viewer: Farbe Frontmatter", "#9a9a9a"],
];
const MD_COLOR_DESC = "Leer: Vorgabe des Themes. Sonst Farbe wie #ff6b6b, gilt in hellem und dunklem Theme. Wirkt beim nächsten Öffnen.";

type NumKey = { [K in keyof CockpitSettings]: CockpitSettings[K] extends number ? K : never }[keyof CockpitSettings];

// Einstellungsseite (seit Abend 34 deklarativ über getSettingDefinitions): Werte kommen aus store.settings(), geschrieben wird nur über
// store.updateSetting. Zwei Regeln, die Obsidians Aufbau (1.14.4, app.js) vorgibt:
// - getSettingDefinitions() läuft schon bei addSettingTab() und bei jedem update(), für den Suchindex und den Aufbau. Es darf nur lesen, was
//   früh feststeht (Zahl der Radare); Plugin-Ordner und Installationsstand erst in render.
// - Obsidian zeichnet eine Zeile bei update() im selben Setting neu und leert dabei nur die Bedienspalte. Alles, was render sonst am Setting
//   oder daneben hinterlässt (gesperrt, roter Grund, Fehlerliste), setzt render selbst zurück oder gibt eine Aufräumfunktion zurück.
export class CockpitSettingTab extends PluginSettingTab {
  private readonly store: SessionStore;
  private readonly plugin: SettingsPlugin;
  private readonly platform: Platform;
  private nativeBusy = false;

  /** platform: Plattform dieses Rechners (Abend 42); sie bestimmt die Taste in den Texten (Cmd oder Ctrl). */
  constructor(app: App, plugin: SettingsPlugin, store: SessionStore, platform: Platform) {
    super(app, plugin);
    this.plugin = plugin;
    this.store = store;
    this.platform = platform;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    // Cmd auf dem Mac, Ctrl unter Windows: Datei-Links (Klick, Speichern im Fenster) und Kopieren nach Markieren mit Shift.
    const mod = modKeyName(this.platform);
    const win = this.platform === "win32";
    return [
      this.group("Sitzungen", [
        this.textField("projectsRoot", "Projektordner", "Unterordner erscheinen in „Neue Sitzung“. ~ steht für dein Home. Leer = aus."),
        this.choiceField(
          "newSessionOrder", "Reihenfolge in „Neue Sitzung“",
          "Zuletzt benutzt: Projektordner mit der jüngsten Claude-Unterhaltung zuerst, nie benutzte alphabetisch darunter. Alphabetisch: wie bisher. „Weiter“, Vault und Home bleiben oben.",
          { recent: "Zuletzt benutzt", alpha: "Alphabetisch" },
        ),
        this.textField("hiddenProjectDirs", "Ausgeblendete Ordner", "Diese Unterordner des Projektordners erscheinen nicht in „Neue Sitzung“. Mehrere mit Komma trennen. Leer = alle zeigen."),
        ...(this.platform === "win32"
          ? [this.textField("windowsShell", "Shell unter Windows", "Leer = automatisch: PowerShell 7 (pwsh.exe), sonst Windows PowerShell.")]
          : []),
        this.numberField("maxSessions", "Höchstzahl laufender Sitzungen", "Ab dieser Zahl startet keine weitere Sitzung."),
        this.toggleField(
          "reopenAfterDisable", "Tabs nach dem Abschalten wieder öffnen",
          "An: Wer Glasscockpit unter Community-Plugins aus- und wieder einschaltet, bekommt die vorher offenen Sitzungen als Tabs zurück, mit ihrer Unterhaltung, und die Cockpit-Ansicht an ihrem Platz (Hauptbereich oder Seitenleiste). Aus: Sie bleiben zu, wie bei Obsidian üblich.",
        ),
      ]),

      this.nativeGroup(),

      this.group("Terminal", [
        this.toggleField(
          "resumeConversations", "Unterhaltung fortsetzen",
          "An: Nach dem Neuladen und bei „Neu starten“ setzt Claude die Unterhaltung fort. Aus: Es beginnt eine neue Unterhaltung, die alte bleibt auf der Platte erhalten.",
        ),
        this.toggleField(
          "fixedPrompt", "Eingabezeile fest (Vollbild)",
          `An: Claude läuft im Vollbild-Modus, die Eingabezeile bleibt unten stehen und das Mausrad scrollt den Verlauf in Claude. Ziehen markiert in Claude und kopiert beim Loslassen, Shift+Ziehen markiert im Terminal (dann ${mod}+C). Suchen im Verlauf mit Ctrl+O und /. Der Scrollback des Terminals bleibt leer. Aus: klassisch, der Verlauf liegt im Scrollback. Wirkt für neu gestartete Sitzungen.`,
        ),
        this.toggleField(
          "smoothScroll", "Weich scrollen",
          "An: Im Vollbild (Eingabezeile fest) nimmt das Cockpit Trackpad und Mausrad selbst an. Der Verlauf folgt dem Finger Zeile für Zeile, eine einzelne Raststufe bewegt eine Zeile, schnelles Scrollen wird gebremst. Claudes eigene Beschleunigung ist in diesen Sitzungen aus. Einschalten wirkt für neu gestartete Sitzungen. Ausschalten gibt das Scrollen sofort an das Terminal zurück, Claudes eigene Beschleunigung kommt erst nach einem Neustart der Sitzung wieder. Aus: wie bisher.",
        ),
        this.numberField(
          "scrollSpeed", "Scrolltempo",
          "Zeilen je Zellhöhe Fingerweg (0.1 bis 5). 2 scrollt doppelt so weit. Wirkt sofort.",
          "0.1",
        ),
        this.numberField(
          "scrollMaxPerFrame", "Höchsttempo je Bild",
          "Höchstens so viele Zeilen je Bildwechsel (1 bis 20); was ein schneller Wisch darüber hinaus bringt, verfällt. Wirkt sofort.",
        ),
        this.toggleField(
          "skipPermissions", "Rechteabfragen überspringen",
          "Achtung: An, und Claude führt Befehle ohne Rückfrage aus (Start mit --dangerously-skip-permissions). Aus: Claude fragt vor Änderungen und Befehlen nach. Gilt für neue Sitzungen; laufende Sitzungen bleiben unverändert.",
        ),
        this.toggleField(
          "claudeExclusion", "Ausgeschlossene Dateien für Claude sperren",
          "An: Was in Obsidian unter „Dateien und Links → Ausgeschlossene Dateien“ steht, kann Claude in Sitzungen aus Glasscockpit weder lesen noch bearbeiten, auch nicht per cat, egal in welchem Ordner die Sitzung läuft. Ohne Sandbox lesen Shell-Befehle wie grep -r über einen ganzen Ordner trotzdem mit. Nicht gesperrt sind Shell-Tabs und Claude außerhalb von Glasscockpit. Gilt ab dem nächsten Sitzungsstart; beim Start zeigt eine graue Zeile, was gesperrt ist.",
          // Neu zeichnen: Der Schalter „Auch Shell-Befehle sperren (Sandbox)“ hängt an diesem.
          () => { this.update(); },
        ),
        this.toggleField(
          "claudeExclusionSandbox", "Auch Shell-Befehle sperren (Sandbox)",
          "An: Claude-Sitzungen laufen in Claudes Sandbox, dann scheitern auch grep -r und Skripte an ausgeschlossenen Dateien. Achtung: In der Sandbox schreibt Claude nur im Arbeitsordner und im Temp-Ordner, Netzzugriffe brauchen eine Freigabe, gh oder git push können haken. Wirkt nur, wenn Einträge gesperrt werden. Braucht die Sperre darüber: Ist sie aus, ist dieser Schalter aus. Gilt ab dem nächsten Sitzungsstart."
            + (this.platform === "win32" ? " Unter Windows nicht verfügbar: Claude Code hat dort keine Sandbox." : ""),
          undefined,
          // Unter Windows gesperrt, der gespeicherte Wert bleibt (ein Vault kann zwischen Mac und Windows wandern).
          () => this.platform === "win32" || !this.store.settings().claudeExclusion,
        ),
        this.toggleField(
          "ideBridge", "IDE-Brücke für Claude-Sitzungen",
          "An: Claude-Sitzungen sehen die Auswahl und die offene Notiz in Obsidian und können Notizen öffnen. Aus: kein Server, kein Lockfile, keine Diffs. Wirkt für neu gestartete Sitzungen.",
          // Neu zeichnen: Der Schalter „Diffs in Obsidian zeigen“ hängt an diesem.
          () => { this.update(); },
        ),
        this.toggleField(
          "ideDiff", "Diffs in Obsidian zeigen",
          "An: Änderungen von Claude öffnen als farbiger Diff in einem Tab mit Annehmen und Ablehnen; Claude wartet dort auf deine Entscheidung. Braucht die IDE-Brücke: Ist sie aus, ist dieser Schalter aus und gesperrt. Gilt sofort für neue Diffs; Claude erfährt davon erst in einer neu gestarteten Sitzung. Beim Ausschalten werden offene Diffs abgelehnt. Wirkt nur ohne Bypass: Cockpit-Sitzungen starten mit Rechtefreigabe, dann fragt Claude nie und zeigt auch keinen Diff. Für Diffs in der Sitzung mit Shift+Tab den normalen Modus wählen. Aus: Die Abfrage bleibt im Terminal.",
          undefined,
          () => !this.store.settings().ideBridge,
        ),
        this.choiceField(
          "nextEffort", "Effort für nächste Sitzung",
          "aus: kein Flag, es gilt settings.json. Jede andere Stufe gibt die nächste vom Cockpit gestartete Claude-Sitzung als --effort <stufe> mit. Laufende Sitzungen bleiben unverändert. Auch in der Effort-Liste im Cockpit (der Bildschirm links) und per Command „Effort für nächste Sitzung“ einstellbar.",
          Object.fromEntries(EFFORT_STEPS.map((step) => [step, step])) as Record<CockpitSettings["nextEffort"], string>,
        ),
        this.numberField("fontSize", "Schriftgröße", "Schriftgröße im Terminal in Pixeln (8 bis 32). Wirkt sofort auf offene Terminals."),
        this.numberField("scrollback", "Scrollback (Zeilen)", "Wie viele Zeilen das Terminal nach oben aufbewahrt (500 bis 100000). Wirkt sofort auf offene Terminals."),
        this.numberField(
          "minimumContrast", "Mindestkontrast im Terminal",
          "Hebt Text, der zu blass auf dem Hintergrund steht, auf dieses Kontrastverhältnis an (1 bis 21, 1 = aus). Nötig im hellen Theme, weil Claude Code manche Texte fest weiß schickt. Wirkt sofort auf offene Terminals.",
          "0.5",
        ),
        this.toggleField(
          "tabShadow", "Schatten am aktiven Tab (helles Theme)",
          "Im hellen Theme heben sich die Tabs kaum ab. Ein weicher Schatten markiert den aktiven Tab, beim Wechsel blendet er über. Wirkt sofort.",
        ),
        this.textField(
          "handoffPrefix", "Präfix des Handoff-Blocks",
          "Ein Codeblock, dessen erste nichtleere Zeile so beginnt, steht oben im Terminal als fester Knopf „Handoff kopieren“, auch nach /clear, bis ein neuerer Block kommt. Groß- und Kleinschreibung zählt. Leer: kein Knopf (sofort). Ein neues Präfix gilt ab der nächsten Änderung des Transkripts.",
        ),
        this.toggleField(
          "fileLinks", `Pfade per ${mod}+Klick öffnen`,
          `An: Dateipfade im Terminal (absolut, mit ~ oder relativ zum Startordner der Sitzung, auch mit :zeile) öffnen per ${mod}+Klick. Dateien im Vault als Tab, alle anderen in einem Fenster zum Lesen und Ändern (${mod}+S speichert, Esc schließt). Ein einfacher Klick markiert weiter Text. Wirkt sofort.`,
        ),
        this.toggleField(
          "fileLinksClaudeDirs", "Relative Pfade auch in Claudes Ordnern suchen",
          "Liegt ein relativer Pfad nicht im Startordner, sucht das Cockpit ihn in den Ordnern, in denen Claude in dieser Sitzung gearbeitet hat (cd, gelesene und bearbeitete Dateien). Haben mehrere die Datei, gilt der, in dem Claude zuletzt gearbeitet hat.",
        ),
        this.toggleField(
          "fileLinksSpaces", "Pfade mit Leerzeichen erkennen",
          "Ein Pfad mit Leerzeichen im Namen wird ganz zum Link, wenn es die Datei gibt: in Anführungszeichen immer, sonst über einzelne Leerzeichen verlängert (höchstens 16 Wörter; relative Pfade nur gegen den Startordner der Sitzung, nicht gegen Claudes Ordner). Aus: Ein Pfad endet am ersten Leerzeichen. Wirkt sofort.",
        ),
        this.toggleField(
          "clearLink", "/clear per Klick einfügen",
          "Ein Klick auf /clear im Terminal einer Claude-Sitzung schreibt es in die Eingabezeile. Enter drückst du selbst.",
        ),
        this.toggleField(
          "checkBeforeClear", "Vor /clear prüfen",
          "Klick auf /clear fragt nach, wenn Handoff, Daily Note oder Git der Sitzung noch offen sind (Lampe Übergabe rot).",
        ),
        this.toggleField(
          "webLinks", `Weblinks per ${mod}+Klick öffnen`,
          `An: Adressen mit http:// oder https:// im Terminal öffnen per ${mod}+Klick im Standardbrowser. Ein einfacher Klick markiert weiter Text. Wirkt sofort.`,
        ),
        this.numberField(
          "fileViewerMaxMb", "Datei-Viewer: Höchstgröße (MB)",
          "Größere Dateien zeigt das Fenster nicht, nur einen Hinweis (1 bis 50).",
        ),
        this.toggleField(
          "fileViewerImages", "Datei-Viewer: Bilder anzeigen",
          "Bilder (png, jpg, gif, webp, svg, bmp, ico) zeigt das Fenster als Bild, eingepasst und zoombar. Aus: Hinweis und Knopf ‚Mit Standardprogramm öffnen‘. Wirkt beim nächsten Öffnen eines Fensters.",
        ),
        this.numberField(
          "fileViewerImageMaxMb", "Datei-Viewer: Höchstgröße Bilder (MB)",
          "Größere Bilder zeigt das Fenster nicht, nur einen Hinweis mit Knopf (1 bis 200).",
        ),
        this.numberField(
          "fileViewerWidthPct", "Datei-Viewer: Startbreite (%)",
          "Anteil an der Breite des Obsidian-Fensters beim Öffnen (40 bis 100). Wirkt beim nächsten Öffnen.",
        ),
        this.numberField(
          "fileViewerHeightPct", "Datei-Viewer: Starthöhe (%)",
          "Anteil an der Höhe des Obsidian-Fensters beim Öffnen (40 bis 100). Wirkt beim nächsten Öffnen.",
        ),
        this.numberField(
          "fileViewerFontSize", "Datei-Viewer: Schriftgröße (px)",
          `Startschrift im Fenster (8 bis 32). ${mod}+Plus, ${mod}+Minus, ${mod}+0 und ${mod}+Mausrad zoomen im offenen Fenster. Wirkt beim nächsten Öffnen.`,
        ),
        this.toggleField(
          "fileViewerAutocomplete", "Datei-Viewer: Vorschläge beim Tippen",
          "An: Das Fenster schlägt beim Tippen Wörter aus der Datei und Schlüsselwörter der Sprache vor (Enter übernimmt, Esc schließt die Liste). Aus: Liste nur mit Ctrl+Leertaste. Wirkt beim nächsten Öffnen eines Fensters.",
        ),
        this.toggleField(
          "fileViewerMarkdown", "Datei-Viewer: Markdown färben",
          "Färbt .md-Dateien: Fließtext, Code, Befehle, Überschriften, Links, Marker und Frontmatter. Der Text bleibt Rohtext. Wirkt beim nächsten Öffnen eines Fensters.",
        ),
        ...MD_COLOR_FIELDS.map(([key, name, placeholder]) =>
          this.textField(key, name, MD_COLOR_DESC, placeholder)),
        this.textField(
          "fileViewerMdCommands", "Datei-Viewer: Befehle in Backticks",
          "Beginnt Text in Backticks mit einem dieser Wörter (oder mit $ oder ./), färbt das Fenster ihn als Befehl, sonst als Code. Wörter durch Leerzeichen getrennt. Wirkt beim nächsten Öffnen.",
        ),
      ]),

      this.group("Benachrichtigung", [
        this.toggleField("notifyOnDone", "Wenn eine Sitzung fertig ist"),
        this.toggleField("notifyOnQuestion", "Wenn eine Sitzung eine Frage hat"),
        this.toggleField(
          "quietWhileAgents", "Zwischenstände bei laufenden Agents nicht melden",
          "Solange Agents, Workflows oder Hintergrund-Befehle laufen, meldet ein Antwortende nichts. Fragen melden sich immer.",
        ),
        this.numberField(
          "quietMaxAgeMin", "Höchstalter einer Hintergrundaufgabe (Minuten)",
          "Ein Start ohne Fertig-Meldung zählt nach dieser Zeit nicht mehr als laufend (1 bis 1440).",
        ),
        this.toggleField("showOpenTasks", "Laufende Hintergrundaufgaben im Tab zeigen (⏳)"),
        this.toggleField("markTab", "Markierung am Tab"),
        this.toggleField("alertSound", "Ton"),
        this.toggleField("alertBanner", win ? "Windows-Benachrichtigung" : "macOS-Banner"),
        this.textField(
          "soundFile", "Klangdatei",
          win ? "Pfad zur Klangdatei (WAV oder MP3), abgespielt in Obsidian. Leer oder Mac-Pfad = Windows-Ton." : "Pfad zur Klangdatei, abgespielt mit afplay.",
          // Platzhalter nur unter Windows: der Ton, der bei leerem Feld läuft. SystemRoot liest der Host wie in terminal-view.
          win ? effectiveSoundFile(this.platform, "", process.env.SystemRoot ?? "") : undefined,
        ),
        this.numberField("alertGapMs", "Mindestabstand zwischen zwei Alarmen (ms)", "Höchstens ein Alarm je Sitzung in diesem Abstand."),
        this.numberField("bannerSeconds", "Banner ausblenden nach (Sekunden)",
          win
            ? "So lange bleibt die Benachrichtigung stehen (1 bis 60), dann verschwindet sie von selbst. Je Sitzung gibt es höchstens ein Banner: Ein neues ersetzt das alte."
            : "So lange bleibt das macOS-Banner stehen (1 bis 60), dann verschwindet es von selbst und steht auch nicht in der Mitteilungszentrale. Je Sitzung gibt es höchstens ein Banner: Ein neues ersetzt das alte.",
        ),
      ]),

      this.group("Telegram", [
        this.toggleField("telegramOnDone", "Telegram, wenn eine Sitzung fertig ist"),
        this.toggleField("telegramOnQuestion", "Telegram, wenn eine Sitzung eine Frage hat"),
        this.numberField("telegramIdleMin", "Telegram erst nach Leerlauf (Minuten)", "Nachricht nur, wenn der Mac so lange ohne Eingabe war. 0 = immer. Unabhängig davon, ob das Cockpit sichtbar ist."),
        this.textField("telegramEnvFile", ".env-Datei mit dem Bot-Token", "Datei mit der Zeile TELEGRAM_BOT_TOKEN=…; das Token selbst wird nie im Cockpit gespeichert. ~ steht für dein Home."),
        this.textField("telegramChatId", "Chat-ID", "Leer = erste Chat-ID aus access.json neben der .env-Datei. Sonst nur Ziffern, bei Gruppen mit - vorn."),
        this.testMessageRow(),
      ]),

      this.group("Dashboard", [
        this.choiceField(
          "dashboardLayout", "Dashboard-Ansicht",
          "Cockpit: Bild mit Instrumenten, ein Klick öffnet die volle Karte. Liste: die Karten untereinander. Wirkt sofort auf offene Dashboards.",
          { cockpit: "Cockpit", list: "Liste" },
        ),
        this.choiceField(
          "cockpitCrop", "Cockpit-Ausschnitt",
          "zugeschnitten: Das Bild ohne den äußeren Rand, alles erscheint größer. voll: das ganze Bild. Wirkt sofort auf offene Dashboards.",
          { crop: "zugeschnitten", full: "voll" },
        ),
        this.textField("briefingsDir", "Briefing-Ordner", "Ordner im Vault mit den Tagesdateien JJJJ-MM-TT.md, ohne führenden Schrägstrich. Leer = aus (nicht eingerichtet)."),
        this.numberField("pullIntervalMin", "Pull-Abstand (Minuten)", "git pull im Briefing-Ordner, solange ein Dashboard offen ist. 0 = kein automatischer Pull."),
        this.textField("continuePrompt", "Text für „Hiermit weiterarbeiten“", "Wird an die aktive Claude-Sitzung gesendet. {ordner} wird durch den Briefing-Ordner ersetzt."),
        this.textField("tasksFile", "Aufgabenliste", "Markdown-Datei im Vault mit den Aufgaben (- [ ] ...), endet auf .md. Wird nie automatisch angelegt."),
        // Karte „Heute“ (Abend 44).
        this.textField("tasksAddHeading", "Überschrift für neue Aufgaben", "Neue Aufgaben aus der Karte „Heute“ landen als letzter Punkt unter dieser Überschrift der Aufgabenliste. Fehlt sie oder ist das Feld leer: am Dateiende."),
        this.toggleField("todayBriefing", "Briefing-Punkte in „Heute“", "An: Die Punkte unter der Überschrift der Tagespunkte und alle Checkboxen im heutigen Briefing stehen in der Karte „Heute“ und lassen sich dort und im Briefing abhaken. Das Briefing selbst wird nie geändert."),
        this.toggleField(
          "remindersEnabled", "Erinnerungen in „Heute“ (nur macOS)",
          "An: Offene Erinnerungen der App „Erinnerungen“, fällig heute oder früher, stehen in der Karte „Heute“; Abhaken setzt sie in der App auf erledigt. Liest per AppleScript, macOS fragt beim ersten Mal nach der Freigabe."
            + (win ? " Unter Windows nicht verfügbar." : ""),
          undefined,
          // Unter Windows gesperrt, der gespeicherte Wert bleibt (ein Vault kann zwischen Mac und Windows wandern).
          win ? () => true : undefined,
        ),
        this.textField("remindersLists", "Listen der Erinnerungen", "Namen der Listen, mit Komma getrennt. Leer = alle."),
        this.toggleField("remindersOverdue", "Überfällige Erinnerungen zeigen", "Aus: nur Erinnerungen, die heute fällig sind."),
        this.numberField("remindersIntervalMin", "Erinnerungen-Abstand (Minuten)", "So oft liest die Karte die Erinnerungen, solange ein Dashboard offen ist (0 bis 1440). 0 = nur beim Öffnen und per Knopf."),
        this.numberField("skillButtons", "Zahl der Skill-Knöpfe", "So viele Skills zeigt die Karte „Skills“ als Knöpfe (1 bis 30), zuletzt benutzte zuerst."),
        this.numberField("usagePollSec", "Usage-Abstand (Sekunden)", "So oft liest die Karte „Usage“ den Schnappschuss der Statuszeile und die heutigen Transkripte (10 bis 3600), auch bei geschlossenem Dashboard." + (win ? " Unter Windows noch ohne Statuszeile, Limits fehlen." : "")),
        this.toggleField("writeTokensFile", "Tokens für die Statuszeile schreiben",
          "Schreibt nach jedem Zählerlauf die heutigen Output-Tokens nach ~/.claude/cockpit/tokens-today.json. Aus: Das Cockpit zählt weiter, die Statuszeile zeigt dann nur noch die letzte Summe mit ihrem Alter."
            + (win ? " Unter Windows nicht verfügbar: Die Statuszeile gibt es dort noch nicht." : ""),
          undefined,
          // Unter Windows gesperrt, der gespeicherte Wert bleibt (ein Vault kann zwischen Mac und Windows wandern).
          win ? () => true : undefined,
        ),
        this.numberField("contextWarn", "Kontext: Warnschwelle (Tokens)", "Ab hier wird das Kontext-Instrument gelb und die Statuszeile gelb (1000 bis 1000000). Muss unter der Handoff-Schwelle liegen; beide gehen über thresholds.json an die Statuszeile."),
        this.numberField("contextHandoff", "Kontext: Handoff-Schwelle (Tokens)", "Ab hier rot mit Handoff-Hinweis (1000 bis 1000000). Muss über der Warnschwelle liegen. Beide zusammen höher stellen: erst diese, dann die Warnschwelle."),
        this.numberField("clearableMinContextPct", "Handoff frühestens ab Kontext (%)", "Erst ab diesem Kontextanteil gilt eine Session als übergabereif (0 bis 100). Geht über thresholds.json an den Stop-Hook aus „npm run deploy:hook“ (README, „Übergabe-Signal“)."),
        this.numberField("clearableMinPrompts", "Handoff frühestens ab Nachrichten", "Erst ab so vielen eigenen Nachrichten in der Session (1 bis 50), damit wirklich etwas passiert ist. Gilt zusammen mit dem Kontextanteil."),
        this.numberField("tokensDayMedian", "Output-Tokens je Tag: Median", "Darunter ist das Tokens-Instrument gelb, ab hier grün (1000 bis 100000000). Muss unter dem p90 liegen."),
        this.numberField("tokensDayP90", "Output-Tokens je Tag: p90", "Hier ist der Ring voll, ab hier läuft der Regenbogen (1000 bis 100000000). Muss über dem Median liegen."),
        this.textField("focusHeading", "Überschrift der Tagespunkte", "Die Punkte unter dieser Überschrift im heutigen Briefing stehen in der Karte „Heute“; die ersten zwei zeigt die Kanzel. Eine Zeile."),
        this.textField("inboxDir", "Inbox-Ordner", "Ordner im Vault, dessen Notizen die Vault-Lage zählt, ohne führenden Schrägstrich. Leer = aus."),
        this.textField("hubsDir", "Projekt-Ordner (Vault)", "Ordner im Vault mit einem Unterordner je Projekt und dessen HUB-Datei. Leer = Handoffs aus."),
        this.textField("handoffsDir", "Handoff-Unterordner", "Name des Handoff-Ordners in jedem Projektordner, z. B. Handoffs. Leer = Handoffs aus."),
        this.textField("hubSuffix", "Endung der HUB-Datei", "Dateiende, an dem die HUB-Datei im Projektordner erkannt wird. Ihr Feld repo: ist der Startordner."),
        this.textField("handoffPrompt", "Startnachricht für „Weiter“", "{datei} wird durch den Handoff-Pfad ersetzt, {auftrag} durch naechster_auftrag."),
        this.textField("indexFile", "Index-Datei", "Datei im Vault mit generated_at im Frontmatter, endet auf .md. Leer = aus."),
        this.numberField("lintAfterDays", "Index gelb ab (Tage)", "Ab so vielen Tagen seit generated_at zeigt die Vault-Lage den Index gelb (1 bis 365)."),
        this.textField("dailyDir", "Ordner der Daily Notes", "Ordner im Vault mit den Tagesnotizen JJJJ-MM-TT.md, ohne führenden Schrägstrich. Leer = aus."),
        this.textField(
          "lintCommand", "Lint-Befehl",
          "Wird mit der Taste „Lint starten“ an die aktive Sitzung geschickt, z. B. /lint. Leer = aus, die Taste verschwindet.",
        ),
      ]),

      this.radarGroup(),

      this.group("Research", [
        this.searchesField(),
        this.numberField("researchMaxAgeMin", "Gültigkeit (Minuten)", "So lange gilt der Stand, bevor die Karte GitHub erneut fragt (10 bis 1440). „Neu laden“ fragt immer."),
      ]),
    ];
  }

  private group(heading: string, items: SettingGroupItem[]): SettingDefinitionItem {
    return { type: "group", heading, items };
  }

  /** Status der node-pty-Binärdateien und der Knopf, der sie vom Release lädt (Abend 26). */
  private nativeGroup(): SettingDefinitionItem {
    const name = "Terminal-Binärdateien (node-pty)";
    return this.group("Binärdateien", [
      {
        name,
        render: (setting) => {
          // Erst hier lesen: getSettingDefinitions() läuft schon bei addSettingTab() für den Suchindex.
          const dir = pluginDirOf(this.app, this.plugin.manifest);
          const { platform: rawPlatform, arch } = hostTarget();
          const target = `${rawPlatform}-${arch}`;
          const platform = this.platform;
          const status = dir === null ? "Der Vault liegt nicht im Dateisystem, die Binärdateien lassen sich nicht ablegen." : nativeStatusText(nativeInstalled(dir, rawPlatform, arch), target);
          setting
            .setName(name)
            .setDesc(`${status} ${nativeDownloadHint(platform, this.plugin.manifest.version)}`);
          setting.addButton((b) =>
            b
              .setButtonText("Binärdateien laden")
              .setDisabled(dir === null || this.nativeBusy)
              .onClick(() => {
                void (async () => {
                  if (dir === null || this.nativeBusy) return;
                  this.nativeBusy = true;
                  b.setDisabled(true);
                  try {
                    const r = await downloadNative(
                      { pluginDir: dir, platform: rawPlatform, arch, version: this.plugin.manifest.version },
                      realDownloadDeps(platform),
                      (schritt) => { setting.setDesc(schritt); },
                    );
                    new Notice(
                      r.ok ? downloadDoneText(r.files, platform, this.plugin.nativeLoader.isLoaded()) : `Binärdateien: ${r.reason}`,
                      r.ok ? 8000 : 15000,
                    );
                  } finally {
                    this.nativeBusy = false;
                    b.setDisabled(false);
                    this.update();
                  }
                })();
              }),
          );
        },
      },
    ]);
  }

  private testMessageRow(): SettingGroupItem {
    const name = "Testnachricht senden";
    const desc = "Sendet sofort, ohne Leerlauf- und Abstandsprüfung.";
    return {
      name,
      desc,
      render: (setting) => {
        setting
          .setName(name)
          .setDesc(desc)
          .addButton((b) =>
            b.setButtonText("Testnachricht senden").onClick(async () => {
              b.setDisabled(true);
              try {
                const r = await sendTelegram(TEST_TEXT, this.store.settings(), homedir(), this.platform);
                new Notice(r.ok ? "Telegram: gesendet" : `Telegram: ${r.reason}`, 8000);
              } finally {
                b.setDisabled(false);
              }
            }),
          );
      },
    };
  }

  /**
   * Radare als Liste: Name, Pfad zur state.json (~ erlaubt), Entfernen; darunter Hinzufügen (bei vollen Plätzen gesperrt).
   * Die Zahl der Zeilen steht beim Aufruf fest. Hinzufügen und Entfernen rufen update(), das diese Methode neu durchläuft.
   */
  private radarGroup(): SettingDefinitionItem {
    const count = this.store.settings().radars.length;
    const rows: SettingGroupItem[] = [];
    for (let i = 0; i < count; i++) rows.push(this.radarRow(i));
    return this.group("Radare", [
      { name: "", render: (hint) => { hint.setDesc(RADAR_VISIBLE_HINT); } },
      ...rows,
      this.radarAddRow(),
    ]);
  }

  private radarRow(i: number): SettingGroupItem {
    return {
      name: `Radar ${i + 1}`,
      render: (row) => {
        const entry = this.store.settings().radars[i] ?? { name: "", stateFile: "" };
        row.setName(`Radar ${i + 1}`);
        this.clearError(row);
        row.addText((t) => {
          t.setPlaceholder(`Name (leer = Radar ${i + 1})`).setValue(entry.name);
          t.inputEl.addEventListener("change", () => this.saveRadars(row, renameRadar(this.store.settings().radars, i, t.getValue())));
        });
        row.addText((t) => {
          t.setPlaceholder("Pfad zur state.json, ~ erlaubt").setValue(entry.stateFile);
          t.inputEl.addEventListener("change", () => this.saveRadars(row, setRadarFile(this.store.settings().radars, i, t.getValue())));
        });
        row.addButton((b) => b.setButtonText("Entfernen").onClick(() => {
          this.saveRadars(row, removeRadar(this.store.settings().radars, i));
          this.update();
        }));
      },
    };
  }

  private radarAddRow(): SettingGroupItem {
    return {
      name: "Radar hinzufügen",
      render: (add) => {
        const full = !canAddRadar(this.store.settings().radars);
        add.setName("Radar hinzufügen");
        this.clearError(add);
        add.setDesc(full ? RADAR_FULL_HINT : "Neuer Eintrag mit leerem Namen und Pfad; leerer Pfad = nicht eingerichtet.");
        add.addButton((b) => b.setButtonText("Radar hinzufügen").setDisabled(full).onClick(() => {
          this.saveRadars(add, addRadar(this.store.settings().radars));
          this.update();
        }));
      },
    };
  }

  private saveRadars(setting: Setting, next: CockpitSettings["radars"]): void {
    const result = this.store.updateSetting("radars", next);
    if (!result.ok) new Notice(`Radare: ${result.reason}`);
    setting.descEl.toggleClass("cockpit-setting-error", !result.ok);
  }

  /** Obsidian zeichnet eine Zeile bei update() im selben Setting neu; der rote Grund der vorigen Eingabe bliebe an der Beschreibung hängen. */
  private clearError(setting: Setting): void {
    setting.descEl.toggleClass("cockpit-setting-error", false);
  }

  /** Mehrzeiliges Feld der Suchen: eine ungültige Zeile blockiert nichts, die gültigen gelten weiter. */
  private searchesField(): SettingGroupItem {
    const desc = "Je Zeile eine GitHub-Suche: <anfrage> | stars|updated | 1–30 (Sortierung und Zahl der Treffer). Beispiel: claude-code stars:>8 | updated | 8";
    return {
      name: "Suchen",
      desc,
      render: (setting) => {
        setting.setName("Suchen").setDesc(desc);
        // Feld unter der Beschreibung in voller Breite: Im schmalen Feld fiel ein fehlender Zeilenumbruch nicht auf.
        setting.settingEl.addClass("cockpit-research-setting");
        // Fehlerliste als Kind der Zeile, nicht dahinter: Nach render setzt Obsidian die Kinder der Gruppe auf genau die Zeilen
        // (setChildrenInPlace) und würfe ein Element daneben sofort wieder raus. Beim Neuzeichnen leert Obsidian nur die Bedienspalte,
        // die Fehlerliste räumt darum die Rückgabe ab.
        const errors = setting.settingEl.createDiv({ cls: "cockpit-setting-error" });
        const showErrors = (text: string) => {
          errors.empty();
          for (const e of parseSearches(text).errors) errors.createDiv({ text: `Zeile ${e.line}: ${e.reason}` });
        };
        setting.addTextArea((t) => {
          const value = this.store.settings().researchSearches;
          t.inputEl.rows = 5;
          t.inputEl.addClass("cockpit-research-searches");
          t.setValue(value);
          showErrors(value);
          // Nur bei change (Verlassen des Feldes), nicht bei jedem Tastendruck.
          t.inputEl.addEventListener("change", () => {
            this.store.updateSetting("researchSearches", t.getValue());
            showErrors(this.store.settings().researchSearches);
          });
        });
        this.addReset(setting, "researchSearches");
        return () => errors.remove();
      },
    };
  }

  /** Knopf „Vorgabe“: setzt das Feld auf den Standardwert zurück und zeichnet die Seite neu. */
  private addReset<K extends keyof CockpitSettings>(setting: Setting, key: K): void {
    setting.addExtraButton((b) =>
      b.setIcon("rotate-ccw").setTooltip("Vorgabe").onClick(() => {
        // Ein Paar (Warn/Handoff, Median/p90) kann die Vorgabe ablehnen: Grund nennen statt still nichts zu tun.
        const result = this.store.updateSetting(key, DEFAULT_SETTINGS[key]);
        if (!result.ok) new Notice(`Vorgabe geht nicht: ${result.reason}`);
        this.update();
      }),
    );
  }

  /** `disabled` wird bei jedem Zeichnen ausgewertet und immer gesetzt, auch als false: Das Setting überlebt das Neuzeichnen. */
  private toggleField(key: BoolKey, name: string, desc?: string, onChanged?: () => void, disabled?: () => boolean): SettingGroupItem {
    return {
      name,
      desc,
      render: (setting) => {
        setting.setName(name);
        if (desc) setting.setDesc(desc);
        setting.addToggle((t) => t.setValue(this.store.settings()[key]).onChange((v) => { this.store.updateSetting(key, v); onChanged?.(); }));
        this.addReset(setting, key);
        if (disabled) setting.setDisabled(disabled());
      },
    };
  }

  private textField(key: TextKey, name: string, desc: string, placeholder?: string): SettingGroupItem {
    return {
      name,
      desc,
      render: (setting) => {
        setting.setName(name).setDesc(desc);
        this.clearError(setting);
        setting.addText((t) => {
          if (placeholder) t.setPlaceholder(placeholder);
          t.setValue(this.store.settings()[key]);
          let invalid = false;
          // Nur bei change (Verlassen des Feldes), nicht bei jedem Tastendruck.
          t.inputEl.addEventListener("change", () => {
            const result = this.store.updateSetting(key, t.getValue());
            invalid = !result.ok;
            this.show(setting, desc, result, this.store.settings()[key]);
          });
          // Ungültige Eingabe bleibt nicht stehen: Das Feld zeigt wieder den Wert, der gilt.
          t.inputEl.addEventListener("blur", () => {
            if (invalid) t.setValue(String(this.store.settings()[key]));
          });
        });
        this.addReset(setting, key);
      },
    };
  }

  /** Auswahl aus festen Werten (Dropdown); der Wert wird sofort gespeichert. */
  private choiceField<K extends ChoiceKey>(key: K, name: string, desc: string, options: Record<CockpitSettings[K], string>): SettingGroupItem {
    return {
      name,
      desc,
      render: (setting) => {
        setting.setName(name).setDesc(desc);
        setting.addDropdown((d) => {
          for (const [v, label] of Object.entries(options)) d.addOption(v, label as string);
          d.setValue(this.store.settings()[key]);
          d.onChange((v) => { this.store.updateSetting(key, v as CockpitSettings[K]); });
        });
        this.addReset(setting, key);
      },
    };
  }

  private numberField(key: NumKey, name: string, desc: string, step?: string): SettingGroupItem {
    return {
      name,
      desc,
      render: (setting) => {
        setting.setName(name).setDesc(desc);
        this.clearError(setting);
        setting.addText((t) => {
          t.inputEl.type = "number";
          if (step) t.inputEl.step = step;
          t.setValue(String(this.store.settings()[key]));
          let invalid = false;
          t.inputEl.addEventListener("change", () => {
            // Leer und Text ergeben NaN (nicht 0) und gehen an die Prüfung, die den Grund nennt.
            const result = this.store.updateSetting(key, parseNumberInput(t.getValue()));
            invalid = !result.ok;
            this.show(setting, desc, result, this.store.settings()[key]);
          });
          t.inputEl.addEventListener("blur", () => {
            if (invalid) t.setValue(String(this.store.settings()[key]));
          });
        });
        this.addReset(setting, key);
      },
    };
  }

  /** Ungültig: roter Grund samt weiter geltendem Wert unter dem Feld; gültig: normale Beschreibung. */
  private show(setting: Setting, desc: string, result: { ok: true } | { ok: false; reason: string }, current: unknown): void {
    setting.descEl.toggleClass("cockpit-setting-error", !result.ok);
    setting.setDesc(result.ok ? desc : invalidMessage(result.reason, current));
  }
}
