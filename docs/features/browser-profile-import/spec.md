# Browser Website Data and Session Import Spec

## Status

V1 implemented on 2026-07-17. The shipped scope is explicit, one-way, source-authoritative
non-partitioned cookie import from macOS Chrome, with Arc exposed as experimental. Windows and
Linux report unsupported. Passwords, `localStorage`, `sessionStorage`, and partitioned cookies
remain deferred.

Last verified against the repository and upstream documentation on 2026-07-17.

## Problem

YoBrowser currently uses one independent persistent Electron session,
`persist:yo-browser`. The right-side browser panel and standalone DeepChat browser windows share
that session, but it does not share authentication state with Chrome, Arc, or another installed
Chromium browser.

Users who are already signed in elsewhere therefore have to sign in again. Clearing the YoBrowser
sandbox is supported, but importing or refreshing source-browser state is not.

The requested product behavior is a repeatable, user-initiated, one-way import where a selected
Chromium profile is the source of truth and supported website data replaces the corresponding
YoBrowser data. The intended outcome is practical session portability: after import, YoBrowser
should open supported sites with the same transferable signed-in state and site preferences as the
selected source profile.

## Product Contract

This is not a whole-profile clone. It is a website-data import whose success is measured by useful
session continuity.

- Cookies can be imported with useful fidelity, subject to operating-system encryption and newer
  device-bound session protections.
- `localStorage` can potentially be imported, but Chromium's on-disk format is internal and must
  pass a compatibility proof before it becomes a supported category.
- `sessionStorage` belongs to a specific top-level browsing context. Copying a profile directory
  does not attach a Chrome tab's namespace to an Electron tab.
- Saved passwords are not required to carry an already authenticated website session. Electron
  exposes encrypted application storage but no public API for importing records into a Chromium
  password manager. Making imported passwords useful would require a DeepChat credential vault and
  explicit autofill UX.
- Passkeys, Device Bound Session Credentials, client certificates, and hardware-bound tokens are
  intentionally non-transferable or may remain unusable after a cookie copy.

The product may say "website data imported" or "session data synced" when the selected categories
were verified. It must not claim that every site is signed in: expired server sessions,
device-bound credentials, and site-side risk checks can still request authentication.

## Goals

- Discover supported installed browsers and their local profiles without modifying the source.
- Let the user select one source browser/profile and preview what can actually be imported.
- Support repeated, explicit, one-way synchronization.
- Make the source authoritative for each selected and supported category.
- Optimize for the user-visible outcome that supported sites retain their transferable signed-in
  session after the target tabs reload.
- Preserve modern cookie attributes where the target Chromium/CDP version supports them.
- Stage and validate all source data before mutating YoBrowser.
- Roll back the target category when an apply step fails.
- Report imported, skipped, expired, unsupported, and failed records without exposing secret values.
- Keep all processing local to the device.

## Non-Goals

- Real-time or bidirectional synchronization.
- Writing anything back to Chrome, Arc, or another source browser.
- Copying an entire live Chromium profile directory into Electron.
- Circumventing Chrome App-Bound Encryption, operating-system authorization, enterprise policy, or
  device-bound authentication. Authorization must use an OS-owned or source-browser-owned prompt.
- Asking the user to type an operating-system, Chrome, Arc, or keychain password into a DeepChat
  renderer form.
- Claiming every Chromium-derived browser is supported by one generic adapter.
- Importing browsing history, bookmarks, downloads, the user's installed extensions, payment cards,
  passkeys, client certificates, or browser settings in the first release.
- Giving an Agent access to raw saved passwords.
- Installing a browser extension or companion service to extract source data.
- Creating a Windows service, running code as `SYSTEM`, injecting into a source-browser process,
  scraping process memory, or using reverse-engineered browser keys to defeat App-Bound Encryption.

## Terminology

- **Source browser**: An installed Chrome, Arc, or later explicitly supported Chromium browser.
- **Source profile**: One profile directory selected by the user.
- **Target session**: DeepChat's shared `persist:yo-browser` Electron session.
- **Quick sync**: A cookie-only import that may be possible while the source browser is running.
- **Full storage sync**: Any import that includes Chromium storage directories or LevelDB data and
  may require the source browser to be closed.
- **Source authoritative**: Existing target data in the selected category and scope is removed
  before validated source data is applied.
- **Session portability**: Transferable client-side website state is present in YoBrowser after
  import; it does not imply that the website's server accepts every copied session indefinitely.
- **Direct importer**: A small main-process reader that discovers a supported Chromium profile,
  snapshots only the selected data stores, uses the supported OS/browser cryptography path, and
  normalizes records before applying them to YoBrowser. It never loads the source profile as a
  DeepChat browser profile.

