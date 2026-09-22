# Cloudflare Tunnel Host Sync

Status: Phase 1 implemented for user-managed tunnels. Local transport, application lifecycle and
settings validation are recorded in `plan.md`. Push, events, scheduling and app-managed tunnels are
separate delivery phases.

## Scope and ownership

A DeepChat host publishes a backup through a loopback HTTP endpoint. Receiving devices connect to
its public HTTPS origin through the user's Cloudflare Tunnel. The host must stay online; there is
no relay, offline queue, peer-to-peer discovery, account service or concurrent-edit merge.

Core owns the endpoint, device authority, publication, receiving client, private persistence and
import coordination. Settings → Data owns the user-facing controls, using typed renderer-only
`syncHost.*` and `syncPeer.*` routes. Remote HTTP traffic never reaches the IPC route surface.

The existing local and S3/R2 backup flows remain available. Host publication reuses their export
format and the existing importer rather than defining a second data model.

## Delivery phases

1. **Phase 1:** user-managed tunnel, fixed loopback port, informed consent, explicit publication,
   pairing, device rename/revocation, manual pull, resume, integrity verification and import.
2. **Phase 2:** bounded multipart push, change events, scheduled pulls and transfer history.
3. **Phase 3:** app-managed cloudflared installation through ToolchainService and core process
   supervision. No plugin package, npm dependency or installer-bundled cloudflared is required.

Unix sockets and Cloudflare Access service-token configuration are deferred. Phase 1 clients do
not follow browser login redirects and do not supply Access service-token headers.

## Host endpoint and lifecycle

- Bind only `127.0.0.1` on a user-configured port in 1–65535. Never fall back to another port on a
  conflict. Port changes require disabling the host first.
- Enabling requires explicit consent describing provider API keys, other backup credentials and
  Cloudflare TLS termination. Consent and the selected port are stored in machine-local host state.
- An enabled state without recorded consent and a valid fixed port does not start at boot.
- Successful enablement persists across restarts. Disabling closes listener connections and clears
  the outstanding pairing code. Application teardown closes the listener without clearing enablement.
- Lifecycle transitions and publication are serialized. Failed publication retains the previous
  selected snapshot. Database maintenance rejects concurrent backup work.
- `<userData>/sync-host/endpoint.json` is an optional descriptor. Failure to write it does not
  prevent user-managed operation. A future supervisor must verify pid and host identity before use.
- Request receive deadlines, header/body caps, bounded connections, per-source pairing limits,
  per-device request limits and bounded audit records protect the public endpoint. Response streams
  do not have a total-duration timeout that would interrupt a healthy large download.

Named-tunnel ingress points at `service: http://127.0.0.1:<port>`. The settings section also provides
`cloudflared tunnel --protocol http2 --url http://127.0.0.1:<port>` for Quick Tunnel debugging.
Quick Tunnel URLs change on restart, requiring the client to pair with the new origin.
DeepChat does not launch, stop or modify user-managed tunnel processes.

## Authentication and pairing

`GET /sync/v1/handshake` and `POST /sync/v1/pair` are the only unauthenticated endpoints. Other
paths authenticate before method/path handling. Repeated anonymous requests may receive 429.
The handshake advertises only supported capabilities (`snapshot`, `range`).

Pairing codes are short-lived, single-use and held only in memory. Failures consume a per-source
budget without destroying the user's code. A failed device issuance restores an unexpired code.
The host UI provides text and QR pairing details containing the HTTPS origin, opaque host identity,
code and expiry. The client checks host identity before exchanging the code.

Device tokens are random, unscoped and non-expiring in Phase 1. The host stores only their hashes
and redacted metadata; revocation is enforced on the next request. An existing response is not
retroactively recalled. Identity comparison is not a cryptographic host signature.

## Explicit snapshot publication

The host never serves the newest arbitrary file in the legacy sync folder. Publishing:

1. Creates a completed backup through the existing export pipeline, even with legacy sync disabled.
2. Copies it to `<userData>/sync-host/snapshots/` with private permissions and atomic rename.
3. Atomically records the selected backup in host state, then retires the previous publication.

A failed export or publication does not select an incomplete file. Ordinary backups, cloud downloads
and imports do not change the selection. If the selected file disappears, status reports no snapshot
and snapshot requests return 404. The UI shows publication time and requires republishing for changes.
Remote fetches never trigger an export.

The snapshot source computes SHA-256 and manifest metadata with concurrent-reader deduplication.
Unrelated deflate entries are consumed without inflation; manifest input slices and output size are
bounded. Invalid manifests are reported as unknown format and are rejected by the receiving client.

