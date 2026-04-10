# FlowDeck shell integration for zsh
# Emits OSC 7 on directory change so the tab title stays in sync.

# ── Restore original ZDOTDIR ──
if [ -n "$FLOWDECK_ORIGINAL_ZDOTDIR" ]; then
  ZDOTDIR="$FLOWDECK_ORIGINAL_ZDOTDIR"
  unset FLOWDECK_ORIGINAL_ZDOTDIR
else
  unset ZDOTDIR
fi

# Source the user's real .zshenv
if [ -r "${ZDOTDIR:-$HOME}/.zshenv" ]; then
  source "${ZDOTDIR:-$HOME}/.zshenv"
fi

# ── OSC 7 reporting ──
__flowdeck_report_cwd() {
  local url_path=''
  local i ch hexch LC_CTYPE=C LC_COLLATE=C LC_ALL= LANG=
  for ((i = 1; i <= ${#PWD}; ++i)); do
    ch="$PWD[i]"
    if [[ "$ch" =~ [/._~A-Za-z0-9-] ]]; then
      url_path+="$ch"
    else
      printf -v hexch "%02X" "'$ch"
      url_path+="%$hexch"
    fi
  done
  printf '\e]7;file://%s%s\a' "$HOST" "$url_path"
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd __flowdeck_report_cwd
add-zsh-hook chpwd __flowdeck_report_cwd
