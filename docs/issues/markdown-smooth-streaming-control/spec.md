# Markdown Smooth Streaming Control

## User Story

As a chat reader, I want completed markdown messages to render without streaming animation so that history and already-generated responses feel stable.

## Acceptance Criteria

- Assistant text blocks that are actively generating use `smoothStreaming`.
- Completed assistant text blocks do not use `smoothStreaming`.
- Markdown artifact previews and workspace markdown previews keep non-streaming behavior by default.
- The change does not alter markdown content parsing, references, code previews, or artifact syncing.

## Non-Goals

- No new user setting is added.
- No IPC, database, or shared message schema changes are needed.
