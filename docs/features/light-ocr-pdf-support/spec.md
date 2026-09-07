# Light OCR PDF Support

Status: implemented and locally validated

Current runtime increment:
[arcships/light-ocr v0.5.6](https://github.com/arcships/light-ocr/releases/tag/v0.5.6)

Initial PDF support release:
[arcships/light-ocr v0.5.5](https://github.com/arcships/light-ocr/releases/tag/v0.5.5)

## User Need

DeepChat already extracts embedded PDF text through `pdf-parse-new`, but scanned PDFs and PDFs with
little usable text remain effectively empty. Light OCR 0.5.5 adds built-in, offline PDF OCR through
the same facade and model used for image OCR. Light OCR 0.5.6 adds a package-local Noto Sans SC
fallback so PDFium can render documents that reference common non-embedded Chinese fonts. DeepChat
needs to ship that runtime correctly, expose PDF representation choices in the attachment UI, and
preserve the exact bounded PDF text used by the provider.

## Goals

- Upgrade the stable Light OCR facade to 0.5.6 without changing the existing image-recognition
  semantics.
- Package the model-free runtime and the matching six native packages, including each platform's
  PDFium payload and fallback-font resources, with no postinstall download or runtime network
  dependency.
- Add `Auto`, `Use embedded text`, and `Use OCR text` choices for PDF attachments.
- Route `Auto` using page-level embedded-text coverage instead of formatted `file.content`.
- Stream PDF pages from the standalone helper so main can stop work when the local output budget is
  reached.
- Preserve page-aware, prefix-only OCR text with explicit coverage and partial-result metadata.
- Reuse complete, empty, output-limited, and resource-limited deterministic document artifacts under
  an exact cache identity.
- Keep cancellation as submission control flow: it must not create an attachment failure snapshot,
  cache a partial artifact, or suggest `retry`.

## Non-Goals

- No per-page embedded/OCR hybrid in this increment. A PDF uses one representation for the whole
  document.
- No OCR language selector, password prompt, PDF repair, form extraction, table reconstruction, or
  layout-preserving document model.
- No change to knowledge-base ingestion, workspace file reading, MCP files, tool output, generated
  files, or PDFs already handled natively by a provider-specific feature.
- No increase to PDFium's initial 150 DPI, 100 Mi rendered-pixel limit, or 100-page requested range
  without measured performance evidence.
- No removal of the legacy `ocr_cancelled` contract value. It remains accepted for compatibility but
  is not produced by the current preparation pipeline.
- No dependency on the compatibility-only `@arcships/light-ocr-document` package.

## Dependency And Packaging Contract

The four independently versioned components are pinned exactly:

| Component | Package | Version |
| --- | --- | --- |
| Stable facade | `@arcships/light-ocr` | `0.5.6` |
| Model-free runtime | `@arcships/light-ocr-runtime` | `0.1.6` |
| Small model | `@arcships/light-ocr-model-ppocrv6-small` | `0.3.4` |
| Native packages | six `@arcships/light-ocr-<platform>` packages | `0.5.6` |

The facade entry point is `src/index.cjs`. The runtime is a required packaged dependency because the
facade imports `@arcships/light-ocr-runtime/facade`, and native-package resolution belongs to that
runtime rather than to the facade.

Each supported native package must contain its existing OCR runtime inventory plus:

| Platform | Required PDFium inventory |
| --- | --- |
| macOS | `pdfium/index.cjs`, `pdfium/pdfium.node`, `pdfium/libpdfium.dylib`, `pdfium/fonts/NotoSansSC-Regular.otf`, `pdfium/fonts/OFL.txt` |
| Linux | `pdfium/index.cjs`, `pdfium/pdfium.node`, `pdfium/libpdfium.so`, `pdfium/fonts/NotoSansSC-Regular.otf`, `pdfium/fonts/OFL.txt` |
| Windows | `pdfium/index.cjs`, `pdfium/pdfium.node`, `pdfium/pdfium.dll`, `pdfium/fonts/NotoSansSC-Regular.otf`, `pdfium/fonts/OFL.txt` |

Inventory checks group descriptor-owned OCR runtime code and manifest-owned `pdfium/` files
separately. The complete recursive `pdfium/` tree is an explicit allowlist and rejects missing,
unexpected, non-regular, or symlinked resources; unrelated provider artifacts do not affect that
contract.

macOS continues to encode raw Mach-O files as `gzip-base64-v1` before signing. Both
`native/*.{node,dylib}` and `pdfium/*.{node,dylib}` are encoded and removed from the unpacked app.
Runtime materialization:

- verifies every source entry against `artifact-hashes.json`;
- reconstructs the descriptor-owned OCR runtime files;
- reconstructs `pdfium/index.cjs`, `pdfium/pdfium.node`, and `pdfium/libpdfium.dylib` with the two
  PDFium Mach-O files in the same directory, preserving the `@loader_path` dependency;
- copies the verified raw font and OFL resources into the private materialized
  `pdfium/fonts/` directory so the loader's relative fallback path remains valid;
- sets `LIGHT_OCR_PDFIUM_MODULE` to the materialized `pdfium/index.cjs` only on macOS.

Linux and Windows keep the direct package layout and do not set `LIGHT_OCR_PDFIUM_MODULE`; upstream
must resolve `<native-package>/pdfium` so the Windows loader receives the `PATH` adjustment in
`index.cjs`.

The packaged runtime manifest advances to schema v3 and records all four component versions, the
runtime package path, native payload encoding, and the PDFium capability. Packaging, runtime
resolution, and smoke validation must reject a partial or mixed-version closure.

## PDF Representation Semantics

PDF attachments support:

| Requested representation | Effective behavior |
| --- | --- |
| `auto` | Use embedded text when at least 90% of pages are substantive; otherwise OCR the whole requested range. |
| `embedded_text` | Use the existing `file.content` snapshot without OCR. |
| `ocr_text` | OCR the whole requested range regardless of embedded coverage. |

Image choices remain `auto`, `image`, and `ocr_text`. Contextually invalid legacy pairings fall back
to `auto` rather than changing existing persisted drafts into hard failures.

A page is substantive when its normalized embedded text contains at least 64 non-whitespace Unicode
code points. The classifier records:

- total page count;
- substantive-page count;
- complete low-text-page count;
- at most the first 20 one-based low-text page samples;
- whether any embedded text exists, independently from the substantive threshold;
- `PDF_ROUTING_REVISION`.

The ratio comparison uses integer arithmetic. `file.content` remains the only embedded-text body;
the resolved snapshot must not duplicate it. Missing or invalid page-coverage metadata makes `Auto`
choose OCR, never a `content.trim()` heuristic.

An explicit `embedded_text` request requires both the persisted any-text fact and a usable embedded
body; otherwise it produces `pdf_text_unavailable`. It is deterministic for the persisted snapshot
and is not retryable.

The v1 whole-document choice intentionally prefers a mostly textual 100-page document with a few
diagram or separator pages over re-OCRing and truncating the entire document.

## OCR Resource Contract

DeepChat sends these explicit document options:

- `dpi: 150`;
- `pageRange: { start: 1, end: 100 }`;
- `maxPages: 100`;
- `maxPagePixels: 4096 * 4096`;
- `maxTotalPixels: 100 * 1024 * 1024`;
- `maxFileBytes`: the effective DeepChat per-file OCR byte limit.

`pageRange` and `maxPages` are both required. The page range lets a PDF longer than 100 pages OCR its
first 100 pages instead of failing before page one. The upstream implementation clamps the range end
to the actual PDF page count.

The 100-page value is a scope ceiling, not a processing guarantee. At 150 DPI, the initial
100 Mi-pixel total permits approximately 48 A4 pages or 49 Letter pages before a deterministic
resource limit. Do not increase that limit without latency and peak-RSS measurements.

One attachment preparation may OCR at most one PDF. Additional PDF OCR candidates produce
`document_limit_exceeded`; they do not consume the existing image OCR candidate allowance. This
keeps a single submission from serially occupying the one-engine helper for many minutes. Existing
limits of eight image OCR candidates and 120 MiB of source snapshots remain unchanged. PDF snapshot
creation reserves its declared maximum before the private copy starts and contracts the reservation
to the actual byte count afterward; concurrent copies cannot transiently bypass the global bound.

PDF OCR has a 16,000-token generation ceiling and the existing 128,000-character safety ceiling.
The character ceiling and all page-aware formatting rules are covered by
`PDF_OCR_ARTIFACT_REVISION`. Turn packing is a later, non-cache-writing layer and must never be stored
as the artifact generation limit.

## Helper Protocol

Protocol v2 retains configure/image-recognition messages and adds:

- `recognize_document` request with a private PDF path, backend, fixed recognition strategy, and
  explicit document options;
- repeated `document_page` messages for the same request ID;
- one `request_complete` message with the number of emitted pages;
- `document_stop` for a host output-limit stop;
- existing `cancel` for user cancellation.

The helper does not claim the PDF's authoritative total page count because the upstream public
`DocumentPage` and generator return type do not expose it. The `sourcePageCountHint` from embedded
parsing is host-only diagnostic and UI metadata.

Main uses a streaming pending-request state:

- each valid page resets a 120-second idle timeout;
- a separate 10-minute total timeout never resets;
- every terminal path clears both timers and pending state exactly once;
- `document_stop` is distinct from user cancellation;
- a true upstream `error(resource_limit_exceeded)` remains an error terminal.

The host may normalize a validated prefix into an artifact outcome:
`request_complete`, `stopped_by_output_limit`, or `resource_limited`. This normalized field is named
`artifactTermination`; it is not a wire message type.

## Page-Aware Text And Coverage

PDF OCR text is assembled in ascending page order with explicit page headings. It is always a prefix:
whole pages followed by, at most, a prefix of the final included page and an explicit truncation
marker. The image OCR head-tail truncator is never used for PDF text.

Each document artifact stores validated page spans with one-based page number, text start/end
offsets, and whether the retained page is complete. The persisted attachment snapshot stores bounded
page spans plus:

- `sourcePageCountHint`;
- `includedThroughPage`;
- whether that page is complete;
- `artifactTermination`;
- `generationOutputLimitReached`;
- routing revision and embedded-text coverage diagnostics.

Protocol page coverage and final retained-text coverage are separate facts. `emittedPages` is
diagnostic only and must not be used to rank artifact usefulness.

Artifact and persisted-message page spans use the same content-aware validator. Besides structural
bounds, it verifies contiguous offsets, page headings, the final truncation marker, and full text
coverage before any turn-level reconstruction or slicing. A malformed persisted OCR representation
with document metadata normalizes to a deterministic unavailable state instead of being
reinterpreted as valid PDF OCR text. Existing image OCR normalization remains unchanged.

## Cache Contract

The derived OCR database advances to schema v2. Existing schema-v1 data is discarded and rebuilt;
message snapshots remain unaffected.

Document exact identity includes:

- source SHA-256;
- facade/runtime/native/model bundle identity and `PDF_OCR_ARTIFACT_REVISION`;
- backend plus actual detection/recognition provider chains and precisions;
- recognition strategy;
- DPI, page range, max pages, max file bytes, max page pixels, and max total pixels.

`PDF_ROUTING_REVISION` is not part of OCR artifact identity because it only chooses whether OCR runs;
it does not change OCR output.

After exact identity and artifact-schema validation, generation-budget compatibility is:

```ts
const compatible =
  !artifact.generationOutputLimitReached ||
  requestedGenerationTokenLimit <= artifact.generationTokenLimit
```

`generationTokenLimit` is the effective service-layer artifact generation limit, never a
turn-packing budget. `artifactTermination` does not participate in this budget predicate, but it is
required for cacheability validation, legal-state validation, diagnostics, and replacement
comparison.

Legal combinations include:

- `stopped_by_output_limit` requires `generationOutputLimitReached: true`;
- `request_complete` permits either output-limit value;
- `resource_limited` permits either output-limit value and requires at least one validated page.

The single stored artifact for an exact identity is replaced only when the candidate dominates the
existing retained-text coverage. The comparator, in order, uses:

1. complete requested-scope text (`request_complete && !generationOutputLimitReached`);
2. last included page;
3. completeness of that page;
4. retained characters on that page;
5. whether generation did not reach its output limit;
6. generation token limit.

The output-limit comparison precedes the generation limit so otherwise equivalent coverage retains
the artifact that is compatible with larger future requests.

Cache outcomes:

| Outcome | Cache | Attachment behavior |
| --- | --- | --- |
| Complete with text | yes | usable OCR text |
| Complete with zero usable text | yes, including empty text | `ocr_empty`, not retryable |
| Output-limited with text | yes | usable truncated OCR text |
| Resource-limited after validated pages | yes | usable partial text plus `ocr_resource_limited`, not retryable |
| Resource-limited after validated pages but zero text | yes | `ocr_resource_limited` unavailable, not retryable |
| Resource-limited before any page | no | unavailable and not retryable under the same configuration |
| Cancel, timeout, protocol error, helper crash | no | abort or retryable failure according to the explicit reason |

Caching deterministic resource-limited prefixes is safe only under exact resource identity. The
constraint protects result determinism: the same PDF and configuration must not return more pages
only because a cache entry exists.

## Cancellation And Retry

User cancellation is control flow:

- router cancellation is rethrown as `AbortError` before failure mapping;
- no unavailable representation is created;
- no `ocr_cancelled` snapshot is persisted;
- no partial artifact is cached;
- no `retry` action is suggested;
- composer text and attachments remain, and a normal subsequent send starts a fresh attempt.

`ocr_empty` is removed from retryable reasons. `ocr_resource_limited` is not retryable. Retry remains
for failures with a reasonable chance of changing under the same user action, such as queue pressure
or a transient OCR failure; it is not inferred from whether an artifact was cached.

If turn-level attachment packing cannot retain any otherwise valid PDF OCR text, the attachment uses
`turn_ocr_budget_exhausted`; it must not be mislabeled as an empty OCR result.

## Persistence, Context, And UI

- `embedded_text` reuses the persisted `file.content` snapshot.
- PDF `ocr_text` excludes the embedded `file.content` from provider context and emits only the
  escaped, explicitly untrusted OCR block.
- Embedded-text PDF context retains the sanitized source path and byte size supplied by the existing
  file attachment path so provider tools do not lose follow-up file-read capability.
- Partial and output-limited PDF text carries an explicit provider-context notice and a visible UI
  notice; it is never presented as complete.
- Sent attachment chips distinguish embedded PDF text, complete OCR, truncated OCR, and
  resource-limited OCR. OCR preview shows the included page boundary.
- PDF attachment UI follows progressive disclosure: the chip shows only the selected
  representation and an essential warning when needed; page coverage and diagnostic detail stay in
  the existing preview or expanded surface. Labels remain short enough for their controls, and the
  same state is not repeated across the chip, trigger, and notice.
- Attachment preparation copy refers to image or PDF attachments as appropriate.
- All new user-facing strings are translated in every shipped locale.

## Acceptance Criteria

- Existing image OCR routing, cache behavior, cancellation, and real packaged image smoke still pass
  with the 0.5.6 facade.
- A textual PDF in `Auto` uses its embedded snapshot without starting the OCR helper.
- A scanned PDF in `Auto`, and any PDF explicitly set to `ocr_text`, streams offline OCR text into
  the provider context.
- A mostly textual PDF with fewer than 10% low-text pages remains embedded.
- PDFs longer than 100 pages OCR the first requested 100 pages rather than failing the whole request
  on page count.
- Output-limit and mid-stream resource-limit results display and persist the correct included page
  boundary.
- Empty completed OCR is negatively cached and does not offer a no-op retry.
- Cancellation after one or more streamed pages retains the composer draft but stores no message or
  artifact.
- Packaged smoke validates the runtime closure, exact PDFium inventory/materialization, real image
  OCR, raster-PDF OCR, non-embedded Chinese-font PDF OCR, and offline execution for supported
  targets.
- Typecheck, formatting, i18n validation, lint, focused main/renderer tests, and the production build
  pass locally. Platform packaging claims remain limited to targets actually validated by their
  workflows.

No clarification marker remains; the implementation and local validation conform to this contract.
