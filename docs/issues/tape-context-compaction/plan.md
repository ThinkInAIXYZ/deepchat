# Tape-Native Context Compaction Implementation Plan

## Status

Implementation complete on `fix/tape-context-compaction`. Repository delivery follows the normal
review workflow; this plan records only the implementation and validation contract.

## Implementation Slices

### 1. Separate Boundary Progress From Summary Success

- Replace the boolean compaction result with an outcome that distinguishes summarized,
  boundary-only, and unchanged states.
- On non-abort summary failure, compare-and-set a reconstruction anchor with the target cursor,
  stable reason, coverage, and bounded provenance.
- Preserve an older valid summary as `priorSummary` partial reconstruction context without
  presenting the boundary timestamp as a new summary generation time.
- Merge consecutive gap coverage into the new anchor state.
- Keep cancellation fail-closed: abort writes neither summary nor boundary.
- Treat a winning CAS state as progress only when its persisted cursor is newer than the prepared
  state.

### 2. Make Runtime Progress Observable And Correct

- Project cursor-only summary state as `compacted`, not `idle`.
- Determine context-pressure `applied` from monotonic cursor progress rather than intent presence.
- Reassemble the checkpoint and require the retry projection to differ and shrink before sending.
- Preserve manual compaction message/event compatibility for both summarized and boundary-only
  outcomes.
- Fix strict retry so its protected-tail override reaches the cache-aware fitter.

### 3. Bound Recovery Sequences

- Split the existing one-shot boolean into a sequence latch and a finite Run-level recovery count.
- Reset the sequence latch after a successful provider response, not after a failed recovery.
- Keep request sequence, physical-attempt identity, ViewManifest, provider outcome, and transient
  retry semantics unchanged.
- Add regression tests for two successful provider steps separated by independent pressure events
  and for total recovery ceiling exhaustion.

### 4. Compact Active-Turn Tool Units

- Characterize the provider message shapes emitted for assistant tool calls and tool results.
- Extract protocol-safe closed-unit selection in the existing context fitting owner.
- Reuse ToolOutputGuard offload/stub construction for eligible large inline results.
- Preserve open/pending/deferred tool units and call/result pairing.
- Run the existing changed-projection and ViewManifest paths on the reduced request.
- Do not restart the original user prompt after a tool side effect.

### 5. Add Usage-Anchored Pressure Projection

- Persist or retain in Run state the latest valid prompt-usage anchor and immutable request-envelope
  fingerprint.
- Fingerprint provider, model, system prompt, provider-visible tools, relevant generation options,
  and the anchored message prefix without retaining raw prompt data.
- Estimate only messages added after an exact anchor; invalidate on prefix or envelope drift.
- Feed projected pressure into each provider-request preflight while retaining full-estimate
  fallback and all output/tool reserves.
- Record bounded diagnostics for anchor use, invalidation reason, projected input, and cache-read
  ratio without changing aggregate billing semantics.

### 6. Final Integration And Documentation

- Exercise automatic turn-boundary compaction, provider-round pressure recovery, long tool loops,
  provider overflow, cancellation, resume, manual compaction, and CAS races through the harness.
- Update the canonical Tape/context architecture documentation with the final behavior and durable
  validation record.
- Review the complete branch against its base and remove temporary probes or implementation-only
  tests.

## Completion Summary

- Boundary progress is independent from semantic summary success and uses atomic reconstruction
  anchors with deterministic merged gap coverage.
- Semantic boundary recovery requires a durable cursor advance and a strictly smaller View;
  in-flight tool-result reduction instead requires a changed protocol-valid projection. Recovery
  resets after a successful provider response and is bounded to three sequences per Run.
- Closed active-turn tool results are compacted before model-backed summary without replaying tool
  side effects or changing raw Tape facts. The newest closed unit remains intact when compacting
  older evidence is sufficient and becomes eligible only as the next pressure fallback.
- Prompt pressure uses provider usage plus exact-prefix suffix projection when the request envelope
  is unchanged and the sent payload matches the continuation View, with conservative full-estimate
  fallback for fitted projections and malformed cache usage.
- Canonical behavior is documented in `docs/architecture/tape-system.md` and
  `docs/architecture/agent-system.md`.

## Test Matrix

| Area | Required evidence |
| --- | --- |
| Compaction service | summary success, summary failure boundary, abort, CAS winner/loser, merged gap |
| Session settings/Tape | cursor-only state, atomic anchor/state write, reset/edit invalidation |
| Runtime coordinator | cursor-only compacted projection, manual lifecycle, projection cleanup |
| Input/context coordination | no-intent, no-progress intent, real progress, strictly smaller retry |
| Provider loop | preflight pressure, provider 400, two later recovery sequences, finite ceiling |
| Context builder | strict protected-tail override, closed tool units, open-unit protection |
| ToolOutputGuard | existing artifact reuse, bounded stub, cleanup ownership, path safety |
| Token meter | exact anchor, suffix delta, every fingerprint invalidation, malformed usage fallback |
| Harness/replay | ViewManifest provenance, provider attempt identity, no duplicated tool effect |

## Commit And Review Discipline

Each implementation slice is committed only after:

1. inspecting the complete unstaged and staged diff;
2. reviewing findings in severity order for hidden side effects, compatibility, edge cases,
   performance, security, naming, test gaps, and maintenance cost;
3. fixing every material finding and repeating the relevant checks;
4. using a conventional commit that describes the concrete behavior, never the review activity.

Documentation and implementation may use separate commits, but boundary/summary decoupling and
truthful runtime progress reporting must land in the same implementation commit so no intermediate
code state can consume recovery without shrinking the View.

## Validation Commands

Focused commands will be selected per slice. Before handoff run at least:

```bash
pnpm exec vitest run --config vitest.config.ts --reporter=dot --silent=passed-only \
  test/main/agent/deepchat/runtime/compactionService.test.ts \
  test/main/agent/deepchat/runtime/compactionRuntimeCoordinator.test.ts \
  test/main/agent/deepchat/runtime/contextBuilder.test.ts \
  test/main/agent/deepchat/runtime/toolOutputGuard.test.ts \
  test/main/agent/deepchat/loop/contextCoordinator.test.ts \
  test/main/agent/deepchat/loop/inputPreparationCoordinator.test.ts \
  test/main/agent/deepchat/loop/loopRun.test.ts \
  test/main/agent/deepchat/harness/deepChatAgentHarness.test.ts \
  test/main/session/data/settings.test.ts \
  test/main/session/data/tapeViewManifest.test.ts \
  test/main/session/data/tapeViewReplay.test.ts
pnpm format
pnpm i18n
pnpm lint
pnpm typecheck
```

Any environment-gated native SQLite tests or unrelated baseline failures will be reported
explicitly rather than presented as passing.