## Current Repository Contract

- `src/main/desktop/browser/yoBrowserSession.ts` owns the persistent target session.
- `src/main/desktop/browser/YoBrowserPresenter.ts` creates Agent browser views with that session.
- `src/main/desktop/tab.ts` also assigns that session to standalone DeepChat browser windows.
- `src/renderer/settings/components/DataSettings.vue` currently exposes only a destructive clear
  action for the YoBrowser sandbox.
- `better-sqlite3-multiple-ciphers` already provides read-only SQLite access and an online backup
  API.
- `level` is already installed and is used by the existing provider-import code for LevelDB
  snapshots.

The import target is therefore global to YoBrowser, not per chat session.

## Source Discovery

Discovery must be adapter-driven and read-only.

Each detected source must include:

- browser ID, display name, channel, and executable presence;
- user-data directory and profile directory;
- profile display name when safely available;
- last modified time;
- whether the source appears to be running;
- per-category capability and the reason for any unsupported state.

Initial discovery scope:

| Browser | macOS | Windows | Linux | Notes |
| --- | --- | --- | --- | --- |
| Google Chrome stable | Required | Unsupported in V1 | Feasibility gate | Direct cookie support varies by OS |
| Chromium | Optional after Chrome | Unsupported in V1 | Optional after Chrome | Separate key-store identity |
| Arc | Experimental in V1 | Unsupported in V1 | Not available | Uses an explicit Arc source identity |
| Edge / Brave | Future | Future | Future | Do not imply support from Chromium ancestry alone |

Chromium documents that profiles are subdirectories of the user-data directory, commonly
`Default` or `Profile N`. Profile metadata may be read from `Local State`, but discovery must fall
back to validated directory inspection when metadata is missing.

[GUESS] Arc's storage and keychain identifiers remain compatible enough with Chromium for a shared
reader. This must be proven with sanitized Arc fixtures on every supported OS before Arc is labeled
supported. Arc's public documentation confirms that profiles contain cookies, logins, passwords,
history, and extensions, but it does not define a stable on-disk contract.

## Capability Matrix

### Data categories

| Category | Direct profile read | Target apply | Proposed release status |
| --- | --- | --- | --- |
| Cookies | Platform-dependent | High via CDP | V1 candidate |
| Partitioned cookies (CHIPS) | Platform-dependent | Medium-high via CDP | V1 only after protocol tests |
| `localStorage` | Medium, internal LevelDB schema | Medium | Feasibility gate |
| `sessionStorage` | Low without source tab mapping | Medium per target tab | Later live-tab handoff research |
| IndexedDB | Low-medium, internal schema and blobs | Low-medium | Not V1 |
| Service workers / Cache Storage | Low value and high compatibility risk | Medium | Not V1 |
| Saved passwords | Platform-dependent decryption | No Electron password-manager import API | Separate product decision |
| Passkeys / DBSC / client keys | Intentionally restricted | Not transferable | Unsupported |

### Operating-system constraints

| Platform | Direct cookie feasibility | Main constraint | Recommended path |
| --- | --- | --- | --- |
| macOS | High for Chrome after proof | Source Keychain item and system-owned user authorization | Direct reader first |
| Windows | Unsupported in V1 | Chrome App-Bound Encryption binds cookies to Chrome identity | No extension and no bypass; show unsupported state |
| Linux | Medium | Secret Service/KWallet availability and browser-specific key identity | Direct reader only after desktop-matrix proof |

Chrome introduced App-Bound Encryption for Windows cookies in Chrome 127. Entering the Windows
account password does not grant an unrelated application Chrome's app identity. DeepChat must not
use process injection, memory scraping, `SYSTEM` elevation, a reverse-engineered browser key, or
another bypass. The product decision is to omit Windows support instead of building a companion
extension or privileged helper. Chrome 136 also rejects remote-debugging switches against the
default user-data directory, so "attach CDP to the user's current Chrome profile" is not an
acceptable general solution.

The direct importer should reuse Chromium's documented profile layout, source schemas, timestamp
conventions, and OS cryptography behavior where those form a supportable contract. Chromium's
`ProfileManager` is useful as a reference for discovering and selecting profiles owned by Chromium,
but it is not a cross-application migration or decryption API.

