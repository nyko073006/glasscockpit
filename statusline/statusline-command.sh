#!/bin/bash
# Claude Code Statusline (Glasscockpit, Abend 13)
# Zeile 1: Modell | Kontext (gelb ab 150k, rot mit HANDOFF ab 175k) | 5h-Fenster mit Restzeit | Output-Tokens heute mit Anteil der Sub-Agents (" · Sub 63 %", nur wenn output_tokens_sub eine Zahl ist)
# Zeile 2 (gedimmt): Wochenbalken, verstrichene Zeit der Woche, Empfehlung (Tempo-Regel)
# Alle Rechnungen in einem jq-Aufruf. Tests: test/statusline.test.ts
# Abend 18: schreibt je Sitzung <COCKPIT_DIR>/sessions/<session_id>.json (Kontext fuers Cockpit)
# und liest optional <COCKPIT_DIR>/thresholds.json (Kontext-Schwellen aus den Cockpit-Einstellungen).

# Schwellen
PCT_YELLOW=70          # Ampel: ab hier gelb
PCT_RED=90             # Ampel: ab hier rot
CTX_WARN=150000        # Kontext gelb
CTX_HANDOFF=175000     # Kontext rot mit HANDOFF (Kontext-Cap der globalen CLAUDE.md)
TEMPO_MARGIN=10        # Prozentpunkte, die der Wochenverbrauch der Zeit voraus sein darf
FIVE_HOUR_WARN=90      # 5h-Fenster fast voll, dieser Hinweis hat Vorrang
TOKENS_STALE=600       # Sekunden, ab denen "heute" sein Alter nennt

input=$(cat)

# Schnappschuss der Limits fuer die Usage-Karte im Glasscockpit (Abend 12).
# Nur wenn rate_limits vorliegt; atomar (temporaere Datei im selben Ordner, dann mv).
# Kein Byte nach stdout, damit die Statuszeile unveraendert bleibt.
if echo "$input" | jq -e '.rate_limits | type == "object"' >/dev/null 2>&1; then
  (
    dir="$HOME/.claude/cockpit"
    mkdir -p "$dir" || exit 0
    tmp=$(mktemp "$dir/.usage.json.XXXXXX") || exit 0
    if echo "$input" | jq -c --argjson now "$(date +%s)" '{written_at: $now, rate_limits: .rate_limits}' > "$tmp"; then
      mv -f "$tmp" "$dir/usage.json"
    else
      rm -f "$tmp"
    fi
  ) >/dev/null 2>&1
fi

