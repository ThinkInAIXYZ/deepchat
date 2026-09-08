# Light OCR Follow-up Hardening

Status: open persistence, scheduling, and lifecycle follow-ups.

GitHub issue: not created; this is a local SDD record by explicit decision.

## Issue

The remaining items require focused reproduction and a defined persistence, compatibility, or
scheduling contract before implementation. Current source behavior and outstanding acceptance work
are distinguished below; an unchecked item is not evidence of measured application latency.

## Current Behavior

- The eight-image resource limit now applies only to actual OCR candidates. Vision-only images and
  the vision-routed images in a mixed turn retain their image representation beyond the eighth
  attachment, while explicit and automatic OCR remain bounded to eight candidates.
- `OcrRuntimeService.getAvailability()` retries unavailable results. Toolchain changes invalidate
  availability and retire stale resources after active owners release them.
- `clearCache()` reports `OcrRuntimeBusyError` while extraction owns resources. It no longer silently
  ignores that request.
- `OcrExtractionScheduler` provides bounded interactive/background queues, cancellation, FIFO within
  each priority, and a four-interactive-task fairness bound. Snapshot byte reservation still occurs
  before scheduling; queue admission and memory admission remain separate.

## Deferred Findings

### High-priority fast follow

- Consumed steer rows retain their OCR-bearing `payload_json`. Define a canonical redacted consumed
  payload that preserves queue lifecycle metadata without retaining a second OCR copy, migrate
  safely, and verify retry/history behavior before changing the persistence contract.

### Performance and scheduling

- Cache hits currently start the OCR helper to discover the effective engine identity. Retain a
  trustworthy last-known identity across clean idle shutdown, perform a cache lookup before spawn,
  and recheck after startup on a miss or identity drift.
- Evaluate moving snapshot byte reservation behind bounded cancellable memory admission. Preserve
  immutable input snapshots and the existing extraction scheduler's priority/fairness contract;
  measure retained bytes and concurrent-session behavior before changing admission order.
- OCR-presence detection reparses the full transcript. Fold the flag into the existing tape/chat
  projection pass instead of adding another history traversal.
- Current-turn routing repeats base64 parsing and normalization. Reuse a trusted prepared payload
  internally while retaining authoritative rerouting when model capability or settings change.
- Token allocation is input-order dependent. Evaluate token-aware fair allocation that preserves
  useful head/tail context across all successful images.

### Compatibility and lifecycle

- Verify availability recovery after asset repair beyond toolchain changes, and cache statistics
  refresh after busy extraction owners release. The existing retry and explicit busy behavior must
  remain covered.
- Clean stale private OCR temporary directories after abnormal application termination without
  touching live process directories.
- Avoid rebuilding tape projection v4 when the source message set cannot contain OCR metadata.

### Security and maintainability

- Treat attachment file names and MIME labels as untrusted prompt data and encode or delimit them
  consistently with OCR text.
- Assign stable attachment ordinals so mixed image/OCR metadata cannot reuse confusing labels.
- Revert domain-specific pointer behavior from the shared shadcn dropdown primitive and keep it in
  the attachment component or a domain wrapper.
- Harden the legacy `accepted` compatibility field so ACP and future callers cannot interpret a
  non-accepted three-state result as success.

## Explicit Non-findings

- Do not restore the removed remote placeholder sentence. Real non-image attachment content remains
  represented by the normal file preparation path, while the placeholder made pure-image input look
  meaningful.
- Do not remove all reported "dead code" as one change. `attachmentFallbackPolicy` is active and
  cancellation/result codes remain part of the typed protocol; each candidate requires a separate
  reachability check.

## Acceptance Criteria

- Each item is implemented only after its persistence, compatibility or scheduling contract is
  specified and tested.
- Privacy cleanup never removes the durable attachment representation stored with the user message.
- Scheduling changes remain bounded, cancellable and free of cross-session starvation.
- Performance changes include before/after helper starts, latency, allocations or transcript-pass
  measurements as appropriate.
- Shared UI primitives contain no Light OCR-specific interaction behavior.

## Task Checklist

- [ ] Scrub consumed steer payloads without changing durable message facts.
- [ ] Avoid helper startup on trustworthy cache hits.
- [ ] Replace hard global reservation rejection with bounded cancellable admission.
- [ ] Eliminate redundant transcript and base64 processing.
- [x] Restrict the eight-image resource limit to OCR candidates.
- [ ] Add availability/cache-clear recovery semantics.
- [ ] Harden prompt metadata and attachment numbering.
- [ ] Move attachment pointer handling out of the shared shadcn primitive.
- [ ] Address the remaining lifecycle and projection optimizations with focused benchmarks.