`GET /sync/v1/status` returns snapshot identity, size, SHA-256, format and database encryption state.
`GET /sync/v1/snapshot` streams the selected file with identity/hash headers and Content-Length.
A valid Range receives 206 and Content-Range; an unsatisfiable range receives 416.

## Receiving client and import

- One paired host and one operation per receiving profile. Pairing credentials live under
  `<userData>/sync-peer/`, outside the synced settings and backup package.
- Tokens are protected with Electron safeStorage. Pairing fails before code exchange when secure
  storage is unavailable, including the Linux basic_text fallback. Tokens never enter renderer DTOs.
- Accept HTTPS origins only, without embedded credentials, path, query or fragment. Reject redirects.
  Check the paired host identity and protocol before sending the bearer token on a pull.
- Bound control responses to 64 KiB and requests to 30 seconds. Downloads have a 60-second idle
  timeout, declared-size checks, a 64 GiB ceiling and a free-space preflight.
- Stage downloads in the private client directory. Resume only when host origin, host identity,
  snapshot identity, size and hash match the saved metadata. Validate the response headers and
  Content-Range before appending. A server returning a full 200 response restarts the file.
- Hash the complete assembled file before import. A changed snapshot, truncated response or invalid
  digest never reaches the importer. Cancelled/interrupted partial downloads remain resumable across
  app restarts; a digest failure discards the partial file.
- Run the verified private file through `SyncService.importBackupFile` inside application database
  maintenance. Preserve the existing importer and rollback behavior. Download cancellation remains
  available until import begins; import itself is not cancellable.
- Incremental import keeps existing insert-only row behavior: updates and deletions do not propagate.
  Configuration restoration keeps the existing backup semantics. Overwrite requires explicit
  confirmation in both UI and IPC input.
- Encrypted remote snapshots are rejected before download. No remote database password is reused or
  transferred. An unencrypted snapshot cannot overwrite an encrypted local database. Key-aware
  cross-device restoration is outside Phase 1.
- Progress remains in main while the page is closed. Settings polls while mounted; reopening the
  page restores current state. Success time is local metadata. A bookkeeping failure after a
  committed import is reported separately and never misrepresented as a failed import.

## Data and security invariants

Backup contents follow the existing exporter. Provider credentials remain included; consent names
this exposure explicitly. Cloudflare terminates HTTPS and the payload has no additional end-to-end
encryption. The UI must not imply otherwise.

Host identity, device hashes, consent, enablement, publication state, receiving credentials, tunnel
credentials and Cloudflare Access secrets must never enter backup packages. Host and client files
are machine-local; imported settings cannot resurrect revoked devices or turn on host mode.
Existing machine-local exclusions such as cloudSyncSecret and agentCommandShell remain unchanged.
Memory vectors are not part of agent.db.

## Acceptance criteria

- Host enablement requires consent; it binds only the configured loopback port and restores that
  port after restart. Disabling leaves no listener or app-owned tunnel process.
- A fresh host has no downloadable snapshot. Publishing works with legacy sync disabled; ordinary
  backups cannot replace the published snapshot and failed publication preserves it.
- Pairing checks the expected host identity, stores no plaintext bearer token, and exposes no token
  through renderer contracts. Revoked devices cannot obtain another snapshot response.
- Interrupted transfers resume across client restarts. Identity/range/hash failures and cancellation
  never import partial data. Successful transfers call the existing importer through maintenance.
- Overwrite needs confirmation. Encryption limitations, insertion-only behavior, tunnel availability
  and publication age are explicit user-visible states.
- Settings remains usable at narrow widths; keyboard-accessible forms and confirmation dialogs use
  existing UI primitives. New copy is Chinese and English; other locale catalogs carry English copy
  for these additions until localized.

## Later phases

Multipart push must stage bounded parts (target at most 32 MiB), validate their complete set, size
and hash before import, and make retries idempotent. SSE notifications carry no payload contents;
manual/scheduled pulls must work without a live stream. An event should describe publication changes,
not imply that unpublished database changes are downloadable.

App-managed cloudflared uses pinned official assets and SHA-256 verification via ToolchainService,
with system, managed and custom sources. Core owns process-group termination and startup reaping.
Descriptor validation and crash-orphan handling must be resolved before claiming complete teardown.
Platform availability follows the pinned official asset catalog; user-managed TCP operation remains
independent of the managed binary catalog.

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
