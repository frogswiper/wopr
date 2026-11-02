#!/usr/bin/env bash
# Update W.O.P.R. to the newest version on GitHub (Linux / macOS).
#   curl -fsSL https://raw.githubusercontent.com/frogswiper/wopr/main/update.sh | bash
#   wopr --update
#
# The new version is downloaded next to the installed one (~/.local/share/wopr/staged). If W.O.P.R. is
# not running it is switched in at once; otherwise it takes over the next time W.O.P.R. starts.
# `update.sh --stage` only downloads: the launcher runs it in the background at every start
# (turn that off with WOPR_AUTO_UPDATE=0 in ~/.config/wopr/wopr.env).
set -euo pipefail

REPO="frogswiper/wopr"
BRANCH="${WOPR_BRANCH:-main}"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/wopr"
APP="$DATA/app"
STAGED="$DATA/staged"
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/wopr/wopr.env"
MODE="${1:-}"
if [ -f "$CONF" ]; then set -a; . "$CONF"; set +a; fi
PORT="${WOPR_PORT:-1983}"

say() { [ "$MODE" = --stage ] && echo "$(date '+%F %T') $*" || printf '> %s\n' "$*"; }

if [ ! -f "$APP/server.js" ]; then
  say "W.O.P.R. is not installed in $APP. Install it with:"
  say "  curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash"
  exit 1
fi

cur="$(cat "$APP/.version" 2>/dev/null || echo none)"
latest="$(curl -fsSL --max-time 20 -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/$BRANCH" 2>/dev/null || true)"
if ! printf '%s' "$latest" | grep -qE '^[0-9a-f]{40}$'; then
  say "could not reach GitHub - try again later"
  exit 0
fi
if [ "$latest" = "$cur" ]; then
  say "W.O.P.R. is up to date (${cur:0:7})"
  rm -rf "$STAGED"
  exit 0
fi

if [ "$(cat "$STAGED/.version" 2>/dev/null)" != "$latest" ]; then
  say "downloading ${latest:0:7} (installed: ${cur:0:7})"
  mkdir -p "$DATA"
  tmp="$(mktemp -d "$DATA/.download.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --max-time 300 "https://codeload.github.com/$REPO/tar.gz/$latest" | tar -xz --strip-components=1 -C "$tmp"
  [ -f "$tmp/server.js" ] || { say "download was incomplete - nothing changed"; exit 1; }
  chmod +x "$tmp/wopr" "$tmp/update.sh" 2>/dev/null || true
  echo "$latest" > "$tmp/.version"
  rm -rf "$STAGED"
  mv "$tmp" "$STAGED"
  trap - EXIT
fi

if [ "$MODE" != --stage ] && ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/wopr.json"; then
  rm -rf "$DATA/app.old"
  mv "$APP" "$DATA/app.old" && mv "$STAGED" "$APP" && rm -rf "$DATA/app.old"
  say "W.O.P.R. updated to ${latest:0:7}"
else
  say "version ${latest:0:7} is ready - it takes over the next time W.O.P.R. starts"
fi
