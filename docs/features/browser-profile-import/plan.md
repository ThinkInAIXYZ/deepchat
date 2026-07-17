# Browser Website Data and Session Import Implementation Plan

## Status

V1 implemented. This document remains the design record; unchecked tasks are validation or later
data-category work rather than claims about the shipped cookie importer.

The smallest credible first release is explicit, one-way Chrome website-session import backed by
cookies on one platform whose supported decryption path passes packaged fixtures. Passwords,
tab-bound `sessionStorage`, Windows App-Bound data, and generic profile cloning are separate from
that milestone.

## Recommended Delivery Shape

```text
Settings renderer
      |
      | typed routes: scan -> preview -> apply -> status
      v
BrowserProfileImportPresenter (main process)
      |
      +-- source discovery
      +-- Chromium-profile cookie reader
      +-- platform key access
      +-- staging and validation
      +-- target mutation lock
      +-- CDP target writer and verifier
      +-- redacted progress/events
      |
      v
persist:yo-browser Electron session
```

Keep this in the main process. Source paths, encryption keys, decrypted values, rollback data, and
CDP cookie parameters must never cross into a renderer.

## Architecture

### 1. One presenter, explicit source readers

Add a `BrowserProfileImportPresenter` owned by the desktop presenter layer. It coordinates a single
import operation and exposes only discovery, preview, apply, cancel-before-mutation, and last-result
operations.

Do not start with a plugin framework. Use a small internal reader contract and concrete readers for
only the combinations that have passed fixtures, for example:

```ts
type BrowserProfileSourceReader = {
  discover(): Promise<DetectedBrowserProfile[]>
  previewCookies(profile: DetectedBrowserProfile): Promise<StagedCookieImport>
}
```

The reader returns normalized in-memory records, not source-specific database rows. Chrome and Arc
must not share a reader merely because both are Chromium-derived; shared decoding helpers are fine
after their fixtures prove identical behavior.

### 2. Typed renderer boundary

Add browser-data import routes and events under the existing shared contract structure. Proposed
operations:

- `browserDataImport.scan`
- `browserDataImport.preview`
- `browserDataImport.apply`
- `browserDataImport.cancel`
- `browserDataImport.getStatus`

Renderer-visible payloads contain IDs, display names, capabilities, counts, progress, and stable
redacted error codes. They never contain profile secrets, cookie names, cookie domains beyond an
explicit aggregate preview decision, values, encryption metadata, keychain labels, or raw paths.

Use an opaque scan token to bind preview/apply to the exact discovered profile. Resolve the source
path again in main and reject a token after the source metadata changes.

### 3. Source discovery

Implement deterministic known-location discovery per browser and OS. For every candidate:

1. Canonicalize the user-data and profile paths.
2. Require the expected metadata and category files.
3. Read profile names from `Local State` when valid.
4. Fall back to validated `Default` / `Profile N` directories.
5. Detect a running source through lock files and process-independent file-open behavior; never kill
   the browser.
6. Compute category capability from browser, version, platform, key access, and source state.

No recursive home-directory scan is needed.

### 4. Consistent snapshots

Use a private temporary directory with mode `0700`.

- For SQLite, use the existing `better-sqlite3-multiple-ciphers` backup support where the source can
  be opened consistently, or copy the database plus WAL/SHM only after proving consistency.
- Validate `PRAGMA integrity_check`, schema version, required columns, and row decoding on the
  snapshot.
- For a future LevelDB category, require the source browser to be closed and copy the complete
  storage directory except transient lock files before opening the snapshot.
- Register startup cleanup for abandoned DeepChat import directories.

The operation must not mutate YoBrowser until the entire selected source category is staged and
validated.

### 5. Platform key access

Build only the platform path selected for V1.

For a macOS Chrome proof, trigger the system-owned Keychain authorization surface and retrieve the
exact source browser's Safe Storage secret through a main-process-only OS adapter. Derive the
Chromium key according to the source version and decrypt the staged `v10` records. The proof may use
the system `security` executable to avoid a new native dependency, provided arguments and output are
never logged, DeepChat never receives the password typed into the OS prompt, and denial is handled
normally. A production implementation should keep that choice only if authorization behavior,
signing, and sandboxed packaging tests pass.

Do not implement Windows Chrome/Arc App-Bound decryption in V1. User account or UAC authorization
does not give DeepChat Chrome's application identity. Do not add a browser extension, companion
service, `SYSTEM` process, process injection, memory scan, reverse-engineered
`elevation_service.exe` key, or remote-debugging workaround. Report the source/category as
unsupported before preview mutates anything.

