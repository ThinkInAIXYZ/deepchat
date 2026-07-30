# Plugin External Runtime Lifecycle Tasks

## Contract and ownership

- [x] Add and validate manifest lifecycle, surface, catalog, environment, and adapter fields.
- [x] Add an in-memory trusted registry for plugin-owned servers.
- [x] Remove persisted MCP `enabled` as a second source of plugin user intent.
- [x] Reject server-name ownership collisions and untrusted lifecycle bypasses.

## Supervisor and startup

- [x] Implement coalesced start, idempotent stop, symmetric ownership, and transient status.
- [x] Gate all public MCP lifecycle methods at the service boundary.
- [x] Route initialization, manual toggle, config restart, auth restart, renderer, disable, and
      shutdown paths through the supervisor.
- [x] Split startup into plugin registration, non-plugin MCP initialization, and supervisor
      reconcile.
- [x] Keep Feishu eager and set CUA to on-demand.

## Discovery and dispatch

- [x] Generate and package the CUA static MCP tool catalog.
- [x] Merge catalog definitions with live client definitions without duplicate or unstable names.
- [x] Ensure runtime on first tool call, then verify the live tool before dispatch.
- [x] Reject on-demand prompt/resource manifests and every silent catalog fallback.

## Migration and safety state

- [x] Add the versioned, safe-side-first legacy CUA migration and idempotency tests.
- [x] Persist pre-spawn sentinels and clear only matching spawn-attempt evidence after clean stop.
- [x] Derive quarantine from stale evidence and a verified runtime fingerprint.
- [x] Add a supervised changed-fingerprint start and explicit user retry for the same fingerprint.
- [x] Treat integrity mismatch as non-bypassable and keep installation intent unchanged.

## CUA 0.12.6 foundation

- [x] Pin tag, commit, assets, checksums, and exact protocol versions.
- [x] Implement private endpoint generation and daemon metadata handshake.
- [x] Keep daemon stdin open for parent-liveness and guarantee timeout/failure cleanup.
- [x] Remove obsolete 0.7.1 launch flags and environment variables.
- [x] Keep the daemon warm after first use and stop it on disable/shutdown.

## CUA 0.13.1 contract upgrade

- [x] Pin the 0.13.1 release commit, assets, checksums, and driver handshake version.
- [x] Rename cursor style policy/docs to theme and cover the complete cursor session contract.
- [x] Document and test `browser_type.replace`, including empty replacement clearing.
- [x] Deny `kill_app` locally and document the version-specific upstream session-schema defect.
- [x] Remove the obsolete UIA-worker environment contract from source, packaging, and tests.
- [x] Exclude the macOS `cua-cursor-theme` authoring sidecar before signing and attestation.
- [ ] Regenerate the native catalog and verify 49 macOS, 50 Windows, and 53 Linux tools.
  - macOS arm64 generated 49 tools and passed bundle/verification locally on 2026-07-29.
  - Windows and Linux counts remain native-CI gates.
- [ ] Run native driver ownership smoke with a disposable process on each supported platform.
- [ ] Validate preinstalled custom cursor themes after sidecar removal.

## CUA 0.14.1 contract upgrade

- [x] Pin the 0.14.1 release commit, assets, checksums, and driver handshake version.
- [x] Preserve the existing embedded protocol metadata and supported target matrix.
- [x] Project only the exact, bounded browser-chrome capture-coverage recovery contract.
- [x] Document session-badge ownership and the v2 action-only custom-theme migration boundary.
- [x] Keep the optional GNOME Wayland helper outside DeepChat packaging and lifecycle ownership.
- [ ] Regenerate the native catalog and verify the expected tool count on each supported platform.
  - macOS arm64 generated 49 tools and passed bundle/verification locally on 2026-07-30.
  - macOS x64, Windows, and Linux generation remain native-CI gates.
- [ ] Validate bundled and preinstalled cursor-theme behavior on native targets.

## Model-facing CUA compatibility

- [x] Normalize empty `element_token` for the seven affected CUA action tools without removing
      valid zero coordinates or unrelated falsy values.
- [x] Preserve raw MCP `structuredContent` and expose a compact latest-snapshot token projection to
      the model.
- [x] Project bounded CUA `refusal.code` values into model-visible content while retaining the raw
      structured refusal.
- [x] Project the exact browser-chrome capture-coverage contract without accepting arbitrary
      runtime-provided recovery instructions.
- [x] Pass stale-token errors through unchanged and document fresh-snapshot retry behavior in the
      packaged CUA skill.
- [x] Analyze CUA screenshots only for explicit `include_screenshot: true` calls and append bounded
      visual grounding or a clear unavailable result.
- [x] Cover empty/index/token/pixel arguments, structured token/refusal projections, screenshot
      gating, and stale-token guidance with automated tests.
- [ ] Re-run the native Calculator action-and-verification scenario.

## Environment and integrity

- [x] Add legacy-compatible `inheritEnv` and the explicit cross-platform minimal baseline.
- [x] Generate a packaged CUA integrity descriptor and verify it before every spawn.
- [x] Reject path escape, symlink/non-regular runtime files, missing files, and unexpected
      executables.
- [x] Update the macOS signature/identity/hardened-runtime/exact-entitlement contract.
- [x] Package only the Windows primary executable and disable UIA-worker opt-in.
- [x] Document Feishu's `npx` artifact-closure exception.
- [ ] Vendor and lock Feishu's runtime dependency closure as a post-P1 security follow-up.

## UX and diagnostics

