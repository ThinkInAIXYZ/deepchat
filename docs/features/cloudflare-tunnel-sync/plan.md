# Cloudflare Tunnel Host Sync Plan

Spec: [spec.md](./spec.md).

## Phase 1 — User-managed tunnel

Objective: a host explicitly publishes a backup through the user's tunnel; a paired receiving
profile downloads, verifies and imports it through the existing database-maintenance boundary.

- [x] Bound manifest extraction without inflating unrelated archive entries.
- [x] Add fixed-port configuration, consent persistence and safe boot/disable behavior.
- [x] Publish a private selected snapshot independently of the legacy sync enable flag.
- [x] Keep publication selection stable across unrelated backups and failed exports.
- [x] Add renderer-only host publishing and client pairing/transfer contracts.
- [x] Protect client tokens with safeStorage outside synced settings; validate HTTPS origin and host identity.
- [x] Add staged resume, response identity/range checks, full hash verification, cancellation and retry.
- [x] Reuse the existing importer through database maintenance; reject concurrent backup/import work.
- [x] Reject unsupported encryption before download and require explicit overwrite confirmation.
- [x] Add Settings → Data host/client controls, text/QR pairing, device management and progress.
- [x] Add Chinese and English copy, with matching English entries in other locale catalogs.
- [x] Review credential containment, publication selection, shutdown, polling and post-import failures.
- [x] Complete targeted regression suites, formatting, i18n, lint and typechecking.
- [x] Build and validate host consent, publish with legacy sync off, restart and disable in an isolated Electron profile.
- [x] Record final verification results and external validation boundaries.

### UI

```text
BEFORE                           AFTER
Data & Privacy                   Data & Privacy
  Local backup / cloud sync        Tunnel sync
  Privacy / maintenance              Host: port, consent, publish, devices
                                     Client: pairing, pull, progress, cancel
                                   Local backup / cloud sync
                                   Privacy / maintenance
```

### Verification

- Format, i18n, lint and Node/renderer typechecks pass. Electron Vite production build passes.
- Targeted Vitest coverage: sync, contracts, CLI surface, existing DataSettings and TunnelSyncSettings.
- The durable Electron host smoke test passes for consent, publication, restart and disable.
- A temporary two-application probe passed with separate user-data directories and a local HTTPS
  proxy trusted through an ephemeral CA. Real safeStorage, IPC, snapshot publication, client pull,
  database maintenance and the importer restored a synthetic host session into the receiving app.
  The probe, certificate/key and temporary profiles were removed after validation.

- Real loopback host/client tests use independent private directories and synthetic backup data.
  Database import is a boundary port in these transport tests; existing importer suites cover
  restoration behavior.
- Electron smoke coverage uses an isolated user-data directory and a backup destination inside it.
  It checks consent before listener startup, explicit publication with legacy sync disabled,
  fixed-port restart, shutdown and narrow-width layout.
- No live user database or real provider credentials are used in validation.
- Real Cloudflare end-to-end transfer and Windows/Linux application runs remain external release
  validation. Phase 1 does not include Access service-token configuration, encrypted remote backups,
  Unix sockets or managed tunnel processes.

## Phase 2 — Push, events and scheduling

- [ ] Add bounded multipart push staging with idempotent retry, integrity verification and cleanup.
- [ ] Reuse database maintenance and existing import semantics; overwrite remains explicitly confirmed.
- [ ] Add publication-change SSE with bounded clients/keepalive; no dependence on stream availability.
- [ ] Add scheduled pulls and user-visible transfer history.
- [ ] Decide Cloudflare Access service-token UX and encrypted-backup import support separately.
- [ ] Review data-loss, resource-limit and credential boundaries; validate the smallest durable cases.

## Phase 3 — App-managed tunnel

- [ ] Add cloudflared to the toolchain catalog with pinned official URLs and SHA-256 per platform.
- [ ] Support system/custom probing and managed raw-binary installation, with no bundled source.
- [ ] Extend existing toolchain UI and missing-runtime actions only where the catalog supports it.
- [ ] Supervise the resolved binary in core, with process-group termination and startup orphan reaping.
- [ ] Validate descriptor pid/host identity before launch; reject missing or stale ownership.
- [ ] Resolve crash-orphan watchdog/parent-liveness behavior before promising crash-time cleanup.
- [ ] Add named-tunnel and Quick Tunnel configuration, HTTP2 defaults and clear tunnel errors.
- [ ] Review and validate process lifecycle, platform support and disabling behavior.