Use Chromium as a reference implementation, not as a library dependency. The minimal reader needs
only deterministic profile discovery, a consistent SQLite snapshot, explicit encrypted-record
version dispatch, the supported platform key adapter, authenticated record decryption, and cookie
normalization. Do not embed Chromium's `ProfileManager` or copy its profile lifecycle machinery into
DeepChat.

### 6. Cookie normalization and CDP application

Normalize source rows into a target-independent cookie record that retains:

- name and value;
- domain and host-only semantics;
- path;
- expiry or session-only state;
- Secure, HttpOnly, SameSite, and prefix constraints;
- priority, source scheme, and source port;
- partition key and cross-site ancestor state where available.

Version the mapper by the source schema and target Electron Chromium/CDP major versions. Unknown
enum values or unsupported partition metadata block preview rather than being silently discarded.

The target operation is transactional at the application level:

```text
acquire target lock
    -> snapshot current target cookies
    -> clear target cookies
    -> apply staged source cookies in bounded batches
    -> read back and normalize
    -> compare identities and values
       -> success: flush + release lock + reload tabs
       -> failure: clear + restore target snapshot + verify + release lock
```

Use CDP `Storage`/`Network` cookie commands against `persist:yo-browser`; do not use Electron's
public Cookies API as the sole writer because it cannot express the full partitioned-cookie shape.

### 7. Mutation ownership

Add one target-data mutation coordinator shared by import and the existing clear-sandbox action.
While it is held:

- a second import or clear request is rejected as `target_busy`;
- source preview may continue because it is read-only;
- YoBrowser navigation may remain visible, but the final clear/apply window should be short;
- affected tabs reload only after verified success;
- application shutdown waits for rollback/apply completion within a bounded deadline, then records
  recovery-required state if safe completion is impossible.

### 8. Settings UX

Extend the existing YoBrowser sandbox card in `DataSettings.vue`. Reuse shadcn-vue Dialog, Button,
Checkbox/Field, Alert, Badge, Progress/Spinner, and existing settings patterns. Use i18n keys for all
visible copy.

The renderer drives a strict state machine from main-process status. It does not infer readiness
from counts and cannot enable apply before a successful preview token is returned.

The confirmation screen must say that selected target categories are replaced, that the source is
not modified, and that an OS/source-browser authorization prompt may appear. The result screen
reports imported, skipped, expired, unsupported, and failed counts separately. It reports data
transfer success, not a guarantee that every site server will accept the session.

## Feasibility Proofs Before Product Work

### Proof A: macOS Chrome cookie round trip

Create a sanitized Chrome fixture containing persistent, session, HttpOnly, SameSite variants,
prefix-constrained, and partitioned cookies. Prove:

- snapshot succeeds with Chrome open and closed;
- system-owned key authorization is understandable and denial is recoverable;
- every supported row decrypts;
- CDP writes and reads back normalized values;
- session cookies remain non-persistent;
- target rollback restores its original cookies byte-for-value where public fields permit.

This is high feasibility based on the current local Chrome schema, but it is not complete until a
packaged, signed application passes the test.

### Proof B: Arc source compatibility

Collect sanitized Arc fixtures on macOS. Verify user-data paths, profile metadata,
cookie schema, keychain identifiers, encryption versions, and running-browser snapshot behavior.
Until this passes, Arc remains experimental rather than inheriting Chrome support. Do not spend
fixture effort on Windows while that platform is outside the release scope.

### Proof C: partitioned-cookie fidelity

Test the exact Electron-bundled CDP version with partitioned cookies. If `partitionKey` and
cross-site ancestor state cannot round-trip, block that profile preview or explicitly exclude those
records with user-visible counts; never flatten them into unpartitioned cookies.

### Proof D: `localStorage` inactive-origin write

Only if `localStorage` is still desired for the same milestone, prove CDP can clear, write, and read
back multiple inactive origins without navigating real remote pages. Failure moves the category to
a later release.

## Implementation Phases

### Phase 0: decisions and fixtures

- Choose the first directly supported V1 platform and its OS-owned authorization surface.
- Freeze V1 categories.
- Collect legally safe, sanitized fixtures for every supported browser/OS/version combination.
- Record source and target Chromium version support ranges.

Exit criterion: the selected path has passing feasibility proofs and no unsupported category is
presented as importable.

### Phase 1: main-process cookie core

- Add discovery, source snapshot, schema decoder, platform key access, cookie normalization, and
  redacted errors.
- Add target lock, CDP snapshot/apply/readback, rollback, and recovery cleanup.
- Add focused unit and fixture tests without renderer work.

Exit criterion: a headless integration test can repeat source-authoritative cookie sync and can
recover from injected apply failures.

### Phase 2: typed contracts and settings UI