The linked `thewh1teagle` Windows proof of concept is not an acceptable implementation path. It was
tested against Chrome 130, creates a local Windows service through `pypsexec`, executes part of the
unwrap under `SYSTEM`, and uses a hard-coded AES key recovered from `elevation_service.exe`. That is
an App-Bound Encryption bypass built from version-specific internals, not an OS-owned authorization
flow. Its useful input is limited to the neutral importer mechanics: locate `Local State`, recognize
encrypted-record versions, snapshot the SQLite cookie store, authenticate AES-GCM records, and
handle the 32-byte cookie plaintext prefix for schema versions where fixtures prove it.

## Authorization Contract

Import is always initiated by the user. Authorization is explicit and may include Touch ID,
Windows Hello, an operating-system account password, or a keychain/keyring prompt.

The authorization surface must be owned by the operating system or source browser whenever it
protects source secrets. DeepChat may trigger that surface and explain why it appears, but it must
not render a look-alike password prompt, receive the password, store it, or pass it through IPC.

Authorization does not change the support matrix:

- on macOS/Linux, successful OS key access may unlock a supported direct reader;
- on Windows, current Chrome App-Bound Encryption remains unsupported in V1 even if the user can
  approve a UAC or account prompt, because authorization does not grant Chrome's application
  identity;
- denial or cancellation returns to preview without changing YoBrowser;
- the user authorizes each import operation in V1; no reusable background authorization token is
  retained.

## Cookie Import Contract

Cookies are the recommended first category because they produce most of the requested
signed-in-session benefit without creating a password manager.

Before target mutation, the importer must:

1. Create a consistent source SQLite snapshot.
2. Validate the `meta.version` and required columns.
3. Decrypt every non-expired source cookie selected for import.
4. Map Chromium time values and enum fields to CDP cookie parameters.
5. Validate domain, path, prefix, SameSite, Secure, HttpOnly, source scheme, source port, priority,
   and partition-key data.
6. Abort before target mutation if any required encrypted record cannot be handled.

V1 applies only non-partitioned cookies through Electron's public `Session.cookies` API, then reads
them back and verifies normalized identity/value pairs. Partitioned cookies are counted and skipped
because the public shape does not expose the required partition key. A future CHIPS-capable release
must move that category to CDP `Storage.getCookies`, `Storage.clearCookies`, and
`Storage.setCookies` with protocol fixtures.

Source-authoritative cookie sync means:

- snapshot all target cookies for rollback;
- clear the target cookie store;
- set the complete validated source set in bounded batches;
- read back the target set and compare normalized cookie identities and values;
- restore the target snapshot if apply or verification fails;
- flush the cookie store;
- reload open YoBrowser tabs after success.

Cookie creation and last-access timestamps cannot be set through the public CDP cookie parameter
shape. The UI must not call this a byte-identical copy.

Session cookies remain session cookies. DeepChat must not invent an expiration date to persist them.
They may need to be imported again after DeepChat restarts.

## Local Storage Contract

`localStorage` is origin-scoped persistent data, but Chromium stores it in an internal LevelDB
format. It can become supported only if a feasibility proof demonstrates all of the following:

- consistent source snapshots while the source browser is closed;
- correct decoding of Chromium storage keys and string encodings;
- correct handling of storage keys and partitioning in the target Electron Chromium version;
- authoritative target clearing;
- target writes without loading arbitrary remote pages or triggering site side effects;
- round-trip verification on fixtures generated by the exact Chrome and Electron major versions in
  the support matrix.

The preferred live target path is CDP `DOMStorage.clear` plus `DOMStorage.setDOMStorageItem` against
an importer target. If CDP cannot write an inactive origin reliably, V1 must defer `localStorage`
rather than copy target LevelDB files while Electron owns them.

## Session Storage Contract

`sessionStorage` is partitioned by origin and top-level browsing context. A Chrome profile's
`Session Storage` LevelDB contains namespaces that refer to Chrome tabs. A DeepChat tab does not
inherit those namespace identities merely because files are copied.

Therefore:

- offline profile-level `sessionStorage` import is not a V1 commitment;
- a later user-initiated open-tab handoff may be considered only if a supported source-browser API
  can export the current tab's URL and `sessionStorage` without an extension or encryption bypass;
- the UI must describe this as "open tab handoff", not profile synchronization;
- closing either source or target tab ends the relevant page session as normal.

## Password Contract

Saved passwords require a separate implementation track, but they can remain part of the broader
"make YoBrowser useful with existing browser data" roadmap.

Reading Chrome's `Login Data` does not make Electron autofill those credentials. Electron provides
`safeStorage` for application-owned encrypted strings, but its documented public session APIs do
not provide a password-manager import surface. This is an inference from the Electron 40.10.5
public API and must be rechecked before implementation.

The acceptable password direction is an explicit DeepChat credential-vault feature with:

