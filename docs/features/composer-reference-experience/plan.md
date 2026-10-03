# Composer reference experience execution

- [x] Inspect composer, inline persistence, queue/message edit contracts, and reference products.
- [x] Create `feat/composer-reference-experience` and record the hybrid design.
- [x] Preserve structured workspace references through shared contracts and document projections;
      keep provider input semantics unchanged. Validate and commit this coherent slice.
- [x] Implement lightweight reference details, grouped picker, and separate attachment shelf using
      existing Vue/Tiptap/shadcn components. Preserve representation controls and legacy content.
- [x] Carry structured edits through queue and message editing, enforce original session grants,
      and use rendered-height message disclosure. Validate and commit integrated behavior.
- [x] Review the complete branch for P0/P1/P2/P3 defects, compatibility and permission boundaries.
      Fix confirmed findings and run focused regression checks.
- [x] Perform ablation: remove unnecessary layers or state, and demonstrate that retained guards
      protect a concrete failure case. Keep durable tests only for observable contracts.
- [x] Run format, i18n, lint, typecheck, relevant main/renderer tests and isolated Electron checks.
      Inspect light/dark and narrow/normal rendered states; keep review screenshots in `.amp/in/`.
- [x] Update affected session-reference documentation, record validation, and make the final local
      commit. Do not push or create a PR.

Implementation precedes new tests. Existing tests may run during each slice. The final review covers
all commits from the branch base, not only the last working diff.

## Review and simplification

Reviewed the branch for P0–P3 findings across grant validation, serialization, legacy compatibility,
component ownership, keyboard handling, and asynchronous lifecycle behavior. Confirmed findings were
fixed: nested same-name paths lost their distinguishing prefix; stale or mismatched file metadata
could render a different source; save shortcuts inserted a newline before saving; and direct scroll
writes bypassed the existing scroll controller. No confirmed introduced finding remains unresolved.
Pre-existing asynchronous edit-failure handling and same-ID queue refresh behavior are outside this
change; the review does not claim application-wide absence of bugs.

Removed attachment-reference tracking state and implicit material deletion, redundant inline-item
types, a redundant mutation scope, and local scroll correction. The shelf owns material deletion;
existing document synchronization and scroll measurement retain their responsibilities. No new
dependency, second editor implementation, or layout setting was introduced.

Ablation with asymmetric inputs demonstrated that removing the text-span guard accepts stale
metadata, removing the path-identity guard accepts a mismatched source, and removing the equal-path
collision check gives `src/foo.ts` and `test/src/foo.ts` the same label. Those guards were retained;
the temporary probe was removed.

## Validation

- Format, i18n validation/check (23 locales), lint, node/web typecheck, and build passed.
- Full renderer suite: 288 files, 2670 tests passed, including architecture ownership checks.
- Session, context-builder, and exporter main suites: 47 files, 948 tests passed.
- Isolated Electron Playwright specs 37 and 39 passed. These exercised draft restoration, reference
  retrieval, two same-name file selections, details/open, queue editing/removal, attachment shelves,
  unavailable sources, long-message disclosure, and composer paste.
- Inspected normal/narrow and light/dark captures, picker, editable/sent attachments, queue,
  recovery, and unavailable-source states. Captures use disposable fixture data under `.amp/in/`.
- Native runtime validation was on macOS; Windows/Linux were not separately exercised. External
  provider calls were mocked; provider behavior was not changed.

Delivery is local to `feat/composer-reference-experience`, in separate design, contract, and UI
commits. No push or PR is authorized or performed.
