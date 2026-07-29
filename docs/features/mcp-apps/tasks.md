# MCP Apps Host Tasks

## Prerequisites

- [ ] Complete MCP v2 legacy-wire parity.
- [ ] Preserve raw tool definitions and raw/bounded results.
- [ ] Complete the source-aware `ToolPermissionBroker` migration.

## Discovery And Persistence

- [ ] Preserve nested and deprecated App resource metadata.
- [ ] Preserve and enforce tool model/app visibility.
- [ ] Add bounded `McpAppDescriptor` persistence in tool block `extra_json`.
- [ ] Bind descriptors to immutable server ID, config generation, and connection binding hash.
- [ ] Keep HTML, tokens, grants, logs, and bridge state out of persistence.

## Main Sandbox And Resource Service

- [ ] Register the secure standard `mcp-app` scheme before Electron ready.
- [ ] Add opaque instance token creation, WebContents binding, expiry, and revocation.
- [ ] Add `ui://` resource validation, decoding, MIME checks, and 2 MiB limit.
- [ ] Normalize CSP domains, requested permissions, domain, and border metadata.
- [ ] Serve a fixed trusted sandbox proxy with a response-header CSP including
      `form-action 'none'`.
- [ ] Add a bounded SDK-aware ephemeral resource cache.

## Contracts

- [ ] Add exact typed prepare/release/tool/resource/link/message/context/permission routes.
- [ ] Add a sender-bound host Retry route that clears only the matching main-owned tool-channel
      suspension.
- [ ] Use bounded structural route schemas and bind every route to `RouteContext` sender identity.
- [ ] Extend preload registration and renderer `McpClient`.
- [ ] Prove route results contain no auth headers, filesystem paths, or raw server config.

## Renderer Host

- [ ] Add `McpAppView.vue` under the existing tool result component.
- [ ] Add component-local `AppBridge(null, ...)` lifecycle.
- [ ] Add source/origin/token/message validation.
- [ ] Send initialize, input, result/cancel, context, and teardown in order.
- [ ] Add loading, fallback, offline, retry, origin, and security states.
- [ ] Add bounded/coalesced size handling.

## Host Actions

- [ ] Resolve app tool calls only from the main-side immutable server binding.
- [ ] Reject generation/binding mismatch without display-name fallback.
- [ ] Enforce app visibility and route consent through `ToolPermissionBroker` with source
      `mcp-app`.
- [ ] Prove tool consent works outside an active model turn and cannot be reused after argument
      changes.
- [ ] Suspend an App instance's tool channel in main after denial and require host-owned Retry
      before the next broker evaluation, without storing an approval or permission cache.
- [ ] Route bounded same-server resource reads.
- [ ] Add confirmed normalized HTTP(S) external links.
- [ ] Add confirmed user-role conversation messages.
- [ ] Add bounded last-write-wins model context with exact-payload user approval.
- [ ] Add redacted/rate-limited App diagnostics.

## Display And Permissions

- [ ] Implement inline display.
- [ ] Implement fullscreen and renderer-floating pip with DOM-preserving Teleport.
- [ ] Allow only one non-inline App per window.
- [ ] Add camera, microphone, geolocation, and clipboard-write consent.
- [ ] Enforce Electron permission request/check callbacks by App origin/token/grant.
- [ ] Preserve and regression-test the first-party audio recorder microphone path.
- [ ] Revoke grants on teardown and token expiry.
- [ ] Add accessible focus, keyboard, labels, and reduced-motion behavior.

## Package Boundary

- [ ] Add `@modelcontextprotocol/ext-apps@1.7.5` and exact peer
      `@modelcontextprotocol/sdk@1.30.0`.
- [ ] Restrict v1 SDK imports to the ext-apps compatibility boundary.
- [ ] Prove no v1 protocol object crosses into v2 MCP core.
- [ ] Add dependency/peer drift validation.

## Verification

- [ ] Run format, i18n validation, lint, typecheck, and focused Apps suites.
- [ ] Run stable lifecycle and visibility fixtures.
- [ ] Run parent/preload/storage/navigation/network/message spoofing attack fixtures.
- [ ] Prove form submissions to self, declared, and undeclared origins cannot send or navigate.
- [ ] Run oversized resource/message and pending-request exhaustion fixtures.
- [ ] Run virtualized unmount/remount and persisted reload fixtures.
- [ ] Prove a denied polling App is suspended without repeated dialogs and Retry re-enters the
      broker without retained approval.
- [ ] Run packaged Electron CSP/origin/permission smokes.
- [ ] Execute the pinned Debug, Budget Allocator, and System Monitor cases in the ecosystem manual
      verification runbook.
- [ ] Run a DeepChat-owned modern App fixture because published Apps examples use the legacy SDK.
- [ ] Archive redacted per-platform Apps evidence using the runbook template.
- [ ] Advertise `io.modelcontextprotocol/ui` only after all required host behavior passes.
