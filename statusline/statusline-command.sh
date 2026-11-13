#!/bin/bash
# Claude Code Statusline (Glasscockpit, Abend 13)
# Zeile 1: Modell mit Effort (" · xhigh", nur wenn effort.level geliefert wird) | Kontext (gelb ab 150k, rot mit HANDOFF ab 175k) | 5h-Fenster mit Restzeit | Output-Tokens heute mit Anteil der Sub-Agents (" · Sub 63 %", nur wenn output_tokens_sub eine Zahl ist)
# Zeile 2 (gedimmt): Wochenbalken, verstrichene Zeit der Woche, Hinweis (5h fast voll, sonst Tempo-Regel: "zu schnell" oder "im Plan")
# Anzeige in einem jq-Aufruf. Tests: test/statusline.test.ts
# Abend 18: schreibt je Sitzung <COCKPIT_DIR>/sessions/<session_id>.json (Kontext fuers Cockpit)
# und liest optional <COCKPIT_DIR>/thresholds.json (Kontext-Schwellen aus den Cockpit-Einstellungen).
# Nachtrag 43d: der eigene Stand der Limits wird je Fenster mit usage.json zusammengefuehrt (neueres Fenster, sonst hoeherer Wert); Anzeige und Datei rechnen mit demselben Stand.
# Nachtrag 43e: Beobachtungszeit je Sitzung aus dem Merker cost.total_api_duration_ms; im selben Fenster gilt der hoehere Wert, ausser die juengere Beobachtung liegt mindestens DROP_MIN Punkte darunter.
# Nachtrag 44a: ein abgelaufenes 5h-Fenster, nach dessen Reset die Woche beobachtet wurde, zeigt die Anzeige nicht mehr (usage.json bleibt, wie sie ist).
# Nachtrag 44c: Effort hinter dem Modell; der Tempo-Hinweis nennt keine Hebel mehr, nur noch "zu schnell".

# Schwellen
PCT_YELLOW=70          # Ampel: ab hier gelb
PCT_RED=90             # Ampel: ab hier rot
CTX_WARN=150000        # Kontext gelb
CTX_HANDOFF=175000     # Kontext rot mit HANDOFF (Kontext-Cap der globalen CLAUDE.md)
TEMPO_MARGIN=10        # Prozentpunkte, die der Wochenverbrauch der Zeit voraus sein darf
FIVE_HOUR_WARN=90      # 5h-Fenster fast voll, dieser Hinweis hat Vorrang
TOKENS_STALE=600       # Sekunden, ab denen "heute" sein Alter nennt
WINDOW_SLACK=600       # Sekunden, bis zu denen zwei resets_at als dasselbe Fenster gelten (Nachtrag 43d)
WINDOW_LEN_5H=18000    # Sekunden, Laenge des 5h-Fensters: Obergrenze fuer ein Fenster der Datei (Nachtrag 43d)
WINDOW_LEN_MAX=604800  # Sekunden, Laenge aller uebrigen Fenster (etwa der Woche), gleiche Obergrenze (Nachtrag 43d)
DROP_MIN=2             # Punkte, um die eine juengere Beobachtung tiefer liegen muss, damit sie den hoeheren Wert abloest (Nachtrag 43e)
OBS_SLACK=60           # Sekunden, um die eine Beobachtungszeit in der Zukunft liegen darf (Nachtrag 43e)

# Uhr ueberschreibbar (Tests); steht vor dem Schnappschuss-Block, der sie braucht
now="${COCKPIT_NOW:-$(date +%s)}"
case "$now" in '' | *[!0-9]*) now=$(date +%s) ;; esac
input=$(cat)

