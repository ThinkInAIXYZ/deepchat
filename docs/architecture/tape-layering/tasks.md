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
- [x] Run the Tape contract and scale suites.
- [x] Review and commit the architecture-guard slice.

## Documentation and Final Validation

- [ ] Update Tape, Session, and Memory architecture references.
- [ ] Run the full main-process test suite and Memory performance suite.
- [ ] Run full type checks, formatting, i18n validation, and lint.
- [ ] Review the complete `dev...HEAD` diff and fix every finding.
- [ ] Complete the task checklist and commit the final documentation slice.
- [ ] Confirm the working tree is clean and the branch has not been pushed.
