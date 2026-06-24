# Skill Reinstall Windows EPERM

## User Story

When a user deletes a skill and immediately imports the same skill again on Windows, DeepChat
should reinstall it normally when the old skill folder is only a stale residue. If the folder is
still locked by another process, DeepChat should report a clear locked-folder error instead of a
raw `EPERM: operation not permitted, rename ... .backup-*` message.

## Problem

Skill installation treats every existing target directory as an overwrite conflict. With overwrite
enabled, the installer renames the existing directory to a timestamped backup before copying the
new skill. On Windows, renaming a directory fails with `EPERM` when any child file or process keeps
the directory open. A deleted or partially deleted skill may also disappear from discovery because
`SKILL.md` is gone while the root folder still remains on disk, causing the next import to look
like a confusing overwrite failure.

## Acceptance Criteria

- Reinstalling a skill succeeds without creating a backup when the target directory exists but no
  valid `SKILL.md` remains.
- Overwriting a valid installed skill continues to preserve the previous folder through the existing
  backup behavior.
- Windows `EPERM` or `EBUSY` failures while replacing a skill return a structured locked-folder
  error instead of a raw rename stack message.
- Skill uninstall does not publish a successful uninstall or clear caches before the target folder
  is actually removed.
- Skill uninstall clears stale sidecar and cache state when the skill folder was already removed
  outside DeepChat.
- Skill script execution should avoid using the skill root as the process working directory when a
  safer session directory is available or creatable.
- Tests cover stale-folder reinstall, locked-folder error mapping, uninstall failure ordering, and
  skill script working-directory fallback.

## Non-Goals

- Removing backup behavior for intentional overwrites of valid installed skills.
- Adding a new user-facing installation mode.
- Changing skill metadata discovery semantics for valid skills.
