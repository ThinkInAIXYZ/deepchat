# Managed Toolchains

## Status

Accepted design. First-run persist and the ToolchainService resolver are
implemented. RuntimeHelper still owns RTK only; leftover Node/uv getters are
inert.

Related: [GitHub issue #2153](https://github.com/ThinkInAIXYZ/deepchat/issues/2153).

## Context

DeepChat currently copies Node, uv, and RTK into the installer via
`scripts/install-runtime.mjs` and `electron-builder.yml`. Consumers then poke
`RuntimeHelper` independently and disagree on missing-runtime behavior:

| Consumer | Missing bundled runtime |
| --- | --- |
| MCP stdio | Whole tree missing → original command / system PATH. Half-install → spawn a nonexistent path. |
| ACP npx/uvx | Original command / silent PATH. |
| Skill `auto` | System first, then bundled; throw if both fail. |
| OCR / CLI | Fail closed on bundled Node. |

`bunRuntimePath` is a leftover alias of `nodeRuntimePath`. Bun was a real bundled
runtime from v0.2.4 through v0.4.8 and was removed in v0.4.9. It is not installed
today.

Issue #2153 asks to stop shipping language runtimes in the app artifact and treat
them as optional, independently managed installs. This RFC keeps uv as a bundled
seed (removing the small binary and re-downloading it is worse than keeping
it) and moves official Node to an on-demand managed install. RTK, OCR models/native, CUA, and DuckDB VSS stay on
their own lifecycles.

## Goals

1. Make `ToolchainService` the only resolver for Node and uv.
2. Persist an explicit source per toolchain: `bundled | managed | system | custom | unconfigured`.
3. Never silently switch sources after the one-time first-run migration.
4. Download at most one official Node distro (the OCR-validated pin) into
   `{userData}/toolchains/`.
5. Keep uv in the installer as a bundled seed; allow an optional newer managed uv.
6. Host the DeepChat CLI with Electron (`ELECTRON_RUN_AS_NODE=1`), not official
   Node and not a managed Node.
7. Remove the fake Bun alias and dead `useBuiltinRuntime` i18n.
8. Stop shipping Node/npm/npx/corepack in the installer once the managed path,
   Settings UI, and CLI host are in place.

## Non-goals

- Bun downloader, bunx-as-default JS MCP, or restoring historical Bun shipping.
- Full CPython. Skills keep using uv or an explicit system Python override.
- mise, asdf, nvm, or any version-manager shim layer.
- Migrating RTK, OCR assets, CUA, or DuckDB VSS onto this lifecycle.
- Auto-download on startup, silent source switch, or a telemetry/analytics SDK.
- Using Electron's Node (ABI 145) for OCR native modules or for `npx` MCP.
- Two managed Node versions. Catalog publishes one pin.
- Patching files inside the read-only app directory when a bundled payload is
  corrupt. Offer managed install first; reinstall the app last.

## Design

### Ownership

```
Settings / MCP / ACP / Skill / OCR
        │
        ▼
  ToolchainService          ← only Node/uv resolver
        │
        ├── bundled probe   (app.asar.unpacked/runtime/{node,uv})
        ├── managed tree    ({userData}/toolchains/{node,uv}/<version>)
        ├── system PATH
        └── custom path
```

`RuntimeHelper` remains the RTK probe and the small PATH/expand utilities.
Node and uv command rewrite must not go through `RuntimeHelper`.

CLI does not resolve toolchains. The CLI host is always the packaged Electron
binary with `ELECTRON_RUN_AS_NODE=1`. Alignment of Electron 41.10.4 with
Node v24.18.0 is coincidence, not an invariant.

### Sources

| Source | Meaning |
| --- | --- |
| `bundled` | Read-only files shipped in the app. Default for uv. Valid for Node only while the installer still ships Node. |
| `managed` | DeepChat-owned download under `userData`. Atomic activate via `state.json` pointer, not a symlink. |
| `system` | User's existing binary on PATH. Never a second DeepChat download. |
| `custom` | User-chosen absolute executable or toolchain root. |
| `unconfigured` | Honest empty state. Do not spawn. Ask the next time a feature needs it. |

`auto` is not a source.

### First-run migration

If `{userData}/toolchains/state.json` is missing:

- Node: persist `bundled` if the bundled tree is complete; else `system` if a
  system `node` exists; else `unconfigured`.
- uv: persist `bundled` if `uv` and `uvx` exist; else `system` if both exist on
  PATH; else `unconfigured`.

This records what the machine already had. It is not a per-resolve fallback.
After this write, source changes only when the user (or Repair / Revert)
changes it, with one exception: a first-run `unconfigured` (no `explicit`
mark) may be promoted to `system` once per userData when login-shell PATH
arrives, including after a restart that happened before PATH was ready.
Never rememoize `bundled` → `system`. Clearing a source persists
`{ source: 'unconfigured', explicit: true }`. That choice survives restart
and is never promoted.

Upgrade after Node is removed from the installer: if the persisted source is
`bundled` and the bundled tree is gone, keep `bundled` and fail with `missing`.
Do not auto-switch to system. The Settings banner offers managed install or an
explicit system/custom pick.

### Completeness

| Kind | Bundled / system / custom | Managed |
| --- | --- | --- |
| Node | `node` + `npm` + `npx` | `node` + `npm` + `npx` + `corepack` |
| uv | `uv` + `uvx` | `uv` + `uvx` |

Half-installs are `incomplete`, not a PATH fallback.

### Purpose is a version constraint

`purpose` does not select a second download.

- OCR requires the resolved official Node to satisfy `>=24.18.0 <25` **and**
  `NODE_MODULE_VERSION === 137`.
- MCP / ACP / Node skills may use an explicitly chosen system Node.
- If that system Node fails the OCR constraint, OCR asks for the managed pin.
  DeepChat still downloads only one Node version.

Handshake: helper `nodeVersion` must equal the **activated** resolved version
(the `state.json` pointer for managed, or the probed version for bundled /
system / custom) **and** that version must be in range. Do not compare against a
baked `runtime-versions.json` string after Node can update independently.

### Layout

```
{userData}/toolchains/
  state.json
  node/<version>/          # official distro root
  uv/<version>/
  download/<kind>-<version>/   # in-progress, never the active pointer
```

Activate is write-to-temp + `fsync` + rename of `state.json`. An interrupted
download never replaces a working version.

### Downloads

Reuse the main-process proxy stack (`ProxyConfig` / undici global dispatcher).
Add sha256, resume, and a single-flight lock per artifact.

Probe the real artifact URL. Pattern from the npm speed-test (custom > cache >
concurrent probe > fallback), **not** its URL list and **not** its
fail-to-`npmmirror` cache write. Failed probes stay in memory. Only successful
probes are cached. Official source is the in-memory fallback.

GitHub mirror is optional and default-empty. No ipinfo. Privacy mode: no
background probe. Locale/timezone may only sort the probe list.

Typed local error reasons:

`dns | timeout | http | proxy | checksum_mismatch | disk | cancelled | activation_failed | unsupported_platform`

### Settings

Settings → Toolchains (visible in the Tools group).

- Per-toolchain source picker. If a system binary is detected, highlight it
  (zero download).
- Install / Repair / Revert are separate explicit actions.
- Missing runtime on an auto-connect path: server error + one aggregated
  banner. No N dialogs.
- Three-way picker only on user-initiated paths.

Bun remains a schema stub if a future catalog needs the slot. The UI hides it.
There is no Bun downloader.

### Skill policy mapping

| Skill preference | Resolution |
| --- | --- |
| `auto` | `ToolchainService` persisted source |
| `builtin` | bundled only; fail if incomplete |
| `system` | system only; fail if missing |

Skill `auto` no longer prefers system over bundled. The first-run migration
plus an explicit Settings pick replace that implicit chain.

Python skills resolve uv through `ToolchainService`. Skill `auto` fail-closes
on that persisted uv source; it must not fall back to a system CPython.
Explicit skill `system` may still use a system CPython. DeepChat does not
download CPython.

### Packaging end state

Installer contains: app, uv+uvx seed, OCR models/native, RTK, DuckDB VSS, CLI
scripts, skills, official plugins.

Installer does not contain: Node/npm/npx/corepack, Bun, full CPython.

`install-runtime.mjs` keeps installing uv (and RTK). Node install becomes a
pack-time no-op after the CLI Electron host and managed downloader ship.
Pack-time verification for any remaining Node seed, and for every managed
artifact, must checksum the completeness set, not only `node`.

Windows OCR smoke firewall rules that currently point at bundled `node.exe`
must point at the resolved official Node after the flip.

### Compatibility

- Existing users with a complete bundled Node migrate to source `bundled` and
  keep working until a later release removes Node from the artifact.
- Users who already relied on system PATH because bundled Node was absent
  migrate to `system` when a system `node` exists.
- `useBuiltinRuntime` stays deleted. Dead i18n keys are removed.
- `bunRuntimePath` is deleted. Callers use Node.
- Issue #2153 AC line “artifact contains no uv” is an accepted deviation:
  uv stays as a bundled seed with a managed override. Re-negotiate on the
  issue; do not silently drop uv from the artifact.

## Invariants

1. One resolver. Consumers do not invent a second PATH chain.
2. One persisted source per kind. Resolve never walk to the next source.
3. One managed Node pin. Catalog never lists a second Node version.
4. Official Node ABI 137 for OCR. Electron Node is only for DeepChat's own JS.
5. CLI host is Electron, even if a managed Node is installed.
6. Interrupted download never becomes the active pointer.
7. Failed mirror probes are not written to disk cache.
8. Repair and Revert are distinct. Revert for uv returns to bundled seed.
9. Bundled corruption is not patched in-place.
10. Privacy mode does not background-probe mirrors.

## Interfaces

Main process owns `ToolchainService`. Renderer talks through typed routes:

- `toolchains.getStatus`
- `toolchains.setSource`
- `toolchains.install`
- `toolchains.cancelInstall`
- `toolchains.repair`
- `toolchains.revert`
- `toolchains.pickCustom`

Progress uses a DeepChat event, not a settings snapshot key.

Persist selection in `{userData}/toolchains/state.json`, not `app-settings.json`.
The pointer and the downloaded trees must share one directory and one atomic
writer.

## Failure behavior

- `unconfigured` / `missing` / `incomplete` / `version_mismatch` / `abi_mismatch`
  / `path_invalid` / `unsupported_platform` are typed errors.
- Auto-connect surfaces one aggregated banner and leaves the feature unused.
- User-initiated install surfaces the typed download reason.
- OCR handshake mismatch disposes the helper. It does not fall back to
  Electron Node.

## Security and privacy

- Custom paths must be absolute after expansion. Reject credentials in URLs.
- Verify sha256 before activate. Do not exec a half-written download.
- Follow the active `ProxyConfig`. Do not add a second proxy stack.
- Privacy mode: no background network for toolchain discovery.
- Do not log full custom paths that may contain usernames beyond existing
  DeepChat logger conventions.

## Performance

- Cache the resolved toolchain in memory. Invalidate on source change,
  activate, or explicit refresh.
- Hot path (MCP/ACP rewrite, Skill spawn) is filesystem metadata plus cache.
  Do not spawn `node -v` on every connect.
- Spawn for version/ABI at most once per executable path, then cache.
- Single-flight per download key.
- PATH scans cap at 256 entries, matching Skill.

## Acceptance criteria

1. MCP, ACP, Skill, and OCR resolve Node/uv only through `ToolchainService`.
2. After first-run persist, Settings (plus Repair/Revert) is the only way a
   later resolve uses a different source, except one-shot first-run
   `unconfigured` → `system` when login-shell PATH arrives. A user-chosen
   `unconfigured` is never promoted.
3. A failed or interrupted Node download leaves the previous working version
   active.
4. OCR helper handshake accepts the activated official pin and rejects
   Electron Node and out-of-range versions.
5. CLI still runs after Node is removed from the installer, hosted by
   Electron.
6. Installer size no longer includes the Node distro after the packaging flip.
7. No Bun binary is downloaded or shipped.
8. uv remains in the artifact; Revert restores that seed.
9. Privacy mode performs no toolchain probe until the user installs.
10. Dead `bunRuntimePath` and `useBuiltinRuntime` copy are gone.

## Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| mise | Extra tool to ship, implicit shims, version-manager UX we do not want. Download the official Node distro directly. |
| Implicit PATH fallback chain | Production pain; silent source changes. |
| Electron Node for OCR / npx | ABI 145 vs 137; no npm/npx/corepack. |
| Two managed Node versions | OCR and MCP share one pin. System Node is the user's binary, not a second download. |
| Restore Bun | Historical only; removed in v0.4.9. Schema stub, UI hidden, no downloader. |
| Drop uv from the artifact now | Removing the seed and re-downloading it is worse, and a CVE-decoupled override still needs a managed path. Keep seed + managed override. |

## Open questions

None that block implementation. The uv-in-artifact deviation must be stated on
#2153 when a PR is opened; that is communication, not a design fork.
