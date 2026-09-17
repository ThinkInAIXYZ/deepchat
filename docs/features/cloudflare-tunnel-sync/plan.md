# Cloudflare Tunnel Host Sync Plan

Spec: [spec.md](./spec.md). Issue: [#2302](https://github.com/ThinkInAIXYZ/deepchat/issues/2302).

## Architecture

Two boundaries, one data path:

1. `SyncHostService` (core, `src/main/sync/host/`) owns the loopback sync endpoint, pairing, device
   token authority, snapshot streaming, push assembly, rate limits, and audit. It consumes the
   existing `SyncService` backup pipeline and `importFromSync`; it does not implement export/import
   itself.
2. The Cloudflare Tunnel helper is **core-supervised** using the binary resolved from the plugin's
   declared runtime (`PluginServicePort.getPlugin(id).runtime.command`). The plugin package owns the
   bundled `cloudflared` binaries, their manifest declarations, and the tunnel settings UI; it does
   not own the process (slice 0 finding, recorded in `spec.md`).

Renderer owns Settings → Data UI for both layers (host mode, pairing, devices, status, progress,
errors). New canonical shared contracts live in `src/shared/contracts/routes/`; the renderer reaches
them through existing `api/*Client` patterns.

## Current status

Landed and verified (typecheck node+web, lint, format, i18n, `test/main/sync`, `test/main/contracts`,
`test/main/cli/surface.test.ts`):

- `src/shared/contracts/syncHost.ts` — wire protocol, shared limits, DTO schemas.
- `src/shared/contracts/routes/syncHost.routes.ts` + catalog registration — `syncHost.*` IPC surface.
- `src/main/sync/host/{index,endpoint,devices,pairing,snapshot,state,routes}.ts` — host mode,
  loopback endpoint (`handshake`, `pair`, `status`, `snapshot` with Range), device token authority,
  pairing codes, audit, private machine-local state, and the endpoint descriptor.
- Composition wiring: service construction, `syncHostRoutes` in the route map, boot-time
  `startIfEnabled()`, and a `syncHostService.stop` destroy step.
- `test/main/sync/host/hostEndpoint.test.ts` — 20 real-listener tests: uniform pre-auth 401s,
  authenticated 404/405/501, pairing single-use and failure accounting, revocation (including across
  a state reload), token-hash containment, byte-exact Range resume, abort-then-resume, corrupt
  archive handling, loopback-only reachability, stalled-request reaping, oversized-body 413,
  pre-`initialize()` state preservation, lifecycle consistency under interleaved transitions, and
  teardown.

Not yet landed: push, change events, renderer UI + i18n copy, the tunnel supervisor, the plugin
package, snapshot production, and everything on the slave side.

## Review record

Independent security, correctness/lifecycle, and spec-conformance reviews were run against the first
implementation. Findings and disposition:

| Finding | Severity | Disposition |
| --- | --- | --- |
| Device records, host identity and the enabled flag lived in the synced settings blob, so token hashes would ship in every backup/S3 upload and be merged on import (importer accepts the original host's tokens, revoked devices resurrect, host mode enabled without consent) | high | **Fixed** — all host state moved to `<userData>/sync-host/host-state.json` (`0600`, atomic); no settings keys involved. Covered by a test asserting the token never appears on disk. |
| `'sync_host'` was added to the log-event type union but not to the runtime `STARTUP_COMPONENTS` allowlist, so boot-failure reporting was silently rejected | high | **Fixed** — allowlist updated. |
| Unauthenticated method/path handling revealed the route surface (405/404 before auth) | medium | **Fixed** — uniform 401 before path/method handling; authenticated callers still get 404/405. |
| Stalled unauthenticated request could hold one of 16 connection slots for the 30-minute request timeout | medium | **Fixed** — request-receive timeout is now 60 s (configurable) and does not bound response streaming; covered by a stalled-socket test. |
| An anonymous caller could permanently kill pairing by burning the attempt budget | medium | **Fixed** — failures now impose backoff and never destroy the code; covered by a test. |
| Whole-archive `readFile` for the manifest, with no in-flight dedupe, multiplied memory under concurrent requests | medium | **Fixed** — the manifest is streamed (bounded memory) and concurrent `current()` calls share one digest pass. |
| No start/stop serialization: interleaved enable/disable could leave a listener running while host mode read as disabled | medium | **Fixed** — lifecycle transitions are serialized and `start()` is idempotent; invariant asserted in tests. |
| `stop()` could report stopped while the port was still bound (2 s fallback timer) | medium | **Fixed** — `stop()` awaits the real close, escalates, and warns if the listener survives. |
| Mid-stream read error never ended or destroyed the response, hanging the client until the request timeout | medium | **Fixed** — the connection is aborted instead. |
| Zero-byte snapshot produced an invalid range read | low | **Fixed** — explicit 409 for an empty package. |
| `push` path was missing from the handled set, so an authenticated push returned 404 while the comment claimed 501 | low | **Fixed** — returns 501 `not_implemented`. |
| Whitespace-only device name was accepted and replaced by a placeholder | low | **Fixed** — request schema trims and rejects empty names. |
| Rate-limit map was never pruned and keyed on an unvalidated header | low | **Fixed** — pruned on insert; the header is only trusted when it looks like an IP literal. |
| `databaseEncrypted` was computed from the manifest and then dropped by the schema | low | **Fixed** — reported in `status` so a slave fails clearly instead of hitting a decrypt error. |
| The traversal test was vacuous (`/sync/v1/../secret` is normalized client-side) | low | **Fixed** — replaced with uniform-401 and authenticated-404/405 assertions. |
| Provider API keys travel inside `agent.db` in every package; the spec claimed credentials never leave the machine | high | **Open — needs a product decision** (spec Open Questions): redact provider credentials from the export, or ship explicit consent + warning. |
| Host does not produce a snapshot on demand; a fresh host answers 404 and `startBackup` refuses while the legacy S3 toggle is off | medium | **Open** — added to slice 4. |
| Tokens are unscoped and non-expiring in practice though the spec implied scope and expiry | medium | **Open** — spec wording corrected; scope/expiry model is phase-2 or an explicit slice. |
| Descriptor pid/host-identity is never verified, so a stale descriptor could aim the tunnel at a reassigned port | medium | **Open** — slice 7 must verify the descriptor before launching the tunnel. |
| User-visible failures from main are not translatable copy yet (bind failure now throws a key-shaped error) | medium | **Open** — slice 1 adds the copy. |
| Cloudflare Access service token: no handling, no UI, no "no-Access" warning | medium | **Tracked** — slice 7. |
| Explicit confirmation + risk notice for enabling host mode is UI-only and unenforced in main | medium | **Tracked** — slice 1. |
| A mutation arriving before the initial state read persisted the empty default state over the real file, discarding every device record and the enabled flag | high | **Fixed** — `update()` loads first and concurrent loads share one read; regression test covers pre-`initialize()` mutation. |
| Persist failures were swallowed, so the documented enable rollback was dead code and a revocation could report success without being durable | medium/high | **Fixed** — write failures propagate to callers (the enable path rolls back, revocation surfaces an error); only last-seen is best-effort. |
| An unparseable archive threw out of a stream handler, escaping to the main process and hanging the request | medium | **Fixed** — archive errors are contained and report a null format version; covered by a corrupt-archive test. |
| The pairing backoff was global, so an anonymous caller could keep the legitimate user from pairing | medium | **Fixed** — failures are charged to the calling source; the user's code is never invalidated or blocked. |
| The audit recorded the planned status for an aborted transfer and dropped the device id on failures | low/medium | **Fixed** — aborted transfers are recorded as 499 and authenticated requests keep their device id. |
| An oversized pairing body reset the connection instead of answering | low | **Fixed** — the body is drained and the caller receives 413. |
| A package rewritten during hashing could be cached under a stale identity | low | **Fixed** — identity is re-verified after hashing; a second change reports no snapshot rather than a mismatched hash. |

## Slice 0 — Gates before implementation

Objective: remove the two unknowns that decide the plugin/core split.

- [x] Verify declared-process capability semantics. **Result: a plugin cannot own a long-lived
      non-MCP child.** An official plugin can only run a binary as an MCP stdio server; the SDK
      kills only the direct child (SIGTERM→SIGKILL) and closes the transport before tree
      termination, so a grandchild is reparented and survives. Plugin-owned supervision fails the
      "no leftover process" acceptance criterion.
- [x] Decide how the endpoint port reaches the tunnel layer. **Result: a private descriptor file**
      (`<userData>/sync-host/endpoint.json`, `0600`, temp+rename), written on start and removed on
      stop.
- [x] Adopt the fallback: tunnel supervision lives in core; the plugin supplies the binary and UI.

Completion: met — both questions are answered in `spec.md` and the fallback is adopted.

## Slice 1 — Shared contracts and settings surface

Objective: freeze the interface before handlers exist.

- [x] Add canonical contracts for host enable/disable, status, pairing code, device list/rename/revoke
      with redacted public DTOs (no tokens, no secrets) — `src/shared/contracts/routes/syncHost.routes.ts`.
- [ ] Add slave-side contracts (configure, transfer trigger) when slice 8 starts.
- [ ] Add i18n keys for all new user copy, including the enable risk notice, the Quick Tunnel
      re-pairing warning, the "increment does not propagate updates or deletions" limitation, and
      the `syncHost.error.bindFailed` key thrown by the host start path.
- [ ] Decide and surface the provider-credential situation (redact on export, or explicit consent +
      warning) before host mode can be enabled.
- [ ] Extend Settings → Data with a host section and a slave section.

Completion: contracts and copy exist, typecheck passes, no handlers yet. Host-side contracts landed;
copy and UI are pending, so this slice is not closed.

## Slice 2 — Endpoint, auth and audit

Objective: a loopback endpoint that rejects everything it should.

- [x] `SyncHostService` binds `127.0.0.1:<ephemeral>` while host mode is enabled.
- [x] Reuse control-plane hardening patterns: descriptor file `0600` via temp+rename, header cap,
      connection cap, a per-request *receive* timeout (response streaming stays unbounded), and a
      body cap on the pair request.
- [x] Bearer device-token middleware with hash-only storage, expiry, immediate revocation; 401 on
      every failure path, authentication before method/path handling.
- [x] Bounded audit log: device, method, bytes, result, client IP; never tokens or payload contents.
- [x] `GET /sync/v1/handshake` reports protocol, host identity, app version, capabilities and
      encryption mode; snapshot format version is reported by `status` instead, since it comes from
      the backup manifest rather than a global constant.

Completion: met — unauthorized paths cannot return 200, and handshake is the only unauthenticated
route (covered by `hostEndpoint.test.ts`).

## Slice 3 — Pairing and device lifecycle

Objective: devices get tokens, and can lose them.

- [x] Pairing code: short TTL, single use, bounded attempts, carries the host identity. QR rendering
      is UI work and remains pending.
- [x] `POST /sync/v1/pair` exchanges the code for a per-device token; the host persists only the
      token hash plus metadata.
- [x] Device list, rename, revoke; revocation takes effect on the next request.
- [ ] Slave side stores `{hostUrl, deviceId, token}` with `safeStorage`, never in synced settings or
      backup packages.

Completion: host side met (pair → request → revoke → rejected, covered by tests). End-to-end
verification on two instances waits for the slave side.

## Slice 4 — Snapshot pull

Objective: resumable, integrity-checked pull.

- [x] `GET /sync/v1/status` reports snapshot file name, size, hash and backup format version.
- [x] `GET /sync/v1/snapshot` streams the latest backup with `Content-Length` and hash headers;
      `Range` returns 206 with `Content-Range`, unsatisfiable ranges return 416, and no snapshot
      returns 404.
- [ ] Produce a snapshot on demand when the host has none (or none newer than its own data), and
      define behavior while the legacy S3 sync toggle is off instead of silently serving 404 or an
      arbitrarily old package.
- [ ] Slave resumes by offset, verifies the assembled hash, then calls the existing import path.
      A partial download never reaches import.

Completion: host side met (whole-file and ranged reads are byte-exact). The end-to-end resume →
import path waits for the slave side.

## Slice 5 — Push

Objective: host-side import that cannot half-apply.

- [ ] `POST /sync/v1/push` accepts bounded parts (target ≤ 32 MiB), each independently retryable and
      idempotent, staged outside the sync folder.
- [ ] Reassembly verifies part set, size and hash before import; incomplete pushes are discarded and
      staged files cleaned up.
- [ ] Import uses existing `increment` | `overwrite` semantics; `overwrite` is an explicit,
      confirmed action.

Completion: a push interrupted between parts leaves no import side effect and can be resumed.

## Slice 6 — Change events

Objective: slaves can notice host changes without polling hard.

- [ ] `GET /sync/v1/events` SSE stream with bounded keepalive and client count, no payload contents.
- [ ] Slave degrades to manual/scheduled pull when the stream is unavailable.

Completion: stream works through the tunnel and its absence never breaks sync.

## Slice 7 — Tunnel helper (core supervisor + plugin package)

Objective: the tunnel layer, without the data plane. Split by slice 0's decision.

Core supervisor:

- [ ] `SyncHostTunnelService` spawns `cloudflared` using the binary path from
      `PluginServicePort.getPlugin(id).runtime.command`, and stops it via
      `terminateProcessTree` with `detached: true` on POSIX so the whole group dies.
- [ ] Add a subsystem value to `ChildProcessSubsystem` and reap stale tunnel processes at startup,
      mirroring the MCP server reaping path.
- [ ] Crash-orphan watchdog or parent-liveness strategy (see `spec.md` open questions); until then
      "no leftover process" holds at next boot rather than at crash time.
- [ ] Protocol selection with `http2` default, precheck `suggested_protocol` surfaced, and clear
      errors for UDP-blocked networks.
- [ ] Read the endpoint port from `<userData>/sync-host/endpoint.json` and verify its pid and host
      identity before launch, rejecting a missing or stale descriptor instead of aiming the tunnel
      at a port the OS may have reassigned to another local service.
- [ ] Lifecycle wired into the same destroy path as `syncHostService.stop`.

Plugin package:

- [ ] `plugins/cloudflare-tunnel-sync/` with `plugin.json`, official source metadata, per-target
      packages, bundled binaries (~42 MB per target), and `plugin:` detect candidates per platform.
- [ ] Named-tunnel configuration (user domain, config-file ingress) plus Quick Tunnel debug mode
      with the re-pairing warning; optional `service: unix:` ingress for named tunnels.
- [ ] Settings contribution page: tunnel state, transport warnings, Cloudflare Access
      service-token fields (host mode, pairing and device list live in Settings → Data, in core).

Completion: a host exposes the endpoint over a real tunnel, and disabling host mode cleans up fully.

## Slice 8 — Slave transfer UX

Objective: the flow a user actually runs.

- [ ] Slave-side pull and push with progress, cancel, retry and readable errors.
- [ ] On-demand and scheduled triggers; last-sync time and result in Settings → Data.
- [ ] Host-side view: connected devices, last seen, transfer history summary.

Completion: two machines stay in sync across a restart, a tunnel outage, and a revoked device.

## Slice 9 — Whole-change review

Objective: verify the change against the spec before handoff.

- [ ] Review hidden side effects, compatibility, failure behavior, performance, security, naming and
      maintenance cost against `spec.md`.
- [ ] Confirm invariants: loopback-only binding, no credential-class data in any transfer, no
      partial imports, no leftover process or port.
- [ ] Confirm known limitations are user-visible copy, not silent behavior.

Completion: every acceptance criterion in the spec has a check or a recorded reason it is deferred.

## Slice 10 — Validation and quality gates

Objective: the smallest durable verification, then repo gates.

- [ ] Durable tests only for qualifying behavior: auth rejection and revocation, credential
      exclusion, resumable transfer integrity, push reassembly atomicity, and host-mode teardown.
- [ ] Remove every temporary probe and spike artifact before handoff.
- [ ] Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and the
      relevant `test/main` and `test/renderer` suites.

Completion: gates pass, and the durable tests fail if an invariant regresses.

## Notes

- Validation evidence and transport measurements are recorded in `spec.md`; the spike used synthetic
  data only and has been torn down.
- `Closes #2302` belongs in the PR body.
