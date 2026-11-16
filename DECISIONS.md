# Entscheidungen Nachtrag 41d (Datei-Viewer lesbar, zoombar, verschiebbar)

Unbeaufsichtigter Lauf ab 22.10.2026. Vom Nutzer im Chat freigegeben: Rohtext bleibt, Zeilenumbruch, eigene Schriftgröße (Vorgabe 14 px), Zoom 50–200 % in 10er-Schritten mit Cmd+Plus/Minus/0 und Cmd+Mausrad, Prozentanzeige, Ziehen an der Titelzeile, Größe an Kanten/Ecken, Doppelklick setzt zurück, Mindestmaß ca. 400 × 300, Startgröße 90 % × 90 % einstellbar, nichts wird gemerkt. Die Zeilen unten sind Annahmen innerhalb dieses Rahmens.

- Arbeitsort: gewählt der vor dem unbeaufsichtigten Teil angelegte Worktree `~/Developer/worktrees/claude-cockpit-41d` (Branch `nachtrag-41d-dateibetrachter`) statt eines neuen `afk/…`-Branches, weil Task 1 dort schon committet und geprüft war. (Repo, Branch)
- Kein Deploy, kein Merge: gewählt Stand nur auf dem Branch statt Deploy in Obsidian, weil das Neuladen des Plugins alle Terminal-Tabs neu startet und der Merge nach main eine Freigabe des Nutzers braucht. (Abschluss)
- Zoom-Tasten: gewählt Obsidian-`scope.register(["Mod"], …)` mit `return false` statt globalem keydown-Listener, weil Cmd+S im selben Fenster so gebunden ist; ob das Obsidians Menü-Zoom (`CommandOrControl+=/-/0` im Hauptprozess) zuverlässig unterdrückt, ist ungemessen und Teil der Abnahme. (src/host/file-viewer-modal.ts, onOpen)
- Zoom-Anzeige und Ziehen: gewählt eine Kopfzeile mit beidem (Anzeige neben dem Titel, Ziehen auf der ganzen Kopfzeile außer dem Schließen-Knopf) statt getrennter Bereiche, weil eine Regel einfacher ist. (src/host/file-viewer-modal.ts, src/styles.css)
- Lage der Zoom-Anzeige: gewählt direkt hinter `titleEl` in der Modal-Kopfzeile statt in `titleEl`, weil `setTitle` nur `titleEl` leert; der Schließen-Knopf hängt am `modalEl`, nicht in der Kopfzeile (gemessen 23.10.2026). (src/host/file-viewer-modal.ts, onOpen)
- Zusätzliche Taste: gewählt auch Mod+Umschalt+Plus/=, weil Plus auf der US-Tastatur nur mit Umschalt erreichbar ist und Obsidians Scope die Modifier genau vergleicht. (src/host/file-viewer-modal.ts, onOpen)
- CSS-Klassen: gewählt eigene `cockpit-file-viewer-header` und `cockpit-file-viewer-zoom-on` statt Obsidians `modal-header` im Stylesheet, weil die Präfix-Wächter im CSS nur `cockpit-`-Klassen erlauben. (src/styles.css)
- Mausrad-Zoom: gewählt aufsummiertes `deltaY` mit einem Schritt je 50 px (Pixelmodus), Rücksetzen bei Richtungswechsel und nach 300 ms Ruhe, statt einem Schritt je Ereignis, weil Trackpad-Pinch und Trägheit sonst in Bruchteilen einer Sekunde auf 50 oder 200 % springen. Im Zeilen-/Seitenmodus (klassisches Mausrad) ein Schritt je Ereignis. (src/core/file-viewer-frame.ts, wheelSteps)
- Zoom-Richtung: Rad nach oben bzw. Pinch auseinander (deltaY < 0) vergrößert, wie im Browser. (src/core/file-viewer-frame.ts, wheelSteps)
- Position im Container: gewählt eigene Klasse `cockpit-file-viewer-container` am Modal-Container und den Selektor `.cockpit-file-viewer-container .cockpit-file-viewer` statt Inline-`style.position`, weil Obsidians `.modal-container .modal { position: relative }` (Spezifität 0,2,0) die einfache Klasse schlägt (gemessen 22.10.2026: Fenster saß um den Startversatz verschoben) und statische Inline-Stile der Portal-Lint meldet. Nach der Änderung gemessen: Ist = Soll. (src/styles.css, src/host/file-viewer-modal.ts onOpen)
- Container noch nicht gemessen (0): gewählt Fenstermaße als Ersatz, weil startRect sonst ein Fenster der Größe 0 liefert. (src/host/file-viewer-modal.ts, Startrahmen)
- Schließen-Knopf und Griffe: gewählt keine eigene Regel, weil Obsidian den Knopf (`modal-header-button`, am Modal, nicht in der Kopfzeile; gemessen in 1.14.4) mit `z-index: var(--layer-modal)` ohnehin über die Griffe legt. Die frühere Annahme einer Klasse `modal-close-button` war falsch (Abschlussreview) und ist gestrichen. (src/host/file-viewer-modal.ts, src/styles.css)
- Ziehen endet über dem Hintergrund: Erwartung, dass Pointer-Capture den Klick an der Kopfzeile hält und das Modal nicht schließt; ungemessen, Teil der Abnahme. (src/host/file-viewer-modal.ts)
- Zoom-Tasten bei offener Rückfrage („Ungespeicherte Änderungen“): nicht abgefangen, weil der Scope der Rückfrage keinen Eltern-Scope hat; Cmd+Plus/Minus/0 erreichen dann Obsidians Menü-Zoom. Randfall, bewusst gelassen. (src/host/file-viewer-modal.ts, ChoiceModal)

