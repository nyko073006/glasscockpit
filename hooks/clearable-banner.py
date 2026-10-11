#!/usr/bin/env python3
"""Stop-Hook: hebt das clearable-Signal farbig hervor.

Liest die letzte Assistant-Nachricht aus dem Feld last_assistant_message der
Hook-Eingabe; nur wenn es fehlt, aus dem Transkript. Das Transkript hinkt beim
Stop hinterher und liefert dann einen Zwischensatz vor dem letzten Tool-Aufruf
(belegt 09.10.2026, 23:04). Signal: ein Codeblock, dessen erste Zeile mit
"Handoff:" beginnt, oder das Wort "clearable" ohne "nicht" davor. Dann werden
drei Zeilen ausgegeben:
  gelb   - die kopierbare Startnachricht (letzter Codeblock) samt Handoff-Pfad
  orange - Session clearable
  rot    - die Aufforderung, mit /clear zu wipen

Ausgabe als systemMessage mit ANSI-Codes. /dev/tty ist kein Weg, weil die
Oberflaeche hier im Fullscreen-Renderer laeuft und direkt geschriebene Zeilen
ueberzeichnet. Schlaegt irgendetwas fehl, beendet sich der Hook still mit 0.
"""
import datetime
import json
import os
import re
import sys

LOG = os.path.expanduser("~/.claude/hooks/clearable-banner.log")


def protokoll(*teile):
    try:
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(datetime.datetime.now().isoformat(timespec="seconds") + " " +
                     " | ".join(str(t) for t in teile) + "\n")
    except OSError:
        pass

GELB = "\033[1;33m"
ORANGE = "\033[1;38;5;208m"
ROT = "\033[1;31m"
RESET = "\033[0m"

# Handoff frühestens ab diesem Kontextanteil (Nutzerwunsch 10.10.2026) und ab so
# vielen eigenen Nachrichten (Nutzerwunsch 11.10.2026). Darunter kein Banner.
# Beide Werte stellt man in den Cockpit-Einstellungen ein, das Plugin schreibt sie
# nach <COCKPIT_DIR>/thresholds.json; fehlt die Datei oder ein Wert, gelten diese
# Vorgaben. Kontext aus dem Schnappschuss der Statuszeile <COCKPIT_DIR>/sessions/<id>.json;
# fehlt er, gilt der Kontext als unbekannt und hält das Banner nicht auf.
MIN_KONTEXT_PROZENT = 10
MIN_NACHRICHTEN = 2


def cockpit_ordner():
    return os.environ.get("COCKPIT_DIR") or os.path.expanduser("~/.claude/cockpit")


def schwellen():
    """(Kontext-Prozent, Nachrichten) aus thresholds.json, je Wert mit Rückfall auf die Vorgabe."""
    try:
        with open(os.path.join(cockpit_ordner(), "thresholds.json"), encoding="utf-8") as fh:
            daten = json.load(fh)
    except (OSError, ValueError):
        daten = {}
    if not isinstance(daten, dict):
        daten = {}

    def ganz(schluessel, unten, oben, vorgabe):
        wert = daten.get(schluessel)
        ok = isinstance(wert, int) and not isinstance(wert, bool) and unten <= wert <= oben
        return wert if ok else vorgabe

    return (ganz("clearable_min_context_pct", 0, 100, MIN_KONTEXT_PROZENT),
            ganz("clearable_min_prompts", 1, 50, MIN_NACHRICHTEN))


def nachrichten_zahl(pfad):
    """Eigene Eingaben im Transkript: ohne Tool-Ergebnisse, Meta-Einträge, Slash-Befehle, Zusammenfassungen."""
    zahl = 0
    with open(pfad, encoding="utf-8") as fh:
        for zeile in fh:
            try:
                satz = json.loads(zeile)
            except ValueError:
                continue
            if satz.get("type") != "user" or satz.get("isMeta") or satz.get("isCompactSummary"):
                continue
            inhalt = satz.get("message", {}).get("content")
            if isinstance(inhalt, list):
                inhalt = "\n".join(t.get("text", "") for t in inhalt
                                   if isinstance(t, dict) and t.get("type") == "text")
            if not isinstance(inhalt, str) or not inhalt.strip():
                continue
            if inhalt.lstrip().startswith(("<command-name>", "<local-command-")):
                continue
            zahl += 1
    return zahl


