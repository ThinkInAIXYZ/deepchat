# Light OCR 0.5.5 PDF Support Plan

## Architecture

Extend the existing OCR boundaries instead of creating a second runtime:

1. `PdfFileAdapter` computes bounded embedded-text coverage while producing the existing
   `file.content` snapshot.
2. `AttachmentCapabilityRouter` owns PDF representation policy alongside image policy.
3. `DocumentTextExtractionService` owns immutable PDF snapshots, document cache compatibility,
   page-aware assembly, singleflight ownership, and normalized partial outcomes.
4. `LightOcrProcessHost` adds a streaming request path while keeping image request/response behavior
   unchanged.
5. `LightOcrHelperServer` reuses the configured `OcrEngine` through
   `createDocumentEngine({ engine })`.
6. `OcrArtifactStore` keeps image artifacts and document artifacts in schema-v2 derived storage.

`OcrRuntimeService` creates one shared scheduler for image and document extraction so expensive PDF
work cannot run concurrently with image inference against the serialized helper engine.

## Data Flow

```text
PDF attachment preparation
  -> PdfFileAdapter embedded page coverage + file.content snapshot
  -> attachment preference / Auto 90% classifier
     -> embedded_text -> persist and use file.content
     -> ocr_text
        -> immutable bounded source snapshot + SHA-256
        -> prepare engine / exact document cache lookup
        -> helper recognize_document stream
        -> host validates pages and page-aware assembler updates prefix
        -> request_complete | host output stop | upstream resource error
        -> cache deterministic artifact when eligible
        -> turn-level page-aware packing
        -> persist exact resolved representation
        -> escaped untrusted provider context + UI status
```

History, retry, compaction, search, export, and sync reuse the persisted representation and never
re-open the source PDF.

## Phase 1: Dependency And Packaging Closure

Update `resources/runtime-versions.json` to explicit facade, runtime, model, and native versions.
Update the exact root dependency and lockfile.

In `scripts/afterPack.js`:

- exact-pin and copy facade 0.5.5, runtime 0.1.5, model 0.3.4, and matching native 0.5.5;
- validate `src/index.cjs` and `runtime/src/index.cjs`;
- resolve native packages through runtime ownership;
- classify native manifest artifacts into descriptor runtime, PDFium, and non-code data;
- encode all macOS `.node`/`.dylib` files under both `native/` and `pdfium/`;
- write runtime manifest schema v3 with the runtime path and PDF support flag.

Move the script-side artifact classifier into a small shared ESM module used by `afterPack` and
`smoke-light-ocr`. Keep a TS-side classifier only where the app build boundary requires it, and add
contract tests that feed all implementations the same path matrix.

Extend `lightOcrNativePayload` so schema-v3 macOS materialization:

- keeps descriptor inventory equality strict for `native/`;
- separately requires the platform PDFium inventory declared by `artifact-hashes.json`;
- decodes code with bounded gzip output and canonical base64 checks;
- copies verified `pdfium/index.cjs`;
- returns a PDFium module path only for encoded macOS payloads.

Update development and packaged asset resolution for the runtime package and independent versions.
Before helper startup, verify the materialized PDFium module explicitly; do not rely only on
upstream `hasPdfSupport()` swallowing load errors.

## Phase 2: Streaming Protocol And Host

Advance `LIGHT_OCR_PROTOCOL_VERSION` to 2. Add strict validators for document requests, pages,
completion, and stop messages. Keep each page below the existing 4 MiB line ceiling by omitting
quadrilateral boxes from the wire document-page payload; DeepChat only needs ordered line text and
page metrics.

The helper:

- validates the private PDF path and byte limit before loading;
- creates a document engine from the already configured OCR engine;
- emits one sanitized page at a time;
- tracks user cancellation separately from an output-limit stop;
- emits `request_complete` for natural completion or acknowledged host stop;
- preserves structured upstream `OcrError.code` in error responses.

The host adds a document queue item and a dedicated streaming pending map. It validates monotonic,
zero-based upstream page indices, positive dimensions, bounded lines, model identity, and
`emittedPages`. The idle timeout resets only after a valid page; the total timeout is independent.

Output budget is enforced in main. When the assembler first reaches the effective generation limit,
main sends `document_stop`, continues consuming the terminal response, and records
`generationOutputLimitReached`.

User abort uses existing `cancel`; it rejects the owner, kills the helper after the grace period if
needed, and discards the accumulator.

## Phase 3: Page-Aware Assembly And Cache

Add `DocumentTextExtractionService` with a PDF-only immutable snapshot reader. It applies the same
per-file and pending-byte bounds as image OCR but skips Sharp preprocessing. Snapshot creation copies
and hashes the source incrementally into the helper-private directory with a fixed-size buffer; the
main process never retains the complete PDF in a `Buffer`. The service reserves the declared source
limit before copying, then contracts that reservation to the immutable snapshot's actual size, so
concurrent copies cannot bypass the shared pending-byte bound. The shared extraction flight owns the
private file and releases it only after every joined owner settles.

Use a fixed PDF recognition strategy and include it in identity. Prepare the engine before cache
lookup so actual provider chains and precision remain part of the canonical key.

Add pure helpers for:

