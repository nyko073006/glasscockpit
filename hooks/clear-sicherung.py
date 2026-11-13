#!/usr/bin/env python3
"""SessionEnd-Hook (Nachtrag 43i): Nach /clear soll nichts unauffindbar sein.

Claude Code behält das Transkript der endenden Sitzung (cleanupPeriodDays), aber die
neue Sitzung weiß nicht, welche vor ihr lief. Dieser Hook
  1. sucht in der letzten Antwort mit einem Handoff-Block (Codeblock, erste
     nichtleere Zeile beginnt mit dem Präfix, Vorgabe "Handoff:") den Pfad,
  2. trägt vorgaenger_session und vorgaenger_transkript ins Frontmatter dieser
     Datei ein (ohne Frontmatter: eine Zeile am Ende), alles andere bleibt bytegleich,
  3. schreibt jedes Sitzungsende als Zeile nach <cockpit>/clear-log.jsonl.

Präfix einstellbar: handoff_prefix in <cockpit>/thresholds.json. Der Hook blockiert
nichts, gibt nichts aus und endet immer mit 0; Fehler landen im Protokoll.
"""
import datetime
import json
import os
import re
import sys

VORGABE_PRAEFIX = "Handoff:"
BLOCK = re.compile(r"```[^\n]*\n(.*?)```", re.S)


def cockpit_ordner():
    return os.environ.get("COCKPIT_DIR") or os.path.expanduser("~/.claude/cockpit")


def praefix():
    try:
        with open(os.path.join(cockpit_ordner(), "thresholds.json"), encoding="utf-8") as fh:
            wert = json.load(fh).get("handoff_prefix")
    except (OSError, ValueError, AttributeError):
        wert = None
    return wert if isinstance(wert, str) and wert.strip() else VORGABE_PRAEFIX


def protokoll(eintrag):
    try:
        os.makedirs(cockpit_ordner(), exist_ok=True)
        eintrag = {"zeit": datetime.datetime.now().isoformat(timespec="seconds"), **eintrag}
        with open(os.path.join(cockpit_ordner(), "clear-log.jsonl"), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(eintrag, ensure_ascii=False) + "\n")
    except OSError:
        pass


def handoff_aus_text(text, pref):
    """Pfad aus dem letzten Handoff-Block des Texts, sonst None."""
    treffer = None
    for m in BLOCK.finditer(text):
        zeilen = [z.strip() for z in m.group(1).splitlines() if z.strip()]
        if zeilen and zeilen[0].startswith(pref):
            pfad = zeilen[0][len(pref):].strip().strip("`\"'").strip()
            if pfad:
                treffer = pfad
    return treffer


def letzter_handoff(transkript, pref):
    pfad = None
    with open(transkript, encoding="utf-8") as fh:
        for zeile in fh:
            try:
                satz = json.loads(zeile)
            except ValueError:
                continue
            if not isinstance(satz, dict) or satz.get("type") != "assistant":
                continue
            teile = satz.get("message", {}).get("content", [])
            if not isinstance(teile, list):
                continue
            text = "\n".join(t.get("text", "") for t in teile if isinstance(t, dict) and t.get("type") == "text")
            gefunden = handoff_aus_text(text, pref)
            if gefunden:
                pfad = gefunden
    return pfad


def aufloesen(roh, cwd):
    pfad = os.path.expanduser(roh)
    if not os.path.isabs(pfad) and cwd:
        pfad = os.path.join(cwd, pfad)
    return pfad if os.path.isfile(pfad) else None


def stempeln(datei, session_id, transkript):
    with open(datei, encoding="utf-8", newline="") as fh:
        text = fh.read()
    nl = "\r\n" if "\r\n" in text else "\n"
    zeilen = text.split("\n")
    felder = {"vorgaenger_session": session_id, "vorgaenger_transkript": transkript}
    kopf = zeilen[0].rstrip("\r").lstrip("﻿") == "---"
    ende = next((i for i in range(1, len(zeilen)) if zeilen[i].rstrip("\r") == "---"), -1) if kopf else -1
    if ende > 0:
        cr = "\r" if nl == "\r\n" else ""
        for name, wert in felder.items():
            neu = f"{name}: {wert}{cr}"
            stelle = next((i for i in range(1, ende) if re.match(rf"{name}[ \t]*:", zeilen[i])), -1)
            if stelle >= 0:
                zeilen[stelle] = neu
            else:
                zeilen.insert(ende, neu)
                ende += 1
        neu_text = "\n".join(zeilen)
    else:
        neu_text = text + ("" if text.endswith(nl) or not text else nl) + f"{nl}> Vorgänger-Sitzung: {session_id} ({transkript}){nl}"
    tmp = f"{datei}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as fh:
        fh.write(neu_text)
    os.replace(tmp, datei)


def main():
    try:
        daten = json.loads(sys.stdin.read())
    except ValueError:
        protokoll({"fehler": "Eingabe ist kein JSON"})
        return
    if not isinstance(daten, dict):
        return
    sid = daten.get("session_id") or ""
    transkript = daten.get("transcript_path") or ""
    cwd = daten.get("cwd") or ""
    eintrag = {"reason": daten.get("reason"), "session_id": sid, "transkript": transkript, "cwd": cwd, "handoff": None, "gestempelt": False}
    try:
        roh = letzter_handoff(transkript, praefix()) if transkript else None
        eintrag["handoff"] = roh
        datei = aufloesen(roh, cwd) if roh else None
        if datei and sid:
            eintrag["handoff"] = datei
            stempeln(datei, sid, transkript)
            eintrag["gestempelt"] = True
    except Exception as e:  # nie die Sitzung stören
        eintrag["fehler"] = f"{type(e).__name__}: {e}"
    protokoll(eintrag)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
