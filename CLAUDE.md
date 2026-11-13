# Glasscockpit

Obsidian-Plugin „Glasscockpit“, ein Nachbau, Open Source unter MIT (Veröffentlichung ab Abend 25): Claude-Code-Sitzungen als Terminal-Ansichten in Obsidian. TypeScript, esbuild, Vitest, kein React. Gebaut für macOS arm64 und x64; x64 ist in Obsidian ungetestet (außerhalb: Ladeprobe unter Rosetta).

## Festlegungen (04.10.2026, nicht neu verhandeln)

- Name Glasscockpit (bis Abend 21 „Claude Cockpit“), Plugin-ID `glasscockpit` (vorher `claude-cockpit`; Umbenennung Abend 22).
- View-Typen `glasscockpit-terminal` und `glasscockpit-dashboard`, CSS-Präfix `cockpit-`, eigene Daten in der Plugin-`data.json` (lesen selbst, schreiben per `saveData`).
- Das private Arbeits-Repo (Pfad in `CLAUDE.local.md`) bleibt lokal, ohne Remote, kein Push. Das öffentliche Repo `nyko073006/glasscockpit` (lokal `~/Developer/glasscockpit`, ab Abend 25) entsteht per `npm run export-public` aus diesem Repo und wird nie von Hand bearbeitet. Es ist zuerst privat; öffentlich stellen, Tag und Release nur auf ausdrückliches Wort des Eigentümers.
- Deploy-Ziel (ab Abend 20): kein Pfad im Code. `npm run deploy` liest `COCKPIT_DEPLOY_TARGET` oder `deploy.local.json` (in `.gitignore`, Vorlage `deploy.local.example.json`), Env geht vor Datei; fehlt beides, Exit 1 vor jedem Schreibzugriff. Logik in `src/core/deploy-target.ts`, Node ab 22.18. Volltext: docs/module.md#ergänzungen-aus-claudemd
- Rechteabfragen überspringen (ab Abend 20, vorher „Rechte immer an“): Einstellung `skipPermissions` (Abschnitt „Terminal“, Name „Rechteabfragen überspringen“, Vorgabe aus). An startet Claude mit `--dangerously-skip-permissions`. Der Wert wird bei jedem Start gelesen und wirkt nur auf neue Sitzungen. Kein Dialog, kein Pro-Tab-Flag, keine Warnung. Die Konstante `SKIP_PERMISSIONS` gibt es nicht mehr, nur `DEFAULT_SKIP_PERMISSIONS` in `src/core/constants.ts`.
- node-pty nur aus dem offiziellen Microsoft-Paket `node-pty`, exakt Version 1.1.0 (`npm install --save-exact`).
- Ausschluss für Claude (ab Abend 33): Einstellungen `claudeExclusion` und `claudeExclusionSandbox` (hängt an der ersten). Liste aus `<configDir>/app.json` (`userIgnoreFilters`), daraus `Read(//…)`/`Edit(//…)` per `--settings` (Mac mit den Hooks, Windows als Settings-Datei je Sitzung, dort nur Laufwerkspfade in POSIX-Form, nie UNC). Sandbox mit `allowUnsandboxedCommands: false`, unter Windows nie gesetzt (Schalter dort gesperrt). Claudes Nutzerdateien bleiben unverändert. Logik in `src/core/exclusion.ts`, Echttest nur mit `GLASSCOCKPIT_CLAUDE_PROBE=1`. Volltext: docs/module.md#ergänzungen-aus-claudemd

## Befehle