- normalized page text;
- page heading and truncation marker formatting;
- prefix-only fitting under token and character limits;
- page-span validation;
- lower-budget page-aware truncation;
- budget compatibility;
- retained-coverage dominance.

Schema v2 adds a document table keyed by exact identity. It stores the engine status, text, page
spans, normalized termination, generation limit facts, diagnostic emitted-page count, source page
hint, and logical-byte accounting. Empty text is valid for a completed negative artifact or for a
resource-limited artifact with at least one validated page; it is invalid for output-limit
termination.

The page-span validator is shared with persisted attachment normalization so cache artifacts and
message snapshots enforce identical heading, marker, offset, and text-coverage invariants. Cache
validation memoizes token estimates by artifact object identity to avoid rescanning the same bounded
text at adjacent service/store boundaries.

Image schema and public behavior remain unchanged apart from the one-time derived-cache rebuild.

## Phase 4: Routing, Persistence, And Context

Add `embedded_text` to the attachment preference and resolved representation contracts. Add
validated, bounded PDF document metadata and the `ocr_resource_limited` unavailable/warning reason.
Legacy payloads without the new fields remain valid.

`PdfFileAdapter` records page coverage during its existing parse. The router:

- recognizes PDFs by normalized MIME type or `.pdf` fallback;
- applies contextual preference normalization;
- admits at most one PDF OCR candidate per attachment preparation while preserving the independent
  image OCR candidate limit;
- reuses preserved resolved snapshots before source work;
- selects embedded or OCR under the final routing contract;
- maps empty embedded snapshots, zero-text resource-limited prefixes, zero-page deterministic
  limits, and transient helper failures explicitly;
- adds a degraded issue while retaining useful partial OCR text;
- reports `turn_ocr_budget_exhausted` when packing, rather than recognition, removes all PDF OCR
  text;
- removes `ocr_empty` from retryable reasons.

Turn packing uses document page spans for PDF OCR and the existing head-tail helper for image OCR.
The packed snapshot updates page coverage and never writes back to cache.

Update `contextBuilder` so resolved PDF OCR is excluded from generic non-image `file.content` and
rendered as one escaped untrusted document OCR block. Embedded PDFs keep the current file-content
path, including sanitized path and byte-size metadata needed for follow-up file reads. Update
transcript/search normalization limits only where new structured fields require it.

Keep protocol `LIGHT_OCR_DOCUMENT_MAX_PAGES`, persisted span limits, and parsed-page-count sanity
limits as independently named constants even when their current numeric values happen to match.

## Phase 5: Renderer And i18n

Use the existing shadcn dropdown, badge, dialog, and alert primitives:

- show the representation dropdown for images and PDFs;
- render image-specific and PDF-specific choices;
- show embedded, OCR, truncated, resource-limited, and unavailable states;
- include page coverage in the OCR preview;
- keep the closed chip and dropdown trigger concise, reveal page/diagnostic detail only in the
  preview or expanded state, and avoid repeating equivalent status copy;
- generalize preparation dialogs from image-only wording to attachment wording.

Update composer draft identity and node attributes for `embedded_text`. Translate every new key for
all shipped locales and run the repository i18n validator.

## Phase 6: Packaging Smoke And Validation

Extend packaged layout verification to schema v3 and all four version pins. Add a deterministic PDF
fixture generated locally during smoke, then verify at least one streamed page contains the expected
text. Keep the existing real image OCR fixture unchanged.

Packaging smoke must validate:

- direct Linux/Windows PDFium layout;
- encoded macOS inventory and same-directory materialization;
- explicit PDFium module load on macOS;
- helper protocol v2 handshake;
- real image and PDF OCR with network denied;
- clean shutdown and no raw macOS PDFium code in the unpacked app.

Run focused validation after each implementation slice. Before final handoff run:

```text
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

Run current-platform packaged smoke when the local runtime and packaging prerequisites are
available. Do not claim other platform results without their native workflow runs.

The native SQLite CI step must run both image and document OCR artifact store suites with
`DEEPCHAT_REQUIRE_NATIVE_SQLITE=1`, so a missing native binding fails instead of silently skipping
document schema and replacement tests.

## Compatibility And Migration

- Root message fields remain optional and old image representations normalize as before.
- `embedded_text` stores no duplicate text body; old PDFs without a resolved representation continue
  through the legacy non-image content path until newly submitted.
- OCR cache schema v1 is derived data and is rebuilt once as schema v2. No message/database migration
  depends on cache availability.
- Tape search projections advance one derived-data revision so persisted embedded PDF text is
  indexed without reopening source files.
- Runtime manifest schema v2 is rejected after the package upgrade; supported packages always write
  schema v3.
- No public route removes `accepted` or changes existing cancellation semantics.
- `ocr_cancelled` remains accepted but non-emitted.

## Review Gates

Before every commit:

1. inspect the complete staged diff and affected call paths;
2. rank findings by severity;
3. review hidden side effects, compatibility, boundaries, performance, security, naming, test
   sufficiency, and maintenance cost;
4. fix all findings that belong to the slice;
5. rerun the smallest meaningful validation set;
6. commit with a message describing the delivered behavior, never the review activity.

No commit from this work is pushed.