# Schnappschuss der Limits fuer die Usage-Karte im Glasscockpit (Abend 12, Nachtrag 43d, Nachtrag 43e).
# Nur wenn rate_limits vorliegt (die Sitzungsdatei davor auch ohne). Der eigene Stand wird je Fenster mit
# usage.json zusammengefuehrt, damit ein ruhiger Tab keinen frischeren Wert eines anderen Tabs zuruecksetzt.
# Je Fensterschluessel (Vereinigung beider Seiten; gueltig = Objekt mit Zahl resets_at):
#   1. Fenster der Datei ungueltig oder Datei unbrauchbar: eigenes Fenster. Ein Fenster der Datei gilt auch
#      als ungueltig, wenn sein resets_at spaeter liegt als jetzt + Fensterlaenge + WINDOW_SLACK
#      (WINDOW_LEN_5H fuer five_hour, sonst WINDOW_LEN_MAX); sonst bliebe ein unsinniger Wert ewig stehen.
#      Das eigene Fenster bekommt keine Obergrenze. Scheitert das Zusammenfuehren, gilt der eigene Stand.
#   2. eigenes Fenster fehlt oder ist ungueltig: Fenster der Datei
#   3. resets_at um mehr als WINDOW_SLACK auseinander: das Fenster mit dem spaeteren resets_at (neueres Fenster)
#   4. sonst dasselbe Fenster, Mischregel (Nachtrag 43e): Die eigene Beobachtungszeit ist api_at, die der Datei
#      observed_at ihres Fensters, wenn es eine Zahl > 0 und hoechstens jetzt + OBS_SLACK ist (sonst unbekannt).
#      Juenger ist die Seite mit der spaeteren bekannten Zeit, bekannt ist juenger als unbekannt; gleiche Zeit
#      oder beide unbekannt: keine. Liegt die juengere mindestens DROP_MIN Punkte unter der anderen (beide
#      used_percentage Zahlen): die juengere (Planwechsel, Gutschrift). Sonst der hoehere, bei Gleichstand der eigene.
# observed_at im geschriebenen Fenster: nach Regel 4 die spaeteste bekannte Zeit beider Seiten, auch wenn der
# Wert der aelteren gilt; nach 1 bis 3 die Zeit des gewaehlten Fensters; unbekannt: ohne. Der Rueckfall
# "eigener Stand" schreibt wie in 43d rate_limits der Eingabe, ohne observed_at.
# api_at schaetzt, wann der Stand der eigenen Sitzung entstand, aus dem Merker cost.total_api_duration_ms
# (aufsummierte Wartezeit auf API-Antworten) gegen die vorige Sitzungsdatei: Steigt er, jetzt minus der Zuwachs
# in ganzen Sekunden (der Stand stammt vom Anfang der Anfrage), aber nicht frueher als das vorige api_at.
# Gleich: das vorige api_at. Sinkt er, fehlt er oder fehlt die Vorgeschichte (neue Sitzung, /clear): unbekannt.
# Deshalb entsteht die Sitzungsdatei vor dem Zusammenfuehren: Nur sie rechnet api_at. Gelingt ihr Schreiben
# nicht, gilt api_at als unbekannt, sonst saehe bei schreibgeschuetztem Ordner jeder Lauf einen Merkersprung.
# Jeder Lauf liest die Datei neu, keine Sperre. Atomar schreiben (temporaere Datei im selben Ordner, dann mv).
# Kein Byte nach stdout, damit die Statuszeile unveraendert bleibt. Die Anzeige unten rechnet mit demselben Stand.

