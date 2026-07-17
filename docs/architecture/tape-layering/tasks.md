# Tape Layering Refactor Tasks

## Specification and Baseline

- [x] Record the pre-refactor Tape baseline: 120 passed and 26 environment-gated skipped tests.
- [x] Write the English `spec.md`, `plan.md`, and `tasks.md` artifacts.
- [x] Confirm the SDD artifacts contain no unresolved clarification markers or non-English prose.
- [x] Review and commit the SDD slice.

## Behavior Characterization

- [x] Split the monolithic Tape suite by reconciliation, recall, lineage, view/replay, and fork
      behavior.
- [x] Preserve every existing assertion and environment skip gate during the mechanical split.
- [x] Add transaction, reconciliation-order, and projection-fallback characterization coverage.
- [x] Review and commit the characterization slice.

## Domain and Ports

- [x] Move Tape-owned entry, source, provenance, and fact types out of Agent and SQLite modules.
- [x] Move effective-view and ViewManifest pure logic into `src/main/tape/domain/`.
- [x] Introduce normal storage and narrow consumer capability ports.
- [x] Replace the broad `TapeRecorder` dependency with `TapeToolFactWriter`.
- [x] Preserve old module paths through compatibility re-exports.
- [x] Review and commit the domain and port slice.

## Application Services

- [x] Extract fact, reconciliation, recall, lineage, view/replay, and fork services.
- [x] Convert `SessionTape` into a compatibility facade.
- [x] Preserve `SessionTapePort` and current reconciliation timing.
- [x] Review and commit the application-service slice.

## Infrastructure and Bypass Closure

- [x] Separate normal SQLite entry operations from destructive lifecycle operations.
- [x] Inject message fact capabilities into transcript without changing transaction boundaries.
- [x] Inject anchor and lifecycle capabilities into Session settings.
- [x] Replace Memory runtime and route table access with explicit capabilities.
- [x] Document and allowlist startup migration and Memory projection infrastructure exceptions.
- [x] Add lifecycle, transaction, projection, and authorization tests.
- [x] Review and commit the storage-boundary slice.

## Architecture Enforcement

- [x] Add domain dependency-direction tests.
- [x] Add a physical Tape table access guard with a narrow explicit allowlist.
- [x] Review and commit the architecture-guard slice.

## Review Remediation

- [x] Make reset generation replacement atomic across entries, mutation projection, search
      projection, FTS state, and the new bootstrap.
- [x] Make fork cleanup atomic while preserving a non-blocking, fail-closed discard receipt.
- [x] Read context projection rows only when projection version and metadata head match the
      synchronous caller's current Tape head in the same SQL statement.
- [x] Replace concrete `SessionTape` dependencies in the loop runner, Turn coordinator, and ACP
      compatibility adapter with narrow ports.
- [x] Reduce `TapeRawEntryReader` to the Memory runtime's `getBySession` requirement.
- [x] Replace Memory route raw rows with effective-source and ViewManifest inspection DTOs.
- [x] Remove production imports of legacy Tape compatibility paths.
- [x] Move handoff, generic anchor, and fork-message fact ownership into `TapeFactService`.
- [x] Restrict `TapeForkService` to fork lifecycle behavior.
- [x] Move stored-manifest validation and replay hash helpers into the domain layer.
- [x] Rename the complete source-set DTO to `TapeViewManifestAssemblySources` and retain its old
      name only as a deprecated legacy-path alias.
- [x] Harden architecture guards for main-layer, SQLite, Electron, logging, legacy-path, and Memory
      route violations, including table-driven negative fixtures.
- [x] Cover every legacy compatibility wrapper and the project's actual SQLite driver in the
      boundary guards.
- [x] Invalidate pre-atomic version 2 search projections and verify same-head context fallback.
- [x] Require capability injection for transcript and settings, with concrete facade construction
      limited to composition boundaries.
- [x] Keep capability-scoped consumers off the concrete facade through a negative-tested guard.
- [x] Remove unused anchor and storage operations from application-facing protocols while keeping
      concrete compatibility methods intact.
- [x] Refresh the canonical agent-system architecture baseline with the new Tape owner evidence.

## Documentation and Final Validation

- [x] Synchronize the English SDD with the implemented capabilities, transactions, ownership, and
      failure semantics.
- [x] Update Tape, Session, and Memory architecture references in their existing languages.
- [x] Run the Tape contract and scale suites.
- [x] Run the full main-process test suite and Memory performance suite.
- [x] Run full type checks, formatting, i18n validation, and lint.
- [x] Scan all three SDD artifacts for non-English prose and unresolved clarification markers.
- [x] Review the complete `dev...HEAD` diff and fix every finding.
- [x] Prepare the completed task checklist and final documentation slice for a local commit.
- [x] Confirm no unexpected working-tree files exist and no remote push has been performed before
      the final commit.

## Post-Review Hardening

- [x] Replace the stale monolithic Tape path in Memory native CI with all SQLite-gated split suites.
- [x] Make scope validation discover required native Tape coverage independently from the manifest.
- [x] Make final Session Tape deletion reuse the atomic generation lifecycle helper.
- [x] Recover failed FTS row deletion by dropping and invalidating the rebuildable derivative.
- [x] Remove pre-version-3 and metadata-orphaned search projection rows at schema initialization.
- [x] Add direct reset-bootstrap rollback and corrupt-FTS lifecycle regression tests.
- [x] Put pending-input deletion, transcript deletion, and Tape reset in one clear-time transaction.
- [x] Freeze and deprecate legacy Tape compatibility export lists without removing old symbols.
- [x] Use distinct canonical names for application assembly sources and domain lookup maps.
- [x] Audit unused concrete storage helpers and retain those present on historically exported
      SQLite classes while removing non-historical facade raw-row forwarding methods.
- [x] Detect dynamic import, CommonJS require, type import, and re-export Memory route bypasses.
- [x] Reuse the composition-owned Tape message writer in legacy import.
- [x] Document the same-connection transaction requirement for settings anchor writers.
- [x] Cache FTS capability detection per SQLite connection.
- [x] Replace fallback tests that depend on missing mock methods with explicit failures.
- [x] Document permanent fork residue when best-effort discard cleanup fails.
- [x] Run focused native scope, lifecycle, recall, boundary, migration, and compatibility tests.
- [x] Run full validation, reproduce the nine unrelated main-suite failures on the exact `dev`
      baseline, and review every new local commit without pushing.
