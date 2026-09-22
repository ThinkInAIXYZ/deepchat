# Cloudflare Tunnel Device Sync Plan

Contract: [spec.md](./spec.md).

## Implemented foundation

- [x] Integrate Device sync with R2/S3 tabs and compact connection controls.
- [x] Provide temporary-address, custom-domain and external-tunnel setup with toolchain navigation.
- [x] Manage verified cloudflared sources and app-owned connector lifecycle.
- [x] Provide consent, private credentials, pairing/revocation and bounded snapshot transport.
- [x] Support resumable manual transfer, integrity verification and confirmed backup restoration.

Automatic bidirectional exchange is not implemented. Existing automatic preparation still serves
manual backup transfers; it must not be presented as the LWW application path.

## Execution

### 1. Timestamp comparison and durable change capture

- [x] Inspect existing backup conflict rules: latest package selection, insert-only record import,
  explicit database overwrite and machine-local settings preservation.
- [ ] Map each sync unit to its persistence owner, canonical data, dependencies and local-only fields.
  Cover whole-session bundles, definitions, portable setting keys, prompts and canonical memory.
  Session tape IDs and dependent rows must be mapped consistently; never copy arbitrary tables.
- [ ] Reuse persisted content modification times; insert missing IDs and replace matching IDs only
  when newer. Use device ID only for timestamp ties. Add the latest-state revision index and deletion
  markers needed for delivery; do not add a global clock service or conflict workflow.
- [ ] Capture successful writes transactionally across UI, CLI, agent and background paths. Reconcile
  interrupted file-backed writes. Exclude transient activity, projections and sync bookkeeping.
- [ ] Index existing data once with preserved timestamps or deterministic baseline stamps. Define
  backup exclusions and identity regeneration so restore does not clone a replica.

Completion: committed changes and deletions survive restart, rolled-back writes are absent, and
replaying an identical remote unit neither changes its stamp nor produces another local edit.

### 2. Safe domain application

- [ ] Apply validated LWW units through live-database domain operations with atomic dependencies and
  receipt progress. Preserve domain memory tombstones and regenerate only affected projections.
- [ ] Add affected-unit admission coordinated with session/tool startup. Stage busy work durably and
  retry on idle; recompare after waiting. Do not cancel runs or invoke global database maintenance.
- [ ] Ensure imported history cannot replay tools or enqueue jobs, and refresh open views after
  commit without resetting local drafts. Keep manual backup import behavior separate.

Completion: switching devices preserves new sessions and applies newer edits/deletions without
interrupting generation, with no whole-database replacement or synthetic runtime execution.

### 3. Event-driven scheduling

- [ ] Implement 15-second quiet time, 60-second minimum between starts and a 120-second maximum wait
  for eligible data. Use one-shot timers, one in-flight cycle and persisted pending revisions.
- [ ] Preserve changes made during preparation, coalesce repeated edits, skip unchanged data and
  defer active session bundles. Distinguish manual flush, reconnect and batch continuation.

Completion: deterministic scheduler checks demonstrate the accepted timing boundaries and no idle
scanning/polling; restart and continuous editing do not lose or indefinitely starve eligible work.

### 4. Bidirectional protocol and recovery

- [ ] Implement explicit v2 compatibility and write-consent negotiation without changing v1 payloads.
  Add authenticated revision notifications and current-state negotiation.
- [ ] Implement immutable bounded batches and resumable parts in both directions, retaining original
  stamps through the host. Reuse staging, integrity and transport bounds where their contracts fit.
- [ ] Persist acknowledgements only with application/no-op completion. Handle gaps, busy units,
  duplicate uploads, lost acknowledgements, restart and re-enumeration including tombstones.
- [ ] Close event streams and cancel uncommitted work on revocation. Bound staging, streams and
  backoff; propagate accepted peer changes to other peers without echo loops.

Completion: two peers and a host converge after disconnects and crashes with no recurring change
queries, unintended write access, cursor gaps or full-database export for each ordinary change.

### 5. Settings and enrollment

- [ ] Add automatic-sync opt-in and compact live status through typed events. Explain timestamp
  overwrite and session replacement; retain Sync now and explicit restore. No conflict controls.
- [ ] Preserve tunnel/toolchain controls. Migrate existing pairs as manual/read-only until write
  enrollment is accepted. Keep English/Chinese copy and locale catalog parity.

Completion: closing settings does not stop sync; waiting for an active chat is visible; existing
pairings cannot silently start overwriting data. Include the spec's BEFORE/AFTER ASCII in the PR.

### 6. Whole-change review and validation

- [ ] Review domain ownership, newer/older/tied timestamps, deletions, bootstrap, write-capture completeness,
  runtime admission, bounded resource use, secret exclusions and legacy protocol behavior.
- [ ] After implementation, select the smallest durable regression coverage for convergence,
  scheduling, device handoff, writes during transfer, restart recovery, authorization and active-session
  protection. Do not build a concurrent session-editing test matrix.
- [ ] Exercise isolated Electron profiles and inspect normal/narrow UI. Measure idle cost, large
  session preparation/application, burst edits, multiple peers, slow links and resume behavior.
- [ ] Run format, i18n, lint, types, relevant tests, renderer boundaries, icons and production build.
  Remove temporary probes, record evidence and update the existing Draft PR to its implemented scope.

## Validation evidence

The foundation has 29 relevant Vitest files / 281 passing tests, one passing isolated Electron smoke,
and passing format, i18n, lint, types, renderer baseline, icons and production build. These results
cover manual transfer and tunnel/toolchain behavior, not the unchecked automatic-sync work above.

The official macOS ARM64 cloudflared 2026.9.1 artifact installs with pinned SHA256 verification.
Quick Tunnel allocation succeeds locally, but the edge TLS handshake fails and port 7844 precheck is
blocked. Public end-to-end transfer, named tunnel account setup and other platform packaging require
separate verification; synthetic local transport success is not evidence of public connectivity.

Backup import research is checked against the existing sync service, configuration import and table
filtering suites: 3 files, 29 passing tests. Design artifacts pass format, i18n, lint, Node/renderer
typechecks and `git diff --check`.
Automatic LWW behavior has no implementation or runtime validation yet.
