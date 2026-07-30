# Plugin External Runtime Lifecycle Plan

## Status

Lifecycle and model-facing CUA compatibility implementation are complete with automated validation.
The v0.14.1 native cross-platform release gates remain pending.

## 1. Freeze the contracts

- Extend plugin manifest types and validation for `startMode`, `surfaces`, `toolCatalog`,
  `inheritEnv`, and the closed runtime-adapter identifier.
- Require explicit tool-only declarations and a resolvable catalog for on-demand servers.
- Update the maintained CUA feature specification so 0.7.1/UIA-worker assumptions cannot remain a
  competing contract.

## 2. Establish trusted ownership

- Register plugin-owned server descriptors in memory from validated plugin manifests.
- Treat this registry as the authority for lifecycle ownership; SQLite `source` fields remain
  descriptive compatibility data.
- Reject collisions between plugin-owned and user-managed server names.
- Remove plugin registration's unconditional overwrite of persisted user state.

## 3. Introduce the supervisor and low-level process capability

- Add a plugin runtime supervisor that owns per-server transitions, start coalescing, stop
  idempotency, errors, and lifecycle notifications.
- Give it a private low-level MCP process port that cannot be invoked by renderer routes or ordinary
  callers.
- Gate public MCP start/stop at the service boundary and route plugin-owned requests through the
  supervisor.
- Cover initialization, manual toggles, configuration restarts, authentication recovery, renderer
  routes, disable, and shutdown.

## 4. Split application initialization

- Plugin discovery/activation registers capabilities without starting processes.
- MCP initialization starts only non-plugin-owned servers.
- A final supervisor reconcile starts enabled eager plugin servers.
- Preserve Feishu's eager behavior while changing CUA to on-demand.

## 5. Add static tool discovery

- Generate and package the pinned CUA catalog via upstream `dump-docs --type mcp --pretty`.
- Keep the reviewed source policy as a cross-platform union, explicitly map native-only tools, and
  scope each packaged manifest to its target catalog without weakening exact parity.
- Merge catalog definitions into `ToolManager` before a live client exists.
- Keep conflict renaming, access filtering, and exact plugin policies identical for catalog and
  live tools.
- Evaluate exact plugin policy before coarse session grants, remember `ask` only for the approved
  server/tool pair, and deny tools absent from an enabled closed policy.
- On invocation, ensure the runtime, resolve the live client, verify the requested live tool, and
  compare its input schema with the packaged catalog before dispatch.
- Fail packaging when catalog, runtime dump, and policies diverge.

## 6. Implement safety state and migration

- Persist versioned runtime sentinels/quarantines separately from installation intent.
- Write the sentinel before spawn; clear it only on verified clean stop.
- Bind recovery policy to the verified runtime fingerprint.
- Persist daemon PID immediately after spawn, add endpoint identity after readiness, and reap a
  stale process only after endpoint metadata attests the same PID, embedded mode, and host identity.
- Add an idempotent CUA migration that preserves an explicit legacy disabled signal in installation
  intent, removes the obsolete server record, and cannot block unrelated plugin activation.
- Add explicit `runtime.test` and `runtime.retry` plugin actions; do not overload plugin enable.

## 7. Establish the CUA 0.12.6 foundation

- Pin `cua-driver-rs-v0.12.6` and exact release assets/checksums.
- Remove obsolete 0.7.1 `--no-daemon-relaunch` and MCP-mode environment assumptions.
- Implement the embedded daemon/proxy adapter, private endpoint generation, metadata handshake,
  parent-liveness stdin, timeout/cleanup, and protocol validation.
- Keep the daemon warm after first tool use until shutdown or disable.
- Normalize empty optional `element_token` only for the seven affected CUA action tools while
  preserving zero coordinates and every unrelated falsy value.
- Preserve raw MCP `structuredContent` and append compact CUA snapshot/token and refusal-code
  projections without duplicating the full accessibility tree or refusal message.
- Send a returned CUA screenshot through the resolved vision model only when
  `include_screenshot: true`; append bounded grounding text and keep the raw image out of the main
  tool transcript.
