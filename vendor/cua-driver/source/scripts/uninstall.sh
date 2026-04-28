#!/usr/bin/env bash
# cua-driver uninstaller. Removes everything install.sh laid down:
#
#   - /usr/local/bin/cua-driver symlink
#   - /usr/local/bin/cua-driver-update script
#   - /Applications/CuaDriver.app bundle
#   - ~/.cua-driver/ (telemetry id + install marker)
#   - ~/Library/Application Support/Cua Driver/ (config.json)
#   - ~/Library/LaunchAgents/com.trycua.cua_driver_updater.plist
#
# Does NOT revoke TCC grants (Accessibility + Screen Recording).
#
# Usage:
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/uninstall.sh)"
set -euo pipefail

BIN_LINK="/usr/local/bin/cua-driver"
UPDATE_SCRIPT="/usr/local/bin/cua-driver-update"
APP_BUNDLE="/Applications/CuaDriver.app"
USER_DATA="$HOME/.cua-driver"
CONFIG_DIR="$HOME/Library/Application Support/Cua Driver"
UPDATER_PLIST="$HOME/Library/LaunchAgents/com.trycua.cua_driver_updater.plist"

log() { printf '==> %s\n' "$*"; }

# Symlink (may need sudo on some systems).
if [[ -L "$BIN_LINK" ]] || [[ -e "$BIN_LINK" ]]; then
    SUDO=""
    if [[ ! -w "$(dirname "$BIN_LINK")" ]]; then
        SUDO="sudo"
    fi
    $SUDO rm -f "$BIN_LINK"
    log "removed $BIN_LINK"
else
    log "no symlink at $BIN_LINK (skipping)"
fi

# Update script (may need sudo on some systems).
if [[ -f "$UPDATE_SCRIPT" ]]; then
    SUDO=""
    if [[ ! -w "$(dirname "$UPDATE_SCRIPT")" ]]; then
        SUDO="sudo"
    fi
    $SUDO rm -f "$UPDATE_SCRIPT"
    log "removed $UPDATE_SCRIPT"
else
    log "no update script at $UPDATE_SCRIPT (skipping)"
fi

# LaunchAgent updater plist.
if [[ -f "$UPDATER_PLIST" ]]; then
    launchctl unload "$UPDATER_PLIST" 2>/dev/null || true
    rm -f "$UPDATER_PLIST"
    log "removed $UPDATER_PLIST"
else
    log "no updater LaunchAgent at $UPDATER_PLIST (skipping)"
fi

# .app bundle (in /Applications, usually writable by the user).
if [[ -d "$APP_BUNDLE" ]]; then
    SUDO=""
    if [[ ! -w "$(dirname "$APP_BUNDLE")" ]]; then
        SUDO="sudo"
    fi
    $SUDO rm -rf "$APP_BUNDLE"
    log "removed $APP_BUNDLE"
else
    log "no app bundle at $APP_BUNDLE (skipping)"
fi

# User-data directory (telemetry id + install marker).
if [[ -d "$USER_DATA" ]]; then
    rm -rf "$USER_DATA"
    log "removed $USER_DATA"
else
    log "no user data at $USER_DATA (skipping)"
fi

# Persisted config.
if [[ -d "$CONFIG_DIR" ]]; then
    rm -rf "$CONFIG_DIR"
    log "removed $CONFIG_DIR"
else
    log "no config at $CONFIG_DIR (skipping)"
fi

# Claude Code skill symlink. Only remove when the link is ours — a dev
# user pointing ~/.claude/skills/cua-driver at a working copy of the
# repo keeps their link untouched.
SKILL_LINK="$HOME/.claude/skills/cua-driver"
SKILL_TARGET_EXPECTED="$APP_BUNDLE/Contents/Resources/Skills/cua-driver"
if [[ -L "$SKILL_LINK" ]] && [[ "$(readlink "$SKILL_LINK")" == "$SKILL_TARGET_EXPECTED" ]]; then
    rm -f "$SKILL_LINK"
    log "removed $SKILL_LINK"
else
    log "no install-created skill symlink at $SKILL_LINK (skipping)"
fi

cat << 'FINALUNMSG'

cua-driver uninstalled.

TCC grants (Accessibility + Screen Recording) remain in System
Settings > Privacy & Security. Reset them explicitly if you want a
clean re-install flow:

  tccutil reset Accessibility com.trycua.driver
  tccutil reset ScreenCapture com.trycua.driver
FINALUNMSG
