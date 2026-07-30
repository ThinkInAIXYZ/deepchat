# MCP Apps Host Implementation Map

Status: implemented and repository-validated; packaged/manual sandbox verification is tracked in
`tasks.md` and the ecosystem runbook.

## Dependency Order

1. Preserve v2 tool definitions/results and immutable server bindings.
2. Establish the single source-aware `ToolPermissionBroker`.
3. Add the main-owned App host, sandbox registry, and custom protocol.
4. Add typed preload/routes and the renderer AppBridge host.
5. Enable host actions, display modes, permissions, persistence, and rehydration.
6. Run repository validation, then human interoperability and packaged malicious fixtures.

## Step 1: Lossless Discovery And Persistence

The core runtime:

- keeps nested `_meta.ui.resourceUri`, deprecated `_meta["ui/resourceUri"]`, visibility, raw
  schemas, annotations, icons, and metadata;
- filters app-only tools before model conflict renaming/provider projection;
- retains the server-local original names for App listing/calls;
- persists bounded raw result content, arbitrary JSON structured content, `_meta`, and an
  `McpAppDescriptor` in the assistant block;
- binds that descriptor to `serverId`, `configGeneration`, and `bindingHash`;
- never persists HTML, token, grant, bridge state, log, or display mode.

`src/main/mcp/resultProjection.ts` owns deterministic metadata precedence and bounded result/App
projection. `src/main/session/data/tables/deepchatAssistantBlocks.ts` owns exact source matching and
approved model-context persistence.

## Step 2: Main-Owned Host

`src/main/mcp/apps/appHost.ts` owns App preparation and actions without creating another MCP
connection:

- resolves the descriptor by immutable server ID;
- rejects generation/binding/source mismatch without display-name fallback;
- ensures the exact bound server is live;
- rechecks the live tool/resource declaration;
- reads the matching `ui://` resource through the v2 client;
- decodes text/base64 HTML and applies byte/content/MIME limits;
- traverses at most 64 resource-list pages for fallback `_meta.ui`;
- normalizes CSP, permissions, advisory domain, and border preference;
- delegates same-server calls to the permission broker and exact bound client;
- mediates links, user messages, and approved model context.

The host applies separate bounds for HTML, actions/lists, tool results, messages, consent previews,
and model context. Denied tool access suspends only that live App instance until the host Retry
route clears the suspension.

## Step 3: Sandbox Registry And Protocol

`src/main/mcp/apps/sandboxRegistry.ts` owns:

- cryptographically random instance hostnames;
- WebContents/window, conversation, message, block, descriptor, input, and expiry binding;
- 64 process-wide and 32 per-WebContents instance limits;
- 64 pending-consent limit and 2-minute consent timeout;
- per-instance sensitive browser grants;
- revocation on release, expiry, renderer destruction, and process shutdown;
- the default-session permission request/check router, including the explicit first-party
  audio-recorder microphone branch.

`src/main/mcp/apps/sandboxProtocol.ts` registers the secure `mcp-app` scheme before Electron ready
and serves only a fixed proxy at:

```text
mcp-app://<opaque-instance>/sandbox.html
```

The proxy creates the untrusted inner iframe, accepts HTML once through the Apps
sandbox-resource-ready notification, and forwards only bounded non-reserved JSON-RPC messages
between the exact parent/inner windows. The response header supplies the effective deny-by-default
CSP and permissions policy, including `form-action 'none'`, no-store, and nosniff.

The custom-protocol request cannot identify its owner WebContents, so it proves only live token and
path. Every privileged action separately proves sender WebContents/window through `RouteContext`.

## Step 4: Typed Boundary

`src/shared/contracts/routes/mcp.routes.ts`, main MCP routes, preload registration, and
`src/renderer/api/McpClient.ts` expose exact operations for:

- prepare/release;
- same-server tool/list/resource/prompt operations;
- external link;
- conversation message authorization;
- model-context update;
- tool-access retry;
- consent response.

Every changed route has a structural, bounded schema. The renderer never receives auth material,
endpoint/command/environment details, raw server config, or generic Electron/MCP access.

## Step 5: Renderer AppBridge Host

`src/renderer/src/components/mcp/McpAppView.vue`:

- creates `AppBridge(null, ...)` with the official postMessage transport;
- advertises only implemented links, server tool/resource proxies, logging, message, model-context,
  sandbox, and display capabilities;
- waits for sandbox readiness and App initialization;
- sends the complete persisted input and completed result exactly once;
- forwards theme, locale, time zone, platform, pointer, safe-area, container, and display context;
- clamps/coalesces size changes;
- provides inline, fullscreen, and renderer-floating PiP using DOM-preserving `Teleport`;
- requests teardown with a 500 ms bound and releases the main instance on unmount;
- rate-limits diagnostic messages and omits their structured data.

`mcpAppDisplayCoordinator.ts` permits one non-inline App in a renderer window. AppBridge, iframe,
and request state stay component-local rather than entering Pinia.

The host does not advertise optional sampling, downloads, App-provided tools, or list-change
capabilities. Persisted completed tool blocks do not emit partial-input or cancellation
notifications.

## Step 6: User Consent And Context

Host-owned Vue dialogs present:

- App tool requests;
- normalized HTTP(S) external links;
- proposed user-role messages;
- exact model-context updates;
- camera, microphone, geolocation, and clipboard-write.

The tool broker binds decisions to conversation, source, immutable server generation/binding, tool,
permission type, and canonical argument hash. A decision cannot cross source, App instance,
arguments, server re-pointing, or conversation.

Approved model context is written to the same tool block with a SHA-256 payload hash. Context
building and compaction consume only that approved exact payload; later App updates require new
approval.

## Step 7: Validation

The final repository phase runs formatting, i18n generation/validation, lint, typecheck, focused
main/renderer suites, broader affected suites, and production build once. Human verification then
uses the pinned official Apps examples and DeepChat-owned modern/malicious fixtures in
`docs/architecture/mcp-v2-protocol/manual-verification.md`.