- `npm run build`: `tsc --noEmit`, dann esbuild nach `build/main.js` und `build/styles.css`.
- `npm test`: Vitest einmal durchlaufen lassen.
- `npm run deploy`: build, dann `scripts/deploy.mjs`. Obsidian liest `main.js` nur beim Laden, danach neu laden. Deploy kopiert node-pty aus `node_modules/node-pty` nach `native/darwin-arm64/` und `native/darwin-x64/` im Ziel (nur diese zwei: Deploy bleibt beim Mac, die Windows-Ziele gehören dem Release; Paketstruktur, alte Ordner werden vorher gelöscht, nie überschrieben), setzt `chmod 755` und `xattr -cr`. Die Kopie steht in `scripts/lib/native-copy.ts` und wird vom Release mitgenutzt.
- `npm run release`: build, `lint:portal`, `check:public`, dann `scripts/lib/release.ts` packt `dist/<id>-<version>.zip` (`<id>/` mit `main.js`, `manifest.json`, `styles.css`, `LICENSE`, `THIRD-PARTY-NOTICES.md`, `native/` aller vier Ziele `darwin-arm64`, `darwin-x64`, `win32-arm64`, `win32-x64`; `spawn-helper` und `pty.node` mit 0755, die Windows-Dateien ohne `chmod`). Der Loader wählt nach `process.platform` und `process.arch` (`nativePaths` wirft für alles außer macOS und Windows, jeweils arm64/x64). Kein Tag, kein GitHub-Release.
- `npm run native-checksums`: schreibt `src/core/native-checksums.ts` neu (Pfad -> SHA256 jeder Datei in `native/<ziel>/` aller vier Ziele, erzeugt über `copyNodePty` aus `node_modules/node-pty`, `scripts/lib/native-checksums.ts`). Nach jeder Änderung an node-pty oder `copyNodePty` ausführen; der Wächter `test/native-checksums.test.ts` wird sonst rot (vergleicht frisch erzeugt gegen die Datei, byte-genau).
- Release-Assets (ab Abend 26, Tag = Manifest-Version ohne `v`): `npm run release` legt zusätzlich in `dist/` ab: `glasscockpit-native-darwin-arm64.zip`, `-darwin-x64.zip`, `-win32-arm64.zip` und `-win32-x64.zip` (Abend 40: vier ZIPs; Inhalt von `native/<ziel>/` direkt an der ZIP-Wurzel, auf macOS `pty.node` und `spawn-helper` 0755) sowie `main.js`, `manifest.json`, `styles.css` einzeln (Store, BRAT). Vor dem Packen wird das Paket gegen `native-checksums.ts` geprüft, sonst Abbruch ohne `dist/`. Das Komplett-ZIP bleibt.
- Portal-Lint (ab Abend 34): `npm run lint:portal` vor jedem Release (`npm run release` ruft ihn nach dem Build selbst auf); Errors sperren, Warnungen werden gezählt, `obsidianmd/ui/sentence-case` zählt nicht (das Portal zeigt es nicht). Die Wegwerf-Kopie unter `~/.cache/glasscockpit-portal-lint` installiert neu, wenn sich `package-lock.json` oder die Linter-Versionen (`LINT_PACKAGES`) ändern.
- Attestierung (ab Abend 34): Der Workflow `.github/workflows/attest-release.yml` attestiert die Dateien jedes veröffentlichten Releases als Herkunftsnachweis; gebaut wird weiter lokal. Seine Action ist per Commit gepinnt (v4.2.2), nie per Tag.
- Binär-Download (ab Abend 26, `src/host/native-download.ts`): Knopf „Binärdateien laden“ lädt per `requestUrl` von fester GitHub-Release-Adresse in einen `mkdtemp`-Ordner im Plugin-Ordner, prüft ZIP-Pfade, entpackt mit Systemwerkzeug und verifiziert per `verifyNative` (`src/core/native-verify.ts`: Dateimenge exakt, keine Symlinks, jede Summe). Erst bei ok: Rechte setzen, dann Tausch per `rename`; jeder Fehler lässt `native/` unverändert. Adresse und Summen sind Sicherheits-Invarianten, keine Einstellung. Volltext: docs/module.md#ergänzungen-aus-claudemd
- `npm run export-public -- <ziel> [--message "Text"]`: kopiert die getrackten Dateien ohne `handoffs/`, `CLAUDE.local.md`, `.publicignore` und dessen Einträge in ein bestehendes git-Repo, räumt Altes im Ziel weg, prüft dort `check:public` und committet. Kein Push. `scripts/lib/export-public.ts`.
- node-pty lädt `src/host/native-loader.ts` nur aus `native/` im Plugin-Ordner, erst das Binary direkt (macOS `pty.node`, Windows `conpty.node`), dann `lib/index.js`. Grund: Der Loader von node-pty verdeckt dlopen-Fehler mit „Cannot find module“.

## Ordner

Vor Arbeit an einem Modul den zugehörigen Abschnitt in `docs/module.md` lesen. Pfade relativ zu `src/`, wo nicht anders vermerkt.

