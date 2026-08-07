#!/usr/bin/env bash
# Brand Studio installer.
#
#   curl -fsSL https://raw.githubusercontent.com/HourglassDigital/brand-studio/main/install.sh | bash
#
# Written for someone who has never opened a terminal. It installs everything itself
# (Node.js, a browser to render with, Claude Code, the plugin) and stays quiet while
# things go well: one tick per item, then the two things to type. It only becomes
# wordy when something genuinely needs them to act.
#
# Nothing here uses sudo. Node goes into the user's own home directory, so there is
# no password prompt, which matters because piping this to bash leaves no terminal
# for sudo to ask at. Bash 3.2 compatible, so it runs on a stock macOS.

set -u

REPO="HourglassDigital/brand-studio"
MARKETPLACE="hourglass"
PLUGIN="brand-studio"
NODE_HOME="$HOME/.local/share/brand-studio/node"
BIN_DIR="$HOME/.local/bin"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; D=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; X=$'\033[0m'
else
  B=""; D=""; G=""; Y=""; R=""; C=""; X=""
fi

ok()   { printf '  %s✓%s %s\n' "$G" "$X" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$X" "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

# One job: name the single thing they must do, then stop. Never leave them staring
# at a half-finished install wondering whether it worked.
die() {
  printf '\n  %s✗ %s%s\n\n' "$R" "$1" "$X"
  shift
  for line in "$@"; do printf '    %s\n' "$line"; done
  printf '\n  %sNothing was left half-installed. Sort that out, then run this again.%s\n\n' "$D" "$X"
  exit 1
}

printf '\n  %sBrand Studio%s %sby Hourglass AI%s\n\n' "$B" "$X" "$D" "$X"

have curl || die "This needs curl, which is missing from your system." \
    "On Mac it is built in, so this usually means something unusual about your setup." \
    "Send this message to Hourglass and we will sort it out."

# --- Node.js -----------------------------------------------------------------
# Installed from Node's own published binaries, verified against their published
# checksum, straight into the user's home directory. No sudo, no Homebrew, and no
# Xcode Command Line Tools download.
node_ok() {
  have node && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ] 2>/dev/null
}

install_node() {
  local os arch ver url tmp want got exe
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux)  os=linux ;;
    *) die "Brand Studio needs a Mac or Linux machine." "Yours reports $(uname -s)." ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64)  arch=x64 ;;
    *) die "Unrecognised processor type ($(uname -m))." "Install Node.js yourself: https://nodejs.org" ;;
  esac

  # Latest LTS, read from Node's release index with text tools: there is no node
  # yet to parse JSON with.
  ver=$(curl -fsSL https://nodejs.org/dist/index.json 2>/dev/null \
        | tr '}' '\n' | grep -m1 '"lts":"' | sed -E 's/.*"version":"(v[^"]+)".*/\1/')
  [ -n "$ver" ] || die "Could not reach nodejs.org." \
      "Check you are connected to the internet, then run this again."

  url="https://nodejs.org/dist/$ver/node-$ver-$os-$arch.tar.gz"
  tmp=$(mktemp -d) || die "Could not create a temporary folder."
  curl -fsSL "$url" -o "$tmp/node.tar.gz" || { rm -rf "$tmp"
    die "Downloading Node.js failed." "Check your internet connection, then run this again."; }

  # Verify against Node's published checksum before unpacking.
  want=$(curl -fsSL "https://nodejs.org/dist/$ver/SHASUMS256.txt" 2>/dev/null \
         | grep "node-$ver-$os-$arch.tar.gz" | awk '{print $1}')
  if [ -n "$want" ]; then
    if have shasum; then got=$(shasum -a 256 "$tmp/node.tar.gz" | awk '{print $1}')
    elif have sha256sum; then got=$(sha256sum "$tmp/node.tar.gz" | awk '{print $1}')
    else got="$want"; fi
    [ "$got" = "$want" ] || { rm -rf "$tmp"
      die "The Node.js download did not match its published checksum." \
          "That usually means the download was interrupted. Run this again."; }
  fi

  rm -rf "$NODE_HOME"
  mkdir -p "$NODE_HOME" "$BIN_DIR" || { rm -rf "$tmp"; die "Could not write to $HOME/.local."; }
  tar -xzf "$tmp/node.tar.gz" -C "$NODE_HOME" --strip-components=1 \
    || { rm -rf "$tmp"; die "Could not unpack Node.js."; }
  rm -rf "$tmp"

  # Put node/npm/npx beside the `claude` launcher, which is already on PATH.
  for exe in node npm npx; do
    [ -e "$NODE_HOME/bin/$exe" ] && ln -sf "$NODE_HOME/bin/$exe" "$BIN_DIR/$exe"
  done
  case ":$PATH:" in *":$BIN_DIR:"*) : ;; *) PATH="$BIN_DIR:$PATH"; export PATH ;; esac
}

