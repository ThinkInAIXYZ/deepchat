# Local Control Plane and Bundled CLI V1 Plan

## Delivery Rules

- Implement the complete V1 on `feat/local-control-plane-cli-v1` as dependency-ordered commits.
- Before every commit, inspect the complete diff and affected call paths. Rank findings by severity
  across hidden side effects, compatibility, boundaries, performance, security, naming, test
  sufficiency, and maintenance cost; fix in-scope findings before committing.
- Commit messages describe delivered behavior and never describe the review process.
- Do not push from this workstream.
- Keep the surface deny-by-default and reuse canonical route contracts.

## Stage A: Typed Foundation and Local Transport

1. Introduce the discriminated `RouteCaller` wrapper and migrate the ten renderer-context integration
   files without changing renderer behavior.
2. Add canonical contracts for CLI diagnostics, public DTOs, new compute routes, approval resolution,
   artifacts, events, and detached runs.
3. Define `CLI_SURFACE_V1` with compile-time route references and runtime uniqueness/classification
   assertions.
4. Implement descriptor creation, atomic permission-safe replacement, token rotation, stale cleanup,
   UDS/named-pipe listening, authentication, JSON envelopes, body bounds, and shutdown fencing.
5. Implement the bundled Node thin client, two-token command grammar, descriptor discovery,
   fail-closed Agent-token selection, version negotiation, machine output, cancellation, and stable
   exit codes.
6. Add focused caller, surface, transport, descriptor, parser, and lifecycle tests.

## Stage B: Raw Model, Media, Speech, OCR, and Artifacts

1. Add `models.invoke` on the existing `coreStream` foundation with tools/session/memory disabled,
   one canonical stream for all CLI output modes, explicit benchmark timings, and secret-safe
   provider failure metadata.
2. Expose standalone image and video generation through typed contracts and output artifacts.
3. Add a provider-runtime `generateSpeechStandalone` capability and typed audio artifact; keep the
   current VoiceAI event quirk behind its adapter.
4. Move transcription CLI input to bounded upload/owned-artifact adapters.
5. Add strict request-body accumulation limits, private threshold spill, and exhaustive cleanup.
6. Implement output-only `ArtifactSpool` ownership, quotas, streaming download, expiry, startup
   cleanup, and shutdown cleanup.
7. Add OCR status, human upload extraction, owned-artifact extraction, and human-only cache clearing
   at background priority with bounded text output.
8. Add machine metrics for raw/media/OCR benchmarks, including the four explicit OCR states.
9. Add focused provider, artifact, upload, OCR, quota, and CLI integration tests.

## Stage C: Effects, Approval, and Administration

1. Extract canonicalization and the generic pending/timeout/consume mechanics into `ApprovalBroker`
   while preserving all existing tool permission behavior through `ToolPermissionBroker`.
2. Add `CliMutationGuard`, unique per-request CLI approvals, redacted display data, targeted approval
   events, and renderer-only `approvals.resolve` typed IPC.
3. Implement the effect matrix, operation classifier, scope checks, audit records, rate limits, and
   renderer-unavailable failure behavior.
4. Expose redacted settings and allowlisted updates with per-key effect classification.
5. Expose redacted provider/model reads and separated configuration/credential mutations.
6. Expose reviewed Skill list/enable/install/uninstall adapters without arbitrary Agent paths.
7. Expose reviewed MCP list/add/update/remove/enable/start/stop adapters without raw tool calls or
   secret-bearing output. Agent access is limited to redacted list and a bounded, fully reviewable,
   disabled HTTPS remote add; updates remain human-only because they can restart a running server.
8. Add policy-matrix, approval-state, redaction, compatibility, and administration tests.

## Stage D: Typed Events and Detached Agent Runs

1. Replace relevant all-window publication with a Typed Event Hub that supports explicit renderer,
   connection, request, and run targets.
2. Add bounded subscriber queues, per-request ordering, overflow termination, disconnect handling,
   and cursor/recovery semantics.
3. Add `sessions.runDetached` by composing existing detached session creation with an initial turn.
4. Add owned run status, message/result recovery, idempotent cancellation, and CLI JSONL streaming.
5. Prove that CLI prompt/delta/approval events cannot leak to unrelated windows or connections.
6. Add detached-run lifecycle, restart/recovery, cancellation, event isolation, and backpressure tests.

