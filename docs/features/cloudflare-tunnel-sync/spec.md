# Cloudflare Tunnel Host Sync

## Scope and ownership

Settings → Data places device sync beside R2 and S3-compatible storage in one sync tab group.
A host shares its current data through a loopback HTTP endpoint. A receiving device connects,
then requests an incremental sync or an explicitly confirmed overwrite. There is no offline relay,
concurrent-edit merge, background schedule, push, or Cloudflare Access login support.

The host automatically prepares a private backup when an authenticated receiving device starts a
new sync. Users do not publish snapshots. Interrupted downloads reuse the same prepared backup when
its identity still matches. Existing insert-only import and encryption restrictions remain explicit.

Core owns host consent, authentication, export, receiving transfer, database maintenance and the
cloudflared process. ToolchainService owns bundled, managed, system and custom cloudflared binaries.
The settings app owns its store and calls typed API clients; it must not add chat-app dependencies.

## Tunnel configuration

- Temporary address: launch cloudflared with HTTP/2, obtain a trycloudflare.com HTTPS origin and show
  connection information once a connector registers. The address may change after restart.
- Custom domain: guide the user to create a remotely managed tunnel in Cloudflare, route their
  hostname to the displayed loopback service, and enter that HTTPS origin plus the tunnel token.
  The token is protected by safeStorage in machine-local host state, omitted from renderer status,
  process arguments, logs and backups. An empty token field reuses the saved token.
- Existing tunnel: accept an HTTPS origin and show its loopback service destination; do not manage
  an external process. This preserves user-managed setups.
- Toolchain status and a Settings → Toolchains link are visible in the sync tab. Cloudflared follows
  the existing source selector, download verification, repair and revert behavior. Official pinned
  assets are bundled on supported targets; Windows ARM64 has no native official asset for the pin.
- App-owned connectors start only after consent and listener startup, stop on disable/shutdown, and
  reuse the child-process registry for identity-checked stale-process cleanup on restart. An abrupt
  app crash can leave a connector until cleanup; its origin listener is no longer available.
- Configuration is editable while sharing is off. Enabling/disabling is serialized. A connector
  failure is visible with a retry action; connector registration is not proof of correct public DNS.

## Host endpoint and lifecycle

- Bind only `127.0.0.1` on a user-configured port in 1–65535. Never fall back to another port on a
  conflict. Port changes require disabling the host first.
- Enabling requires explicit consent describing provider API keys, other backup credentials and
  Cloudflare TLS termination. Consent and the selected port are stored in machine-local host state.
- An enabled state without current consent (version 2) and a valid fixed port does not start at boot.
  Legacy publication-only consent requires explicit renewal before automatic exports are allowed.
- Successful enablement persists across restarts. Disabling closes listener connections and clears
  the outstanding pairing code. Application teardown closes the listener without clearing enablement.
- Lifecycle transitions and publication are serialized. Failed publication retains the previous
  selected snapshot. Database maintenance rejects concurrent backup work.
- `<userData>/sync-host/endpoint.json` is an optional descriptor. Failure to write it does not
  prevent operation. The connector receives the bound port directly from its owning host service.
- Request receive deadlines, header/body caps, bounded connections, per-source pairing limits,
  per-device request limits and bounded audit records protect the public endpoint. Response streams
  do not have a total-duration timeout that would interrupt a healthy large download.

## Authentication and pairing

`GET /sync/v1/handshake` and `POST /sync/v1/pair` are the only unauthenticated endpoints. Other
paths authenticate before method/path handling. Repeated anonymous requests may receive 429.
The handshake advertises only supported capabilities (`snapshot`, `range`, `prepare`).

Pairing codes are short-lived, single-use and held only in memory. Failures consume a per-source
budget without destroying the user's code. A failed device issuance restores an unexpired code.
The host UI provides text and QR pairing details containing the HTTPS origin, opaque host identity,
code and expiry. The client checks host identity before exchanging the code.

Device tokens are random, unscoped and non-expiring in this protocol. The host stores only their hashes
and redacted metadata; revocation is enforced on the next request. An existing response is not
retroactively recalled. Identity comparison is not a cryptographic host signature.

## Automatic data preparation

The host never serves arbitrary legacy backup files. Authenticated `POST /sync/v1/prepare` starts
one coalesced export and immediately returns. `GET /sync/v1/status` reports preparation state and
failure while the receiver polls, avoiding long control requests through the tunnel. Exports have
a short cooldown to bound repeated remote work. Failed preparation must not import an older backup
as though it were current.

The exporter creates a completed backup, copies it privately to `sync-host/snapshots`, then atomically
selects it. Failed exports keep the previous file for resume. Ordinary local/cloud backups do not
replace this transfer cache. Unrelated ZIP entries are skipped without inflation; manifest output
and compressed-input slices remain bounded. Download identity, ranges and SHA-256 are verified.

The prepare capability is negotiated so legacy hosts can still serve their existing selected backup.
A matching partial transfer skips preparation; a new transfer requests fresh data. The receiving UI
shows preparation, download, verification and import separately, with cancellation before import.

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
  cross-device restoration is outside this scope.
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
- A receiving device can sync from a fresh enabled host without a separate publish action.
  Preparation works with legacy sync disabled; failed preparation does not import stale data.
- Pairing checks the expected host identity, stores no plaintext bearer token, and exposes no token
  through renderer contracts. Revoked devices cannot obtain another snapshot response.
- Interrupted transfers resume across client restarts. Identity/range/hash failures and cancellation
  never import partial data. Successful transfers call the existing importer through maintenance.
- Overwrite needs confirmation. Encryption limitations, insertion-only behavior, tunnel availability
  and last successful sync are explicit user-visible states.
- Settings remains usable at narrow widths; keyboard-accessible forms and confirmation dialogs use
  existing UI primitives. New copy is Chinese and English; other locale catalogs carry English copy
  for these additions until localized.

## Deferred capabilities

Push, schedules, encrypted remote imports, Access service tokens and conflict-aware merging remain
outside this scope. Sync is a user-requested transfer of a consistent backup, not live replication.

Configuration guidance follows the [official setup guide](https://developers.cloudflare.com/tunnel/get-started/)
and [run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/).

## Validation

Current implementation checks and external-service validation limits are recorded in
[the validation plan](./plan.md#validation).