- [x] Expose installation intent, runtime state, quarantine, and integrity errors separately.
- [x] Add “Test runtime” and recoverable “Retry runtime” actions for on-demand CUA.
- [x] Keep generic MCP controls from directly starting/stopping plugin-owned servers.
- [x] Provide actionable Windows Security guidance without suggesting exclusions.

## Automated validation

- [x] Cover all lifecycle entry points and unauthorized low-level access.
- [x] Cover concurrent first call, disable-during-start, shutdown, and failed-start cleanup.
- [x] Cover catalog/policy parity, live-tool revalidation, prompts/resources scope, and name
      conflicts.
- [x] Cover migration re-entry, stale sentinel, changed fingerprint, retry, and integrity failure.
- [x] Cover environment allowlists and preservation of legacy MCP inheritance.
- [x] Cover per-target package layout, exact runtime files, checksums, and unsupported targets.
- [x] Scope the reviewed cross-platform CUA policy union to each native target catalog.
- [x] Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck`.
- [x] Run focused plugin, MCP, ToolManager, package, signing, and workflow tests.

## Native release gates

- [ ] macOS arm64: signed/notarized app, TCC, screen capture, input, restart, crash/recovery.
- [ ] macOS x64: signed/notarized app, TCC, screen capture, input, restart, crash/recovery.
- [ ] Windows x64: clean consumer install with Defender enabled and protection status/history
      recorded.
- [ ] Windows arm64: clean consumer install with Defender enabled and protection status/history
      recorded.
- [ ] Linux x64 X11: reproduce the #2039 activation path with no desktop/session loss.
- [ ] Linux x64 X11: record warm-daemon idle CPU, handle/file-descriptor count, and residual
      windows with and without a compositor.
- [ ] Linux x64 Wayland: validate discovery, input, capture, restart, current and older manually
      installed helper states, and known limitations.
- [x] Confirm statically that DeepChat Linux application releases remain independent from optional
      CUA artifacts.

## Verification record

Completed on 2026-07-28:

- `pnpm test`: 657 files and 7005 tests passed; 20 files and 277 tests were conditionally skipped.
- `pnpm run build`, `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and
  `pnpm run typecheck` passed.
- `pnpm run plugin:validate -- --name cua` passed.
- `pnpm run plugin:bundle -- --name cua --platform darwin --arch arm64` passed and produced a
  development-signed 0.12.6 artifact.
- CUA plugin verification passed for `darwin/arm64` with `build/bundled-plugins` as the plugin
  root.

The development artifact does not satisfy the macOS native release gate. No Windows or Linux
desktop-session native gate was run in this environment.

Native macOS development testing later passed on-demand startup, exact per-tool approval, app
launch, and window discovery, then failed the first Calculator `click` because the provider emitted
`element_token: ""` beside a valid `element_index`. The model-facing compatibility checklist above
is implemented and automation-verified; the unchecked Calculator task is the remaining native
acceptance step.

Model-facing compatibility validation completed on 2026-07-28:

- focused CUA adapter/ToolManager/result-normalizer tests: 62 passed;
- `pnpm run test:main`: 5416 passed, 277 skipped by environment gates;
- full Node/Web type checks, formatting, lint, i18n, and CUA plugin manifest validation passed.

CUA 0.13.1 upgrade validation completed on 2026-07-29:

- macOS arm64 plugin bundle and verification passed with a development-signed artifact;
- the generated catalog reported 49 tools for driver 0.13.1, and the package excluded
  `cua-cursor-theme`;
- 182 focused tests passed;
- `pnpm run test:main`: 467 files and 5568 tests passed; 20 files and 279 tests were skipped;
- `pnpm run test:renderer`: 207 files and 1653 tests passed;
- formatting, i18n, lint, Node/Web type checks, and CUA manifest validation passed.

CUA 0.14.1 upgrade validation completed on 2026-07-30:

- all five pinned supported-target release assets matched their upstream SHA-256 values; static
  protocol, catalog, signing, entitlement, and native-library audits found no host-contract drift;
- macOS arm64 plugin bundle, validation, and verification passed with a development-signed
  artifact; the generated catalog reported 49 tools for driver 0.14.1, the package excluded
  `cua-cursor-theme`, and strict code-signature verification passed;
- 178 focused CUA, plugin, MCP, package, integrity, and renderer tests passed;
- `pnpm run test:main`: 467 files and 5591 tests passed; 20 files and 279 tests were skipped;
- `pnpm run test:renderer`: 207 files and 1653 tests passed;
- formatting, i18n, lint, Node/Web type checks, the production build, and CUA manifest validation
  passed.

Windows/Linux native catalogs and behavior, the version-gated direct-driver ownership smoke,
release-signed/notarized macOS behavior, and preinstalled custom themes remain unchecked above.

## Review hardening

- [x] Evaluate closed plugin tool policy before coarse grants and cache approvals per exact tool.
- [x] Fail closed when a tool is absent from an enabled plugin policy.
- [x] Compare live tool input schemas with the packaged catalog.
- [x] Preserve legacy CUA disabled intent, remove its obsolete MCP record, and isolate retryable
      migration failures from unrelated plugins.
- [x] Complete Linux/Windows session environment baselines and keep `CUA_LOG` adapter-local.
- [x] Reject CUA environment overrides outside the exact host-owned contract.
- [x] Persist daemon PID and reap only endpoint-attested stale CUA processes.
- [x] Clarify permission-gate, double-verification, and warm-runtime design intent in code/docs.
- [x] Cover the review regressions with focused tests and rerun the required validation suite.
