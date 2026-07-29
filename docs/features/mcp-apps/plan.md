# MCP Apps Host Implementation Plan

## Dependency Order

1. Complete MCP v2 legacy-wire parity and lossless tool/result metadata.
2. Complete the source-aware single permission-broker migration.
3. Add the sandbox/resource host with no app-origin capabilities.
4. Add lifecycle and read-only rendering.
5. Add tool/resource/message/link/context handlers.
6. Add display modes, browser permissions, persistence, and conformance fixtures.
7. Advertise `io.modelcontextprotocol/ui` only after the complete host passes.

## Phase 1: Preserve Definitions And Results

Extend the lossless MCP types from the core migration:

- retain raw tool `_meta`, input/output schemas, and visibility;
- retain raw call result content, structured content, and `_meta`;
- add a bounded `McpAppDescriptor` to assistant tool block `extra_json`;
- bind the descriptor to immutable `serverId`, config generation, and connection binding hash;
- keep executable HTML and bridge state out of persistence.

The model tool catalog filters out app-only tools before conflict renaming and provider projection.
The server-local App catalog retains them by original name.

## Phase 2: Main Resource Service

Add `src/main/mcp/apps/` with narrowly scoped modules:

- `McpAppResourceService`
  - resolves a descriptor to the bound live client by immutable server identity;
  - rejects generation/binding mismatch without falling back to display name;
  - reads and validates `ui://` resources;
  - decodes text/blob content;
  - normalizes CSP, permissions, border, and domain metadata;
  - owns a bounded ephemeral resource cache;
- `McpAppSandboxRegistry`
  - creates opaque instance tokens;
  - binds tokens to WebContents, conversation, message block, immutable server identity, and
    descriptor identity;
  - expires/revokes records;
  - returns the normalized response-header CSP;
- `McpAppActionService`
  - validates and dispatches server-local tool/resource actions;
  - delegates tool consent to `ToolPermissionBroker` with source `mcp-app`;
  - redacts results and diagnostics.

Keep these behind `McpService`; they do not create an independent MCP client.

Register the `mcp-app` scheme before `app.whenReady()` and install its protocol handler in the
existing pre-composition protocol registration. Serve only fixed versioned sandbox proxy assets. A
missing or expired token returns a closed response; WebContents ownership is checked at the route
and bridge boundaries where sender identity is available.

Concrete composition:

- register the privileged scheme beside the existing workspace-preview registration in
  `src/main/appMain.ts`;
- construct one `McpAppSandboxRegistry` in `startMainProcess`;
- pass that registry to `registerProtocols(...)` and main composition;
- install the protocol handler in `src/main/app/protocols.ts`;
- inject the same registry into `McpService`/Apps services.

Do not use a second global registry hidden behind module state.

## Phase 3: Shared Contracts

Add exact types and routes for:

```text
mcp.apps.prepareView
mcp.apps.releaseView
mcp.apps.callTool
mcp.apps.readResource
mcp.apps.openLink
mcp.apps.sendMessage
mcp.apps.updateModelContext
mcp.apps.requestPermission
```

`prepareView` returns:

- opaque sandbox URL;
- raw HTML as an inert string;
- normalized CSP/permission metadata;
- non-secret descriptor and host display data.

It never returns server auth headers, filesystem paths, raw server configuration, or another
conversation's data.

The request uses a local opaque descriptor record ID. Main resolves its stored `serverId`,
generation, and binding hash; it does not accept a server name/ID from the iframe as authority.

Use structural, bounded Zod schemas rather than `z.custom` for every Apps input and output. Route
handlers bind `RouteContext.webContentsId`/`windowId` to the sandbox registry before returning HTML
or dispatching an action.

Use existing preload route registration and `src/renderer/api/McpClient.ts`. Do not expose a generic
`postMessage`, shell, protocol, permission, or MCP request route.

## Phase 4: Trusted Sandbox Proxy

Create a small static proxy script based on the stable reference host:

1. load only from the opaque custom origin;
2. capture its parent window and expected origin;
3. announce `sandbox-proxy-ready`;
4. accept one matching `sandbox-resource-ready`;
5. create the inner iframe with fixed sandbox flags and granted `allow` features;
6. forward only valid non-sandbox-reserved MCP Apps messages;
7. enforce message byte limits and source/origin checks;
8. stop forwarding after teardown.

Bundle the proxy as project-owned audited code. Do not copy the basic host wholesale.

Security fixtures must inspect the actual CSP response header and nested origins in packaged
Electron, not only a string builder unit test.

The effective header includes `form-action 'none'`. A packaged malicious fixture must submit forms
to self, a declared origin, and an undeclared origin and prove that no request or navigation occurs.

## Phase 5: Renderer Host Component

Add:

- `McpAppView.vue` under the message/tool presentation area;
- a small `useMcpAppBridge` composable;
- a one-active-non-inline display coordinator;
- host-owned loading, failure, retry, origin, consent, and display controls.

`MessageBlockToolCall.vue` renders `McpAppView` only when the persisted/live result has a valid
descriptor. The normal text, image, diff, and detail UI remains the fallback.

The bridge:

- creates `AppBridge(null, ...)` in `shallowRef`/`markRaw`;
- validates every callback;
- sends lifecycle events in order;
- sends optional partial input only from bounded objects produced by the existing streaming argument
  parser;