- Ordner src/core: `core/`. Details: docs/module.md#ordner-srccore
- Ordner src/host: `host/host-platform.ts`. Details: docs/module.md#ordner-srchost
- src/main.ts: `main.ts`. Details: docs/module.md#srcmaints
- Sitzungen (ab Abend 4): `core/session-manager.ts, core/view-tracker.ts`. Details: docs/module.md#sitzungen-ab-abend-4
- Claude-Start: `host/launcher.ts, core/login-path.ts, core/claude-launch.ts`. Details: docs/module.md#claude-start
- Sitzungen (ab Abend 7): `core/session-store.ts, host/new-session-modal.ts`. Details: docs/module.md#sitzungen-ab-abend-7
- node-pty spawn-helper: `native/ (ausserhalb src)`. Details: docs/module.md#node-pty-spawn-helper
- Eingabe: `core/keymap.ts, host/terminal-input.ts, core/paste.ts`. Details: docs/module.md#eingabe
- Bild-Paste: `host/clipboard.ts`. Details: docs/module.md#bild-paste
- Knopfleiste und Transkript-Leser: `host/code-block-bar.ts, host/transcript-reader.ts, core/transcript-poll.ts`. Details: docs/module.md#knopfleiste-und-transkript-leser
- Benachrichtigung: `core/attention.ts, core/session-activity.ts`. Details: docs/module.md#benachrichtigung
- Einstellungen: `core/settings.ts, core/constants.ts, host/settings-tab.ts`. Details: docs/module.md#einstellungen
- Launcher: `core/discovery.ts, host/discovery-fs.ts, core/frontmatter.ts`. Details: docs/module.md#launcher
- Dashboard: `host/dashboard-view.ts, host/internal-link.ts, core/briefings.ts`. Details: docs/module.md#dashboard
- Tasks und Skill-Karte: `host/tasks-card.ts, core/tasks.ts, host/skills-card.ts`. Details: docs/module.md#tasks-und-skill-karte
- Heute-Karte: `host/tasks-card.ts, core/today.ts, core/focus.ts, host/reminders.ts, host/briefing-checks.ts`. Details: docs/module.md#heute-karte
- Härtung: `core/claude-start.ts`. Details: docs/module.md#härtung
- Telegram: `host/telegram-send.ts, host/idle-time.ts, host/telegram-notify.ts`. Details: docs/module.md#telegram
- Usage-Karte: `host/usage-card.ts, host/usage-fs.ts, core/usage.ts`. Details: docs/module.md#usage-karte
- Übergabe-Signal: `hooks/clearable-banner.py (ausserhalb src)`. Details: docs/module.md#übergabe-signal
- Statuszeile: `statusline/statusline-command.sh (ausserhalb src), core/session-file.ts`. Details: docs/module.md#statuszeile
- Research-Karte: `host/research-card.ts, core/research.ts, host/research-fs.ts`. Details: docs/module.md#research-karte
- Cockpit-Ansicht: `host/cockpit-layout.ts, core/cockpit-panels.ts`. Details: docs/module.md#cockpit-ansicht
- src/styles.css: `styles.css`. Details: docs/module.md#srcstylescss
- IDE-Brücke: `host/ide-bridge.ts, host/ide-server.ts, core/ide-protocol.ts`. Details: docs/module.md#ide-brücke
- Diff-Ansicht: `host/diff-view.ts, host/ide-diff.ts, core/line-diff.ts`. Details: docs/module.md#diff-ansicht
- Cockpit füllen, Daten und Bedienung: `core/cockpit-feed.ts, host/feed-source.ts, host/feed-fs.ts`. Details: docs/module.md#cockpit-füllen-daten-und-bedienung
- Neue Sitzung: `core/cockpit-split.ts, core/new-session.ts`. Details: docs/module.md#neue-sitzung
- Neue Sitzung nach zuletzt benutzt: `host/last-used.ts, core/new-session.ts`. Details: docs/module.md#neue-sitzung-nach-zuletzt-benutzt
- Zuschnitt und Entdoppeln: `core/cockpit-panels.ts, core/cockpit-split.ts`. Details: docs/module.md#zuschnitt-und-entdoppeln
- Ordner test, scripts, native, build: `test/, scripts/, native/, build/ (ausserhalb src)`. Details: docs/module.md#ordner-test-scripts-native-build
- Sicherheitsnetz: `core/session-model.ts`. Details: docs/module.md#sicherheitsnetz
- Effort-Schieber: `host/effort-lever.ts, core/effort-lever.ts`. Details: docs/module.md#effort-schieber
- Cockpit-Ansicht im Merkzettel: `host/dashboard-layout-controller.ts, core/cockpit-panels.ts`. Details: docs/module.md#cockpit-ansicht-im-merkzettel
- Eingabezeile fest: `core/terminal-modes.ts`. Details: docs/module.md#eingabezeile-fest
- Vault-Konventionen neutral: `core/constants.ts, core/unset.ts, host/settings-tab.ts`. Details: docs/module.md#vault-konventionen-neutral
- Mindestkontrast: `core/terminal-options.ts`. Details: docs/module.md#mindestkontrast
- Tab-Schatten: `styles.css, main.ts`. Details: docs/module.md#tab-schatten
- Datei-Viewer: `core/file-links.ts, host/file-links.ts, host/vault-open.ts`. Details: docs/module.md#datei-viewer
- Markdown-Farben im Datei-Viewer: `core/markdown-mode.ts, host/code-editor.ts, host/file-viewer-modal.ts`. Details: docs/module.md#markdown-farben-im-datei-viewer
- Bilder im Datei-Viewer: `core/file-links.ts, host/file-viewer-fs.ts, core/file-viewer-frame.ts`. Details: docs/module.md#bilder-im-datei-viewer
- Pfade mit Leerzeichen: `core/file-links.ts, host/file-links.ts`. Details: docs/module.md#pfade-mit-leerzeichen
- Stille Zwischenstände: `core/background-tasks.ts`. Details: docs/module.md#stille-zwischenstände
- Klick auf /clear: `core/clear-link.ts, host/clear-link.ts`. Details: docs/module.md#klick-auf-clear
- Link-Wächter: `core/link-guard.ts, host/link-guard.ts`. Details: docs/module.md#link-wächter
- Weich scrollen: `core/smooth-wheel.ts, host/smooth-wheel.ts, host/terminal-pane.ts`. Details: docs/module.md#weich-scrollen
- Windows-Fundament: `core/kill-escalation.ts, core/platform-path.ts, core/shell.ts`. Details: docs/module.md#windows-fundament
- Windows-Prozess und Eingabe: `host/settings-files.ts, core/cmd-shim.ts, host/win-kill.ts`. Details: docs/module.md#windows-prozess-und-eingabe
- Windows-Abschluss: `core/settings.ts, core/constants.ts, core/platform-path.ts`. Details: docs/module.md#windows-abschluss

