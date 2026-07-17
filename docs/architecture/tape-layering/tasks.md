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

- [ ] Move Tape-owned entry, source, provenance, and fact types out of Agent and SQLite modules.
- [ ] Move effective-view and ViewManifest pure logic into `src/main/tape/domain/`.
- [ ] Introduce normal storage and narrow consumer capability ports.
- [ ] Replace the broad `TapeRecorder` dependency with `TapeToolFactWriter`.
- [ ] Preserve old module paths through compatibility re-exports.
- [ ] Review and commit the domain and port slice.

## Application Services

- [ ] Extract fact, reconciliation, recall, lineage, view/replay, and fork services.
- [ ] Convert `SessionTape` into a compatibility facade.
- [ ] Preserve `SessionTapePort` and current reconciliation timing.
- [ ] Review and commit the application-service slice.

## Infrastructure and Bypass Closure

- [ ] Separate normal SQLite entry operations from destructive lifecycle operations.
- [ ] Inject message fact capabilities into transcript without changing transaction boundaries.
- [ ] Inject anchor and lifecycle capabilities into Session settings.
- [ ] Replace Memory runtime and route table access with explicit capabilities.
- [ ] Document and allowlist startup migration and Memory projection infrastructure exceptions.
- [ ] Add lifecycle, transaction, projection, and authorization tests.
- [ ] Review and commit the storage-boundary slice.

## Architecture Enforcement

- [ ] Add domain dependency-direction tests.
- [ ] Add a physical Tape table access guard with a narrow explicit allowlist.
- [ ] Run the Tape contract and scale suites.
- [ ] Review and commit the architecture-guard slice.

## Documentation and Final Validation

- [ ] Update Tape, Session, and Memory architecture references.
- [ ] Run the full main-process test suite and Memory performance suite.
- [ ] Run full type checks, formatting, i18n validation, and lint.
- [ ] Review the complete `dev...HEAD` diff and fix every finding.
- [ ] Complete the task checklist and commit the final documentation slice.
- [ ] Confirm the working tree is clean and the branch has not been pushed.