- Add routes, events, preload/browser client calls, and status types.
- Add scan, preview, confirmation, progress, result, and clear-conflict UX.
- Add accessibility, keyboard, i18n, and settings tests.

Exit criterion: a user can understand platform/category limitations before any target mutation.

### Phase 3: packaged platform validation

- Validate notarized macOS builds and Windows/Linux packages selected for support.
- Test OS key prompts, source-browser open/closed states, multi-profile discovery, rollback on crash
  injection, and app restart cleanup.
- Document the support matrix and known non-transferable login systems.

Exit criterion: release checks pass on every advertised platform.

### Later phases, only if separately approved

- `localStorage` import after Proof D.
- Live-tab `sessionStorage` handoff.
- A separate credential-vault SDD for passwords.

## Expected File Areas

Exact names may change after the feasibility proof, but implementation should remain localized to:

- `src/main/desktop/browser/import/` for discovery, readers, crypto, normalization, and coordinator;
- `src/main/desktop/browser/yoBrowserSession.ts` for target session access/flush hooks;
- `src/main/desktop/browser/YoBrowserPresenter.ts` for tab reload coordination only;
- `src/shared/contracts/routes/` and `src/shared/contracts/events/` for typed boundaries;
- `src/shared/types/` for redacted public state;
- `src/preload/` for the existing safe route exposure pattern;
- `src/renderer/settings/components/DataSettings.vue` and a focused import dialog component;
- mirrored `test/main/**` and `test/renderer/**` suites plus sanitized fixtures.

Do not place source-profile parsing in the renderer or generalize the standalone browser tab system
to solve this feature.

## Test Strategy

### Unit

- path discovery and canonicalization;
- schema version/column validation;
- Chromium timestamp and enum mapping;
- cookie identity normalization, prefix rules, and expiry filtering;
- platform decrypt success, denial, corrupt ciphertext, and unknown versions;
- state-machine transitions and redacted error serialization;
- target comparison and rollback planning.

### Main-process integration

- repeat import with changed and deleted source cookies;
- source-authoritative clearing of target-only cookies;
- session and persistent cookie behavior across restart;
- CHIPS round trip;
- apply failure at every batch boundary;
- rollback failure and recovery-required state;
- import versus clear lock contention;
- source browser open/closed fixtures;
- no secret values in captured logs/events;
- no authorization password enters a DeepChat renderer, IPC payload, log, or process-owned field.

### Renderer

- per-profile/per-category capability rendering;
- preview before confirmation;
- apply disabled for stale/failed previews;
- cancellation only before mutation;
- result and error accessibility;
- no accidental source-path or secret rendering.

### Packaged smoke tests

- OS key prompt behavior;
- signing/notarization permissions;
- multiple browser channels and profiles;
- unsupported browser/version messaging;
- removal of temporary snapshots after success, failure, crash, and restart.

## Rollout and Compatibility

- Hide the entry point when no supported source exists, but keep an explanation in the settings
  card rather than an empty dialog.
- Gate experimental Arc and `localStorage` support independently from Chrome cookies.
- Store only non-secret last-sync metadata: browser ID, opaque profile ID, categories, timestamp,
  counts, source version, and importer version.
- Do not automatically re-run old imports after an app upgrade.
- If the target Electron Chromium major changes, rerun CDP fidelity fixtures before keeping support
  enabled.

## Rejected Approaches

- **Point Electron at Chrome's user-data directory**: risks concurrent profile corruption and mixes
  incompatible browser-owned state.
- **Copy the whole profile directory**: brings locks, caches, extensions, keys, versioned formats,
  and non-transferable credentials without a safe rollback boundary.
- **Attach remote debugging to the user's normal Chrome profile**: current Chrome restricts this and
  it is not a stable import contract.
- **Run a privileged App-Bound decryption proof of concept**: the referenced Chrome 130 script
  creates a Windows service, executes under `SYSTEM`, and uses a hard-coded key recovered from
  `elevation_service.exe`. This bypasses the protection, depends on browser internals, and is outside
  the product's authorization and maintenance contract.
- **Install a companion browser extension**: its implementation, distribution, broad cookie
  permissions, and ongoing browser-store policy cost are not justified for a platform fallback.
- **Use only Electron `cookies.set`**: loses modern cookie fields.
- **Make password decryption part of cookie import**: still leaves no target password manager and
  creates a much larger secret-handling surface.
- **Add a general background sync daemon in V1**: creates consent, locking, freshness, and failure
  semantics before the manual import is proven.

## Complexity Budget

V1 should add no new runtime dependency unless the packaged macOS key-access proof shows the system
API cannot be used safely. It should support one browser/platform/category combination completely
before adding adapters. A generic migration framework, scheduler, diff viewer, and bidirectional
sync engine are explicitly out of scope.