def kontext_prozent(session_id):
    if not isinstance(session_id, str) or not re.fullmatch(r"[\w-]+", session_id):
        return None
    ordner = cockpit_ordner()
    try:
        with open(os.path.join(ordner, "sessions", session_id + ".json"), encoding="utf-8") as fh:
            wert = json.load(fh).get("used_percentage")
    except (OSError, ValueError, AttributeError):
        return None
    return wert if isinstance(wert, (int, float)) and not isinstance(wert, bool) else None


def letzte_assistant_nachricht(pfad):
    text = None
    with open(pfad, encoding="utf-8") as fh:
        for zeile in fh:
            zeile = zeile.strip()
            if not zeile:
                continue
            try:
                satz = json.loads(zeile)
            except ValueError:
                continue
            if satz.get("type") != "assistant":
                continue
            teile = satz.get("message", {}).get("content", [])
            if not isinstance(teile, list):
                continue
            stuecke = [t.get("text", "") for t in teile
                       if isinstance(t, dict) and t.get("type") == "text"]
            if any(s.strip() for s in stuecke):
                text = "\n".join(stuecke)
    return text


def text_aus_feld(wert):
    """last_assistant_message: Text oder Inhaltsliste wie im Transkript."""
    if isinstance(wert, str):
        return wert
    if isinstance(wert, dict):
        wert = wert.get("content", wert.get("text"))
        if isinstance(wert, str):
            return wert
    if isinstance(wert, list):
        return "\n".join(t.get("text", "") for t in wert
                         if isinstance(t, dict) and t.get("type") == "text")
    return None


def wort_signal(text):
    """"clearable" zaehlt nur, wenn im selben Satz kein "nicht" davor steht."""
    for treffer in re.finditer(r"clearable", text, re.I):
        satzanfang = max(text.rfind(z, 0, treffer.start()) for z in ".!?\n") + 1
        if not re.search(r"\bnicht\b|\bnot\b", text[satzanfang:treffer.start()], re.I):
            return True
    return False


def main():
    try:
        rohdaten = sys.stdin.read()
        eingabe = json.loads(rohdaten)
    except ValueError:
        protokoll("stdin unlesbar")
        return
    protokoll("gestartet", "felder=" + ",".join(sorted(eingabe)))
    text = text_aus_feld(eingabe.get("last_assistant_message"))
    quelle = "feld"
    if not text:
        pfad = eingabe.get("transcript_path")
        if not pfad:
            protokoll("weder last_assistant_message noch transcript_path")
            return
        try:
            text = letzte_assistant_nachricht(pfad)
        except OSError as fehler:
            protokoll("transkript nicht lesbar", fehler)
            return
        quelle = "transkript"
    if not text:
        protokoll("keine assistant-nachricht gefunden")
        return

    bloecke = re.findall(r"```[^\n]*\n(.*?)```", text, re.S)
    handoff_block = next((b.strip() for b in reversed(bloecke)
                          if b.strip().lower().startswith("handoff:")), "")
    if not handoff_block and not wort_signal(text):
        protokoll("kein signal", quelle, "letzte nachricht endet mit:", repr(text[-80:]))
        return

    min_prozent, min_nachrichten = schwellen()
    prozent = kontext_prozent(eingabe.get("session_id"))
    if prozent is not None and prozent < min_prozent:
        protokoll("signal unter schwelle, kein banner", "kontext=" + str(prozent) + " %", "min=" + str(min_prozent))
        return
    pfad = eingabe.get("transcript_path")
    if pfad:
        try:
            nachrichten = nachrichten_zahl(pfad)
        except OSError:
            nachrichten = None
        if nachrichten is not None and nachrichten < min_nachrichten:
            protokoll("signal vor genug nachrichten, kein banner", "nachrichten=" + str(nachrichten), "min=" + str(min_nachrichten))
            return

    startnachricht = handoff_block or (bloecke[-1].strip() if bloecke else "")
    if not startnachricht:
        treffer = re.search(r"\S*HANDOFF[^\s`\"']*\.md", text)
        startnachricht = ("Handoff: " + treffer.group(0)) if treffer else "(keine Startnachricht im Beitrag)"

    zeilen = []
    for z in startnachricht.splitlines():
        zeilen.append(GELB + z + RESET)
    zeilen.append(ORANGE + "Session clearable" + RESET)
    zeilen.append(ROT + "Diese Session jetzt mit /clear wipen." + RESET)
    banner = "\n".join(zeilen)

    protokoll("signal erkannt, banner ausgegeben", "zeilen=" + str(len(zeilen)))
    json.dump({"systemMessage": banner, "suppressOutput": True}, sys.stdout)


if __name__ == "__main__":
    main()
