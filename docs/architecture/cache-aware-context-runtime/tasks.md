# Cache-Aware Context Runtime Tasks

## Specification

- [x] Inspect DeepChat, Bub, Pi, and the installed AI SDK provider adapters.
- [x] Record the prompt trust, cache transport, compaction, compatibility, and telemetry contracts.
- [x] Write the English architecture `spec.md`, `plan.md`, and `tasks.md`.
- [x] Update the maintained Tape and Memory architecture references.
- [x] Review and commit the SDD slice.

## Provider Cache Transport

- [x] Add conversation and isolated cache intent at the AI SDK runtime boundary.
- [x] Preserve structured system instructions when provider metadata is present.
- [x] Correct official OpenAI, Anthropic, and Bedrock cache metadata.
- [x] Add OpenRouter and Zenmux final-body cache transforms with marker stripping.
- [x] Add real-adapter wire-capture and one-shot isolation tests.
- [x] Review and commit the provider slice.

## Context Trust and Prefix Stability

- [x] Return structured summary, reconstruction, and Memory contributions.
- [x] Project checkpoint data as synthetic user context.
- [x] Inject Memory into the current or resume-owner user message.
- [x] Preserve contributions across system refresh and context-pressure recovery.
- [x] Remove the composed system-prompt memo and obsolete invalidation paths.
- [x] Register the cache-aware default policy and ViewManifest schema 3 provenance.
- [x] Add trust-boundary, prefix-stability, resume, refresh, recovery, and compatibility tests.
- [x] Review and commit the context slice.

## Model-Aware Compaction

- [x] Select complete retained turns using the configured floor and model-aware token target.
- [x] Preserve the resume target and preceding configured turns.
- [x] Keep manual compaction behavior and avoid persisted retained-tail copies.
- [x] Persist retained-tail diagnostic counts in summary anchors.
- [x] Add token target, cap, oversized turn, tool-group, and manual/resume tests.
- [x] Review and commit the compaction slice.

## Provider Attempt Telemetry

- [x] Add the narrow Tape provider-attempt writer capability.
- [x] Record one idempotent outcome per actual provider request sequence.
- [x] Handle cumulative usage, overflow retry, abort, error, and no-usage outcomes.
- [x] Expose the latest nullable cache metrics through Tape info.
- [x] Verify new events do not enter Memory ingestion projection.
- [x] Review and commit the telemetry slice.

## Final Validation

- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
- [x] Run `pnpm run typecheck`, `pnpm test`, and `pnpm run build`.
- [x] Review any expected generated registry refresh.
- [x] Review the complete `dev...HEAD` diff by severity and fix every finding.
- [x] Confirm the working tree contains no unexpected files and no push occurred.

## Validation Result

- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm run build` completed successfully.
- The final focused context/runtime suite completed with 319 passing tests.
- The full `pnpm test` run completed with 6,505 passing and 2 skipped tests. Its nine failures
  exactly match the clean `dev` baseline: six in `test/main/data/mainDatabase.test.ts`, two in
  `test/main/app/startupMigrations/sessionDataMigrations.sqlite.test.ts`, and one in
  `test/main/scheduler/schedulerService.test.ts`.
- The generated provider and ACP registries were reviewed semantically and reproduced without a
  working-tree diff during the final build.
- The final P0-P3 branch review has no remaining findings. Review findings were fixed and
  revalidated before their commits.
- The final branch is clean, has no configured upstream, and was not pushed.
