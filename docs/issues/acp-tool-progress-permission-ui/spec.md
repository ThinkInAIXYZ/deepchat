# ACP Tool Progress Pseudo Permission UI

## Issue

Ordinary ACP `tool_call` / status progress was projected as `action_type: 'tool_call_permission'`,
which mixed narrative tool progress with real permission interactions.

## Fix

Emit reasoning events for tool progress only; reserve permission action blocks for protocol
permission requests.

## Tasks

- [x] Remove pseudo permission action blocks from `acpContentMapper`
- [x] Regression test
