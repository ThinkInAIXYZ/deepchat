# Plugin Remote Distribution — RFC

Status: accepted (2026-09-16). Decisions recorded in this spec supersede earlier discussion;
the interactive planning draft lives outside the repository and is not authoritative.

## Context

DeepChat ships heavyweight optional capabilities inside the installer:

- the CUA (Computer Use) plugin bundles a native driver app (~tens of MB per platform);
- LightOCR ships model + native engine packages (~124 MB per platform).

Both are already managed by the plugin host (`src/main/plugin/`), but `.dcplugin` packages are
only ever bundled at build time into `app.asar.unpacked/plugins`. The manifest `source.url`
field is a trust anchor that the host never fetches; there is no runtime download path.

The installer is therefore larger than necessary for users who never use these capabilities,
and GitHub release downloads are unreliable in mainland China without a mirror strategy.

Out of scope (decided 2026-09-15): DuckDB, Knowledge, and Memory stay fully built-in. Their
extraction paths are archived in the interactive plan draft and intentionally not part of this
spec. `runtime/node|uv` on-demand slimming remains an open follow-up.

## Goals

1. Reduce installer size by ~150-180 MB/platform by distributing CUA and LightOCR payloads as
   remotely downloadable artifacts.
2. Provide a host-side remote installer for official plugins: download → sha256 verify →
   `.dcplugin` verify → atomic install → register, with progress, cancel, retry, and corrupt
   artifact isolation.
3. Mirror chain resolution so mainland users can download artifacts reliably, with tamper
   resistance from catalog-pinned sha256 values.
4. Plugin versions update independently of app versions, gated by `engines.deepchat` ranges.
5. Default UX: silent download on first use (OCR) or on enable (CUA); no explicit download
   confirmation step.

## Non-goals

- Runtime `npm install` for plugin dependencies. Artifacts are prebuilt, lockfile-reproduced,
  checksummed packages produced by CI (existing `pnpm plugin:bundle` tooling). The Feishu
  `npx` pattern is explicitly not extended.
- A remote marketplace or runtime-refreshable catalog. The catalog ships inside the app.
- DuckDB / Knowledge / Memory pluginization.
- Draft-release testing support. Draft assets are not anonymously downloadable and ghproxy
  cannot proxy the authenticated assets API, so a token-auth download path would diverge from
  the production path and skip mirror testing.
- Generalizing the CUA-only launch-guard/integrity machinery to all plugins (deferred; does
  not block this feature).

## Design

### Catalog

A static JSON document shipped at `resources/plugin-catalog.json`:

```jsonc
{
  "schemaVersion": 1,
  "artifacts": [
    {
      "pluginId": "com.deepchat.plugins.cua",
      "version": "1.0.4-beta.3",
      "channel": "stable",              // 'stable' | 'pre-release'
      "minAppVersion": "1.1.2",
      "displayName": "CUA Computer Use Runtime",
      "targets": [
        {
          "platform": "darwin",         // NodeJS.Platform values used by the host
          "arch": "arm64",
          "url": "https://github.com/.../<file>.dcplugin",
          "sha256": "<64 hex>",
          "size": 123456,
          "mirrors": ["https://<self-hosted-ghproxy>/"]  // ordered, applied as url prefixes
        }
      ]
    }
  ]
}
```

- The stable app resolves only `channel: 'stable'` entries. Dev/test builds may point at
  `pre-release` entries through the override hook.
- Dev-only override: `DEEPCHAT_PLUGIN_CATALOG` env var names a catalog file plus artifact
  base directory (or HTTP base) used by e2e fixtures. Packaged builds ignore the override.
- `minAppVersion` plus the manifest `engines.deepchat` range are independent gates.

### Artifact URL resolution

Ordered attempt list per target, tried with the toolchains downloader pattern (probe with
short connect timeout, fall through on failure):

1. the app's configured HTTP proxy, if set (proxy takes GitHub direct with it);
2. GitHub direct, short connect timeout;
3. each mirror prefix from `mirrors` in order (`mirror + url` concatenation).

Every attempt verifies the downloaded bytes against the catalog-pinned `sha256` before any
filesystem move, so a mirror cannot serve tampered content. Size mismatch aborts early.

### PluginRemoteInstaller

New module in `src/main/plugin/`:

- `install(catalogEntry, target)` — staging download under
  `userData/plugins/.staging/<opId>/`, sha256 verification, `.dcplugin` package verification
  (reuse the existing checksums.json + path-escape checks used for bundled packages), atomic
  move into the plugin install root, then hand off to the existing official-plugin
  registration path.
