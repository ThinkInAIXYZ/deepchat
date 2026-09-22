# Cloudflare Tunnel Device Sync Plan

Contract: [spec.md](./spec.md).

## Implementation

- [x] Integrate Device sync with R2/S3, guided domain setup and cloudflared toolchain management.
- [x] Map canonical session bundles, definitions, prompt-list settings, portable preferences and memory.
  Preserve local paths, runtime state, embeddings, jobs, approvals and device credentials.
- [x] Capture committed writes and deletions in a transactionally updated latest-state SQLite index.
  Seed existing roots once, retain original timestamps/origins on relay, and exclude tracking from backups.
- [x] Migrate portable preferences to existing SQLite settings and preserve manual backup compatibility.
- [x] Apply newer units and durable receipts atomically, honor memory domain tombstones, recompare
  after admission, and use existing session gates to defer active sessions and pending input.
- [x] Refresh affected session views, prompt/provider caches and settings events after commit.
- [x] Schedule event-driven exchanges after 15 quiet seconds, at least 60 seconds between starts,
  with a 120-second maximum wait for eligible pending work. Keep one cycle in flight.
- [x] Add v2 write grants, SSE revision notifications, two-way immutable batches, resumable parts,
  digest verification, retry and revocation checks. Keep v1 tokens read-only for v2.
- [x] Bound batches and staging, preserve pending work across restart, and pause safely for manual
  database maintenance. Regenerate identity when an imported database has no local tracking.
- [x] Add the automatic-sync switch, timing/overwrite explanation, busy/offline status and typed events.

## Whole-change review and validation

- [x] Review conflict ordering, deletion, transaction rollback, identity, runtime admission,
  compatibility, cache invalidation, resource bounds and cleanup.
- [x] Retain focused native SQLite and HTTP regression tests for handoff, deletion, memory tombstones,
  receipts, staged resume, corruption, write grants and revocation.
- [x] Verify 15/60/120-second scheduling and absence of idle exchanges with virtual time.
- [x] Verify portable-setting migration preserves existing SQLite values and excludes local paths.
- [x] Measure an 8 MiB changed session and a 1,000-write burst; remove the temporary probe.
- [x] Finish static checks, renderer regression suite and isolated Electron smoke.
- [x] Commit, push and update Draft PR #2344 with implementation scope and validation.

## Validation evidence

Full main-process validation passes: 663 files / 9,371 tests (4 skipped). Focused validation passes: 35 main-process files / 259 tests, 3 renderer files / 107 tests,
2 package-budget tests and one isolated Electron smoke. Format, i18n, lint, typechecks, renderer
boundaries, icons and the production build pass.

Native SQLite and loopback HTTP checks exercise real storage, gzip parts and sockets. The timing
check observes exchange starts under virtual time. The complete-schema check covers canonical memory
tombstones and portable settings. Renderer checks cover synchronization status and existing session
refresh behavior. The Electron smoke covers consent, legacy read-only access, v2 application through
the full main process, backup preparation, restart, toolchain navigation and narrow layout.

On this macOS ARM64 machine, an 8 MiB changed session measured 9.3 ms for export, 19.0 ms for batch
serialization/compression/file persistence, and 13.7 ms for validation/application. A transaction with
1,000 successive metadata edits measured 13.8 ms. These are local synthetic measurements, not a
cross-platform performance guarantee. Batches target 8 MiB with a 32 MiB hard limit; sessions above
that limit need smaller content before they can sync. Export waits behind busy units to preserve a
contiguous acknowledgement cursor.

The package smoke budgets allow 48 MiB of compressed non-OCR runtimes on targets bundling
cloudflared, based on CI measurements of 41–44 MiB. Windows ARM64 retains its 32 MiB budget because
it does not bundle cloudflared; OCR and Node budgets are unchanged.

## External validation

- [ ] Test public transfer and a named custom-domain tunnel with a reachable Cloudflare account/network.
- [ ] Verify Windows/Linux packaging on their native runners.

The pinned macOS ARM64 cloudflared artifact passes SHA256 verification and Quick Tunnel allocation.
The local network blocks edge TLS/port 7844, so loopback success does not establish public connectivity.
Windows ARM64 has no native official artifact at the current pin. These external checks remain visible
in the Draft PR rather than being reported as completed.
