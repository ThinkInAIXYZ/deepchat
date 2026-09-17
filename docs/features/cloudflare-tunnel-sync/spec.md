# Cloudflare Tunnel Host Sync

Status: proposed. Transport validated end-to-end; host-side core implemented (pairing, device
tokens, status, snapshot pull with resume). Tunnel supervision, push, change events, settings UI
and the slave side are not implemented yet.

Tracks GitHub issue [#2302](https://github.com/ThinkInAIXYZ/deepchat/issues/2302).

A DeepChat instance becomes the **host** (device A) and exposes a sync endpoint through the user's
own Cloudflare Tunnel, so other devices (B/C/D) can pull from or push to it over a public HTTPS
address without a third-party bucket, inbound port, or working NAT. Topology is star-shaped: slaves
talk only to the host; devices never connect to each other.

The existing S3/R2 cloud backup flow stays as-is and is not replaced.

## Goals

1. Host mode: a host exposes an authenticated sync endpoint through a user-operated Cloudflare
   Tunnel; no inbound port, works behind CGNAT.
2. Pairing: the host shows a short-lived pairing code (text + QR); a slave exchanges it for its own
   device token. The host can list, rename, and revoke devices at any time.
3. Transfer: slaves pull the host snapshot or push their own backup to the host, reusing the
   existing backup/import pipeline with `increment` and `overwrite` semantics unchanged.
4. Visibility: tunnel state, transport protocol, last sync time, progress, and errors live in
   Settings → Data.
5. Security: every request except `handshake` is authenticated; Cloudflare provides TLS; optional
   Cloudflare Access service token; loopback-only origin binding.

## Non-Goals

- No DeepChat-operated relay, no multi-tenant account system.
- No queueing or forwarding while the host is offline; slaves wait or skip.
- No programmatic manipulation of the user's Cloudflare account.
- No replacement of the existing S3/R2 backup path.
- No concurrent-edit merge in this phase (see Known Limitations).
- No incremental or delete-propagation improvement to the backup format itself.

## Ownership

Two layers, deliberately split by capability rather than by convenience:

- **Core** owns the data plane: the loopback-bound sync HTTP surface (`/sync/v1/*`), pairing, device
  token authority, snapshot streaming, push assembly, audit, and the Settings → Data UI. Core
  already owns `agent.db`, the backup pipeline and the import semantics; the endpoint must not
  duplicate them.
- **Core also supervises the tunnel process** (Plan slice 0 closed this question against the
  original assumption). Slice 0 established that a plugin cannot own a long-lived `cloudflared`
  child: an official plugin can only run a binary as an MCP stdio server, the SDK kills only that
  direct child (SIGTERM then SIGKILL) and closes the transport *before* tree termination, so a
  reparented grandchild survives — which fails the "disabling leaves no leftover process"
  acceptance criterion. Core supervision is therefore required, not preferred.
- **Plugin** (`com.deepchat.plugins.cloudflare-tunnel-sync`, official package) owns binary
  provisioning and user-facing tunnel configuration: the bundled `cloudflared` per target, its
  declared runtime manifest, the tunnel settings/status page, and the configuration values core
  needs to launch the tunnel.

The plugin still cannot carry the data plane for the reasons below: an official plugin cannot
register HTTP routes on the app server, cannot reach the DB or backup pipeline (`sync.*` contracts
are renderer-IPC only and absent from the CLI surface), and the only host-owned runtime adapter
(`cua-embedded-v1`) is reserved for the CUA plugin.

## Host Endpoint

A new server in the main process owns `127.0.0.1:<ephemeral-port>`, started only while host mode is
enabled:

- **Binding invariant**: loopback only. Never `0.0.0.0`, never a LAN address. This is what the
  issue's security baseline permits and what the transport evidence forces: `cloudflared` Quick
  Tunnels cannot target a unix socket, so a TCP origin is required on every platform.
- **Platform coverage**: POSIX and Windows both use the loopback listener. Windows cannot use a
  named pipe for this, because `cloudflared` cannot dial one.
- **Hardening** reuses the control-plane patterns rather than inventing new ones: descriptor file
  `0600` written by temp+rename, `maxHeaderSize` cap, connection cap, a bounded *request-receive*
  timeout (which does not limit response streaming, so long downloads stay possible while a stalled
  request cannot hold a connection slot), per-route body caps, and a bounded audit log.
- Authentication runs before path and method handling: every unauthenticated request other than
  `handshake` and `pair` receives one uniform 401, so callers cannot map the route surface. Unknown
  paths and unsupported methods are only distinguished for authenticated devices.
- The endpoint is **not** the local control plane. That surface explicitly non-goals TCP, loopback,
  remote access and network callers, and its bearer token is a same-user file-readable secret. Host
  sync gets its own listener, its own token authority, and its own principal model.
- Core publishes the bound port and host identity to a private descriptor
  (`<userData>/sync-host/endpoint.json`, `0600`, temp+rename), which the tunnel supervisor reads
  instead of guessing the port. The descriptor is removed when host mode is disabled.
- Renderer access is IPC-only (`syncHost.*` routes); remote devices never touch those routes.

## Pairing and Device Tokens

- Enabling host mode is off by default and requires an explicit confirmation with a risk notice.
- The host generates a pairing code: short TTL (single-digit minutes), single use, rate-limited
  attempts. It carries the host identity, and the UI renders it as text plus QR alongside the
  current tunnel URL, so a slave can confirm it reached the intended host.
- Failed attempts impose a backoff window but **never destroy the code**. Anyone who learns the
  tunnel hostname can call `pair` unauthenticated, so letting failures invalidate the code would
  hand an anonymous caller a permanent denial of pairing.
- Phase 1 uses an opaque host identity (`hostId`) rather than a cryptographic host key: the value is
  generated once per profile and is what a slave compares against the pairing payload. Signature
  verification and end-to-end payload encryption remain outside this phase and must not be implied
  in UI copy.
- `POST /sync/v1/pair` exchanges the code for a per-device token. The host stores only the token
  hash plus device metadata (id, name, created/expires, last seen).
- Tokens are per device and revocable immediately; revocation is enforced on the next request, not
  on restart. Phase 1 issues unscoped, non-expiring tokens — the store supports expiry but pairing
  does not set one yet, and there is no scope model. UI copy must not imply otherwise.
- Every other route requires `Authorization: Bearer <device-token>`; failures return 401 and never
  a success status, and authentication runs before method or path handling so unauthenticated
  callers learn nothing about the route surface.

## Snapshot Pull

`GET /sync/v1/snapshot` streams the latest backup package:

- `Content-Length`, snapshot id, and content hash headers are required; `Range` requests return
  `206` with `Content-Range` (validated end-to-end, see Validation Evidence).
- The slave resumes by offset, then verifies the assembled hash before importing. A partial
  download never reaches `importFromSync`.
- Payload reuse is the existing pipeline (`startBackup` producing `backup-<epochMs>.zip`,
  `importFromSync` with `increment` | `overwrite`), not a parallel export implementation.
- The host currently serves whatever the newest package in the sync folder is; it does not yet
  produce one on demand. A fresh or stale host therefore answers 404 or serves an old package, and
  `startBackup` additionally refuses while the legacy S3 sync toggle is off. Closing this gap (a
  host-triggered snapshot or an explicit "no snapshot yet" state) is required before the acceptance
  criteria can pass.

## Push

`POST /sync/v1/push` accepts a slave's backup for host-side import, split into bounded parts:

- Cloudflare documents a **100 MB proxied request body limit** on free plans. Our validation pushed
  125,829,120 bytes through a Quick Tunnel successfully, so enforcement varies by tunnel mode, plan
  and edge; the design must not depend on it. Parts are therefore capped well below that
  (target ≤ 32 MiB), each part is independently retryable and idempotent, and the host reassembles
  into a staging file before import.
- Import runs only after full assembly and hash/identity verification. An interrupted or partial
  push leaves no import side effect; staging is discarded and cleaned up.
- Imported data uses the existing `increment` | `overwrite` modes. `increment` only inserts missing
  rows; it does not propagate updates or deletions. This limitation is user-visible copy, not a
  hidden surprise.

## Change Events

`GET /sync/v1/events` is a long-lived SSE stream used to tell slaves that host data changed, so a
slave can decide to pull. Bounded keepalive, bounded client count, no payload contents, no
credential material. Slaves must treat it as an optimization: absence of the stream must degrade to
manual or scheduled pulls, never to a broken sync.

## Slave Device Side

- Slaves store `{hostUrl, deviceId, token}` locally; the token is protected with `safeStorage`,
  never written to synced settings or backup packages.
- Slaves trigger pull or push on demand or on a schedule, with progress, cancel, and clear errors.
- Host URL changes (for example after a Quick Tunnel restart mints a new hostname) invalidate
  pairing for that device until re-paired; the UI must say so instead of failing opaquely.

## Tunnel Helper Plugin

- Package id `com.deepchat.plugins.cloudflare-tunnel-sync`, official source, per-target packages
  following the existing `deepchat-plugin-*` release naming.
- `cloudflared` ships **inside the plugin package** (measured `darwin-amd64` binary: 41.7 MB), so
  no download infrastructure is required. Detection uses manifest `plugin:` relative candidates and
  the host applies the executable bit; version comes from `--version`. Note that
  `runtime.install.provider`/`strategy` are only recorded as labels by the host today; there is no
  generic manifest-driven downloader to lean on.
- **Transport protocol**: `http2` is the default and is user-selectable. QUIC/UDP 7844 is blocked on
  real networks (including the validation network): with the default `auto`, `cloudflared` retries
  QUIC indefinitely and every request fails with 502 while TCP/HTTP2 passes the precheck. The plugin
  surfaces transport state and the precheck's `suggested_protocol` instead of failing silently.
- Tunnel modes: a named tunnel on the user's own domain (fixed hostname, the supported product path)
  and Quick Tunnel (random `*.trycloudflare.com`, debug/fallback, no SLA, new hostname per start).
  Quick Tunnel mode must warn that pairing does not survive a restart.
- Optional hardening: for named-tunnel users, a config-file ingress with
  `service: unix:/<userData>/sync.sock` is supported and validates cleanly, but it must remain
  optional because Quick Tunnel cannot use it.
- Host mode disable must stop the tunnel process and close the listener: no leftover `cloudflared`,
  no listening port, no stale socket file.

## Excluded Data (Invariants)

These must never appear in any transfer, and this is verified rather than assumed:

- **Host-mode credentials and identity**: device token hashes, the host identity and the enabled
  flag. These are satisfied by construction: host state lives in a private machine-local file
  (`<userData>/sync-host/host-state.json`, `0600`), not in the settings blob. This matters because
  settings travel inside backup packages (`configs/app-settings.json`), into S3/R2 uploads, and are
  merged wholesale on import — a settings-backed device list would have let an importer accept
  another host's device tokens, resurrect revoked devices, and enable host mode without consent.
- tunnel credentials and Cloudflare Access secrets — nothing in the sync path touches them yet;
  this becomes an implementation obligation when the tunnel layer lands.
- machine-local values excluded by design today (`cloudSyncSecret`, `agentCommandShell`);
- memory vector data — vectors are not in `agent.db`; slaves regenerate them locally.

**Not yet satisfied — provider credentials.** The existing backup format packages `database/agent.db`
whole, and `providers.api_key` is a plaintext column in that database. Today's S3/R2 flow already
uploads it; serving the same package over a tunnel extends that exposure to every paired device and
to the network path in between. "Provider API keys never leave the machine" is therefore **false**
until either the export redacts provider credentials or the feature ships with an explicit,
user-visible warning and consent. This is a product decision, not an implementation detail, because
redacting keys changes what an imported backup restores.

Session, message and settings data are the baseline; skills, MCP configuration and knowledge-base
files are in scope because the existing backup package already carries them.

## Security Baseline

- Default off; enabling requires explicit confirmation and a risk notice.
- Loopback-only origin binding on every platform; Unix socket is an optional extra for named
  tunnels, never a requirement.
- Per-device tokens: hash-only at rest, scoped, optional expiry, immediate revocation; pairing codes
  are one-time, short-lived, and rate-limited.
- Request size caps, per-device rate limits, and path validation on both ends.
- Audit log records device, method, bytes, result, and client IP (`cf-connecting-ip` is forwarded by
  Cloudflare and was confirmed present at the origin), never tokens or payload contents.
- Cloudflare Access service token (`CF-Access-Client-Id`/`CF-Access-Client-Secret`) is **strongly
  recommended** rather than mandatory: the Settings UI provides a configuration entry and warns when
  a public hostname runs without it, but application-level device tokens remain the enforced layer.

## Compatibility

- The endpoint is versioned (`/sync/v1`) and `handshake` reports protocol, app version, database
  version, capabilities and encryption mode so a slave can refuse an incompatible host instead of
  corrupting data.
- Import compatibility is the existing backup contract; a host and slave on incompatible database
  versions must fail handshake, not attempt import.
- Nothing in this feature changes existing S3/R2 behavior, existing sync IPC contracts, or the local
  control plane's surface.

## Known Limitations

- Whole-database transfer every time; no incremental and no delete propagation.
- `increment` inserts missing rows only, so updates and deletions made on the host do not reach
  slaves.
- Memory vectors must be regenerated on the receiving side.
- Measured throughput on the validation network was ~7.2 MB/s, so a multi-hundred-MB database means
  minutes, not seconds.
- The host is a single point of failure by design; slaves cannot reach each other.

## Validation Evidence

Transport was validated end-to-end before writing this spec (bundled `cloudflared` 2026.9.1, Quick
Tunnel, synthetic data only, bearer-gated endpoint):

| Probe | Outcome |
| --- | --- |
| Quick Tunnel + public edge request | 200, TLS 490 ms, TTFB 1.29 s |
| Missing/invalid token | 401, never 200 |
| `Range` request | 206 with correct `Content-Range` |
| Two ranged halves vs single fetch | byte-identical |
| Abort at 37,993,254 bytes then `curl -C -` | resumed to full length, byte-identical |
| 120 MiB download | 17.4 s, ~7.2 MB/s |
| SSE `/events` | 5 events over ~3 s, clean close |
| 120 MiB upload | accepted (but see the 100 MB documented proxy limit) |
| `cf-connecting-ip` at origin | present |
| QUIC/UDP 7844 | blocked; precheck `suggested_protocol=http2` |
| `cloudflared --url unix:/path` | fails (`http://unix:` → DNS lookup of `unix`) |
| Config-file `service: unix:` ingress | `ingress validate` OK, routes correctly |
| Process teardown | no leftover processes; stale socket file survived SIGTERM |

## Acceptance Criteria

1. Two devices pair, then pull and push successfully; `increment` import neither loses data nor
   duplicates sessions.
2. A transfer interrupted mid-flight resumes without corruption and without a partial import.
3. A revoked or expired token is rejected immediately; no request returns 200 on a failed
   validation.
4. Disabling the feature leaves no listening port, no `cloudflared` process, and no stale socket.
5. Credential-class data (provider keys, tunnel credentials, machine-local values) is provably
   absent from every transfer.
6. Host mode works on a network where QUIC/UDP 7844 is blocked.
7. Host mode works on macOS, Linux and Windows hosts.

## Resolved Questions

| Question (issue #2302) | Decision |
| --- | --- |
| Windows host: loopback-only or macOS/Linux-only in phase 1? | Support Windows hosts in phase 1, using the same loopback listener as POSIX. |
| `cloudflared` managed by the app or user-run? | Bundled inside the plugin package; core supervises the process using the plugin-resolved binary path. |
| Default sync scope | Sessions, messages, settings, plus skills, MCP configuration and knowledge-base files. Provider credentials and memory vectors excluded. |
| Access service token mandatory? | Strongly recommended in the UI, not mandatory; device tokens remain enforced. |
| Endpoint transport (added) | Loopback TCP listener on every platform; Unix socket optional for named tunnels only. |
| Push framing (added) | Bounded, independently retryable parts; no reliance on large single-body uploads. |
| Who supervises the tunnel process? (Plan slice 0) | Core, after slice 0 proved a plugin cannot guarantee grandchild teardown: the MCP SDK kills only its direct child and closes the transport before tree termination, so a reparented `cloudflared` survives plugin disable. The plugin supplies the binary and UI. |

## Open Questions

- **Provider credentials in the served package** (see Excluded Data): decide between redacting
  provider credentials from the export, or shipping an explicit consent + warning. This blocks the
  "credentials provably absent" acceptance criterion.
- **Snapshot production**: whether the host creates a snapshot on demand or only serves an existing
  one, and how it behaves when the legacy S3 sync toggle is off.
- Descriptor ownership verification: the endpoint descriptor carries a pid and host identity but
  nothing verifies them. Once the tunnel supervisor lands, a stale descriptor could aim the tunnel
  at a port the OS later reassigned to an unrelated local service.
- Crash-orphan handling for the tunnel: a core-spawned `cloudflared` is reparented after an app
  crash or SIGKILL and holds its edge connection until the next launch reaps it. Closing this needs
  a watchdog or a parent-liveness mechanism, since `cloudflared` has no equivalent of the CUA
  driver's `--parent-liveness-stdio` flag. The acceptance criterion currently holds at next boot,
  not at crash time.
- Whether the slave must be told that a host's database is encrypted before it attempts an import.
  The snapshot already reports `backupFormatVersion`; a companion "database is encrypted" flag may
  be required so the slave fails with a clear message instead of a decrypt error.
