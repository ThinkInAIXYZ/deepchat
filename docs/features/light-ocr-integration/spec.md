# Offline Light OCR Attachment Routing

Status: implemented; six-target native package behavior validated in
[Build Application run 29978292769](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/29978292769);
the reusable packaging workflow refactor still requires its first remote run. The implemented
[Light OCR 0.5.5 PDF support](../light-ocr-pdf-support/spec.md) increment supersedes this original
increment's pinned runtime version and scanned-PDF non-goal while retaining its image OCR contract.

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
- No language selection or runtime/model download flow. Scanned-PDF support is specified separately
  by the 0.5.5 PDF increment.
- No knowledge-base integration in v1. A later increment can inject the same
  `ImageTextExtractionPort` into knowledge ingestion with background priority.
- No Linux musl support. Official Linux packages target glibc and are validated only on the
  repository's explicit Ubuntu 24.04 runners.

## Product Semantics

Each image can request `auto`, `image` or `ocr_text` representation.
Inbound clients can only request a representation. The main process strips caller-supplied resolved
representations and is the sole authority that creates a durable resolved snapshot.

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

- Pin `@arcships/light-ocr` to exactly `0.3.4` and require model bundle
  `ppocrv6-small-native-20260719.1`.
- Use a standalone helper launched with bundled Node `v24.14.1`; never fall back to system Node.
- Pass an explicit packaged `bundlePath`; verify the package version, bundle identity and model
  checksums both during packaging and helper handshake.
- Verify pinned Node and native source hashes before code signing. Final macOS smoke keeps exact
  hashes for data files, while signed Mach-O files must have valid Apple-anchored signatures from
  the same team as the enclosing application.
- Supported DeepChat targets are macOS x64/arm64, Windows x64/arm64 and Linux x64/arm64 on the
  `ubuntu-24.04` ABI baseline. Windows arm64 and Linux arm64 use the upstream CPU-only runtimes;
  WebGPU remains an x64-only provider on Windows and Linux. The pinned Linux x64 addon imports
  `GLIBC_2.38` and `GLIBCXX_3.4.32`; GitHub-hosted Linux builds and validation use explicit
  `ubuntu-24.04` and `ubuntu-24.04-arm` images, and no lower Linux ABI is claimed.
- macOS direct-download artifacts use two notarization layers because DeepChat distributes both
  targets: the signed app is notarized and stapled before the updater ZIP is created, while the
  final signed DMG is separately notarized and stapled after it is created. Gatekeeper assessment
  of the DMG must pass before the artifact can be uploaded.
- Every packaged smoke enforces component budgets from
  `resources/light-ocr-size-budgets.json`: 90 MiB compressed OCR assets, 50 MiB compressed Node,
  and 32 MiB compressed non-OCR runtime payloads for each of the six targets. Installer regression
  is a separate contract backed by `resources/package-size-baseline.json` and
  `resources/package-size-policy.json`; it does not rebuild a historical source tree.
- The helper owns at most one engine and one recognition call. It is created lazily, closes an
  engine before changing detection strategy, and exits after 120 seconds idle.
- First use performs no network request. Required licenses and notices ship with the app.

## Input And Resource Limits

- Read each source path once into an immutable byte snapshot; hash and preprocess that same buffer.
- Per image: configured upload limit capped at 50 MiB, 50 megapixels and 16,384 pixels per side.
- Per OCR preparation: at most 8 OCR candidates and 120 MiB of encoded OCR source bytes.
  Vision-routed images are not subject to this OCR resource limit.
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

Expose OCR as a built-in capability in the main-window Plugins Hub. Keep the legacy
`settings-ocr` route registered for direct navigation and persisted settings activity, but hide it
from the Settings sidebar. The route continues to render the same management component as a
compatibility surface; the Plugins Hub remains the canonical entry. When an ACP agent is selected,
Spotlight falls back to that compatibility route because the whole Plugins Hub is gated. The Plugins
Hub entry remains visible when the runtime is unavailable so users can inspect the reason. Both
surfaces may coexist in separate windows, but only the visible, focused instance polls runtime
status.

Runtime-status polling runs only while the owning renderer document is visible and its window is
focused. Returning to an active surface refreshes status immediately. Catalog refresh failure is
shown as an unknown status even when a previous snapshot exists; it must not keep presenting a stale
Available badge.

The OCR management page provides:

- automatic OCR for non-vision models, enabled by default;
- Auto/CPU execution backend;
- availability, process state, actual detection/recognition provider, precision, strategy, package
  and bundle identity;
- cache statistics and clear action.

Image attachment actions are named `Auto`, `Send image` and `Use OCR text`. Do not call the existing
optimized provider payload an "original" image. Sent attachments show their effective
representation and allow the OCR snapshot to be inspected.

Composer representation controls use progressive disclosure:

- `auto` is the implicit default and does not render a persistent label on image or PDF chips;
- an accessible attachment-options trigger is discoverable on hover and keyboard focus, and remains
  visible for coarse-pointer devices that cannot hover;
- explicit `image`, `embedded_text` and `ocr_text` preferences remain visible as compact intent
  badges until the user restores `auto`;
- menu actions keep action-oriented labels, while badges keep the existing short state labels;
- renderer capability checks are advisory only. Unknown model capability and failed OCR status
  reads fail open, while the main-process attachment router remains authoritative at dispatch;
- a known non-vision model cannot create a new `image` preference from the menu. An existing
  `image` preference remains intact, and the UI offers the existing vision-model picker and an
  `auto` reset instead of silently changing user intent;
- ACP composers hide representation controls and intent badges because ACP does not consume the
  DeepChat attachment representation contract. Stored preferences remain unchanged and become
  visible again when the draft returns to a DeepChat Agent;
- OCR availability is read on demand when the attachment menu opens. A short-lived successful
  snapshot is shared across nodes, and an expired snapshot remains authoritative while its refresh
  is in flight so a known unavailable capability cannot flicker back to selectable. Composer nodes
  never poll the runtime or reuse a potentially stale plugin-catalog snapshot.

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
- Composer attachment chips keep the default path free of representation labels, expose advanced
  choices to pointer and keyboard users, suppress no-op representation controls for ACP, and never
  destroy an explicit preference merely because the selected model or Agent changes.
- Packaged smoke verifies the bundled Node version, helper, native package, model identity, real OCR
  and offline execution on each supported target before that target is considered enabled.
- Release and package-regression packaging compare every selected installer role against the
  committed six-target baseline and reject both growth and shrinkage beyond 90 MiB. Manual Build
  keeps the component budgets but does not run the installer delta gate.
- A quarantined macOS DMG is independently verifiable as a valid Developer ID distribution: its
  container signature, secure timestamp, stapled notarization ticket, disk-image checksum and
  Gatekeeper open assessment must all pass. The DMG is not part of update metadata because stapling
  changes its final bytes; the updater ZIP remains the authoritative macOS update payload.

No clarification marker remains; implementation can proceed from this contract.