## Stage E: Packaged Product and Agent Integration

1. Build the CLI as a packaged application resource that runs on the bundled Node runtime.
2. Automatically reconcile platform launchers after server startup, with no settings toggle and with
   explicit, reversible ownership that never overwrites foreign commands or shell content. Install a
   stable regular-file shim, atomically refresh its pinned app-resource paths, migrate the owned
   legacy POSIX symlink, and never fall back to a runtime from `PATH`. During full data reset, stop
   the server first and treat owned-launcher removal as best-effort: conflicts or cleanup failures
   preserve external files and cannot block application-data deletion.
3. Add the internal scoped-token issuer, conversation binding, expiry/revocation, call/byte quotas,
   and main-enforced Agent restrictions. Derive each token's exact scopes from the shared command
   catalog and `CLI_SURFACE`; the issuer has no broad default capability set.
4. Harden `CommandPermissionService` so redirection and compound shell syntax cannot inherit a safe
   base-command decision.
5. Integrate `deepchat <domain> <verb>` without adding `deepchat` to `SAFE_COMMANDS`; reject
   prefix-global-flag grammar, deny Agent artifact-byte/output-path access, and make human-only
   commands and wrapper processes fail closed without descriptor fallback. Keep `run watch`
   human-only to avoid an Agent waiting on its own active run.
6. Prepend the packaged CLI directory to the controlled Agent shell `PATH` while retaining and
   de-duplicating existing entries.
7. Add the bundled DeepChat CLI Skill and ensure instructions never expose the human descriptor.
8. Add packaged smoke coverage for diagnostics, raw text, artifact download, OCR, and scoped Agent
   denial paths without requiring external credentials where fixtures can substitute providers.
9. Complete cross-platform packaging validation and user-facing documentation.

## Validation Order

Run the smallest relevant tests after each change, then expand by risk:

```text
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

Use current-platform unsigned packaging and packaged smoke where local prerequisites allow. Claims
for other targets require their normal platform workflows. Record actual commands and outcomes in
`tasks.md`; do not report an unrun check as passed.

## Review Gates

Before each commit, review staged and unstaged changes in this order:

1. Critical: authority escalation, credential/output leakage, arbitrary file access/write, endpoint
   exposure, approval replay, or data loss.
2. High: renderer compatibility, caller confusion, lifecycle races, unbounded memory/disk/event use,
   cancellation gaps, or cross-request data leakage.
3. Medium: error/exit instability, incomplete cleanup, misleading naming, retry/idempotency ambiguity,
   performance regression, or insufficient negative tests.
4. Low: maintainability, local duplication, documentation drift, and non-functional clarity.

Resolve all in-scope findings, rerun affected checks, then commit with a behavior-specific
Conventional Commit subject of at most 50 characters.

## Programmatic Tool Extension Plan

This work follows completed V2 and does not reopen its checkboxes or generic route surface.

1. Add version-negotiated `CLI_SURFACE_V3` as a strict immutable-V2 superset with four Agent-only tool
   commands; keep V2, human, ACP, and generic raw MCP invocation denied from those routes.
2. Build the immutable per-View `ProgrammaticToolCapabilityV1` without a future provider call ID,
   then accept only a derived exact outer-operation grant/token; enforce surface version, route,
   canonical invocation hash, adapter, identity, hashes, expiry, child/batch/I/O/time quotas, and no
   descriptor fallback.
3. Make search/describe frozen-surface reads with no authorization, activation, or target Journal
   facts; route call/batch through the process-live parent controller and Journal v2 receipts.
4. Keep prepared tokens inert until parent T1 arms them, bind receipts to the outer-result hash, add
   bounded owned stdin, and reject background/detached/yielded Programmatic execution before T1.
5. Add the bounded sequential non-durable batch controller, controller-assigned plan-index ordinals,
   static RFC 6901 bindings from existing argument destinations to prior immutable results,
   post-materialization quotas, and per-child approval/runtime gates.
6. Verify v1/v2 negotiation, anti-oracle errors, principal separation, changed invocation body/route,
   token replay/exhaustion, Journal-fatal propagation, terminal fencing, shutdown/crash parking, and
   the absence of human/ACP access.
7. Before every commit, perform the existing severity-ranked review, fix findings, and do not push.
