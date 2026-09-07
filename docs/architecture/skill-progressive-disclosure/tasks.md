# Skill Progressive Disclosure Tasks

## Specification

- [x] Verify current Skill catalog, tool, activation, context, and Tape paths.
- [x] Define Route / Discover / Activate product semantics and budgets.
- [x] Define Tape materialization, continuation, isolation, and fail-closed boundaries.
- [x] Write `spec.md`, `plan.md`, and `tasks.md`.
- [x] Update maintained Skill and Tape architecture references.
- [x] Review and commit the SDD slice.

## P0a: Route And Discover

- [x] Add canonical whitelisted Skill routing cards and stable normalization.
- [x] Add the 2-percent/2,000-token budget and Unicode-safe description cap.
- [x] Add binary UTF-8 ordering, deterministic shared-cap summaries, name-only, zero-block, and
      omission allocation.
- [x] Add compact system renderer and bounded render report.
- [x] Pass effective context length through prompt assembly without moving final preflight.
- [x] Add prompt provenance degradation for catalog shortening/omission.
- [x] Extend `skill_list` with optional `query`, `cursor`, and `limit`.
- [x] Add deterministic local lexical ranking and catalog-fingerprint-bound pagination.
- [x] Add structured JSON routing-card renderer and response token ceiling.
- [x] Remove arbitrary metadata and unbounded descriptions from provider results.
- [x] Wire Route omission and bounded discovery atomically.
- [x] Add boundedness, determinism, Unicode, tiny-window, ranking, cursor, pagination, whitelist,
      active-state, refresh, and omitted-Skill tests.
- [x] Review and commit the Route/Discover slice.

## P0b: Tape Foundation

- [x] Add the forward-compatible physical `context` kind and canonical Skill materialization
      payload with per-body, count, and aggregate byte limits.
- [x] Add narrow materialization writer and runtime reader capabilities.
- [x] Add transactional strict payload equality and corruption handling for provenance-key reuse.
- [x] Add ViewManifest schema 6/hash 4 with Skill contexts and optional ExecutionContract.
- [x] Add Run/request/incarnation binding, independent durable-manifest policy, and runtime reader.
- [x] Exclude materialization facts from effective views, transcript, search, Tape tools, Memory,
      ordinary renderer projection, and fork merge.
- [x] Add old-reader compatibility, schema/hash, corruption, reset, isolation, and native SQLite
      tests.
- [x] Review and commit the Tape Foundation slice.

## P0b: Safe Runtime View

- [x] Extract the canonical fresh-resolving effective-content builder.
- [x] Return body plus runtime instructions from root `skill_view`.
- [x] Add exact result size/context checks, strict Journal outcome validation, and a strictly
      persisted canonical `tool_result` before activation.
- [x] Make later transcript settlement reuse and verify the same tool-result fact.
- [x] Add the Run-local projection registry, strict pause/resume recovery, and overlap-aware
      root-view confirmation.
- [x] Require a strict schema-6 Skill-bearing manifest before the next provider request.
- [x] Refresh only tools/allow-list after successful activation.
- [x] Remove the duplicate leading-system body projection.
- [x] Preserve supporting-file view and bound repeated root views.
- [x] Replace completed historical root-view bodies with markers without mutating exact Tape facts
      or permission-resume projections.
- [x] Add settlement ordering, manifest failure, all activation-source overlaps, repeat-view, and
      supporting-file tests.
- [x] Review and commit the runtime-view slice.

## P0b: Message And Session Projection

- [x] Separate message Skill refs from Session active Skills in runtime APIs.
- [x] Add pre-write count/byte guards and a two-phase flow whose sole token-admission decision is
      the final fact-derived `ContextCoordinator` preflight.
- [x] Build active-turn and stable-system projections only from verified facts.
- [x] Carry exact refs through tool rounds, retries, recovery, and in-process pause/resume; preserve
      existing parked restart behavior.
- [x] Record Skill-context refs and projection hashes in strict Skill-bearing ViewManifests.
- [x] Leave bounded historical markers without persisting full bodies in transcript history.
- [x] Enforce one complete body per Skill per request.
- [x] Verify regular first-message selection remains message-scoped while preserving explicit
      detached and subagent Session-active assignment.
- [x] Remove the dormant persistent mention fallback.
- [x] Add continuation/new-execution, source drift, deduplication, recovery, and semantic tests.
- [x] Review and commit the projection slice.

## P0b: Session Compatibility UI

- [x] Display existing Session active Skills separately from next-message selections.
- [x] Allow removal through the existing typed route without adding a Pin action.
- [x] Use existing i18n contracts and add renderer tests for visibility, removal, errors, and
      Session-switch races.
- [x] Review and commit the compatibility UI slice.

## P1: Context Ledger

- [x] Add ephemeral render reports without changing prompt-section identity.
- [x] Derive category costs from the exact final projection and preflight.
- [x] Report approximate, unattributed, and opaque costs honestly.
- [x] Make overflow diagnostics actionable for Session active Skill removal.
- [x] Add attribution and projection-mismatch tests.
- [x] Review and commit the context-ledger slice.

## P2: Provider Overflow Facts

- [x] Parse structured actual/limit observations from provider errors.
- [x] Keep configured context, explicit Provider limit, and derived Session ceiling separate; leave
      estimator calibration unchanged.
- [x] Retry only when the final Provider messages or effective output limit materially change.
- [x] Skip unchanged or locally inadmissible retries and surface model-setting guidance.
- [x] Add explicit-limit, generic-error, metadata-suspect, and retry-decision tests.
- [x] Review and commit the overflow-facts slice.

## Final Validation

- [x] Extend canonical materializations with bounded private `scripts/` plus declared-support
      execution packages under schema 3 with schema 2 read compatibility, unchanged-bundle
      compatibility migration, and non-secret environment revision bindings.
- [x] Add ViewManifest schema 7/hash 5 to bind runtime tool-result bodies and execution packages to
      one exact Provider request, including strict replay and continuation recovery.
- [x] Execute `skill_run` only from an exact execution-bound package ref and fail closed on package,
      environment, extraction, or hash drift.
- [x] Revalidate the exact Skill-bearing request authority after rate/retry waits and immediately
      before every physical Provider attempt.
- [x] Remove the mutable prompt-builder fallback so direct ACP compatibility cannot project local
      Skill bodies without Tape materialization authority.
- [x] Run format, i18n, lint, Node/web type checks, main/renderer tests, and build.
- [x] Review generated provider and ACP registry output.
- [x] Review the complete `dev...HEAD` diff by severity and fix every material finding.
- [x] Confirm the branch has no unexpected files, no upstream, and no push occurred.