- listens for theme/locale/container changes;
- performs bounded teardown on unmount;
- rejects pending calls after teardown.

Do not put bridge instances, MessagePort-like objects, iframe elements, pending request maps, or raw
HTML in Pinia.

## Phase 6: Read-Only Lifecycle Gate

Before enabling app-origin actions:

1. render a known local stable App fixture;
2. complete sandbox and App initialize handshakes;
3. send full input then result/cancel;
4. process size changes;
5. process host context changes;
6. teardown and rehydrate under message virtualization.

At this gate, advertise no Apps extension to production servers. Use fixture-only injection.
Within the Apps handshake, advertise only host actions, display modes, sandbox permissions, and
resource/tool proxies that have passed their corresponding gate.

## Phase 7: Host Action Handlers

### Tool And Resource

- Resolve requests from the main-side descriptor's immutable server identity.
- Reject a generation/binding mismatch and never look up execution authority by `serverName`.
- Resolve original tool names from the raw App catalog.
- Enforce `visibility.includes('app')`.
- Enter `ToolPermissionBroker` with main-derived conversation/server/tool/arguments identity and
  source `mcp-app`, including when no model turn is active.
- Suspend the App instance's tool channel after user denial; reject later automatic calls without a
  dialog until a host-owned Retry clears the suspension and re-enters the broker.
- Keep suspension in the main-owned App instance record, clear it on teardown, and never treat it
  as approval or persist it.
- Preserve cancellation and structured results.
- Restrict resource reads to the same server and validate size/content.

### Link And Message

- Normalize HTTP(S) URL in main and show a host confirmation.
- Submit app messages through the ordinary user-message flow after preview/confirmation.
- Prevent an App from marking content as assistant/system.

### Model Context

- Validate stable content types and bounded structured content.
- Store only the latest update per App descriptor.
- Show a host-owned preview and bind approval to the exact content hash.
- Add only approved content to the next model turn, never the current in-flight tool call.
- Invalidate approval whenever the App changes the payload.
- Clear or replace it on an explicit empty update.
- Make its server/App origin visible in context diagnostics.

### Logging

- Accept only bounded severity/message shapes.
- Redact payloads and rate-limit per instance.
- Keep logs out of conversation data.

## Phase 8: Display And Browser Permissions

Implement inline first. Then add fullscreen and renderer-floating pip through Vue `Teleport`, moving
the same component instance.

Add a per-instance permission grant controller:

1. intersect declared permissions with DeepChat support;
2. request user consent;
3. update the inner iframe `allow` policy before use;
4. route Electron permission request/check callbacks through one default-session policy that
   preserves the first-party audio recorder and verifies App token/origin/grant;
5. revoke on teardown.

Do not claim a display mode or permission in host capabilities until implemented.

## Phase 9: Compatibility Boundary

Install `@modelcontextprotocol/ext-apps@1.7.5` and its exact v1 peer
`@modelcontextprotocol/sdk@1.30.0`. Add import restrictions:

- `src/main/mcp/**` cannot import v1 SDK;
- shared MCP core types cannot import v1 SDK;
- renderer Apps code may import only public `@modelcontextprotocol/ext-apps` host exports;
- no DeepChat type exposes v1 Protocol.

Add a dependency test that fails if ext-apps changes its peer range or two incompatible App SDK
copies enter the bundle.

## Test Matrix

### Protocol

- nested/deprecated metadata;
- default and explicit visibility;
- resource validation;
- lifecycle ordering;
- input partial/full/result/cancel;
- display negotiation;
- teardown timeout;
- unknown/out-of-order methods.

### Security

- parent DOM and preload access;
- cookies/local/session storage isolation;
- top navigation and popups;
- `file:`, custom Electron schemes, and localhost wildcard;
- undeclared fetch/WebSocket/script/image/frame/base URI;
- CSP header presence and inheritance;
- message source/origin/instance spoofing;
- cross-server and model-only tool calls;
- descriptor generation/binding mismatch and display-name collision;
- form submission to self, declared, and undeclared origins under the effective header;
- oversized HTML/messages and pending-call exhaustion;
- permission grant/revocation.

### Renderer

- fallback text result;
- loading/offline/retry states;
- resize clamping and coalescing;
- keyboard/focus;
- theme/locale update;
- inline/fullscreen/pip DOM preservation;
- virtualized unmount/remount.

### Persistence

- bounded descriptor round trip;
- no HTML/token/grant/bridge state;
- last model-context replacement;
- server-offline reload.

### Packaged Electron

Run `MV-APP-01` through `MV-APP-03`, `MV-IDENTITY-01`, and `MV-SECURITY-01` from
`../../architecture/mcp-v2-protocol/manual-verification.md` on supported platforms. The exact
official Apps packages validate legacy-wire host compatibility. A DeepChat-owned modern App fixture
validates 2026 extension encoding, and owned benign/malicious fixtures validate the security
boundary.

Browser-only Vitest or jsdom tests are insufficient for the origin, CSP, permission, and preload
boundary. Public hosted Apps are comparison smokes, not the release gate.

## Failure And Rollback

Failure to validate or initialize an App affects only that view. Preserve the normal tool result and
provide retry/details. Repeated security violations revoke the instance.

The extension is one advertised capability. Rollback removes its advertisement and renderer host;
durable descriptors remain inert data that older code ignores. No destructive message migration is
required.