## Regeln

- **Testregel:** Reine Logik gehört nach `src/core`, der Vitest-Test kommt zuerst. Rot muss an einer Zusicherung scheitern, nicht an einem fehlenden Modul. Rot- und Grün-Ausgabe zeigen. Was nur in Obsidian prüfbar ist, meldet Claude nicht als erledigt; das prüft der Nutzer in der Abnahme.
- Bei Obsidian-API und Claude-Code-Verhalten zuerst die aktuelle Doku prüfen (Obsidian-Signaturen stehen in `node_modules/obsidian/obsidian.d.ts`).
- Kein Code aus dem Original `agentic-os`. Nichts in `~/.agentic-os/`. `plugins/agentic-os/` nie anfassen.
- **iCloud:** Repo und Vault liegen in iCloud. Hängt git, vor den Befehl setzen: `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.trustctime GIT_CONFIG_VALUE_0=false`.
- **Worktrees** nie neben dem Repo in `~/Documents`, sondern unter `~/Developer/worktrees/claude-cockpit-<name>` (`git worktree add ~/Developer/worktrees/claude-cockpit-<name> -b <branch>`). Grund: iCloud holt gelöschte Worktree-Ordner in `~/Documents` als Platzhalter zurück, samt Eintrag in `.git/worktrees/` (06.10.2026 zweimal).
- Banner (Abend 26c, Teil C): Web-`Notification.close()` wirkt in Obsidian nicht; `showBanner` (`src/host/attention-alert.ts`) nutzt die Hauptprozess-Notification über `@electron/remote`. Logik in `src/core/banner-manager.ts`: je Sitzung höchstens ein Banner, Selbstschluss nach `settings.bannerSeconds`. Volltext: docs/module.md#ergänzungen-aus-claudemd

