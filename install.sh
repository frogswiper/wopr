#!/usr/bin/env bash
# W.O.P.R. installer
#   curl -fsSL https://raw.githubusercontent.com/frogswiper/wopr/main/install.sh | bash
#
# 1. installs Ollama if it is not present (official ollama.com installer)
# 2. makes sure the Ollama server is running
# 3. signs in to ollama.com (needed for cloud models)
# 4. finds the newest GLM cloud model on ollama.com and pulls it (e.g. glm-5.3:cloud)
# 5. installs the espeak-ng voice synthesizer (Joshua's voice) if it is missing
# 6. installs Node.js locally if missing/too old, downloads W.O.P.R., adds a launcher + menu entry
# 7. starts W.O.P.R. full screen
#
# Env overrides: WOPR_MODEL=<name:tag>  WOPR_PORT=1983  WOPR_NO_LAUNCH=1  WOPR_NO_ESPEAK=1  WOPR_BRANCH=main
set -euo pipefail

REPO="frogswiper/wopr"
BRANCH="${WOPR_BRANCH:-main}"
FALLBACK_MODEL="glm-5.3:cloud"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/wopr"
APP="$DATA/app"
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/wopr"
BIN="${WOPR_BIN:-$HOME/.local/bin}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"

blu=$'\e[36m'; hi=$'\e[1;97m'; dim=$'\e[2m'; off=$'\e[0m'
say()  { printf '%s>%s %s\n' "$hi" "$off" "$*"; }
ok()   { printf '  %s... OK%s %s\n' "$blu" "$off" "$*"; }
die()  { printf '%sERROR:%s %s\n' "$hi" "$off" "$*" >&2; exit 1; }

# Interactive steps (ollama signin, sudo) need the terminal even when piped from curl.
TTY=/dev/tty; { : < /dev/tty; } 2>/dev/null || TTY=/dev/null

printf '%s' "$blu"
cat <<'BANNER'
  __        __    ___     ____     ____
  \ \      / /   / _ \   |  _ \   |  _ \
   \ \ /\ / /   | | | |  | |_) |  | |_) |
    \ V  V /  _ | |_| |_ |  __/ _ |  _ < _
     \_/\_/  (_) \___/(_)|_|   (_)|_| \_(_)
BANNER
printf '%s  WAR OPERATION PLAN RESPONSE  //  NORAD  //  INSTALLER%s\n\n' "$dim" "$off"

[ "$(id -u)" = 0 ] && die "run as your normal user, not root (sudo is used only where needed)"
command -v curl >/dev/null || die "curl is required"
command -v tar  >/dev/null || die "tar is required"

OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS" in Linux) os=linux ;; Darwin) os=darwin ;; *) die "unsupported OS: $OS" ;; esac
case "$ARCH" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) die "unsupported CPU: $ARCH" ;; esac

# ---------- 1. Ollama ----------
say "CHECKING OLLAMA RUNTIME"
if command -v ollama >/dev/null; then
  ok "$(ollama --version 2>/dev/null | head -1)"
else
  say "OLLAMA NOT FOUND - INSTALLING FROM ollama.com"
  if [ "$os" = darwin ] && command -v brew >/dev/null; then
    brew install ollama
  else
    oi="$(mktemp)"
    curl -fsSL https://ollama.com/install.sh -o "$oi"
    sh "$oi" < "$TTY"
    rm -f "$oi"
  fi
  hash -r
  command -v ollama >/dev/null || die "Ollama install failed"
  ok "$(ollama --version 2>/dev/null | head -1)"
fi

# ---------- 2. Ollama server ----------
say "DIALING $OLLAMA_URL"
if ! curl -fs -o /dev/null "$OLLAMA_URL/api/version"; then
  if command -v systemctl >/dev/null && systemctl list-unit-files ollama.service >/dev/null 2>&1; then
    sudo systemctl start ollama < "$TTY" || true
  fi
  if ! curl -fs -o /dev/null "$OLLAMA_URL/api/version"; then
    mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}"
    nohup ollama serve > "${XDG_CACHE_HOME:-$HOME/.cache}/ollama-serve.log" 2>&1 &
  fi
  for _ in $(seq 50); do curl -fs -o /dev/null "$OLLAMA_URL/api/version" && break; sleep 0.2; done
