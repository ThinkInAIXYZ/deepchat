# Local Control Plane and Bundled CLI V1 Tasks

## Architecture and Scope

- [x] Verify the current route registry, provider runtime, detached session, event publication,
  permission broker, command signature, OCR runtime, and OCR cache behavior.
- [x] Freeze the V1 goals, exclusions, 14 capability groups, effect taxonomy, caller model, file-I/O
  split, benchmark semantics, and implementation order.
- [x] Specify `CLI_SURFACE_V1`, the ten-file `RouteCaller` migration, and `ApprovalBroker` adapters.
- [x] Specify transport, discovery, artifact, event, CLI grammar, packaging, and Agent-token contracts.
- [x] Complete the severity-ranked architecture-document review and resolve its findings.
- [x] Commit the accepted SDD locally.

## Typed Foundation

- [x] Add `RouteCaller` and migrate renderer-dependent integrations without behavior change.
- [x] Add canonical local-control contracts and redacted public DTOs.
- [x] Define and test the deny-by-default versioned surface registry.
- [x] Add local-control error codes, request/result envelopes, and route limits.

## Local Transport and CLI

- [x] Implement atomic private descriptor creation, token rotation, and stale cleanup.
- [x] Implement UDS/named-pipe HTTP server lifecycle and authentication.
- [x] Implement fixed/chunked body bounds, spill-to-disk, abort handling, and cleanup.
- [x] Implement the bundled thin CLI, two-token grammar, version negotiation, output modes, signals,
  fail-closed Agent-token selection, timeouts, and exit codes.
- [x] Add descriptor, transport, auth, body-boundary, parser, and shutdown tests.

## Compute and Artifacts

- [x] Add raw `models.invoke` over `coreStream` with no Agent/session/tool side effects, explicit
  benchmark timings, and secret-safe provider failure metadata.
- [x] Add image and video standalone generation surfaces.
- [x] Add formal standalone speech generation and typed audio output.
- [x] Add upload and owned-artifact transcription inputs.
- [x] Implement output-only `ArtifactSpool` ownership, quotas, expiry, cleanup, and portable
  no-overwrite downloads on filesystems without hardlinks.
- [x] Add stream, media, speech, transcription, artifact, and quota tests.

## OCR

- [x] Add explicit upload and owned-artifact extraction contracts and handlers.
- [x] Preserve automatic-attachment-setting independence and background priority.
- [x] Enforce bounded text output and exclude layout/batch/model administration.
- [x] Classify cache clear as audited human-only `local-maintenance` without approval.
- [x] Report cache hit, warm-runtime miss, cold-runtime, and offline metrics accurately.
- [x] Add OCR caller, input, cache, runtime-state, output-bound, and benchmark tests.

## Effects and Approval

- [x] Extract generic canonicalization/pending/timeout/consume mechanics into `ApprovalBroker`.
- [x] Preserve MCP, Agent pre-check, and live-delegation behavior through `ToolPermissionBroker`.
- [x] Add `CliMutationGuard` with unique live-request-bound approvals and no replay token.
- [x] Add targeted approval events and renderer-only `approvals.resolve` IPC.
- [x] Implement effect/caller/operation policy, scopes, quotas, rate limits, and redacted audit.
- [x] Add concurrent-identical-call, timeout, abort, cancellation, redaction, and compatibility tests.

## Administration Surface

- [x] Add public/redacted settings reads and allowlisted per-effect updates.
- [x] Add public/redacted provider/model reads and separated credential mutations.
- [x] Add reviewed Skill list/enable/install/uninstall operations.
- [x] Add reviewed MCP list/add/update/remove/enable/start/stop operations.
- [x] Prove raw MCP calls, arbitrary internal routes, secret reads, and Agent destructive operations are
  unreachable.

## Events and Agent Runs

- [x] Add explicit renderer/connection/request/run Event Hub targets.
- [x] Add bounded subscriber queues and global retention, idle expiry, ordering, overflow,
  disconnect, and incarnation-safe recovery semantics.