- Document stale-token re-snapshot/retry behavior in the packaged CUA skill.

## 8. Harden launch

- Add `inheritEnv: "minimal"` and platform baselines for the CUA daemon and proxy.
- Keep CUA-only diagnostics out of the generic baseline and reject environment overrides outside
  the adapter's exact host-owned contract.
- Generate a release integrity descriptor during official plugin packaging.
- Verify the CUA runtime file set and identity immediately before spawn.
- On macOS, update the exact entitlement contract and preserve helper-before-parent signing and
  notarization.
- On Windows, package only the primary executable, omit the unsigned UIA worker, and do not declare
  its retired opt-in environment variable.

## 9. Adapt UI and diagnostics

- Show installation intent separately from running, quarantined, and integrity-error states.
- Replace any generic on-demand start control with “Test runtime”; expose “Retry runtime” only for
  recoverable quarantine.
- Surface actionable integrity/AV errors without recommending security exclusions.
- Keep plugin-owned servers hidden from generic MCP settings.

## 10. Validate and release

- Run targeted lifecycle, MCP, plugin, tool-manager, migration, packaging, signing, and workflow
  tests first.
- Run formatting, i18n, lint, node/web type checks, and the appropriate broader suites.
- Build and verify target-specific official plugin artifacts.
- Complete native macOS arm64/x64, Windows x64/arm64, and Linux x64/X11 release gates.
- Measure warm-daemon idle CPU, handle/file-descriptor count, and residual windows on Linux X11
  with and without a compositor.
- Do not enable Linux arm64 CUA solely because upstream now publishes an artifact.

## 11. Upgrade the closed CUA contract to 0.13.1

- Pin `cua-driver-rs-v0.13.1`, its release commit, assets, and SHA-256 values.
- Regenerate the native tool catalog and update the closed policy for the cursor-theme rename,
  cursor session contract, and `browser_type.replace`.
- Deny `kill_app` until a later driver exposes the session needed for standard-mode ownership
  proof; keep cooperative close in the skill and bind a direct native failure smoke to 0.13.1.
- Remove the retired UIA-worker environment variable from manifests, packaging validation, the
  embedded adapter, and tests.
- Remove the macOS `cua-cursor-theme` authoring sidecar during staging before signing and
  descriptor generation.
- Keep the empty-token compatibility shim narrowly scoped and document structured token recovery
  without parsing or synthesizing tokens.
- Leave normal `start_session.cursor_theme` unset and avoid adding a parameter-policy shim to the
  adapter.

## 12. Upgrade the closed CUA contract to 0.14.1

- Pin `cua-driver-rs-v0.14.1`, its release commit, assets, and SHA-256 values without expanding the
  supported target matrix.
- Keep the embedded daemon/proxy protocol contract and 49-tool catalog closed unless native
  generation proves an intentional upstream change.
- Preserve raw browser-chrome capture coverage and project only the exact reviewed recovery shape
  into model-visible content using fixed, bounded identifiers.
- Document that the signal is a window-scope limitation rather than evidence that a browser prompt
  exists, and require verified ineffectiveness before desktop escalation.
- Accept the bundled v2 action-only cursor theme contract while treating separately installed v2
  themes and retired v1 rejection as native release gates.
- Keep the optional GNOME Wayland helper outside DeepChat packaging and validate both fresh and
  manually installed helper states separately.

## Compatibility and rollback

- Omitted manifest fields default to eager, all existing MCP surfaces, and legacy environment
  inheritance.
- Feishu remains eager and lifecycle-managed, with its current `npx` closure explicitly outside CUA
  integrity attestation.
- Existing user-managed MCP servers retain their public start/stop and global MCP behavior.
- Existing user-managed MCP servers and plugins without a tool policy retain coarse permission
  caching; closed plugin policies use exact server/tool grants.
- The database migration is forward-idempotent and never converts one server's boolean into plugin
  installation intent except for the explicitly versioned one-to-one legacy CUA rule.
- Code rollback may restore the old host, but a release rollback must not redistribute CUA 0.7.1 on
  Linux. The optional CUA artifact can be withheld independently from the DeepChat application.
