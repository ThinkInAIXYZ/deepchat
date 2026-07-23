# Skill Tool Activation and Refresh Regression

## Issue

`deepchat-settings` can be inspected by `skill_view`, but a subsequent settings tool call
can report that the skill is inactive. Enabling or disabling skills also causes an unnecessary
full tool/window refresh, visible as repeated shortcut registration and focus loss.

## Impact

- DeepChat settings requests such as changing the theme may fail after the skill is viewed.
- Updating the skill list interrupts the active window and rebuilds unrelated runtime state.

## Suspected Root Cause

Temporary skill activation is stored on the runtime resource instance, while some tool resolution
paths fall back to conversation-level active skills. Skill catalog updates also use the broad runtime
refresh path instead of notifying only consumers whose tool definitions changed.

## Acceptance Criteria

- After `skill_view` successfully views a root `SKILL.md`, a settings tool call in the same message
  sees the skill as active and can apply `theme: light`.
- Skill activation remains available across the tool-definition refresh triggered by `skill_view`.
- Enabling or disabling a skill does not unregister/re-register global shortcuts or force a window
  reload unless the changed skill affects the active runtime tool catalog.
- Existing skill, tool-refresh, and shortcut behavior remains covered by tests.

## Fix Plan

- Trace runtime active-skill propagation through `skill_view`, tool execution, and refresh callbacks.
- Narrow skill-list refresh notifications to affected runtime consumers.
- Add regression tests for settings activation and for avoiding unrelated shortcut refreshes.

## Tasks

- [x] Preserve temporary activation when resolving settings tools after `skill_view`.
- [x] Narrow skill-list refresh side effects.
- [x] Add and run regression tests.

## Validation

Targeted Vitest suites, node/web type checks, formatting, i18n, and lint passed.
