#!/bin/bash
# Claude Code Statusline: Modell, Kontext in k-Tokens und Prozent, HANDOFF ab 150k
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

model=$(echo "$input" | jq -r '.model.display_name')
# Kontext = aktueller Prompt inkl. Cache aus current_usage, nicht total_input_tokens
tokens=$(echo "$input" | jq -r '.context_window.current_usage | (.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)')
# Runden in jq statt printf: printf scheitert unter deutscher Locale an "1.5"
pct_int=$(echo "$input" | jq -r '(.context_window.used_percentage // 0) | round')

ktok=$(( tokens / 1000 ))

DIM='\033[2m'
RESET='\033[0m'
BOLD_RED='\033[1;31m'

if [ "$tokens" -ge 150000 ]; then
  printf "${DIM}%s | %dk tokens (%d%%)${RESET} ${BOLD_RED}HANDOFF${RESET}" "$model" "$ktok" "$pct_int"
else
  printf "${DIM}%s | %dk tokens (%d%%)${RESET}" "$model" "$ktok" "$pct_int"
fi
