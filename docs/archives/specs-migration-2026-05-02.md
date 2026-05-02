# Specs Migration 2026-05-02

> Archive note: This document records the SDD directory migration performed on 2026-05-02. Historical paths can reference code that has since moved or been removed.

## Summary

The legacy SDD tree was split into goal-based directories:

- `docs/features`: 35 active feature and capability targets
- `docs/issues`: 5 active issue, regression, and reliability targets
- `docs/architecture`: 8 active architecture and migration targets
- `docs/archives`: 27 stale, completed, retired, or superseded target folders

Active goal folders now contain `spec.md`, `plan.md`, and `tasks.md`. Generated placeholder plan/task files preserve SDD shape for older spec-only folders and should be replaced with detailed content when those targets are resumed.

## Active Features

`acp-agent-uninstall`, `acp-session-config-options`, `active-input-routing`, `agent-db-legacy-import`, `agent-input-advanced-config`, `app-spotlight-search`, `chat-settings-control`, `chat-sidebar-input-polish`, `edit-file-tool`, `electron-vite-5-upgrade`, `file-attachment-support`, `floating-agent-widget`, `hooks-notifications`, `message-toolbar-actions`, `message-trace-storage`, `ollama-model-selection`, `privacy-mode`, `process-tool`, `provider-deeplink-import`, `remote-acp-control`, `remote-block-streaming`, `remote-discord-lark`, `remote-multi-channel`, `remote-process-log`, `remote-tool-interactions`, `right-sidepanel`, `settings-dashboard`, `settings-environments`, `sidebar-session-context-menu`, `sidebar-workspace-shortcuts`, `subagent-orchestrator`, `tool-call-image-preview`, `user-message-collapse`, `workspace-lifecycle`, `yobrowser-optimization`.

## Active Issues

`agent-tool-context-budget`, `e2e-smoke-regression`, `permission-flow-stabilization`, `question-tool-prompt-optimization`, `tool-output-guardrails`.

## Active Architecture Targets

`agent-provider-simplification`, `agent-refactor`, `architecture-simplification`, `chat-store-zero-migration`, `main-kernel-refactor`, `renderer-main-single-track`, `skill-runtime-hardening`, `startup-orchestration`.

## Archived Targets

`agent-cleanup`, `agent-tooling-v2`, `agentpresenter-mvp-replacement`, `ai-sdk-runtime`, `cua-runtime-plugin`, `default-model-settings`, `legacy-agentpresenter-retirement`, `legacy-llm-provider-runtime-retirement`, `mac-computer-use`, `multi-window-cleanup`, `new-agent`, `new-ui-agent-session`, `new-ui-agent-store`, `new-ui-chat-components`, `new-ui-implementation`, `new-ui-markdown-rendering`, `new-ui-page-state`, `new-ui-pages`, `new-ui-project-store`, `new-ui-session-store`, `new-ui-sidebar`, `new-ui-status-bar`, `provider-layer-simplification`, `remove-chat-mode`, `skills-system`, `skills-ux-redesign`, `telegram-remote-control`.

## Deleted Stale Files

- `agentpresenter-mvp-replacement/gap-analysis.md`
- `skills-system/code-review.md`
- `skills-system/create-skill-prompt.md`
- `skills-system/create-skill-spec.md`

These files were removed because they only described superseded implementation paths or skill scaffolding plans that no longer match the current project-level skill model.
