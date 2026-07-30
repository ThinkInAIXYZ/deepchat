# MCP Apps Host Tasks

Status: implementation and repository validation complete; human and packaged sandbox
interoperability validation remain pending.

## Discovery And Persistence

- [x] Advertise `io.modelcontextprotocol/ui` with
      `text/html;profile=mcp-app` from the v2 client.
- [x] Preserve nested `_meta.ui.resourceUri`, deprecated `_meta["ui/resourceUri"]`, visibility, and
      complete raw tool definitions.
- [x] Enforce model/app visibility at model listing, App listing, and App call time.
- [x] Persist a bounded non-executable result/App descriptor in assistant-block `extra_json`.
- [x] Bind descriptors to immutable server ID, generation, and binding hash.
- [x] Keep HTML, opaque tokens, grants, logs, bridge requests, and display state out of persistence.
- [x] Persist only exact user-approved App model context and payload hash.

## Main Sandbox And Resource Service

- [x] Register a secure standard `mcp-app` scheme before Electron ready.
- [x] Add cryptographic instance hostnames, WebContents/window binding, expiry, revocation, and
      process/per-renderer caps.
- [x] Validate `ui://`, exact matching resource content, stable MIME, UTF-8/base64 HTML, and 2 MiB
      decoded size.
- [x] Traverse bounded resource pages for fallback `_meta.ui` and use the v2 SDK cache/invalidation
      path.
- [x] Normalize CSP origins, requested permissions, advisory domain, and border preference.
- [x] Serve a fixed double-iframe proxy with response-header CSP, deny-by-default network policy,
      `form-action 'none'`, permissions policy, message/source bounds, and no-store semantics.

## Typed Boundary

- [x] Add exact prepare/release/tool/list/read/link/message/context/retry/consent routes.
- [x] Bind every route to main-derived `RouteContext` sender identity.
- [x] Apply bounded structural schemas at every changed route.
- [x] Extend preload registration and renderer `McpClient` without exposing a generic IPC or secret
      API.
- [x] Keep route results free of auth headers, endpoints, commands, environment, and raw server
      config.

## Renderer Host

- [x] Mount `McpAppView.vue` under the persisted tool result.
- [x] Use component-local `AppBridge(null, ...)` and the official postMessage transport.
- [x] Send sandbox-ready, initialize, complete input/result, context, display, size, and bounded
      teardown in protocol order.
- [x] Add loading, inert/error, retry, source label, and effective security details.
- [x] Clamp and animation-frame-coalesce inline size changes.
- [x] Implement inline, fullscreen, and renderer-floating PiP with DOM-preserving `Teleport`.
- [x] Permit one non-inline App per renderer window.

## Host Actions And Permission

- [x] Resolve every App action from the main-owned descriptor and exact live server binding.
- [x] Reject generation/binding/source mismatch without display-name fallback.
- [x] Recheck bindings after awaited reads/consent and revoke every live instance on server
      disable, removal, reconfiguration, plugin unregister, or OAuth binding finalization.
- [x] Route App-visible same-server tool calls through the source-aware `ToolPermissionBroker`.
- [x] Suspend an instance's tool channel after denial and require host Retry without retaining an
      approval.
- [x] Route bounded same-server tool/resource/list operations.
- [x] Require host confirmation for normalized HTTP(S) links and App-authored conversation
      messages.
- [x] Require host confirmation and exact persistence for model-context updates.
- [x] Rate-limit App diagnostic messages and omit their structured payload.

## Browser Permission And Lifecycle

- [x] Support declared camera, microphone, geolocation, and clipboard-write only.
- [x] Enforce Electron permission request/check callbacks by opaque App origin, WebContents, media
      type, declaration, and per-instance grant.
- [x] Preserve the explicit first-party audio-recorder microphone branch.
- [x] Revoke instances, grants, pending consent, and HTML on teardown, expiry, or renderer
      destruction.
- [x] Add localized host consent, security, display, retry, and error copy.
- [x] Keep Escape-to-inline and accessible host labels/expanded-state controls.

## Package Boundary

- [x] Pin `@modelcontextprotocol/ext-apps@1.7.5` and its exact
      `@modelcontextprotocol/sdk@1.30.0` peer.
- [x] Keep AppBridge/v1 types in the renderer Apps boundary; pass only validated plain JSON to the
      v2 main runtime.
- [x] Prevent v1 SDK imports from DeepChat-owned main MCP code.
- [x] Advertise no unsupported optional sampling, download, App-provided-tool, or list-change
      capability.

## Verification

- [x] Run the repository final validation matrix recorded in the MCP v2 architecture tasks.
- [x] Run focused result projection, source binding, sandbox policy/registry, App host, routes, and
      permission-broker suites.
- [ ] Run parent/preload/storage/navigation/network/form/message-spoofing attack fixtures in a
      packaged Electron build.
- [ ] Run oversized message/resource, consent exhaustion, unmount/remount, and persisted reload
      cases.
- [ ] Execute the pinned Debug, Budget Allocator, System Monitor, Map, and DeepChat-owned modern App
      cases in `manual-verification.md`.
- [ ] Archive redacted per-platform Apps evidence using the runbook template.
