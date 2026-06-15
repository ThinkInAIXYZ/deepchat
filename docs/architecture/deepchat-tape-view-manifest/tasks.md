# DeepChat Tape ViewManifest Shadow Mode - Tasks

## Documentation

- [x] T0: Create SDD folder and convert the broad Tape vision into the current implementation
  direction.

## Implementation Tasks

- [ ] T1: Add `DeepChatTapeViewManifest` shared types and a pure manifest hashing helper.
- [ ] T2: Add `tapeViewManifest.ts` with pure assembly helpers for normal chat, resume, and
  request-level provider calls.
- [ ] T3: Extend `DeepChatTapeService` to append and list `view/assembled` events.
- [ ] T4: Emit initial shadow manifests after `buildContext()` and `buildResumeContext()`.
- [ ] T5: Emit request-level manifests inside `runStreamForMessage()` after preflight and
  context-pressure recovery.
- [ ] T6: Add typed route and renderer client method for manifests by message ID.
- [ ] T7: Extend `TraceDialog.vue` with Request, View Manifest, Tape Entries, and Budget tabs.
- [ ] T8: Add unit tests for manifest assembly, tape service list/append behavior, and route/client
  compatibility.
- [ ] T9: Add renderer tests for manifest tab loading, empty, error, and data states.
- [ ] T10: Run format, i18n, lint, typecheck, and focused test suites.

## Follow-up Tasks

- [ ] F1: Evaluate whether manifest storage should get a dedicated table after real usage data.
- [ ] F2: Design production `TapeViewAssembler` replacement only after shadow parity is stable.
- [ ] F3: Define eval/replay export format from manifest slices.
