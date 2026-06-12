# Feishu Pairing Save Race

## User Need
Feishu/Lark Remote Control users who complete `/pair <code>` must stay authorized after the settings page auto-saves stale form state.

## Goal
Prevent general Feishu settings saves from overwriting the runtime-managed `pairedUserOpenIds` list.

## Acceptance Criteria
- Saving Feishu settings preserves the existing paired user open IDs when the input contains an older or empty list.
- Pair/unpair operations remain the only path that changes Feishu paired users.
- Existing Feishu settings fields such as brand, credentials, enabled state, default agent, and workdir still save normally.
- Regression coverage verifies stale frontend settings cannot erase a paired Feishu user.

## Constraints
- Keep public settings shape compatible with the current renderer and IPC contracts.
- Avoid broad changes to unrelated remote channels unless a matching save-race path is confirmed in code.

## Non-Goals
- Redesign remote settings state management.
- Remove `pairedUserOpenIds` from shared types in this fix.
