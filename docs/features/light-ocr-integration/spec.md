# Offline Light OCR Attachment Routing

Status: implementation in progress.

## User Need

DeepChat currently prepares image attachments only as compressed image data. A model without vision
capability receives attachment metadata but cannot recover the text in the image. Users need image
text to remain useful with non-vision models, without silently switching models, invoking a second
vision model, downloading runtime assets on first use, or dropping an attachment when extraction
fails.

## Goals

- Bundle `@arcships/light-ocr` and its model/native runtime in supported installers so OCR works
  offline immediately after installation.
- Route user image attachments according to model capability, per-attachment intent and OCR
  settings.
- Resolve the actual attachment representation before compaction and user-message persistence so
  historical turns retain the exact OCR text that was sent.
- Run OCR outside Electron in the bundled Node 24 runtime with bounded concurrency, cancellation,
  timeout, crash recovery and idle process reclamation.
- Keep OCR output explicitly untrusted, bounded by tokens, absent from logs/traces, and stored with
  the same lifecycle as its owning message.
- Cover direct sends, new conversations, queue/steer dispatch and remote conversation input through
  one main-process policy boundary.

## Non-Goals

- No OCR of MCP sampling images, tool output, generated images or thumbnails.
- No automatic vision-model invocation or conversation-model switching.
- No scanned-PDF support, language selection or runtime/model download flow.
- No knowledge-base integration in v1. A later increment can inject the same
  `ImageTextExtractionPort` into knowledge ingestion with background priority.
- No Windows arm64 or Linux arm64 support while the exact `0.3.0` npm release has no matching
  native packages.

## Product Semantics

Each image can request `auto`, `image` or `ocr_text` representation.

| Model and preference | Effective behavior |
| --- | --- |
| Vision + `auto`/`image` | Send the existing LLM-friendly image; do not OCR. |
| Any model + `ocr_text` | OCR and send only extracted text. |
| Non-vision + `auto`, automatic OCR enabled | OCR and send extracted text. |
| Non-vision + `image`, OCR disabled, or OCR unavailable | Produce an explicit unavailable representation. |

Attachment preparation returns one of:

- `ready`: all requested representations are usable;
- `degraded`: the request still has meaningful text/content, but one or more attachments are
  represented by an explicit failure note;
- `needs_user_action`: the request would contain no meaningful content without the unavailable
  image. No message is persisted and no provider request is made unless the user explicitly chooses
  to send without image content.

Queued and steered inputs are re-evaluated at dispatch using the then-current model. A blocked queue
item remains visible and does not allow later queued items to overtake it. Remote pure-image input
returns an actionable explanation instead of synthesizing a generic caption or calling the model.

## Runtime And Packaging Contract

- Pin `@arcships/light-ocr` to exactly `0.3.0` and require model bundle
  `ppocrv6-small-native-20260719.1`.
- Use a standalone helper launched with bundled Node `v24.14.1`; never fall back to system Node.
- Pass an explicit packaged `bundlePath`; verify the package version, bundle identity and model
  checksums both during packaging and helper handshake.
- Supported targets are macOS x64/arm64, Windows x64 and Linux x64 glibc. Unsupported arm64 targets
  keep the settings page visible but do not package unusable OCR assets.
- The helper owns at most one engine and one recognition call. It is created lazily, closes an
  engine before changing detection strategy, and exits after 120 seconds idle.
- First use performs no network request. Required licenses and notices ship with the app.

## Input And Resource Limits

- Read each source path once into an immutable byte snapshot; hash and preprocess that same buffer.
- Per image: configured upload limit capped at 50 MiB, 50 megapixels and 16,384 pixels per side.
- Per turn: at most 8 images and 120 MiB of encoded source bytes.
- Apply EXIF rotation, use the first animated frame/page, flatten transparency on white, resize
  without enlargement to 4,096 pixels longest side, and emit PNG.
- Support JPEG, PNG, WebP, TIFF, GIF and uncompressed 24/32-bit BMP. Reject other BMP variants,
  SVG, HEIC/HEIF and AVIF in v1.
- Use bounded-960 detection through 1,600 pixels and tiled-v1 above that threshold.
- Limit sent OCR text to approximately 8,000 tokens per image and 16,000 tokens per turn with an
  explicit line-aware truncation marker.

## Persistence And Security

- Store `resolvedRepresentation` alongside each normalized user-message file and materialize it
  after restart. Legacy files without the field retain existing behavior.
- The persisted OCR text is the exact truncated snapshot used in provider context. Retry, history
  and compaction reuse it without re-reading the source path.
- Exported transcripts include OCR text; sync naturally carries the message snapshot; search indexes
  a bounded projection of it. Deleting the message deletes the durable snapshot.
- Wrap OCR text in escaped, explicitly untrusted user-role markup and conditionally add a system
  instruction that attachment OCR is data, not executable instruction.
- Traces contain representation kind, reason code, counts, cache hit, effective provider/precision
  and timing only. They contain no OCR body, source path or source hash.
- Keep derived cache data in a machine-local `ocr-cache.db`, outside sync/export. Protect its random
  SQLCipher key with Electron safeStorage; use memory-only cache when safeStorage is unavailable.
- Cache has a 256 MiB LRU limit, 90-day TTL, singleflight extraction and short-lived owner leases.

## Settings And UX

Add Tools -> File processing -> OCR with:

- automatic OCR for non-vision models, enabled by default;
- Auto/CPU execution backend;
- availability, process state, actual detection/recognition provider, precision, strategy, package
  and bundle identity;
- cache statistics and clear action.

Image attachment actions are named `Auto`, `Send image` and `Use OCR text`. Do not call the existing
optimized provider payload an "original" image. Sent attachments show their effective
representation and allow the OCR snapshot to be inspected.

## Acceptance Criteria

- A non-vision model receives useful, marked OCR text from a supported image without network access.
- Vision models retain the existing image path unless the user explicitly requests OCR text.
- Pure-image failure never reaches the provider by default; mixed meaningful input degrades without
  silently dropping the image.
- OCR runs before compaction and persistence, and survives restart, history reconstruction, retry,
  export and sync.
- Helper crashes, hangs, cancellation and app shutdown leave no orphan process or stale private temp
  files.
- Unsupported platforms clearly report why OCR is unavailable.
- Packaged smoke verifies the bundled Node version, helper, native package, model identity, real OCR
  and offline execution on each supported target before that target is considered enabled.

No clarification marker remains; implementation can proceed from this contract.
