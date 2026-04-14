# FlowDeck shell integration for bash
# Emits OSC 7 on directory change so the tab title stays in sync.

# Source the user's profile/rc files
if [ -r ~/.bash_profile ]; then
  source ~/.bash_profile
elif [ -r ~/.bash_login ]; then
  source ~/.bash_login
elif [ -r ~/.profile ]; then
  source ~/.profile
fi
if [ -r ~/.bashrc ]; then
  source ~/.bashrc
fi

# ── OSC 7 reporting ──
__flowdeck_report_cwd() {
  printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"
}
PROMPT_COMMAND="__flowdeck_report_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