- [x] Compose detached session creation with initial-turn execution.
- [x] Add owned status, event streaming, result recovery, and idempotent cancellation.
- [x] Add event-isolation, backpressure, detached-recovery, startup-error redaction,
  recursion-denial, and cancellation tests.

## Packaging and Agent Use

- [x] Package the CLI with the bundled Node runtime on all supported targets.
- [x] Add automatic, idempotent, reversible platform launcher/PATH integration with no settings
  toggle, a hash-reconciled regular-file shim, legacy symlink migration, and no system-Node fallback.
- [x] Keep full data reset available when launcher ownership conflicts or cleanup fails, while
  preserving external files and logging only safe diagnostics.
- [x] Add in-memory scoped Agent token issuance, expiry, revocation, and quotas.
- [x] Derive Agent token scopes from the shared command catalog and fail closed for human-only
  commands, including self-blocking `run watch`.
- [x] Harden shell permission checks for redirection and compound syntax before Agent enablement.
- [x] Keep `deepchat` out of `SAFE_COMMANDS`, enforce domain/verb-first grammar, and deny Agent
  artifact-byte/output-path access.
- [x] Prepend the bundled CLI directory while retaining the controlled Agent command `PATH`.
- [x] Add the bundled CLI Skill without exposing the human descriptor.
- [x] Add bundled diagnostics/compute/artifact/OCR/Agent-policy and desktop-shutdown smoke coverage.

## Validation and Delivery

- [x] Run focused tests after each implementation slice.
- [x] Run format and i18n validation.
- [x] Run lint and typecheck.
- [x] Run the full test suite and production build.
- [x] Complete current-platform unsigned packaging with the pinned bundled runtimes.
- [x] Run packaged CLI smoke where local prerequisites allow.
- [x] Complete a severity-ranked review before every commit and resolve findings.
- [x] Commit all V1 work locally with behavior-specific messages.
- [x] Do not push.

## Local Validation Evidence

Recorded on 2026-08-05 using macOS arm64, Node 24.14.1, and pnpm 10.33.4:

- `pnpm exec vitest run --config vitest.config.ts test/main/cli`: 26 files and 262 tests
  passed, including the real bundled CLI child-process smoke for desktop shutdown.
- `pnpm test`: 778 files and 8,199 tests passed; 26 files and 348 tests were skipped by
  their existing suite configuration.
- `pnpm run build`: passed Node and renderer typecheck, all Electron production bundles, and
  `out/cli/deepchat.mjs` generation. The provider catalog fetch failed closed to the committed
  snapshot; the ACP registry refresh succeeded without a tracked diff.
- `pnpm run format:check`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck`: passed.
- `pnpm run installRuntime:mac:arm64`: installed the pinned uv 0.9.18, Node 24.14.1, and
  rtk 0.43.0 runtimes with the local HTTP/SOCKS proxy configured. The installed Node executable
  matched the manifest SHA-256 and reported the pinned version.
- `pnpm run build:unpack`: passed the application build, native rebuild, Electron extraction, and
  unsigned macOS arm64 packaging. The completed app contains `deepchat`, `deepchat.cmd`,
  `deepchat.mjs`, and the executable bundled Node runtime under `app.asar.unpacked`; the POSIX
  launcher retains its executable bit. Code signing and notarization were skipped as expected for
  this local unsigned build.
- The completed packaged launcher returned the versioned `unavailable` envelope and exit code `3`
  against an isolated stopped-desktop profile. With the unpacked app running against another
  isolated profile, packaged `system status`, `system version`, `system capabilities`, and
  `system doctor` commands all exited `0`; doctor reported healthy transport, descriptor,
  46-method V1 surface, and renderer approval checks. App shutdown ran `cliServer.stop`, removed
  the descriptor and socket, left no packaged app process, and restored launcher exit code `3`.
