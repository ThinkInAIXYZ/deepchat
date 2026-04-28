#!/usr/bin/env bash
# cua-driver installer — download the latest signed + notarized tarball
# from GitHub Releases, move CuaDriver.app to /Applications, and symlink
# the `cua-driver` binary into /usr/local/bin so shell users can invoke
# it without typing the bundle path.
#
# Usage (from README + release body):
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"
#
# Override the release tag with $CUA_DRIVER_VERSION:
#   CUA_DRIVER_VERSION=0.1.0 /bin/bash -c "$(curl -fsSL .../install.sh)"
#
# Skip the auto-updater setup:
#   CUA_DRIVER_NO_UPDATER=1 /bin/bash -c "$(curl -fsSL .../install.sh)"
#
# Uninstall:
#   sudo rm -rf /Applications/CuaDriver.app /usr/local/bin/cua-driver
set -euo pipefail

REPO="trycua/cua"
APP_NAME="CuaDriver.app"
BINARY_NAME="cua-driver"
TAG_PREFIX="cua-driver-v"
APP_DEST="/Applications/$APP_NAME"
BIN_LINK="/usr/local/bin/$BINARY_NAME"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

# Whether to install the auto-updater (default: true)
INSTALL_AUTO_UPDATER="${CUA_DRIVER_NO_UPDATER:-0}"
if [[ "$INSTALL_AUTO_UPDATER" == "1" ]]; then
    INSTALL_AUTO_UPDATER=false
else
    INSTALL_AUTO_UPDATER=true
fi

log() { printf '==> %s\n' "$*"; }
err() { printf 'error: %s\n' "$*" >&2; }

# --- Sanity checks ------------------------------------------------------

if [[ "$(uname -s)" != "Darwin" ]]; then
    err "cua-driver is macOS-only; uname reports $(uname -s)"
    exit 1
fi

for cmd in curl tar; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        err "$cmd not found on PATH"
        exit 1
    fi
done

# --- Resolve release tag ------------------------------------------------

if [[ -n "${CUA_DRIVER_VERSION:-}" ]]; then
    TAG="${TAG_PREFIX}${CUA_DRIVER_VERSION#v}"
    log "using version from CUA_DRIVER_VERSION: $TAG"
else
    log "resolving latest $TAG_PREFIX* release via GitHub API"
    TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=40" \
        | grep -Eo '"tag_name":[[:space:]]*"'"${TAG_PREFIX}"'[^"]+"' \
        | head -n 1 \
        | sed -E 's/.*"'"${TAG_PREFIX}"'([^"]+)"/'"${TAG_PREFIX}"'\1/')
    if [[ -z "$TAG" ]]; then
        err "no release matching ${TAG_PREFIX}* found on $REPO"
        exit 1
    fi
    log "latest release: $TAG"
fi

# --- Download tarball ---------------------------------------------------

ARCH=$(uname -m)
VERSION="${TAG#${TAG_PREFIX}}"
TARBALL="cua-driver-${VERSION}-darwin-${ARCH}.tar.gz"
URL="https://github.com/$REPO/releases/download/$TAG/$TARBALL"

log "downloading $URL"
if ! curl -fsSL -o "$TMP_DIR/$TARBALL" "$URL"; then
    err "download failed; try CUA_DRIVER_VERSION=<version> to pin a specific release"
    exit 1
fi

log "extracting"
tar -xzf "$TMP_DIR/$TARBALL" -C "$TMP_DIR"

if [[ ! -d "$TMP_DIR/$APP_NAME" ]]; then
    err "$APP_NAME not found inside $TARBALL (tarball layout may have changed)"
    exit 1
fi

# --- Install .app bundle ------------------------------------------------

if [[ -e "$APP_DEST" ]]; then
    log "removing existing $APP_DEST"
    rm -rf "$APP_DEST"
fi

log "installing $APP_DEST"
ditto "$TMP_DIR/$APP_NAME" "$APP_DEST"

# --- Symlink CLI --------------------------------------------------------

APP_BINARY="$APP_DEST/Contents/MacOS/$BINARY_NAME"
if [[ ! -x "$APP_BINARY" ]]; then
    err "binary missing at $APP_BINARY (refusing to create broken symlink)"
    exit 1
fi

SUDO=""
if [[ ! -w "$(dirname "$BIN_LINK")" ]]; then
    SUDO="sudo"
    log "/usr/local/bin requires elevated write; prompting for sudo"
fi

$SUDO mkdir -p "$(dirname "$BIN_LINK")"
$SUDO ln -sf "$APP_BINARY" "$BIN_LINK"
log "symlinked $BIN_LINK -> $APP_BINARY"

