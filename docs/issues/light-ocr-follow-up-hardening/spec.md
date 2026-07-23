# Light OCR Follow-up Hardening

Status: deferred follow-ups; vision image-limit compatibility resolved.

GitHub issue: not created; this is a local SDD record by explicit decision.

## Issue

The Light OCR integration review found additional performance, compatibility, privacy and
maintenance risks that are real but do not block the current offline chat-attachment release. They
must remain visible as concrete follow-up work rather than being implied by the implementation or
left only in review discussion.

## Resolved Findings

- The eight-image resource limit now applies only to actual OCR candidates. Vision-only images and
  the vision-routed images in a mixed turn retain their image representation beyond the eighth
  attachment, while explicit and automatic OCR remain bounded to eight candidates.

## Deferred Findings

### High-priority fast follow

- Consumed steer rows retain their OCR-bearing `payload_json`. Define a canonical redacted consumed
  payload that preserves queue lifecycle metadata without retaining a second OCR copy, migrate
  safely, and verify retry/history behavior before changing the persistence contract.

### Performance and scheduling

- Cache hits currently start the OCR helper to discover the effective engine identity. Retain a
  trustworthy last-known identity across clean idle shutdown, perform a cache lookup before spawn,
  and recheck after startup on a miss or identity drift.
- The global eight-image/120 MiB reservation rejects concurrent sessions instead of providing
  cancellable admission. Introduce an interactive/background priority queue with FIFO ordering
  inside each priority and reserve bytes only after admission.
- OCR-presence detection reparses the full transcript. Fold the flag into the existing tape/chat
  projection pass instead of adding another history traversal.
- Current-turn routing repeats base64 parsing and normalization. Reuse a trusted prepared payload
  internally while retaining authoritative rerouting when model capability or settings change.
- Token allocation is input-order dependent. Evaluate token-aware fair allocation that preserves
  useful head/tail context across all successful images.

### Compatibility and lifecycle

- Availability failures are negatively cached for the process lifetime. Add an invalidation trigger
  for asset repair or runtime-state change.
- Cache clearing can silently do nothing while an extraction owns a lease. Return an explicit
  partial/busy result and refresh statistics after owners release.
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