fi
curl -fs -o /dev/null "$OLLAMA_URL/api/version" || die "Ollama server is not answering on $OLLAMA_URL"
ok "CONNECT 1200"

# ---------- 3. Sign in ----------
say "LOGON: ollama.com (cloud models need an account)"
printf '  %sIf a link is shown, open it in a browser, approve, and this continues.%s\n' "$dim" "$off"
ollama signin < "$TTY" || die "ollama signin failed - run 'ollama signin' and re-run this installer"
ok "IDENTIFICATION ACCEPTED"

# ---------- 4. Newest GLM cloud model ----------
say "LOCATING NEWEST GLM CLOUD STRATEGY MODULE"
if [ -n "${WOPR_MODEL:-}" ]; then
  MODEL="$WOPR_MODEL"
else
  latest="$(curl -fsSL "https://ollama.com/search?c=cloud&q=glm" 2>/dev/null \
    | grep -oE 'href="/library/glm-[0-9]+(\.[0-9]+)*"' \
    | sed -E 's#.*/library/##; s/"$//' | sort -u -V | tail -1 || true)"
  MODEL="${latest:+$latest:cloud}"
  MODEL="${MODEL:-$FALLBACK_MODEL}"
fi
ok "$MODEL"
say "PULLING $MODEL"
if ! ollama pull "$MODEL" < /dev/null; then
  [ "$MODEL" = "$FALLBACK_MODEL" ] && die "could not pull $MODEL"
  say "PULL FAILED - FALLING BACK TO $FALLBACK_MODEL"
  MODEL="$FALLBACK_MODEL"
  ollama pull "$MODEL" < /dev/null || die "could not pull $MODEL"
fi
ok "MODULE READY"

