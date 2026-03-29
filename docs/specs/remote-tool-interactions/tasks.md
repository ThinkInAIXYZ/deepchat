# Remote Tool Interactions Tasks

## Readiness

- No open clarification items remain.
- All tasks below map back to the acceptance criteria in [spec.md](./spec.md).

## T0 Spec Artifacts

- [x] Create and align `spec.md`, `plan.md`, and `tasks.md`
- Owner: Remote control maintainer
- Estimate: 0.5d
- Acceptance Criteria:
  - Spec acceptance criteria for `pendingInteraction`, channel rendering, `/pending`, and command gating are explicitly represented in the plan/tasks artifacts.
  - No unresolved clarification markers remain before the work is marked ready.

## T1 Remote Snapshot And API Changes

- [x] Extend `RemoteConversationSnapshot` with `pendingInteraction`
- [x] Extend runner status to expose `pendingInteraction`
- [x] Parse assistant `tool_call_permission` and `question_request` blocks into `RemotePendingInteraction`
- Owner: Electron main
- Estimate: 1d
- Acceptance Criteria:
  - Satisfies spec acceptance criteria for structured `pendingInteraction`.
  - Remote delivery no longer depends on the generic desktop confirmation notice as the primary state.

## T2 Electron Main Integration

- [x] Add `RemoteConversationRunner.getPendingInteraction()`
- [x] Add `RemoteConversationRunner.respondToPendingInteraction()`
- [x] Continue polling the same assistant message after tool interaction responses
- Owner: Electron main
- Estimate: 1d
- Acceptance Criteria:
  - Satisfies spec acceptance criteria for remote session continuity during paused interactions.
  - Chained interactions can surface one at a time without losing the bound session.

## T3 Telegram Buttons, Callback Handling, And Text Fallback

- [x] Render permission prompts with `Allow` / `Deny` inline buttons
- [x] Render single-choice question prompts with option buttons and `Other` when custom input is allowed
- [x] Parse `ALLOW` / `DENY`, exact numeric replies, exact labels, and custom text as appropriate
- [x] Edit the original Telegram prompt into a resolved state immediately after button selection
- Owner: Telegram remote
- Estimate: 1.5d
- Acceptance Criteria:
  - Satisfies spec acceptance criteria for Telegram permission buttons, single-choice buttons, and text fallback.
  - `question.multiple === true` stays plain-text only.

## T4 Feishu Card Rendering And Full Plain-Text Fallback

- [x] Render pending interactions as Feishu card-style outbound actions
- [x] Fall back to the complete plain-text prompt when card delivery fails
- [x] Parse `ALLOW` / `DENY`, exact numeric replies, exact labels, and custom text as appropriate
- Owner: Feishu remote
- Estimate: 1d
- Acceptance Criteria:
  - Satisfies spec acceptance criteria for Feishu card rendering and fallback behavior.
  - Card failure still preserves permission/question details in the fallback message.

## T5 Token Refresh And Expired Callback Recovery

- [x] Store Telegram pending interaction callback tokens in `RemoteBindingStore`
- [x] Refresh the pending prompt when an expired callback token is used and the interaction still exists
- Owner: Telegram remote
- Estimate: 0.5d
- Acceptance Criteria:
  - Satisfies spec acceptance criteria for expired Telegram callback token refresh.
  - Prompt refresh only succeeds when `endpointKey`, `messageId`, and `toolCallId` still match.

## T6 Pending Prompt Re-Send And Command Gating

- [x] Add `/pending` for Telegram and Feishu
- [x] Block `/new`, `/use`, `/model`, and unrelated plain-text turns while waiting
- [x] Keep `/help`, `/status`, `/open`, and `/pending` available while waiting
- Owner: Remote router
- Estimate: 0.5d
- Acceptance Criteria:
  - Satisfies spec acceptance criteria for `/pending`.
  - Satisfies spec acceptance criteria for blocked and allowed commands while waiting.

## T7 Tests

- [x] Add runner tests for extraction and follow-up execution
- [x] Add Telegram tests for callback handling, `/pending`, prompt refresh, and non-blocking continuation
- [x] Add Feishu tests for text parsing and fallback behavior
- [x] Add binding/token lifecycle tests
- Owner: QA + Electron main
- Estimate: 1d
- Acceptance Criteria:
  - Test coverage maps to the acceptance criteria in `spec.md`.
  - Regressions in pairing, binding, `/open`, `/status`, and normal non-interaction flows are covered by targeted tests.

## T8 Documentation And Review Notes

- [x] Document compatibility, rollout behavior, and command gating in `plan.md`
- [x] Keep the feature scope explicit: Telegram buttons, Feishu cards, no Feishu callback endpoint
- Owner: Remote control maintainer
- Estimate: 0.5d
- Acceptance Criteria:
  - Reviewers can understand rollout steps, dependencies, and compatibility notes without reading implementation files.
  - The blocked commands list and allowed commands list match the implemented router behavior and `spec.md`.
