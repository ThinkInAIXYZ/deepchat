# Plan

## Implementation

- Add prompt sanitation in `contextBuilder` so blank text-only user messages are filtered from
  history and the current prompt input is only appended when it has visible text or supported
  attachments.
- Keep attachment-only inputs valid by treating generated attachment context or structured media
  parts as non-empty prompt content.
- Preserve protected resume turns in `selectTurnHistory` even when the protected turn itself exceeds
  a small positive remaining budget.
- Allow `applyCompactionIntent` to accept a requested indicator order sequence.
- In the resume path, create the compaction indicator at the assistant message's existing order
  sequence, then shift the resumed assistant message and following messages forward before streaming
  continues.

## Test Strategy

- Unit-test prompt building with blank text-only current and historical user messages.
- Unit-test ask-user resume context when the protected tool-result turn exceeds the remaining budget.
- Add a regression test for ask-user resume compaction indicator placement.
- Run focused Vitest suites, then repository format, i18n, and lint checks.

## Risks

- Message order changes must not reorder unrelated history. The shift is only used for resume-time
  compaction and only when an intent exists.
- Filtering blank prompt messages must preserve attachment-only messages.