# ---------- 5. Voice synthesizer ----------
say "CHECKING VOICE SYNTHESIZER"
ESPEAK=""
if command -v espeak-ng >/dev/null; then ESPEAK="$(command -v espeak-ng)"
elif command -v espeak >/dev/null; then ESPEAK="$(command -v espeak)"
elif [ -x "$DATA/bin/espeak-ng" ] && "$DATA/bin/espeak-ng" --version >/dev/null 2>&1; then ESPEAK="$DATA/bin/espeak-ng"
fi
if [ -z "$ESPEAK" ] && [ "$os" = linux ] && [ -z "${WOPR_NO_ESPEAK:-}" ]; then
  # Most Linux desktops already carry libespeak-ng (speech-dispatcher pulls it in); only the small
  # command-line tool is missing. Unpack it from the distro package without sudo when that is the case.
  if command -v apt-get >/dev/null && command -v dpkg-deb >/dev/null && ls /usr/lib/*/libespeak-ng.so.1 /usr/lib/libespeak-ng.so.1 >/dev/null 2>&1; then
    td="$(mktemp -d)"
    if (cd "$td" && apt-get download espeak-ng >/dev/null 2>&1) && dpkg-deb -x "$td"/espeak-ng_*.deb "$td/x" 2>/dev/null; then
      mkdir -p "$DATA/bin"; cp "$td/x/usr/bin/espeak-ng" "$DATA/bin/espeak-ng"; chmod 755 "$DATA/bin/espeak-ng"
      "$DATA/bin/espeak-ng" --version >/dev/null 2>&1 && ESPEAK="$DATA/bin/espeak-ng"
    fi
    rm -rf "$td"
  fi
  if [ -z "$ESPEAK" ]; then
    say "INSTALLING espeak-ng (sudo)"
    if command -v apt-get >/dev/null; then sudo apt-get install -y espeak-ng < "$TTY" || true
    elif command -v dnf >/dev/null; then sudo dnf install -y espeak-ng < "$TTY" || true
    elif command -v pacman >/dev/null; then sudo pacman -S --noconfirm espeak-ng < "$TTY" || true
    elif command -v zypper >/dev/null; then sudo zypper --non-interactive install espeak-ng < "$TTY" || true
    fi
    hash -r
    command -v espeak-ng >/dev/null && ESPEAK="$(command -v espeak-ng)"
  fi
fi
if [ -n "$ESPEAK" ]; then ok "$ESPEAK"
elif [ "$os" = darwin ]; then ok "macOS say (voice: Fred)"
else ok "espeak-ng not installed - Joshua will use the browser's speech instead"; fi

# ---------- 6. Node.js ----------
say "CHECKING NODE.JS (18+)"
NODE_BIN=""
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ]; then
  NODE_BIN="$(command -v node)"
  ok "system node $(node --version)"
else
  base="https://nodejs.org/dist/latest-v22.x"
  file="$(curl -fsSL "$base/SHASUMS256.txt" | awk -v p="-$os-$arch.tar.gz" '$2 ~ p"$" {print $2; exit}')"
  [ -n "$file" ] || die "could not find a Node.js build for $os-$arch"
  sum="$(curl -fsSL "$base/SHASUMS256.txt" | awk -v f="$file" '$2==f {print $1}')"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  say "DOWNLOADING $file"
  curl -fsSL "$base/$file" -o "$tmp/$file"
  if command -v sha256sum >/dev/null; then got="$(sha256sum "$tmp/$file" | cut -d' ' -f1)"
  else got="$(shasum -a 256 "$tmp/$file" | cut -d' ' -f1)"; fi
  [ "$got" = "$sum" ] || die "Node.js checksum mismatch"
  rm -rf "$DATA/node"; mkdir -p "$DATA/node"
  tar -xzf "$tmp/$file" -C "$DATA/node" --strip-components=1
  NODE_BIN="$DATA/node/bin/node"
  ok "private node $("$NODE_BIN" --version) in $DATA/node"
fi

# ---------- 7. W.O.P.R. ----------
say "DOWNLOADING W.O.P.R. ($REPO@$BRANCH)"
tmpapp="$(mktemp -d)"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz --strip-components=1 -C "$tmpapp"
[ -f "$tmpapp/server.js" ] || die "download did not contain server.js"
rm -rf "$APP"; mkdir -p "$DATA"; mv "$tmpapp" "$APP"; chmod +x "$APP/wopr"
ok "$APP"

mkdir -p "$CONF_DIR"
{
  echo "# Written by the W.O.P.R. installer. Edit and restart W.O.P.R. to change."
  echo "WOPR_MODEL=$MODEL"
  echo "WOPR_NODE=$NODE_BIN"
  echo "OLLAMA_URL=$OLLAMA_URL"
  if [ -n "$ESPEAK" ]; then echo "WOPR_TTS=$ESPEAK"; fi
  if [ -n "${WOPR_PORT:-}" ]; then echo "WOPR_PORT=$WOPR_PORT"; fi
} > "$CONF_DIR/wopr.env"
ok "config $CONF_DIR/wopr.env"

mkdir -p "$BIN"; ln -sf "$APP/wopr" "$BIN/wopr"
ok "launcher $BIN/wopr"
if [ "$os" = linux ]; then
  apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"; mkdir -p "$apps"
  cat > "$apps/wopr.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=W.O.P.R.
Comment=Shall we play a game? NORAD war-room terminal for Ollama
Exec=$APP/wopr
Icon=$APP/public/emblem.svg
Terminal=false
Categories=Utility;Game;
EOF
  ok "menu entry W.O.P.R."
fi

# A server from a previous install may still be running with the old settings; restart it.
port="${WOPR_PORT:-1983}"
if curl -fs -o /dev/null "http://127.0.0.1:$port/wopr.json"; then
  pkill -f "$APP/server.js" 2>/dev/null || true
fi

echo
say "W.O.P.R. INSTALLED.  SHALL WE PLAY A GAME?"
printf '  start it any time with %swopr%s (or the W.O.P.R. menu entry). Press Esc to log off.\n' "$hi" "$off"
case ":$PATH:" in *":$BIN:"*) ;; *) printf '  %s(%s is not on your PATH - run %s/wopr)%s\n' "$dim" "$BIN" "$BIN" "$off" ;; esac

if [ -z "${WOPR_NO_LAUNCH:-}" ]; then
  "$APP/wopr" >/dev/null 2>&1 || true
fi