# Keep that directory on PATH in future shells too, so the plugin can still find
# node long after this script exits.
persist_path() {
  local f
  case "${SHELL:-}" in
    *zsh)  f="$HOME/.zshrc" ;;
    *bash) f="$HOME/.bashrc" ;;
    *)     f="$HOME/.profile" ;;
  esac
  [ -f "$f" ] || touch "$f"
  grep -qF '.local/bin' "$f" 2>/dev/null && return 0
  printf '\n# Added by Brand Studio so it can find Node.js\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$f"
}

if node_ok; then
  ok "Node.js"
else
  if have node; then warn "Updating Node.js (yours is $(node -v), too old to draw graphics)..."
  else warn "Installing Node.js (needed to draw your graphics, about 50MB)..."; fi
  install_node
  persist_path
  node_ok || die "Node.js installed, but this window cannot see it yet." \
      "Close this window, open a new one, and run this again."
  ok "Node.js $(node -v)"
fi

# --- git ---------------------------------------------------------------------
# Needed to fetch the plugin. On a fresh Mac this is missing until the Command Line
# Tools are installed, and without it the plugin step fails with a confusing error.
if have git; then
  ok "git"
else
  if [ "$(uname -s)" = "Darwin" ]; then
    warn "Asking macOS to install its developer tools (needed to download Brand Studio)..."
    xcode-select --install >/dev/null 2>&1 || true
    die "macOS should have opened a window asking to install the Command Line Tools." \
        "Click Install, wait for it to finish (a few minutes), then run this again." \
        "If no window appeared, install git yourself from https://git-scm.com"
  fi
  die "git is missing, and it is needed to download Brand Studio." \
      "Install it with your package manager, for example: sudo apt install git"
fi

# --- a browser to render into ------------------------------------------------
# render.mjs looks in the Playwright cache before /Applications, so we can supply a
# browser without touching /Applications or asking for an admin password.
CHROME=""
for p in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/usr/bin/google-chrome" "/usr/bin/chromium" "/usr/bin/chromium-browser"; do
  [ -x "$p" ] && CHROME="$p" && break
done
for cache in "$HOME/Library/Caches/ms-playwright" "$HOME/.cache/ms-playwright"; do
  [ -n "$CHROME" ] && break
  [ -d "$cache" ] && [ -n "$(ls -A "$cache" 2>/dev/null)" ] && CHROME="cached"
done

if [ -n "$CHROME" ]; then
  ok "A browser to draw with"
else
  warn "Setting up a browser to draw your graphics with (about 150MB, one time)..."
  if npx --yes playwright install chromium >/dev/null 2>&1; then
    ok "A browser to draw with"
  else
    # Not fatal: Chrome can be installed later and everything else still works.
    warn "That did not finish. Install Chrome before your first post: https://google.com/chrome"
  fi
fi

# --- Claude Code -------------------------------------------------------------
RESTART=0
if have claude; then
  ok "Claude Code"
else
  warn "Installing Claude Code (the app Brand Studio runs inside)..."
  curl -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1 \
    || die "Claude Code could not be installed automatically." \
           "Install it here: https://code.claude.com/docs/en/setup" "Then run this again."
  case ":$PATH:" in *":$BIN_DIR:"*) : ;; *) PATH="$BIN_DIR:$PATH"; export PATH ;; esac
  have claude || die "Claude Code installed, but this window cannot see it yet." \
      "Close this window, open a new one, and run this again."
  ok "Claude Code"
  RESTART=1
fi

# --- the plugin --------------------------------------------------------------
# Both steps treat "already there" as success, so re-running is always safe.
if ! claude plugin marketplace add "$REPO" >/dev/null 2>&1; then
  claude plugin marketplace list 2>/dev/null | grep -q "$MARKETPLACE" \
    || die "Could not download Brand Studio." \
           "Check you are connected to the internet, then run this again."
fi
if ! claude plugin install "${PLUGIN}@${MARKETPLACE}" >/dev/null 2>&1; then
  claude plugin list 2>/dev/null | grep -q "$PLUGIN" \
    || die "Brand Studio could not be installed." \
           "Run this and send Hourglass what it says:" \
           "claude plugin install ${PLUGIN}@${MARKETPLACE}"
fi
ok "Brand Studio"

# --- what to do next ---------------------------------------------------------
printf '\n  %sReady.%s ' "$G$B" "$X"
if [ "$RESTART" = "1" ]; then
  printf 'Close this window and open a new one, then:\n\n'
else
  printf 'Two things to type:\n\n'
fi
printf '    %sclaude%s            %s(starts it up)%s\n' "$C" "$X" "$D" "$X"
printf '    %s/create-brand%s     %s(then this, once it has started)%s\n\n' "$C" "$X" "$D" "$X"
printf '  %sIt asks a few questions and does the rest. Have 2-3 screenshots of posts%s\n' "$D" "$X"
printf '  %syou like the look of ready. You will be asked to sign in (needs Claude Pro).%s\n\n' "$D" "$X"