# --- Install Claude Code skill pack -------------------------------------
#
# Detect Claude Code users (via ~/.claude/skills/ presence) and drop a
# symlink pointing at the skill we shipped inside the bundle. Auto-updates
# atomically replace /Applications/CuaDriver.app, so the symlink stays
# valid across every release. Never overwrites an existing link or
# directory — dev users with their own ~/.claude/skills/cua-driver symlink
# pointing at a working copy of the repo keep theirs.

SKILL_LINK="$HOME/.claude/skills/cua-driver"
SKILL_TARGET="$APP_DEST/Contents/Resources/Skills/cua-driver"
if [[ -d "$HOME/.claude/skills" ]]; then
    if [[ -e "$SKILL_LINK" ]] || [[ -L "$SKILL_LINK" ]]; then
        log "skill link already exists at $SKILL_LINK (skipping)"
    elif [[ -d "$SKILL_TARGET" ]]; then
        ln -s "$SKILL_TARGET" "$SKILL_LINK"
        log "symlinked Claude Code skill at $SKILL_LINK"
    else
        log "skill pack missing at $SKILL_TARGET (skipping; older release?)"
    fi
fi

# --- Install auto-updater -----------------------------------------------

if [[ "$INSTALL_AUTO_UPDATER" == "true" ]]; then
    log "setting up auto-updater"

    # Matches lume's pattern — emit the update script as a heredoc
    # from inside install.sh rather than shipping a sibling
    # update.sh file. Keeps the installer self-contained and means a
    # user who runs just `curl | bash` has everything they need with
    # no second fetch. Contents are identical to what an external
    # update.sh would be.
    UPDATER_SCRIPT="/usr/local/bin/cua-driver-update"
    $SUDO tee "$UPDATER_SCRIPT" > /dev/null << 'UPDATER_EOF'
#!/bin/bash
# cua-driver auto-updater. Installed by scripts/install.sh; invoked
# weekly by the com.trycua.cua_driver_updater LaunchAgent or on demand
# via `cua-driver update`. Reads the opt-out flag from the persisted
# config + the CUA_DRIVER_AUTO_UPDATE_ENABLED env var, fetches the
# latest cua-driver-v* release from GitHub, and atomically replaces
# /Applications/CuaDriver.app when a newer version is available.
set -e

LOG_FILE="/tmp/cua_driver_updater.log"
GITHUB_REPO="trycua/cua"
TAG_PREFIX="cua-driver-v"
APP_NAME="CuaDriver.app"
APP_INSTALL_DIR="/Applications/$APP_NAME"
BIN_LINK="/usr/local/bin/cua-driver"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

log "Starting cua-driver update check..."

# Env override wins over config.
if [ -n "${CUA_DRIVER_AUTO_UPDATE_ENABLED:-}" ]; then
    case "${CUA_DRIVER_AUTO_UPDATE_ENABLED,,}" in
        0|false|no|off)
            log "Auto-update disabled via CUA_DRIVER_AUTO_UPDATE_ENABLED; exiting."
            exit 0
            ;;
    esac
fi

# Otherwise consult the persisted config.
CONFIG_FILE="$HOME/Library/Application Support/Cua Driver/config.json"
if [ -f "$CONFIG_FILE" ] && grep -q '"auto_update_enabled":[[:space:]]*false' "$CONFIG_FILE"; then
    log "Auto-update disabled in config; exiting."
    exit 0
fi

if [ ! -x "$BIN_LINK" ]; then
    log "ERROR: cua-driver binary not found at $BIN_LINK"
    exit 1
fi