# Uhr und Ordner ueberschreibbar (Tests)
now="${COCKPIT_NOW:-$(date +%s)}"
case "$now" in '' | *[!0-9]*) now=$(date +%s) ;; esac
cockpit_dir="${COCKPIT_DIR:-$HOME/.claude/cockpit}"
# Kontext je Sitzung (Abend 18) fuers Glasscockpit: <COCKPIT_DIR>/sessions/<session_id>.json
# { session_id, written_at (Unix-Sekunden wie usage.json), context_tokens, used_percentage, model }.
# context_tokens ist derselbe Wert wie in der Statuszeile (input + cache_creation + cache_read).
# Nur bei einer UUID als session_id (sonst keine Datei: kein fremder Pfad ueber den Dateinamen).
# Atomar (mktemp im selben Ordner, dann mv), kein Byte nach stdout, Fehler brechen nichts.
sess=$(echo "$input" | jq -c --argjson now "$now" '
  (.session_id // null) as $id
  | select(($id | type) == "string" and ($id | length) == 36
      and ($id | test("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")))
  | (.context_window.current_usage // {}) as $u
  | {session_id: $id, written_at: $now,
     context_tokens: (($u.input_tokens // 0) + ($u.cache_creation_input_tokens // 0) + ($u.cache_read_input_tokens // 0)),
     used_percentage: (.context_window.used_percentage // 0),
     model: (.model.display_name // "?")}' 2>/dev/null)
if [ -n "$sess" ]; then
  (
    sid="${sess#\{\"session_id\":\"}"
    sid="${sid%%\"*}"
    case "$sid" in '' | *[!0-9a-fA-F-]*) exit 0 ;; esac
    sdir="$cockpit_dir/sessions"
    mkdir -p "$sdir" || exit 0
    tmp=$(mktemp "$sdir/.session.XXXXXX") || exit 0
    if printf '%s\n' "$sess" > "$tmp"; then
      mv -f "$tmp" "$sdir/$sid.json" || rm -f "$tmp"
    else
      rm -f "$tmp"
    fi
  ) >/dev/null 2>&1
fi
# Schwellen aus dem Plugin; fehlt die Datei oder ist sie unbrauchbar, gelten CTX_WARN und CTX_HANDOFF
thresholds=$(cat "$cockpit_dir/thresholds.json" 2>/dev/null)
# Tagessumme des Plugins; fehlt die Datei, bleibt der Text leer und jq laesst den Teil weg
tokens_today=$(cat "$cockpit_dir/tokens-today.json" 2>/dev/null)

# Rechnen in jq statt printf: printf scheitert unter deutscher Locale an "1.5"
echo "$input" | jq -j \
  --argjson now "$now" \
  --arg tt "$tokens_today" --arg th "$thresholds" \
  --argjson py "$PCT_YELLOW" --argjson pr "$PCT_RED" \
  --argjson ctx_warn_std "$CTX_WARN" --argjson ctx_handoff_std "$CTX_HANDOFF" \
  --argjson margin "$TEMPO_MARGIN" --argjson five_warn "$FIVE_HOUR_WARN" \
  --argjson stale "$TOKENS_STALE" '
  # Jeder Code setzt vorn zurueck (0;), sonst laeuft eine Farbe in den naechsten Teil weiter
  def dim: "\u001b[0;2m";
  def rs: "\u001b[0m";
  def green: "\u001b[0;32m";
  def yellow: "\u001b[0;33m";
  def red: "\u001b[0;1;31m";
  def ampel($p): if $p >= $pr then red elif $p >= $py then yellow else green end;
  def clamp($lo; $hi): if . < $lo then $lo elif . > $hi then $hi else . end;
  def pad2: tostring | if length < 2 then "0" + . else . end;
  def fmtk: floor | if . < 1000 then "\(.)"
    elif . < 1000000 then "\(. / 1000 | floor)k"
    else (. / 100000 | floor) as $t | "\($t / 10 | floor),\($t % 10)M" end;
  def rest($s): if $s >= 86400 then "\($s / 86400 | floor)d \(($s % 86400) / 3600 | floor)h"
    else "\($s / 3600 | floor):\((($s % 3600) / 60 | floor) | pad2)" end;
  def alter($a): if $a < 3600 then "\($a / 60 | floor) Min" else "\($a / 3600 | floor) Std" end;

  # thresholds.json: nur positive Ganzzahlen mit warn < handoff gelten, sonst die eingebauten Werte
  ($th | try fromjson catch null) as $thr
  | (if ($thr | type) == "object"
        and all($thr.context_warn, $thr.context_handoff; type == "number" and . > 0 and . == floor)
        and $thr.context_warn < $thr.context_handoff
     then [$thr.context_warn, $thr.context_handoff] else [$ctx_warn_std, $ctx_handoff_std] end) as $cs
  | $cs[0] as $ctx_warn | $cs[1] as $ctx_handoff
  | (.context_window.current_usage // {}) as $u
  | ((($u.input_tokens // 0) + ($u.cache_creation_input_tokens // 0) + ($u.cache_read_input_tokens // 0))) as $tok
  | ((.context_window.used_percentage // 0) | round) as $cpct
  | "\($tok / 1000 | floor)k (\($cpct)%)" as $ctxtxt
  | (if $tok >= $ctx_handoff then red + $ctxtxt + " HANDOFF" + dim
     elif $tok >= $ctx_warn then yellow + $ctxtxt + dim
     else $ctxtxt end) as $ctx

  | (.rate_limits.five_hour // null) as $f
  | (.rate_limits.seven_day // null) as $w
  | (if ($f | type) == "object" and ($f.used_percentage | type) == "number" and ($f.resets_at | type) == "number"
     then ($f.used_percentage | round) else null end) as $fp
  | (if $fp == null then null else ($f.resets_at - $now) end) as $frest
  | (if $fp == null then ""
     else " │ 5h " + (if $frest <= 0 then "zurückgesetzt"
          else ampel($fp) + "\($fp)%" + dim + " · noch " + rest($frest) end) end) as $five

  | ($tt | try fromjson catch null) as $t
  | ($now | localtime | strftime("%Y-%m-%d")) as $today
  | (if ($t | type) == "object" and $t.day == $today and ($t.output_tokens | type) == "number"
     then " │ heute " + ($t.output_tokens | fmtk)
          + (if ($t.output_tokens_sub | type) == "number" and $t.output_tokens > 0
             then " · Sub \(($t.output_tokens_sub * 100 / $t.output_tokens) | round) %" else "" end)
          + (if ($t.written_at | type) == "number" and ($now - $t.written_at) > $stale
             then " (vor " + alter($now - $t.written_at) + ")" else "" end)
     else "" end) as $heute

  | (dim + "\(.model.display_name // "?") │ " + $ctx + $five + $heute + rs) as $zeile1

  | (if ($w | type) == "object" and ($w.used_percentage | type) == "number" and ($w.resets_at | type) == "number"
     then
       ($w.used_percentage | round) as $wp
       | (if ($w.resets_at - $now) <= 0 then dim + "Woche zurückgesetzt" + rs
          else
            (((($now - ($w.resets_at - 604800)) / 604800 * 100) | round) | clamp(0; 100)) as $zp
            | (($wp / 10 | round) | clamp(0; 10)) as $n
            | (([range($n) | "▓"] | join("")) + ([range(10 - $n) | "░"] | join(""))) as $balken
            | (if $fp != null and $frest > 0 and $fp >= $five_warn then red + "5h fast voll, kurz warten" + dim
               elif ($wp - $zp) > $margin then yellow + "zu schnell: kein xhigh, Sonnet-Agents, früher übergeben" + dim
               else "im Plan" end) as $rat
            | dim + "Woche \($balken) " + ampel($wp) + "\($wp)%" + dim + " · Zeit \($zp)% · " + $rat + rs
          end)
     else null end) as $zeile2

  | $zeile1 + (if $zeile2 != null then "\n" + $zeile2 else "" end)
'
