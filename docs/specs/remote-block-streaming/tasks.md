# Remote Block Streaming Tasks

## T0 Spec

- [x] Update the spec, plan, and tasks artifacts for dual-track remote delivery

## T1 Snapshot Contract

- [x] Keep `statusText`, `text`, and `finalText` in `RemoteConversationSnapshot`
- [x] Redefine `text` as answer-only streamed content for remote runtimes
- [x] Keep `draftText`, `renderBlocks`, and `fullText` as compatibility fields

## T2 Compact Extraction

- [x] Derive short status strings from assistant blocks
- [x] Derive streamed answer text from `content` blocks only
- [x] Keep `finalText` limited to final answer or terminal fallback

## T3 Telegram Delivery

- [x] Create separate temporary status and streamed answer messages
- [x] Delete the status message after final answer sync
- [x] Keep pending interaction prompts separate and preserve streamed answer text
- [x] Support long-answer chunk growth with an editable tail

## T4 Feishu Delivery

- [x] Create separate temporary status and streamed answer messages
- [x] Delete the status message after final answer sync
- [x] Keep pending interaction cards/fallback text separate and preserve streamed answer text
- [x] Support long-answer chunk growth with an editable tail

## T5 Validation

- [x] Add formatter, runner, binding-store, Telegram, and Feishu regression tests
- [x] Keep `/status` free of stream-mode output and retain legacy stream-mode config as a compatibility no-op
- [x] Run repo quality gates and capture residual issues
