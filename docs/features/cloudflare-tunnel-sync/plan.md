# Cloudflare Tunnel Sync Plan

Spec: [spec.md](./spec.md).

- [x] Add cloudflared to existing toolchain sources, pinned verified downloads and runtime bundling.
- [x] Add private tunnel configuration, supervised Quick/named connectors, status and shutdown.
- [x] Prepare current data on authenticated sync requests while preserving partial-download resume.
- [x] Place device sync in the existing storage tab group; provide compact setup, connection and sync controls.
- [x] Add domain guidance, toolchain status/navigation and Chinese/English copy.
- [x] Review lifecycle, secrets, migration, concurrency and app boundaries.
- [x] Validate relevant behavior, format, i18n, lint, types, renderer baseline, icons, build and UI.

## UI

```text
BEFORE                              AFTER
Tunnel sync (separate large card)    Sync [R2 | S3 compatible | Device sync]
  Port, manual command, publish       cloudflared status       [Manage]
  Pairing and receiving forms         Share this device        [Enable]
Local/cloud sync                      Address mode + focused setup guide
                                      Connection information   [Copy/QR]
                                      Connect another device   [Sync now]
```

## Validation boundary

Use synthetic profiles only. Public Cloudflare service availability and platform packaging must be
reported separately from local transport, process lifecycle and renderer verification.


## Validation

- Format, i18n, lint, Node/renderer typechecks, renderer architecture baseline and generated icons pass.
- Relevant Vitest coverage: 29 files, 281 tests pass, including authenticated preparation, failed
  exports, interrupted download resume, token handling, connector shutdown, consent migration and
  toolchain source persistence.
- Electron smoke: 1 test passes with an isolated synthetic profile. It covers the integrated tab,
  domain guide, automatic export, fixed-port restart, disable, toolchain navigation and narrow layout.
- Electron production build passes. The official macOS ARM64 cloudflared 2026.9.1 artifact installs,
  passes the pinned SHA256 check and reports its version.
- Real Quick Tunnel allocation succeeds, but the local network blocks the edge TLS connection
  (`TLS handshake with edge error: EOF`; port 7844 precheck fails). Public end-to-end transfer is
  unverified in this environment. The UI reports the network failure; connector teardown succeeds.
- Named tunnel account configuration and non-macOS packaging require platform/account validation.
  The pinned official release has no native Windows ARM64 asset, so that target omits the bundled
  connector and supports an external executable or separately managed tunnel.