Modulübergreifend (Volltext je Regel in docs/module.md):
- `src/core` ist reine Logik: kein Import von `obsidian`, `electron`, `node-pty`; liest nie `process.platform`, `process.arch`, `os.release()`, `process.env`, der Host reicht die Werte herein.
- Plattform und Vault-Pfad nur über `src/host/host-platform.ts`; nur dort `process.platform` und `getBasePath(` (Wächter `test/platform-source.test.ts`).
- `src/main.ts` ist nur Verkabelung: immer `this.app`, nie `window.app`; Ziel-Sitzung über `RecentSessions`/`sendToActive`, nie `getActiveViewOfType`.
- Was man anders wollen könnte, wird Einstellung mit Vorgabe in `src/core/constants.ts`, gelesen über `store.settings()` bei jeder Nutzung (nie beim Laden zwischengespeichert), geändert über `store.updateSetting`.
- Windows: Programme nur über `system32Path`, nie über PATH; jeder Prozessaufruf in `src/host` trägt `windowsHide: true` (Wächter `test/windows-hide.test.ts`).
- `native/<ziel>` muss nach jedem Tausch vollständig sein (`verifyNative` prüft vor dem Tausch), sonst werfen laufende Sitzungen bei Resize und Kill.
- Download-Adresse und Prüfsummen der Binärdateien sind Sicherheits-Invarianten, keine Einstellung.
- Netz nur über Obsidians `requestUrl`, nie `fetch` (Telegram-Versand).
- IDE-Token nie in Log, Notice oder Fehlertext (Wächter `test/ide-wiring.test.ts`).
- Hooks auf dem Mac immer per `--settings` (JSON-Argument); unter Windows Settings-Datei je Sitzung.
- Web-`Notification.close()` wirkt in Obsidian nicht: Banner über `@electron/remote`.
- Vor Arbeit an einem Modul den Abschnitt in `docs/module.md` lesen; die Fallen und Messwerte stehen dort.

## CSS in Obsidian (Messungen, aus dem Memory übernommen am 23.10.2026)

- **`all: unset` ersetzen (Abend 34, 13.10.2026):** Wer `all: unset` (Portal-Lint-Befund „Unexpected property all“) durch ausdrückliche Zurücksetzungen ersetzt, bekommt Obsidians eigene `button`-Regel zurück: `justify-content: center`, `white-space: nowrap`, `user-select: none`, `transition`, bei `.cockpit-zoom-close` auch `align-items`. `min-height: 0` ist nicht der Wert von `all: unset` (`auto`); in Flex-Spalten mit `overflow: auto` werden die Knöpfe dann gestaucht. Gleichwertig zu `all: unset` war es erst mit `justify-content: normal; align-items: normal; white-space: normal; user-select: inherit; transition: initial` und ohne `min-height`. Warum gemessen werden muss: Der Plan-Block sah vollständig aus; erst ein Chrome-Vergleich der berechneten Stile (Alt mit `all: unset` gegen Neu, Obsidians echte button-Regeln aus dem asar) zeigte zentrierte Radar-Zeilen und einen gestauchten Zoom. Den Ersatz nie nur lesen, sondern Alt gegen Neu messen (`getComputedStyle`, Grund-, Hover- und Fokuszustand, plus ein Schrumpf-Szenario). Messskript: `handoffs/2026-10-13-abend-34-css-messung.py`.
- **Dialoge (Modal, gemessen 22.10.2026 in Obsidian 1.14.4, Nachtrag 41d):** `app.css` hat `.modal-container .modal { corner-shape: …; position: relative; }`, Spezifität 0,2,0. Eine Plugin-Regel mit einer Klasse (`.mein-modal { position: absolute }`) verliert, `left`/`top` addieren sich dann zur Flex-Zentrierung des Containers. Abhilfe: eigene Klasse an `containerEl` und Selektor `.mein-container .mein-modal` (0,2,0, Plugin-CSS lädt später). Der Schließen-Knopf heißt `modal-header-button mod-raised clickable-icon`, hängt direkt am `modalEl` (nicht in `.modal-header`) und hat `z-index: var(--layer-modal)` (50); `.modal-close-button` gibt es im normalen Modal nicht mehr. `modalEl > .modal-header > .modal-title` ist `titleEl`; `setTitle` leert nur `titleEl`. Messweg: Attrappe `.modal-container > .modal` per `obsidian eval` mit dem echten Regelblock, `getBoundingClientRect` gegen Soll; das DOM eines echten Modals über die Modal-Klasse aus der Prototypkette von `app.setting`. Wächter, die nur den eigenen Quelltext lesen, sehen das nicht. Der Vorfall steht auch im Fehlerlog `03 Bereiche/Claude Code/Fehlerlog.md`.
- **Fremde Plugins teilen Klassennamen (Abend 11, 05.10.2026):** Obsidian-Elemente (Statusleiste usw.) über ihre Lage im DOM suchen (`.app-container > .status-bar`), nie über eine nackte Klasse wie `.status-bar`. Andere Plugins verwenden dieselben Klassennamen in ihren Views: Agentic OS rendert ein `div.status-bar` (MODEL/MODE/EFFORT), und `querySelector` liefert das erste Element im Dokument. Die Abnahme fand den Statusleisten-Abstand bei 0; die erste Vermutung (Messzeitpunkt) war falsch, erst ein Gegentest widerlegte sie. Regel: Bei jedem `querySelector` auf Obsidian-Elemente den Selektor an der Struktur verankern. Wie Obsidian ein Element anlegt, steht im App-Code (`~/Library/Application Support/obsidian/obsidian-<version>.asar`, `strings | grep`).