- user-triggered Chrome/Arc CSV export or another user-mediated export;
- source-browser or operating-system authorization rather than a DeepChat-owned system-password
  prompt;
- immediate encrypted ingestion and a prominent plaintext-file warning;
- origin-bound, user-triggered fill;
- no automatic submit;
- no Agent, tool, renderer, log, export, or telemetry access to decrypted credentials;
- OS-backed encryption with a hard failure on insecure Linux `basic_text` storage;
- independent threat modeling, tests, and settings UX.

That work is not required for session portability and should not be hidden inside cookie-sync V1.

## User Experience

### Before

```text
+--------------------------------------------------------------+
| YoBrowser Sandbox                                            |
| Independent cookies and local storage.                       |
|                                      [Clear YoBrowser data]  |
+--------------------------------------------------------------+
```

### Proposed settings card

```text
+--------------------------------------------------------------+
| YoBrowser data                                               |
| Source: Google Chrome / Personal                             |
| Last sync: 2026-07-17 14:32 · Cookies: 1,284                |
|                         [Import or sync] [Clear YoBrowser]    |
+--------------------------------------------------------------+
```

### Proposed import dialog

```text
+------------------------------------------------------------------+
| Import browser data                                          [x] |
|                                                                  |
| Browser     [Google Chrome v]   Profile [Personal v]             |
|                                                                  |
| [x] Cookies                 Ready                                 |
| [ ] Local storage           Experimental · Chrome must be closed |
| [ ] Session storage         Not available for profile import     |
| [ ] Passwords               Requires a separate credential vault |
|                                                                  |
| Source data replaces the selected YoBrowser categories.          |
| Chrome is never modified.                                        |
| System or Chrome authorization may be requested after Preview.   |
|                                            [Cancel] [Preview]     |
+------------------------------------------------------------------+
```

### Unsupported Windows source

This state appears when a Windows Chrome or Arc profile uses App-Bound Encryption.

```text
+------------------------------------------------------------------+
| Import browser data                                          [x] |
|                                                                  |
| Windows Chrome protects cookies with Chrome's app identity.      |
| This Chrome profile cannot be imported safely by DeepChat.       |
|                                                                  |
| DeepChat will not install an extension, elevate a helper, or     |
| bypass Chrome's encryption.                                      |
|                                                                  |
|                                                         [Close]  |
+------------------------------------------------------------------+
```

### Interaction flow

1. The user opens Data & Privacy and selects **Import or sync**.
2. DeepChat scans known locations and shows only validated source profiles.
3. The user selects a source profile.
4. DeepChat displays per-category capability, browser-running requirements, and platform limits.
5. **Preview** performs source snapshot, authorization when required, decryption, validation, and
   count calculation without changing YoBrowser. Protected authorization UI is owned by the OS or
   source browser, not DeepChat.
6. The confirmation view states exactly which target categories will be replaced.
7. DeepChat pauses conflicting YoBrowser mutations, applies the staged data, verifies, and reloads
   affected tabs.
8. The result shows counts and stable error codes, never secret values or source URLs beyond what
   the user selected.
9. Running the flow again repeats the same source-authoritative operation.

There is no schedule or background watcher in V1.

## Import States

The renderer may display these stable states:

- `idle`
- `scanning`
- `previewing`
- `ready`
- `applying`
- `verifying`
- `rolling_back`
- `succeeded`
- `failed`
- `cancelled`

Cancellation is allowed before target mutation. After mutation starts, the operation must finish or
roll back rather than stop halfway.

## Security and Privacy Requirements

- Source paths must be canonicalized and restricted to discovered/explicitly selected profiles.
- Symlinks and path traversal must not escape the selected profile root.
- Source databases and LevelDB files are opened read-only.
- Temporary snapshots use a mode-`0700` directory and are always removed after success, failure, or
  startup recovery.
- Decrypted cookie/password values are never logged, serialized to renderer state, included in
  exceptions, copied to the clipboard, or written to plaintext staging files.
- Renderer contracts expose counts, capability, progress, and redacted failures only.
- A source Keychain/keyring denial is a normal unsupported/denied result, not a retry loop.
- DeepChat never receives or stores the password entered into an OS/source-browser authorization
  surface.
- The source profile is never opened as an Electron `Session`.
- Import is blocked while another import or clear operation owns the target mutation lock.
- Rollback data receives the same secret handling as source data.
- Windows App-Bound sources fail capability detection before any key or cookie value is staged.

## Failure Semantics

Stable categories should include:

- `browser_not_found`
- `profile_not_found`
- `source_browser_busy`
- `source_schema_unsupported`
- `source_snapshot_failed`
- `key_access_denied`
- `encryption_unsupported`
- `record_decryption_failed`
- `target_busy`
- `target_apply_failed`
- `target_verification_failed`
- `target_rollback_failed`
- `category_unsupported`

If rollback fails, DeepChat must mark the target as requiring an explicit clear or re-import and
must not report success.

## Acceptance Criteria

- The settings UI discovers and distinguishes multiple supported source profiles.
- Every source/profile/category combination reports `ready`, `requires_action`, `experimental`, or
  `unsupported` with a concrete reason.
- Preview does not mutate the source or target.
- A supported cookie sync can be repeated and produces source-authoritative target cookies.
- After successful import and tab reload, transferable source sessions are available to YoBrowser;
  sites with expired or device-bound sessions may still request login without invalidating the
  import result.
- Partitioned cookie fields are preserved when the target CDP version supports them; otherwise the
  preview blocks rather than silently flattening them.
- No target mutation occurs when source decryption or validation is incomplete.
- A failed target apply restores the previous target cookie set and verifies the rollback.
- Open YoBrowser tabs reload only after a successful apply.
- Chrome/Arc files are never written.
- Windows App-Bound cookies are not decrypted through a bypass.
- Protected source access uses OS/source-browser authorization; DeepChat never collects the
  authorization password itself.
- `sessionStorage` and saved-password limitations are visible before confirmation.
- Secret values never cross the main-process contract boundary.
- Focused unit, integration, and fixture tests cover supported schema and platform combinations.
- Format, i18n, lint, typecheck, and relevant tests pass after implementation.

## Decision Gates

Implementation should not begin until these product decisions are made:

1. **Windows Chrome support (decided)**: current Chrome/Arc App-Bound data is unsupported. Do not
   build a companion extension, privileged service, process-injection path, or reverse-engineered
   decryption path. Revisit only if Windows or the source browser exposes a supported export API.
2. **Delivery sequence**: recommendation is cookie-backed session portability as the first shipping
   slice. Add `localStorage` after the CDP arbitrary-origin proof, then current-tab
   `sessionStorage` handoff; these remain roadmap capabilities rather than discarded requirements.
3. **Password sequencing**: passwords remain in the roadmap, but recommendation is a separate
   credential-vault SDD after transferable session data because they do not contribute to an already
   active site session.
4. **Arc support label**: recommendation is experimental until sanitized macOS Arc fixtures prove
   profile discovery and key access. Windows Arc remains outside V1 with Windows Chrome.

Confirmed product requirements: import is user-initiated, source-authoritative, repeatable, and does
not use an encryption bypass. V1 therefore has no startup/background synchronization.

## Verified References

- [Chromium user-data directory and profile locations](https://chromium.googlesource.com/chromium/src/+/main/docs/user_data_dir.md)
- [Chromium persistent cookie-store schema and encrypted values](https://chromium.googlesource.com/chromium/src/+/main/net/extras/sqlite/sqlite_persistent_cookie_store.cc)
- [Chromium OS Crypt contract](https://chromium.googlesource.com/chromium/src/+/HEAD/components/os_crypt/sync/README.md)
- [Chromium ProfileManager lifecycle contract](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/profiles/profile_manager.h)
- [Chrome App-Bound Encryption on Windows](https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html)
- [Chromium App-Bound Encryption path validation](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/os_crypt/README.md)
- [Chrome 136 remote-debugging restrictions](https://developer.chrome.com/blog/remote-debugging-port)
- [thewh1teagle Chrome 130 App-Bound proof of concept](https://gist.github.com/thewh1teagle/d0bbc6bc678812e39cba74e1d407e5c7)
- [Chrome DevTools Protocol Storage domain](https://chromedevtools.github.io/devtools-protocol/tot/Storage/)
- [Chrome DevTools Protocol Network cookie parameters](https://chromedevtools.github.io/devtools-protocol/tot/Network/)
- [Chrome DevTools Protocol DOMStorage domain](https://chromedevtools.github.io/devtools-protocol/tot/DOMStorage/)
- [Electron Session API](https://www.electronjs.org/docs/latest/api/session)
- [Electron Cookies API](https://www.electronjs.org/docs/latest/api/cookies)
- [Electron safeStorage API](https://www.electronjs.org/docs/latest/api/safe-storage)
- [HTML Web Storage standard](https://html.spec.whatwg.org/multipage/webstorage.html)
- [Arc profile behavior](https://resources.arc.net/hc/en-us/articles/19227964556183-Profiles-Separate-Work-Personal-Browsing)
- [Chrome password export](https://support.google.com/chrome/answer/95606)