# Entscheidungen Release-Wächter (unbeaufsichtigt ab 16.11.2026)

Vom Nutzer gewählt: Wächter, der vor dem Push des öffentlichen Exports prüft, ob es zur Manifest-Version ein Release gibt (Fehlerlog 13.11.2026). Spec: `handoffs/2026-11-16-release-waechter-plan.md` im privaten Repo (ignoriert).

- Ort des Wächters: gewählt git-Hook `pre-push` im öffentlichen Repo, den `export-public` bei jedem Export einrichtet, statt eines eigenen Push-Befehls, weil ein Hook auch ein gewöhnliches `git push` fängt. (scripts/lib/export-public.ts)
- Entwürfe: gewählt Entwurf zählt, wenn `main.js`, `manifest.json`, `styles.css` dranhängen, statt nur veröffentlichter Releases, weil der Release-Weg „Entwurf, Dateien, pushen, veröffentlichen“ sonst gesperrt wäre; ein leerer Entwurf zählt nicht (Skeptiker-Befund 1). (scripts/lib/release-guard.ts, entscheide)
- Release-Abfrage: gewählt `gh api --paginate …/releases` statt `gh release list`, weil nur die API die Dateinamen liefert. (scripts/release-guard.mjs)
- Fehlschlag von gh, fremder Host, kaputtes Manifest: gewählt sperren statt durchlassen, weil der Wächter sonst stumm ausfällt; Notausgang `git push --no-verify`. (scripts/lib/release-guard.ts, pruefePush)
- core.hooksPath gesetzt: gewählt Export bricht ab statt Hook in den fremden Ordner zu legen, weil ein globaler Hook-Ordner jedes Repo träfe (Skeptiker-Befund 2). (scripts/lib/export-public.ts)
- Remote-URL: gewählt `pushurl`, sonst `url` roh aus der Konfiguration, bei Push an eine URL Argument 1, weil Argument 2 schon per insteadOf umgeschrieben ist (gemessen vom Skeptiker). (scripts/lib/release-guard.ts, remoteUrl)
- Meldungen: gewählt Präfix `release-guard: ` nur in der .mjs (je Zeile, auch mehrzeilige Fehlertexte; stderr von gh und git per pipe abgefangen) statt im Kern, weil der Kern reine Texte liefert. (scripts/release-guard.mjs, ausgeben)
- Mehrere Treffer zum selben Tag: gewählt veröffentlichte entscheiden allein, eines mit allen Dateien genügt; Fehlliste vom Treffer mit den wenigsten fehlenden Dateien, weil Obsidian aus dem veröffentlichten lädt (agy-Befund). (scripts/lib/release-guard.ts, entscheide)
- Release-Dateien: gewählt nur Assets mit `state == "uploaded"`, weil abgebrochene Uploads sonst als vorhanden zählten (agy-Befund, `state` an der echten API geprüft). (scripts/lib/release-guard.ts, RELEASE_JQ)
- Stdin-Lesefehler, falsche Feldtypen in der gh-Ausgabe: gewählt sperren. (scripts/release-guard.mjs, scripts/lib/release-guard.ts parseReleases)
- Eigener Hook: gewählt „Zeile 2 ist exakt die Markenzeile“ statt „Marke irgendwo im Text“, weil sonst ein fremder Hook mit der Marke überschrieben würde (agy-Befund). (scripts/lib/export-public.ts, HOOK_ZEILE)
- Hook-Pfad: gewählt `git rev-parse --path-format=absolute --git-path hooks` plus `pre-push` statt `--git-path hooks/pre-push`, weil Letzteres Symlinks auflöst und ein Symlink am Hook-Pfad (Abbruch) sonst unsichtbar bliebe. (scripts/lib/export-public.ts)
- Verworfen (agy): Hook bei einem Ziel, das ein verknüpfter Worktree ist, liegt im gemeinsamen Hook-Ordner; das ist der Ort, an dem git ihn sucht. Teil-Schreiben beim späten Abbruch durch check:public ist Altverhalten und nicht Teil dieses Auftrags. Wettlauf zwischen Prüfung und Schreiben: theoretisch.

## Ergebnis Release-Wächter
- Tests: `npx vitest run` 4389 grün, 0 rot (Basis vor dem Lauf 4330); `npm run build` Exit 0.
- Echtlauf A5 in einer Wegwerf-Kopie des öffentlichen Repos (Remote GitHub, nur `git push --dry-run`): Manifest 0.4.0 -> „Release 0.4.0 vorhanden“, Exit 0; Manifest 0.4.1 -> „Push gesperrt … kein Release 0.4.1“, Exit 1.
- Nicht geprüft: Windows (Prozesstest dort übersprungen), Entwurfs-Fall gegen echtes GitHub (nur per Stub).
- Bekannte Lücke (Re-Review Task 2, nicht behoben): Ist `.git/hooks` selbst ein Symlink auf einen geteilten Ordner, schreibt der Export `pre-push` dorthin (git löst den Ordner-Symlink auf). Gleiche Fehlerklasse wie `core.hooksPath`, exotisch, nicht in der Spec. Abhilfe bei Bedarf: `lstat(join(target, ".git/hooks"))` prüfen. (scripts/lib/export-public.ts)