## Obsidian-Interna (Messungen, aus dem Memory übernommen am 23.10.2026)

- **CodeMirror fehlt im Zusatz (Abend 32, 13.10.2026; Obsidian 1.14.4, bei neueren Versionen nachmessen):** Die Fork-Fassung von `@codemirror/language` und ihre Regel stehen schon im Abschnitt Datei-Viewer (`lineHighlighter`, `tokenClassNodeProp`). Ergänzt: `StreamLanguage` vergibt keine `@lezer/highlight`-Tags, `HighlightStyle`/`syntaxHighlighting` bleiben wirkungslos; Marks heißen `cm-<token>`, Obsidians globales CSS (`.cm-keyword { color: var(--code-keyword) }` usw.) ist unbeschränkt. Weitere Fork-Exporte: `lineClassNodeProp`, `ignoreSpellcheckToken`. Abend 32 war mit 2795 grünen Tests und Opus-Abschlussreview fertig und trotzdem in Obsidian einfarbig, weil die Tests Upstream-CodeMirror aus `node_modules` laden. Rezept: Bei CodeMirror-Funktionen erst Obsidians Exportliste lesen (`npx @electron/asar extract-file ~/Library/Application\ Support/obsidian/obsidian-<ver>.asar app.js`, dann nach `n.d(o,{DocInput:` suchen) und eine Live-Messung per `obsidian eval` einplanen, bevor die Abnahme angesetzt wird. Live-Zugriff auf einen Editor: `contentDOM.cmTile.view` (nicht mehr `cmView`); Modals hängen in `activeDocument`.
- **Windows: kein `fork`, keine Worker (gemessen 18.10.2026, Obsidian 1.14.4, Windows x64 und ARM64; Ergänzung zum Windows-Fundament Abend 40/41):** `child_process.fork` aus dem Renderer startet `Obsidian.exe` als App (stdout „Loaded main app package …obsidian.asar“), auch mit `ELECTRON_RUN_AS_NODE=1`; die Electron-Sicherung RunAsNode ist aus, ein Node-Hostprozess per fork geht nicht. node-pty 1.1.0 unter Windows: Ohne `useConptyDll` ruft jedes `kill()` `fork(conpty_console_list_agent)` auf und startet in Obsidian jedes Mal ein zweites `Obsidian.exe`; mit `useConptyDll: true` gibt es keinen fork. Im Renderer startet kein `worker_threads`-Worker („V8 platform … does not support creating Workers“), deshalb braucht node-pty die eigene `windowsConoutConnection.js` ohne Worker. Warum festgehalten: Ohne diese Messung sah Weg B (eigener Hostprozess) gleichwertig aus, und das Beenden mit System-ConPTY wirkte harmlos. Regel: In Obsidian-Plugins unter Windows nie `fork` und keine Worker; node-pty nur mit `useConptyDll: true` und gepatchter Conout-Verbindung. Gilt bis zum Gegenbeleg auch für neuere Obsidian-Versionen; bei einem Obsidian-Update im Probe-Repo nachmessen.
- **Rückfrage-Werkzeug löst zwei Hooks aus (gemessen 06.10.2026, claude 2.1.291, Wegwerf-Sitzung mit protokollierenden Hooks, auch unter bypassPermissions):** `AskUserQuestion` löst sofort `PreToolUse` und `PermissionRequest` aus, nach 6 s offen zusätzlich `Notification` mit `notification_type: permission_prompt` und `message: "Claude needs your permission"`, ohne Werkzeugnamen. Nach der Antwort feuert `PostToolUse`. Der Textfilter im Cockpit (8838198) suchte „AskUserQuestion“ in der Meldung und griff nie; die Annahme stammte aus einem String im Binary, nicht aus einer Messung, die doppelte Telegram-„Frage“ blieb. Regel: Hook-stdin nie aus dem Binary ableiten, sondern per Wegwerf-Sitzung messen; entdoppeln über den Sitzungszustand (Frage, während schon eine offen ist, `repeatsQuestion` in `src/core/attention.ts`), nicht über den Meldungstext.
