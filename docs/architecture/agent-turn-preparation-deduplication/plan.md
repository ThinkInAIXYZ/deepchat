# Agent Turn Preparation Deduplication — Plan

## Approach

1. Add one private `prepareTurnResources` method to `AgentRuntimePresenter`.
2. Keep the current step order and use existing `runPreStreamStep` checkpoints inside it.
3. Let the initial caller opt into replacing and merging runtime-activated skills; let resume omit
   that input to preserve its current behavior.
4. Return only values already consumed by the two callers: generation settings, budget policy,
   active skills, tools, base prompt, capability flags, and the prompt assembler.
5. Remove both duplicated blocks and run the existing initial/resume lifecycle tests.

## Compatibility

This is a private source refactor. Public methods, database writes, event payloads, prompt section
order, cancellation timing, and session state ownership remain unchanged.

## Validation

- Existing pre-stream watchdog and initial/resume phase-order tests.
- Full `test/main/presenter/agentRuntimePresenter/**` suite.
- Line/method/field measurement and production LOC comparison against `ab716717c`.
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck`.

## Result

Both turn paths now share one preparation method while retaining separate compaction and Tape-view
logic. The presenter is 4,874 lines / 136 methods / 34 fields, and the affected production diff is
31 lines smaller than the checkpoint.
