# Offline Light OCR Attachment Routing Plan

## Architecture

Introduce four main-process boundaries:

1. `AttachmentCapabilityRouter` owns attachment policy and the three-state preparation result.
2. `ImageTextExtractionService` implements `ImageTextExtractionPort`, snapshots source bytes,
   preprocesses raster images, schedules extraction, applies text limits and coordinates cache use.
3. `LightOcrProcessHost` owns the standalone Node helper protocol, engine lifecycle and effective
   runtime identity.
4. `OcrArtifactStore` owns only encrypted machine-local derived artifacts and leases.

`OcrRuntimeAssetResolver` resolves immutable bundled paths and availability. It has no download or
installation behavior.

## Data Flow

```text
renderer / remote / pending input
  -> main attachment preflight
  -> model capability + attachment preference
  -> immutable source bytes
  -> preprocess + source hash
  -> cache lookup / standalone helper OCR
  -> ready | degraded | needs_user_action
  -> resolved SendMessageInput
  -> prepareInitial / compaction
  -> persist exact attachment representation
  -> synchronous context builder
  -> provider
```

Direct sends preflight before the renderer clears its draft. New-thread input uses a main route with
the selected provider/model before creating the session. The turn coordinator repeats authoritative
resolution at dispatch. Queue and steer inputs therefore use current model capability and can enter
a persistent blocked state without creating a user/assistant turn.

## Shared Contracts

- Add `AttachmentRepresentationPreference`, `AttachmentResolvedRepresentation`, failure codes and
  `AttachmentPreparationSummary` to shared attachment contracts.
- Extend `MessageFile` with optional `requestedRepresentation` and `resolvedRepresentation`.
- Extend `SendMessageInput` with optional `attachmentFallbackPolicy`; strip this control field before
  user-content persistence.
- Extend chat/steer results while preserving the existing `accepted` field.
- Add `blocked` pending-input state plus redacted blocking metadata and a typed resolve action.
- Add attachment preflight and OCR runtime/cache status routes. No OCR body crosses a preflight or
  status route.

## Message And Context Lifecycle

Resolve attachments in `TurnCoordinator.start()` after model capability is known but before
`InputPreparationCoordinator.prepareInitial()`. Pass the resolved input consistently to compaction,
message persistence and context construction.

Persist the representation in the existing normalized file `metadata_json` envelope and restore it
in `toMessageFile()`. The synchronous context builder renders:

- current image representations as structured image data only when the model supports vision;
- OCR representations as escaped untrusted text;
- unavailable representations as explicit attachment notes;
- legacy attachments through the existing fallback behavior.

Update transcript export, search projection and tape/user-message projections so the actual sent OCR
representation is retained without unbounded index growth.

## Helper And Extraction

Compile a separate Electron Vite main entry that contains no Electron imports. Keep
`@arcships/light-ocr` external so bundled Node resolves the flattened unpacked packages.

Use newline-delimited JSON over stdio:

- helper hello: protocol, Node version, light-ocr version, bundle ID and redacted `EngineInfo`;
- main recognize/cancel/shutdown requests;
- helper result/error responses keyed by request ID.

Reserve stdout for protocol by dynamically importing light-ocr after redirecting console output to
stderr. Validate real paths against the private temp root. Cap protocol line sizes and result line
counts.

Main owns a bounded interactive queue. The helper engine uses `queueCapacity: 1`, one active
recognition, a 60-second handshake timeout, 120-second request timeout, one crash-only retry and
120-second idle shutdown. Cancellation and semantic/resource failures are never retried.

## Cache

Canonical cache identity includes source SHA-256, light-ocr version, bundle ID, preprocessing
revision, concrete bounded/tiled strategy and the detection/recognition provider chains and
precisions reported by `EngineInfo`. Qualification IDs remain artifact metadata.

Use a separate SQLCipher SQLite file in app user data. A safeStorage-wrapped random key is
machine-local. If safeStorage is unavailable, use an in-memory implementation. Transactions protect
artifact/lease updates; startup/write maintenance removes expired and least-recently-used unleased
entries. Corruption discards the derived cache and rebuilds it without affecting messages.

## Packaging

- Centralize runtime locks: injector `1.2.0`, Node `v24.14.1`, uv `0.9.18`, RTK `v0.43.0`.
- Add exact `@arcships/light-ocr: 0.3.4` dependency.
- Unpack/copy the facade, model, matching native package and compiled helper next to bundled Node.
- Verify versions, platform package, manifest bundle ID, SHA256SUMS, helper and runtime executable in
  `afterPack`.
