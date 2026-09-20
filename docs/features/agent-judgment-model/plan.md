# Agent Judgment Model — Plan

Spec: `spec.md`. Status: implemented; gates green.
Depends on: `docs/features/typesafe-jev-provider/` for `ModelType.Judgment` and the `jev` protocol.

## Slice 1 — Configuration field

Objective: a persisted, per-agent judgment model that nothing reads yet.

- [x] Add `judgmentModel` to `DeepChatAgentConfig` in `src/shared/types/agent-interface.d.ts`.
- [x] Add it to `DeepChatAgentConfigSchema` in `src/shared/contracts/domainSchemas.ts`.
- [x] Add it to the repository merge list in `deepChatAgentRepository.ts` so it round-trips.
- [x] Do not extend `CONFIG_ENTRY_KEYS`; the slot is per-agent only.

Ownership: shared agent config contract and the agent repository.

Completion condition: the field survives a save/reload round-trip and an existing row without it
still parses.

## Slice 2 — Settings UI

Objective: select and clear a judgment model, restricted to Jev-protocol models.

- [x] Add the field to `ModelKey`, `FormState`, the reactive defaults, and `emptyForm()`.
- [x] Add the `open` ref, the `modelFields` entry, and the close branch in `selectModel`.
- [x] Add it to `CONFIG_DIFF_KEYS`, `buildEditableConfig`, and the `fromAgent` mapping.
- [x] Restrict its picker to `ModelType.Judgment` through the existing per-field type filter.
- [x] Add the i18n label across all 23 locales.
- [x] Update the fixed model-picker count and index assertions in the renderer test.
- Note: `src/types/i18n.d.ts` is already stale in the repository relative to `zh-CN`; running
  `pnpm run i18n:types` rewrites ~336 unrelated lines. The single `judgmentModel` leaf was inserted
  by hand instead. Wholesale regeneration belongs in its own change.

Ownership: `DeepChatAgentsSettings.vue`, i18n catalogs.

Completion condition: the picker shows only judgment models; save and reload persist the selection;
`pnpm run i18n` passes.

## Slice 3 — Judgment question set

Objective: the reviewable surface, isolated in one file.

- [x] Add `jevPermissionQuestions.ts` holding the question definitions, every threshold, and the
      composition rules.
- [x] Keep questions atomic — a risk `Choice`, an authorization `Noul`, an injection `Noul` — and
      leave composition to code.
- [x] Document every threshold as provisional pending evaluation evidence.

Ownership: one new module under the DeepChat agent runtime.

Completion condition: the module contains no review logic and no I/O, and every threshold is named.

## Slice 4 — System One execution path

Objective: let the runtime issue a System One request to a provider.

- [x] Add `runJudgment` to the provider runtime port, the `ProviderExecutionPort` pick, the runtime
      implementation, and the tool-runtime binding dependencies.
- [x] Implement it for the Jev protocol provider, rejecting non-System-One providers with a clear
      error instead of a missing-method crash.
- [x] Preserve abort, timeout, rate limiting, and error mapping.

Ownership: `src/shared/types/provider.ts` port surface, provider runtime, `jevProvider.ts`.

Depends on: Slice 3 for the question shapes.

Completion condition: a judgment call can be issued and returns typed answers, and a non-Jev
provider rejects it clearly.

## Slice 5 — Reviewer backend selection

Objective: use the judgment model when configured, and change nothing when it is not.

- [x] In `reviewAutoApproveToolPermission`, branch on the configured judgment model.
- [x] Build a filtered review state containing only what the questions need.
- [x] Compose typed answers into `ToolPermissionReviewResult` in code, with code-side action binding
      replacing the hash echo.
- [x] Preserve `critical -> block`, `high -> ask_user`, and `ask_user` on failure, timeout, or
      invalid output.
- [x] Map the structured classification to fixed local rationale copy.
- [x] Log the decision, the judgment signals used, and token usage, without logging secrets.
- [x] Bound the judgment request with the review's own abort signal, so the 30s review timeout
      applies to it exactly as it does to the generative path.

Ownership: `toolPermissionReviewer.ts`.

Completion condition: with the slot unset the existing path is untouched; with the slot set a
System One request is issued and mapped.

## Slice 6 — Review and validation

Objective: prove decoupling held and the safety floor is intact.

- [x] Confirm by inspection that compaction, title generation, translation, and memory consolidation
      still read `assistantModel`; only the reviewer reads `judgmentModel`.
- [x] Durable tests: the `critical`/`high` floor under the judgment path, each auto-allow threshold,
      failure and malformed answers resolving to `ask_user`, abort propagation, and the unchanged
      generative path when unset.
- [x] Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and the focused
      main and renderer suites.
- [x] No temporary probe or scaffolding retained.

Completion condition: all gates pass and existing permission-reviewer tests pass unchanged.

## Deferred

- Evaluation of judgment quality, latency, cost, Chinese authorization, and injection resistance.
  Issue #2326 treats this as the condition for adoption, not for implementation.
- Threshold tuning, which depends on that evaluation.
- The `pnpm run i18n:types` regeneration drift noted in Slice 2.