CURRENT_VERSION=$("$BIN_LINK" --version 2>/dev/null | grep -oE 'v?[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "0.0.0")
log "Current version: $CURRENT_VERSION"

get_latest_tag() {
    local response=$(curl -s "https://api.github.com/repos/$GITHUB_REPO/releases?per_page=40")
    [ -z "$response" ] && return 1
    echo "$response" | grep -oE '"tag_name":[[:space:]]*"'"${TAG_PREFIX}"'[^"]+"' | head -n 1 | sed -E 's/.*"('"${TAG_PREFIX}"'[^"]+)".*/\1/'
}

LATEST_TAG=$(get_latest_tag)
if [ -z "$LATEST_TAG" ]; then
    log "ERROR: Could not fetch latest release tag"
    exit 1
fi

LATEST_VERSION="${LATEST_TAG#${TAG_PREFIX}}"
log "Latest version: $LATEST_VERSION"

version_gt() {
    [ "$(printf '%s\n' "$1" "$2" | sort -V | tail -n1)" = "$1" ] && [ "$1" != "$2" ]
}

apply_update() {
    log "Downloading and applying update..."
    local temp_dir=$(mktemp -d)
    trap 'rm -rf "$temp_dir"' EXIT

    local arch=$(uname -m)
    local version="${LATEST_TAG#${TAG_PREFIX}}"
    local tarball="cua-driver-${version}-darwin-${arch}.tar.gz"
    local download_url="https://github.com/$GITHUB_REPO/releases/download/$LATEST_TAG/$tarball"

    if ! curl -fsSL -o "$temp_dir/$tarball" "$download_url"; then
        log "ERROR: Failed to download $tarball"
        exit 1
    fi
    if ! tar -tzf "$temp_dir/$tarball" > /dev/null 2>&1; then
        log "ERROR: Downloaded file is not a valid tar.gz archive"
        exit 1
    fi
    if ! tar -xzf "$temp_dir/$tarball" -C "$temp_dir"; then
        log "ERROR: Failed to extract tarball"
        exit 1
    fi
    if [ ! -d "$temp_dir/$APP_NAME" ]; then
        log "ERROR: $APP_NAME not found inside tarball"
        exit 1
    fi

    # ditto preserves code signatures and xattrs; cp -R strips
    # Gatekeeper metadata on some macOS versions.
    [ -e "$APP_INSTALL_DIR" ] && rm -rf "$APP_INSTALL_DIR"
    ditto "$temp_dir/$APP_NAME" "$APP_INSTALL_DIR"

    local app_binary="$APP_INSTALL_DIR/Contents/MacOS/cua-driver"
    if [ ! -x "$app_binary" ]; then
        log "ERROR: Binary missing at $app_binary after extraction"
        exit 1
    fi

    local sudo=""
    [ ! -w "$(dirname "$BIN_LINK")" ] && sudo="sudo"
    $sudo mkdir -p "$(dirname "$BIN_LINK")"
    $sudo ln -sf "$app_binary" "$BIN_LINK"

    log "Successfully updated cua-driver to version $version"
    osascript -e "display notification \"Updated to version $version\" with title \"cua-driver Updated\"" 2>/dev/null || true
}

if version_gt "$LATEST_VERSION" "$CURRENT_VERSION"; then
    log "New version available: $LATEST_VERSION (current: $CURRENT_VERSION)"
    case "${1:-}" in
        --silent|--apply)
            # LaunchAgent path: no dialog.
            apply_update
            ;;
        *)
            # Interactive path (user ran `cua-driver update` in a terminal):
            # prompt via osascript before downloading.
            response=$(osascript -e "display dialog \"cua-driver $LATEST_VERSION is available (current: $CURRENT_VERSION).\" buttons {\"Later\", \"Update Now\"} default button \"Update Now\" with title \"cua-driver Update\"" 2>/dev/null || echo "")
            if echo "$response" | grep -q "Update Now"; then
                log "User chose to update"
                apply_update
            else
                log "User chose to skip update"
            fi
            ;;
    esac
else
    log "Already up to date (version $CURRENT_VERSION)"
fi

log "Update check complete"
UPDATER_EOF

    $SUDO chmod +x "$UPDATER_SCRIPT"
    log "installed updater at $UPDATER_SCRIPT"

    AGENT_LABEL="com.trycua.cua_driver_updater"
    AGENT_PLIST="$HOME/Library/LaunchAgents/$AGENT_LABEL.plist"

    mkdir -p "$HOME/Library/LaunchAgents"

    cat > "$AGENT_PLIST" << 'PLIST_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.trycua.cua_driver_updater</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/cua-driver-update</string>
        <string>--silent</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>604800</integer>
    <key>StandardOutPath</key>
    <string>/tmp/cua_driver_updater.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/cua_driver_updater.error.log</string>
</dict>
</plist>
PLIST_EOF

    chmod 644 "$AGENT_PLIST"
    launchctl load "$AGENT_PLIST" 2>/dev/null || true

    log "auto-updater installed (checks weekly)"
    echo ""
    echo "To disable auto-updates later, run:"
    echo "  cua-driver config updates disable"
else
    log "skipping auto-updater setup (CUA_DRIVER_NO_UPDATER=1)"
fi

# --- Done ---------------------------------------------------------------

log "cua-driver $VERSION installed"
cat << 'FINALEOF'

Next steps:
  1. Start the daemon so TCC attributes requests to CuaDriver.app:
       open -n -g -a CuaDriver --args serve

  2. Trigger the Accessibility + Screen Recording prompts:
       cua-driver check_permissions
     macOS will raise the system dialogs. Grant both, then re-run
     the command to confirm it reports all green.

  3. Wire into your MCP client (Claude Code, Cursor, etc.):
       cua-driver mcp-config | pbcopy

  4. Or drive directly from the shell:
       cua-driver list_apps

Docs: https://github.com/trycua/cua/tree/main/libs/cua-driver
FINALEOF
