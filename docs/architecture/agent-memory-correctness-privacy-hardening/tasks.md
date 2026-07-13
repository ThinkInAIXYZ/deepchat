# Agent Memory Correctness and Privacy Hardening — Tasks

## Architecture and Storage

- [x] Add message-aligned, CJK-aware extraction chunks with Unicode-safe oversized-message fragments.
- [x] Make cursor advancement follow successful complete-message boundaries and preserve exact chunk lineage.
- [x] Replace local lineage parsers with one shared codec.
- [x] Add per-agent read epochs and destructive operation generations with separate semantics.
- [x] Add authoritative retrieval revalidation and the final injection epoch/enablement gate.
- [x] Add correctness-only working-memory dirty tracking and shared mutation finalization.
- [x] Add conflict aggregate guards, transactional challenge creation, integrity repair, and indexed lookup.
- [x] Add additive migration v41 with `decision_revision INTEGER NOT NULL DEFAULT 1`.
- [x] Add revision-checked atomic UPDATE, SUPERSEDE, and CHALLENGE operations with one bounded retry.
- [x] Make maintenance merge CAS both participants and reject stale model output.
- [x] Add provenance v2 SHA-256 keys, verified legacy lookup, and lazy re-key.

## External Lifecycles

- [x] Route vector query, query-by-ID, upsert, delete, and reconcile through manager-owned generation leases.
- [x] Make failed vector reset recoverable through `requiresReset`.
- [x] Gate ready and reconcile writeback by vector-store generation.
- [x] Drain vector stores per agent in parallel without force-closing active native operations.
- [x] Add the agent-aware provider gateway with required rate-limit admission and purpose deadlines.
- [x] Add per-agent provider abort and bounded unsettled-request capacity.
- [x] Bound dispose with one five-second deadline and guard every late side effect.

## Native Validation and Documentation

- [x] Add a real SQLite smoke script and focused native migration suite.
- [x] Add the isolated `memory-native-validation` GitHub Actions job.
- [x] Keep Node ABI preparation inside the disposable CI dependency tree.
- [x] Remove local package scripts that could replace the developer's Electron ABI binding.
- [x] Synchronize the maintained English and Chinese as-built architecture specifications.
- [x] Publish self-contained English architecture documents without external document dependencies.
- [x] Confirm the post-commit `memory-native-validation` GitHub Actions job passes.

## Validation Evidence

- [x] Focused Agent Memory main-process suite: **362/362 passed**.
- [x] Native SQLite suite executed before restoring the local Electron ABI: **125/125 passed**.
- [x] Memory renderer suite: **116/116 passed**.
- [x] Type checking passed.
- [x] Formatting, i18n, lint, architecture guard, and `git diff --check` passed.

Repository-wide evidence at implementation close:

- Main process with the Electron ABI preserved: **3285/3432 passed**, **145 skipped**. The two failures were
  outside Agent Memory: a debug fixture missing a plan block and long-steer rebudget behavior. Native-only
  suites skipped locally by design and remain mandatory in the isolated CI job.
- Renderer: **1225/1229 passed**. The four failures were outside Agent Memory and reproduced as missing
  `setActivePinia` exports in their own Pinia mocks.

The repository-wide unrelated failures are recorded as evidence and are not part of this architecture goal.
