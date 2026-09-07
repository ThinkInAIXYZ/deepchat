# Light OCR 0.5.5 PDF Support Tasks

## Specification

- [x] Verify the upstream 0.5.5 release, npm facade/runtime/native tarballs, public document API, and
  PDFium manifests.
- [x] Resolve Auto routing, page range, pixel limits, streaming termination, partial-result,
  cancellation, retry, cache identity, compatibility, and replacement semantics.
- [x] Write the feature specification and implementation plan.
- [x] Complete the pre-commit specification review and commit the SDD slice.

## Dependency And Packaging

- [x] Pin facade 0.5.5, runtime 0.1.5, model 0.3.4, and native 0.5.5 independently.
- [x] Copy and verify the runtime package in supported packaged layouts.
- [x] Add shared script artifact classification and drift tests.
- [x] Encode and smoke-validate macOS PDFium Mach-O artifacts.
- [x] Materialize verified PDFium files with the `@loader_path` same-directory contract.
- [x] Resolve development native packages through runtime ownership.
- [x] Advance and validate packaged OCR manifest schema v3.
- [x] Update size accounting for the PDFium payload.
- [x] Complete the pre-commit packaging review, focused tests, and commit.

## Streaming Document OCR

- [x] Add protocol-v2 document request/page/completion/stop contracts.
- [x] Add helper document-engine reuse, structured errors, PDF capability validation, and separate
  output-stop/user-cancel behavior.
- [x] Add host streaming pending state with idle and total timeouts.
- [x] Add queue accounting, cancellation cleanup, monotonic page validation, and crash behavior.
- [x] Add protocol/helper/host tests for every legal and illegal terminal combination.

## Document Artifacts

- [x] Add immutable bounded PDF snapshots and shared scheduler ownership.
- [x] Add page-aware prefix assembly and lower-budget truncation.
- [x] Add exact document identity and schema-v2 storage.
- [x] Add persisted `generationOutputLimitReached` compatibility logic.
- [x] Add retained-text coverage dominance replacement.
- [x] Cover empty, complete, output-limited, resource-limited, cancel, timeout, and invalid-cache
  outcomes.

## Routing And Persistence

- [x] Add PDF attachment detection and contextual representation normalization.
- [x] Add bounded embedded-page coverage from `PdfFileAdapter`.
- [x] Add the 64-code-point / 90-percent Auto classifier and routing revision.
- [x] Route embedded, explicit OCR, and automatic OCR PDFs.
- [x] Enforce one PDF OCR candidate per preparation without reducing the image OCR allowance.
- [x] Preserve document coverage in normalized message snapshots.
- [x] Apply page-aware turn packing without modifying cache artifacts.
- [x] Exclude embedded PDF content when an OCR snapshot is selected.
- [x] Keep PDF OCR blocks escaped and guarded as untrusted user data.
- [x] Remove `ocr_empty` from retryable reasons and keep cancellation non-emitted.

## Renderer And i18n

- [x] Add PDF Auto/embedded/OCR choices to attachment chips.
- [x] Show embedded, OCR, truncated, resource-limited, and unavailable PDF states.
- [x] Show included-page coverage in the OCR preview.
- [x] Keep default chip/control copy compact and move secondary PDF detail behind preview/expand.
- [x] Generalize image-only preparation copy.
- [x] Translate and validate every shipped locale.

## Validation

- [x] Preserve existing image OCR unit, integration, and packaged smoke behavior.
- [x] Add textual, scanned, mixed-coverage, empty, over-100-page, output-limit, resource-limit, and
  cancellation PDF tests.
- [x] Add deterministic packaged PDF OCR smoke.
- [x] Run focused main and renderer tests after each slice.
- [x] Run format, i18n, lint, typecheck, full tests, and production build.
- [x] Run current-platform packaged smoke when prerequisites are available.
- [x] Complete the final cross-module review and resolve findings.
- [x] Update this checklist and the retained historical OCR specification.
- [x] Commit the validated implementation and documentation locally.
- [x] Do not push.

## Validation Evidence

- Focused protocol, helper, host, artifact, routing, persistence, renderer, and packaging suites
  passed after their implementation slices.
- The full main suite passed with 5,142 tests and 244 skips; the full renderer suite passed with
  1,578 tests.
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm run build` passed.
- An unsigned macOS arm64 packaged app passed the network-denied Light OCR smoke. The helper
  recognized both the existing image fixture and a generated one-page image-only PDF through the
  packaged PDFium runtime.
- Post-implementation hardening passed 259 focused tests with four native-SQLite skips on this
  machine, plus the full main suite with 5,153 tests passed and 244 skipped. Format, i18n, lint, and
  node/web typecheck also passed.

## Post-Implementation Hardening

- [x] Share content-aware page-span validation between cache artifacts and persisted snapshots.
- [x] Restore output-limit compatibility as the fifth document coverage replacement criterion.
- [x] Stream immutable PDF snapshots to helper-private files without retaining whole-document
  buffers in main.
- [x] Distinguish turn packing exhaustion from empty OCR output.
- [x] Restore embedded PDF path and size metadata in provider context.
- [x] Avoid repeated token estimation at adjacent document artifact validation boundaries.
- [x] Separate protocol page, persisted span, and parsed page-count sanity constants by name.
- [x] Require document artifact persistence tests in the native SQLite CI step.
- [x] Run focused validation, required repository checks, pre-commit review, and commit locally.
- [x] Do not push.