# Ordner ueberschreibbar (Tests)
cockpit_dir="${COCKPIT_DIR:-$HOME/.claude/cockpit}"
# session_id gilt nur als UUID (sonst kein fremder Pfad ueber den Dateinamen). Kopf und Sitzungsdatei pruefen mit
# diesem einen Ausdruck; \A und \z statt ^ und $, weil $ in jq einen Zeilenumbruch am Ende zuliesse.
uuid_re='\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\z'
# Gueltige Beobachtungszeit (Nachtrag 43e): Zahl > 0 und hoechstens jetzt + OBS_SLACK. Die Regel steht nur hier;
# Sitzungs-jq (voriges api_at) und Zusammenfuehren (observed_at der Datei) stellen sie ihrem Programm voran.
def_gilt='def gilt: type == "number" and . > 0 and . <= $now + $obs_slack;'
# Kopf: ob rate_limits ein Objekt ist, dahinter die session_id, wenn sie eine UUID ist (sonst leer)
kopf=$(echo "$input" | jq -r --arg uuid "$uuid_re" '
  (.session_id // null) as $id
  | "\((.rate_limits | type) == "object") \(if ($id | type) == "string" and ($id | test($uuid)) then $id else "" end)"' 2>/dev/null)
# Zerlegen per Parameter-Expansion (ein Here-String legte in bash 3.2 je Lauf eine temporaere Datei an).
# Die ID wird Teil eines Dateipfads: nur Hexziffern und Bindestriche, sonst leer (etwa bei mehrzeiliger Ausgabe).
kopf_rl=${kopf%% *}
sid=${kopf#* }
case "$sid" in *[!0-9a-fA-F-]*) sid="" ;; esac

# Kontext je Sitzung (Abend 18) fuers Glasscockpit: <COCKPIT_DIR>/sessions/<session_id>.json
# { session_id, written_at (Unix-Sekunden wie usage.json), context_tokens, used_percentage, model, api_ms, api_at }.
# context_tokens ist derselbe Wert wie in der Statuszeile (input + cache_creation + cache_read).
# api_ms ist der Merker (keine Zahl: null), api_at die Beobachtungszeit nach der Regel oben (ganze Unix-Sekunden
# oder null; Nachtrag 43e). Von der vorigen Datei hoechstens 4096 Byte: Eine aufgeblaehte Datei sprengte sonst
# bei jedem Lauf die Argumentgrenze, und die Sitzungsdatei wuerde nie mehr erneuert.
# Nur bei einer UUID als session_id (sonst keine Datei: kein fremder Pfad ueber den Dateinamen).
# Atomar (mktemp im selben Ordner, dann mv), kein Byte nach stdout, Fehler brechen nichts.
sdir="$cockpit_dir/sessions"
sess_old=""
if [ -n "$sid" ]; then sess_old=$(head -c 4096 "$sdir/$sid.json" 2>/dev/null); fi
sess=$(echo "$input" | jq -c --argjson now "$now" --arg uuid "$uuid_re" --arg old "$sess_old" \
  --argjson obs_slack "$OBS_SLACK" "$def_gilt"'
  (.session_id // null) as $id
  | select(($id | type) == "string" and ($id | test($uuid)))
  | (.context_window.current_usage // {}) as $u
  | (if (.cost | type) == "object" then .cost.total_api_duration_ms else null end) as $m
  | ($old | try fromjson catch null) as $v
  | (if ($v | type) == "object" and ($v.api_at | gilt) then $v.api_at else null end) as $v_at
  | {session_id: $id, written_at: $now,
     context_tokens: (($u.input_tokens // 0) + ($u.cache_creation_input_tokens // 0) + ($u.cache_read_input_tokens // 0)),
     used_percentage: (.context_window.used_percentage // 0),
     model: (.model.display_name // "?"),
     api_ms: (if ($m | type) == "number" then $m else null end),
     api_at: (if ($m | type) != "number" then null
              elif ($v | type) != "object" or $v.session_id != $id or ($v.api_ms | type) != "number" then null
              elif $m > $v.api_ms then
                # Nicht frueher als der vorige Stempel, weil Claude Code aeltere Header-Staende verwirft (isStaleObservation, 2.1.312); der gezeigte Stand einer Sitzung wird nie aelter
                (($now - (($m - $v.api_ms) / 1000 | floor)) as $t | if $v_at != null and $v_at > $t then $v_at else $t end)
              elif $m < $v.api_ms then null
              else $v_at end)}' 2>/dev/null)
# Die Unterschale meldet jeden Fehlerweg mit Exit ungleich 0; nur eine geschriebene Datei liefert api_at weiter
sess_ok=""
if [ -n "$sid" ] && [ -n "$sess" ] && (
    mkdir -p "$sdir" || exit 1
    tmp=$(mktemp "$sdir/.session.XXXXXX") || exit 1
    if printf '%s\n' "$sess" > "$tmp" && mv -f "$tmp" "$sdir/$sid.json"; then exit 0; fi
    rm -f "$tmp"
    exit 1
  ) >/dev/null 2>&1; then
  sess_ok="$sess"
fi

merged_limits=""
if [ "$kopf_rl" = "true" ]; then
  usage_old=$(cat "$HOME/.claude/cockpit/usage.json" 2>/dev/null)
  merged_limits=$(echo "$input" | jq -c --arg old "$usage_old" --arg sess "$sess_ok" --argjson slack "$WINDOW_SLACK" \
    --argjson now "$now" --argjson len5 "$WINDOW_LEN_5H" --argjson lenmax "$WINDOW_LEN_MAX" \
    --argjson drop_min "$DROP_MIN" --argjson obs_slack "$OBS_SLACK" "$def_gilt"'
    def gueltig: type == "object" and (.resets_at | type) == "number";
    def zu_spaet($k): .resets_at > $now + (if $k == "five_hour" then $len5 else $lenmax end) + $slack;
    def pct: if type == "object" and (.used_percentage | type) == "number" then .used_percentage else null end;
    def obs: if type == "object" and (.observed_at | gilt) then .observed_at else null end;
    def mit_obs($t): if type != "object" then . elif $t == null then del(.observed_at) else .observed_at = $t end;
    .rate_limits as $e
    | (($sess | try fromjson catch null)
       | if type == "object" and (.api_at | type) == "number" then .api_at else null end) as $e_at
    | (($old | try fromjson catch null)
       | if type == "object" and (.rate_limits | type) == "object" then .rate_limits else {} end) as $d
    | ($e | keys_unsorted) as $ke
    | ($ke + (($d | keys_unsorted) - $ke)) as $keys
    | reduce $keys[] as $k ({};
        ($e[$k]) as $ev | ($d[$k]) as $dv | ($dv | obs) as $d_at
        | if ($dv | gueltig | not) or ($dv | zu_spaet($k)) then (if ($e | has($k)) then .[$k] = ($ev | mit_obs($e_at)) else . end)
          elif ($ev | gueltig | not) then .[$k] = ($dv | mit_obs($d_at))
          elif ($ev.resets_at - $dv.resets_at) > $slack then .[$k] = ($ev | mit_obs($e_at))
          elif ($dv.resets_at - $ev.resets_at) > $slack then .[$k] = ($dv | mit_obs($d_at))
          else
            ($ev | pct) as $ep | ($dv | pct) as $dp
            | (if $e_at != null and ($d_at == null or $e_at > $d_at) then "eigen"
               elif $d_at != null and ($e_at == null or $d_at > $e_at) then "datei"
               else null end) as $juenger
            | ([$e_at, $d_at] | map(numbers) | max) as $spaetest
            | (if $juenger == "eigen" and $ep != null and $dp != null and $dp - $ep >= $drop_min then $ev
               elif $juenger == "datei" and $ep != null and $dp != null and $ep - $dp >= $drop_min then $dv
               elif $dp > $ep then $dv
               else $ev end) as $w
            | .[$k] = ($w | mit_obs($spaetest))
          end)' 2>/dev/null)
  # Zusammenfuehren gescheitert (etwa eine Datei, die die Argumentgrenze sprengt): eigener Stand, Regel 1
  if [ -z "$merged_limits" ]; then
    merged_limits=$(echo "$input" | jq -c '.rate_limits' 2>/dev/null)
  fi
  if [ -n "$merged_limits" ]; then
    (
      dir="$HOME/.claude/cockpit"
      mkdir -p "$dir" || exit 0
      tmp=$(mktemp "$dir/.usage.json.XXXXXX") || exit 0
      if printf '{"written_at":%s,"rate_limits":%s}\n' "$(date +%s)" "$merged_limits" > "$tmp"; then
        mv -f "$tmp" "$dir/usage.json" || rm -f "$tmp"
      else
        rm -f "$tmp"
      fi
    ) >/dev/null 2>&1
  fi
fi

# Schwellen aus dem Plugin; fehlt die Datei oder ist sie unbrauchbar, gelten CTX_WARN und CTX_HANDOFF
thresholds=$(cat "$cockpit_dir/thresholds.json" 2>/dev/null)
# Tagessumme des Plugins; fehlt die Datei, bleibt der Text leer und jq laesst den Teil weg
tokens_today=$(cat "$cockpit_dir/tokens-today.json" 2>/dev/null)

# Rechnen in jq statt printf: printf scheitert unter deutscher Locale an "1.5"
echo "$input" | jq -j \
  --argjson now "$now" \
  --arg tt "$tokens_today" --arg th "$thresholds" --arg ml "$merged_limits" \
  --argjson py "$PCT_YELLOW" --argjson pr "$PCT_RED" \
  --argjson ctx_warn_std "$CTX_WARN" --argjson ctx_handoff_std "$CTX_HANDOFF" \
  --argjson margin "$TEMPO_MARGIN" --argjson five_warn "$FIVE_HOUR_WARN" \
  --argjson stale "$TOKENS_STALE" --argjson obs_slack "$OBS_SLACK" '
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

  # zusammengefuehrter Stand (Nachtrag 43d); ohne ihn (leer) der eigene
  | (($ml | try fromjson catch null) // .rate_limits) as $rl
  | ($rl.five_hour // null) as $f0
  | ($rl.seven_day // null) as $w
  # Nachtrag 44a, gleichlautend mit dropDeadFiveHour (src/core/usage.ts): abgelaufenes 5h-Fenster ohne Nachfolger
  # gilt als nicht vorhanden, wenn die Woche nach seinem Reset beobachtet wurde (observed_at hoechstens jetzt + OBS_SLACK)
  | (if ($f0 | type) == "object" and ($f0.resets_at | type) == "number" and $f0.resets_at <= $now
        and ($w | type) == "object" and ($w.observed_at | type) == "number"
        and $w.observed_at <= $now + $obs_slack and $w.observed_at > $f0.resets_at
     then null else $f0 end) as $f
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

  # Nachtrag 44c: Effort der Sitzung hinter dem Modell, wenn Claude Code ihn liefert (effort.level, gemessen 2.1.322).
  # Nur ein kurzes Wort aus Buchstaben, Ziffern, "_" und "-", sonst nichts (kein Steuerzeichen ins Terminal).
  | (if (.effort | type) == "object" and (.effort.level | type) == "string"
        and (.effort.level | test("\\A[A-Za-z0-9_-]{1,16}\\z"))
     then " · " + .effort.level else "" end) as $effort

  | (dim + "\(.model.display_name // "?")" + $effort + " │ " + $ctx + $five + $heute + rs) as $zeile1

  | (if ($w | type) == "object" and ($w.used_percentage | type) == "number" and ($w.resets_at | type) == "number"
     then
       ($w.used_percentage | round) as $wp
       | (if ($w.resets_at - $now) <= 0 then dim + "Woche zurückgesetzt" + rs
          else
            (((($now - ($w.resets_at - 604800)) / 604800 * 100) | round) | clamp(0; 100)) as $zp
            | (($wp / 10 | round) | clamp(0; 10)) as $n
            | (([range($n) | "▓"] | join("")) + ([range(10 - $n) | "░"] | join(""))) as $balken
            | (if $fp != null and $frest > 0 and $fp >= $five_warn then red + "5h fast voll, kurz warten" + dim
               elif ($wp - $zp) > $margin then yellow + "zu schnell" + dim
               else "im Plan" end) as $rat
            | dim + "Woche \($balken) " + ampel($wp) + "\($wp)%" + dim + " · Zeit \($zp)% · " + $rat + rs
          end)
     else null end) as $zeile2

  | $zeile1 + (if $zeile2 != null then "\n" + $zeile2 else "" end)
'