- Keep pre-sign SHA-256 verification byte-exact. In final signed macOS bundles, allow Node and native
  Mach-O bytes to change only when their Apple-anchored signatures remain valid and match the
  enclosing application's team identifier; model and metadata files remain byte-exact.
- Copy light-ocr/model/native license and notice material into packaged legal resources.
- Package the CPU-only Windows arm64 and Linux arm64 native runtimes in their architecture-specific
  artifacts.
- Add a packaged real-OCR smoke script and supported-target workflow jobs.
- Pin every GitHub-hosted Ubuntu build, release and PR-check job to `ubuntu-24.04` rather than a
  moving `ubuntu-latest` alias. This matches the published Linux addon requirement of glibc 2.38
  and `GLIBCXX_3.4.32`.
- Keep app notarization in `afterSign` so the updater ZIP contains a stapled app. Configure
  electron-builder to sign the DMG, then use `artifactBuildCompleted` to notarize and staple the
  final DMG before it is emitted to publishers. Fail closed if credentials, the Developer ID team,
  secure timestamp, ticket, disk-image checksum or Gatekeeper open assessment is invalid.
- Disable DMG update-info generation. electron-builder calculates the DMG blockmap before the
  artifact completion hook, while notarization stapling changes the DMG bytes; retaining that
  blockmap would create stale hashes. macOS updates continue to use the required ZIP target and its
  blockmap, while the finalized DMG remains a direct-download installer.

## Compatibility

- New message fields are optional; old persisted messages and pending-input payloads remain valid.
- Existing vision and non-image behavior is unchanged when no OCR representation is present.
- Chat route keeps `accepted`; consumers that ignore new result fields continue to work.
- Pending-input migration adds nullable blocking data and does not rewrite existing payloads.
- Cache is not a fact source and can be cleared or lost without affecting sent messages.

## Validation Strategy

- Unit test routing, preprocessing, cache keys/GC, process protocol and failure recovery.
- Test direct/new-thread/queue/steer/remote semantics and provider non-invocation when blocked.
- Test persistence, restart, retry, compaction, delete, export, sync-compatible JSON and search.
- Test renderer draft preservation, action dialogs, pending blocked controls and settings states.
- Run real packaged OCR on the current macOS target; configure but do not claim remote target results
  until their workflows run.
- Record cold/warm latency, peak/idle RSS and packaged size. Stop for review above 768 MiB peak RSS
  or 120 seconds per image.
- Treat package size as a component and installer contract instead of inferring it from OCR assets:
  - OCR assets must remain at or below 90 MiB compressed;
  - bundled Node must remain at or below 50 MiB compressed;
  - the complete Linux application may contain its existing uv and RTK runtimes, measured separately
    from OCR and capped at 32 MiB compressed for x64 and arm64;
  - installer growth for every supported target, including both Linux architectures, must remain at
    or below 90 MiB;
  - compare the current `dev` baseline and candidate on the same architecture runner with identical
    non-OCR runtimes, and record artifact names, byte counts, delta and baseline commit rather than
    substituting an unpacked-directory estimate.

## Merge-blocking Review Hardening

The post-implementation review identified merge blockers that are part of this feature contract:

- helper processes receive an explicit environment allowlist; CI credentials are scoped to the
  installation step that needs them;
- packaged offline smoke runs under operating-system network isolation and takes an independent
  expected-support assertion from the workflow;
- macOS direct-download DMGs are signed, notarized, stapled and Gatekeeper-assessed after creation;
  updater metadata contains only the already-stable ZIP payload so no checksum can predate DMG
  stapling;
- bundled Node is verified by exact version and target-specific executable SHA-256 after install
  and `afterPack`; final smoke accepts the original hash or, for signed macOS code only, a valid
  application-matching Apple signature;
- attachment preparation has a submission-scoped cancellation path that never stops an unrelated
  provider generation;
- renderer drafts, blocked attempts and initial recovery are isolated by session, and acceptance
  removes only the attachment occurrences that were actually submitted;
- pending-input claims are released on every failure before the durable user fact exists;
- legacy attachment metadata is treated as untrusted optional data and cannot crash context
  construction;
- all OCR UI and recovery copy is translated for every shipped locale.

Lower-priority follow-up work is tracked in
`docs/issues/light-ocr-follow-up-hardening/spec.md`; it does not broaden the merge-blocking slice.
