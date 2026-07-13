# Remote Topic Thread Copy

## User Need

The Simplified Chinese remote-control copy should not use the awkward phrase `话题线程`.

## Goal

Replace `话题线程` with `会话` in the zh-CN remote-control descriptions and access rule.

## Acceptance Criteria

- Telegram remote description says `私聊、群聊和会话远程控制`.
- Feishu remote description says `私聊、群聊和会话远程控制`.
- The group access rule says `群聊和会话里`.
- Topic ID field labels remain unchanged.

## UI Sketch

Before:

```text
接入 Telegram Bot，支持私聊、群聊和话题线程远程控制。
```

After:

```text
接入 Telegram Bot，支持私聊、群聊和会话远程控制。
```

## Constraints

- zh-CN copy only.
- No behavior or schema changes.

## Non-Goals

- Renaming topic/thread IDs.
- Updating non-Chinese locales.

## Open Questions

- None.