- Progress reporting (bytes / total / phase), cancellation via AbortController, retry on
  transient network errors, corrupt-artifact quarantine into the staging dir before cleanup.
- Concurrency: one install per plugin id at a time; later requests join or are rejected
  while running.

### Manifest extension

`plugin.json` `runtime.install` gains `strategy: 'download'` alongside the existing
bundled-helper and guideUrl forms. For catalog-distributed plugins the host resolves the
artifact from the catalog rather than the manifest `source.url` (the manifest URL remains the
trust anchor for bundled packages).

### UX

- Plugins catalog page: catalog-distributed plugins show Install/Installing/Installed states
  with progress and failure retry.
- OCR (phase P1b): first use with missing runtime triggers a background download through the
  same installer; the triggering attachment skips text extraction for that turn; runtime
  status surfaces through the existing `getRuntimeStatus` route and settings page.
- A single settings toggle "automatically download feature runtimes" (default on).

### Testing (three layers)

| Layer | Mechanism | Coverage |
|---|---|---|
| L1 local e2e, CI-repeatable, offline | `DEEPCHAT_PLUGIN_CATALOG` override + local static fixture server | download → verify → install → launch guard → enable → failure retry → degradation |
| L2 prerelease staging, real network | CI publishes rc artifacts to a prerelease release; dev-build catalog points at `pre-release` entries | real GitHub URLs, mirror chain, sha256, platform×arch naming |
| L3 release gate | `plugin:verify --remote <catalog>` fetches and verifies every remote artifact before promote | prevents catalog/asset drift |

Rationale for prerelease over draft: draft assets require PAT-authenticated API downloads
and cannot be mirrored; prerelease assets are publicly fetchable but invisible to stable
apps because the shipped catalog never references `pre-release` entries. The catalog is the
distribution gate, not the GitHub release page.

### Signing posture (macOS)

All signing stays in CI (sign-cua-helper): Developer ID + hardened runtime + entitlements
travel inside the `.dcplugin`. The runtime launch guard (`cuaRuntimeIntegrity`) already
verifies on-disk signature properties and already supports `plugin:` detect paths, so
downloaded installs verify identically to bundled ones. Host-written files carry no
quarantine xattr, so Gatekeeper never assesses them and the `.dcplugin` needs no separate
notarization. CI signing must be kept because TCC (accessibility / screen capture) grants are
keyed to the code-signing identity; unsigned or ad-hoc helpers lose grants on every plugin
update. Unbundling also removes the `Contents/Helpers` nested app and its `signIgnore`
special case from the main app.

Windows remains unsigned (no certificate today); app-spawned exes carry no MOTW and do not
trigger SmartScreen. Linux has no signing system.

## Phases

- P0 (this RFC's implementation slice): catalog schema + loader + override hook,
  PluginRemoteInstaller with mirror chain, manifest `strategy: 'download'`, plugins catalog
  page install UX, L1 e2e fixture.
- P1a: unbundle CUA from build scripts and installer; catalog entry; CI publishes
  `.dcplugin` per platform; silent download on enable; in-place migration for existing
  bundled installs.
- P1b: LightOCR payload becomes a downloadable runtime asset; first-use silent download with
  per-turn degradation; auto-download settings toggle; plain files replace gzip-base64
  encoding for downloaded payloads.

## Compatibility & migration

- Existing bundled CUA installs keep working; catalog entries supersede bundled packages on
  next app update (`ensureOfficialPluginInstallation` version refresh already preserves user
  config).
- Plugin data (app_db/, config.json) is never touched by artifact install/uninstall.
- Rollback: removing the catalog entry reverts to bundled distribution.

## Acceptance criteria

1. A catalog-declared plugin installs from a remote artifact on a clean profile, passes
   `.dcplugin` verification, registers, and its MCP/skills/settings contributions activate.
2. sha256 mismatch (corrupted or tampered artifact, including from a mirror) fails the
   install, quarantines the staging copy, and leaves no partial install.
3. A failed or cancelled download can be retried to success without app restart.
4. The dev override hook drives the full install path from local fixtures without network.
5. Installer, catalog parsing, and mirror ordering have unit coverage; the L1 e2e covers the
   happy path and the corrupt-artifact path.
6. Stable builds never resolve `pre-release` catalog entries.

## Open questions

- `runtime/node|uv` on-demand slimming (deferred, does not block this work).
- Self-hosted mirror domain choice (ops decision needed before P1a ships to stable).
