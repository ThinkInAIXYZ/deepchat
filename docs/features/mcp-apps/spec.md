# MCP Apps Host Support

Status: implemented and repository-validated; external manual interoperability and packaged
sandbox verification remain pending.

## User Need

MCP tools can return structured data that is awkward or impossible to use through a text-only tool
block. DeepChat will support the stable MCP Apps extension so an MCP server can attach a
sandboxed, interactive `ui://` view to a tool result.

An MCP App is untrusted executable web content. It must never run in DeepChat's renderer origin,
inherit the renderer preload, access conversation state directly, or bypass the existing tool and
user-consent boundaries.

## Standard Baseline

- Extension identifier: `io.modelcontextprotocol/ui`
- Stable Apps specification: `2026-01-26`
- Resource MIME type: `text/html;profile=mcp-app`
- SDK: `@modelcontextprotocol/ext-apps@1.7.5`
- Official documentation:
  https://modelcontextprotocol.io/extensions/apps/overview
- Stable specification:
  https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- SDK and basic host:
  https://github.com/modelcontextprotocol/ext-apps

The SDK repository explicitly provides `AppBridge` and a basic host example, not a supported
turnkey production host. DeepChat owns its Electron sandbox, permission, persistence, and
conversation integration.

## Implemented State

- Raw nested and deprecated App metadata, visibility, schemas, and bounded tool results are
  preserved through the v2 client and assistant-block `extra_json`.
- `MessageBlockToolCall.vue` mounts `McpAppView.vue` only from a persisted, non-executable
  descriptor whose immutable server binding still matches.
- A secure `mcp-app` custom origin serves a fixed double-iframe proxy. Server HTML never enters the
  DeepChat renderer DOM or renderer origin.
- Typed, sender-bound routes mediate same-server tools/resources, links, conversation messages,
  model-context updates, display, consent, retry, and teardown.
- The source-aware main-process `ToolPermissionBroker` owns both model- and App-origin tool
  permission decisions; MCP server `autoApprove` no longer exists.
- Camera, microphone, geolocation, and clipboard-write remain deny-by-default and are scoped to one
  live App instance. The explicit first-party audio-recorder microphone branch remains intact.
- Inline, fullscreen, and renderer-floating PiP preserve one AppBridge/iframe instance.

## Supported Protocol Surface

### Discovery

DeepChat advertises:

```json
{
  "io.modelcontextprotocol/ui": {
    "mimeTypes": ["text/html;profile=mcp-app"]
  }
}
```

The v2 SDK owns the modern per-request and legacy capability encoding.

For each tool, preserve:

- nested `_meta.ui.resourceUri`;
- deprecated flat `_meta["ui/resourceUri"]` as read-only compatibility;
- `_meta.ui.visibility`;
- the complete raw tool definition.

Nested metadata wins if both resource URI forms are present. A malformed or non-`ui://` URI disables
the App view for that tool but does not remove the text tool.

Visibility defaults to `["model", "app"]`:

- tools without `"model"` are excluded from the model's tool list;
- app-origin calls require `"app"`;
- an app may call only tools from the MCP server that created its view;
- DeepChat ignores any server identity supplied by the app and binds calls to the view descriptor.

### Resource

Read the declared `ui://` resource through the bound MCP client. Require exactly one matching
content item with:

- the requested URI;
- `text/html;profile=mcp-app`;
- either text or decoded base64 HTML;
- at most 2 MiB decoded HTML;
- normalized `_meta.ui.csp`, `_meta.ui.permissions`, `_meta.ui.domain`, and
  `_meta.ui.prefersBorder`.

Never persist the executable HTML in conversation data. Each view preparation reads through the
bound v2 client, whose SDK cache honors response TTL and invalidation. HTML remains only on the
ephemeral sandbox instance. A conversation reload refetches or revalidates the resource. If the
server is unavailable, keep the existing text/structured result and expose the host retry state.

### App/Host Lifecycle

Implement the stable lifecycle in order:

1. sandbox proxy sends `ui/notifications/sandbox-proxy-ready`;
2. host sends `ui/notifications/sandbox-resource-ready`;
3. view sends `ui/initialize`;
4. host returns its capabilities, info, and context;
5. view sends `ui/notifications/initialized`;
6. host sends the persisted complete tool input, then the completed tool result;
7. host sends context/theme/size updates as needed;
8. host requests `ui/resource-teardown` before unmount and waits for a bounded response.

Do not send view lifecycle or result messages before `initialized`. The teardown wait is capped at
500 ms so a hostile view cannot block navigation or virtualized unmount.

Support:

- `tools/call`;
- `resources/read`;
- `ping`;
- `ui/open-link`;
- `ui/message`;
- `ui/update-model-context`;
- `ui/request-display-mode`;
- `ui/notifications/tool-input`;
- `ui/notifications/tool-result`;
- `ui/notifications/size-changed`;
- `ui/notifications/host-context-changed`;
- `ui/resource-teardown`.

Unknown valid methods receive a method-not-found response. Malformed, oversized, spoofed, or
out-of-order messages are rejected without forwarding.

DeepChat mounts an App from a completed, persisted tool block. It therefore emits no partial-input
or cancellation notification and sends complete input plus the completed result exactly once.
Optional App sampling, downloads, App-provided tools, and list-change advertisements are not
declared by this host.

## Electron Sandbox Architecture

Use the specification's double-iframe architecture:

```text
DeepChat renderer origin
  |
  | validated postMessage only
  v
mcp-app://<opaque-instance-token>/sandbox.html
  trusted fixed sandbox proxy, separate origin
  sandbox="allow-scripts allow-same-origin"
  |
  | validated MCP Apps messages only
  v
inner iframe
  untrusted server HTML
  sandbox="allow-scripts allow-same-origin allow-forms"
  permissions restricted by host policy
```

Register the standard, secure custom scheme before Electron is ready. Do not grant bypass-CSP,
service-worker, or broad CORS privileges. Use `protocol.handle` to return a fixed audited proxy and
a CSP HTTP response header derived from the validated resource metadata.

Every App instance gets a cryptographically random hostname token. The main-side record is bound to
the creating renderer WebContents, conversation, message block, server, tool, resource URI, and
expiry. URLs contain no raw HTML, CSP data, server URL, conversation ID, or secret.

The custom-protocol request itself does not identify its owning WebContents. Its handler validates
only token existence/expiry and serves no App data beyond the fixed proxy plus policy header.
WebContents/window binding is enforced by typed route `RouteContext` and the bridge's window,
source, origin, and token checks before raw HTML or host actions are released.

The outer and inner frames may share their isolated token origin; neither shares DeepChat's
renderer origin. A server-requested `_meta.ui.domain` is advisory. DeepChat never loads an
arbitrary requested host as the sandbox origin; it maps the request to its own opaque origin.

The renderer passes raw HTML only as the data field of
`ui/notifications/sandbox-resource-ready` after the proxy proves its window, source, origin, and
instance token. It never uses `v-html`, host-renderer `srcdoc`, `document.write`, or DOM parsing for
that HTML.

### CSP

Build a response-header CSP from declared domains:

- `default-src 'none'`;
- scripts and styles: isolated self, `'unsafe-inline'`, plus the declared `resourceDomains` as
  required by the stable Apps profile;
- images/media: isolated self, `data:`, plus declared resource domains;
- fonts: isolated self plus declared resource domains;
- connections: declared `connectDomains` only;
- frames: declared `frameDomains`, otherwise `'none'`;
- `base-uri`: declared `baseUriDomains`, otherwise isolated self;
- `object-src 'none'`;
- `form-action 'none'`;
- no host renderer origin, `file:`, Electron internals, localhost wildcard, or undeclared origin.

Normalize exact HTTPS/WSS origins and documented wildcard subdomains. Reject credentials, paths,
fragments, broad `*`, non-network schemes, and malformed values. The host may further restrict a
valid declaration and reports the granted policy in `hostCapabilities.sandbox`.

Do not rely on a CSP `<meta>` element supplied by the app.

### Permissions

Apps may request camera, microphone, geolocation, and clipboard write. Default is deny.

- Map only declared and user-approved permissions into the inner iframe `allow` attribute.
- Install one default-session permission request/check router that verifies the active opaque App
  origin, WebContents, requested media type, and current grant.
- Preserve the existing first-party audio-recorder microphone behavior through an explicit
  first-party branch and regression tests; deny every other unmatched origin/capability.
- Ask with a localized host-owned dialog before first grant.
- Grant per App instance, not per MCP server forever.
- Revoke on teardown, navigation, renderer destruction, or token expiry.
- Never grant notifications, MIDI, HID, serial, USB, Bluetooth, filesystem, screen capture, or
  unrestricted clipboard access through this feature.

## Host Actions And Consent

Every app-origin request is untrusted:

| Request | Host behavior |
| --- | --- |
| `tools/call` | Bind to the originating server, verify live definition/app visibility/plugin policy, enter the source-aware `ToolPermissionBroker`, then call that exact bound MCP client |
| `resources/read` | Bind to the originating server and enforce URI/size/content limits |
| `ui/open-link` | Allow only normalized HTTP(S); show a host-owned confirmation before `shell.openExternal` |
| `ui/message` | Show a host-owned preview/confirmation, then add one user message through the normal conversation path |
| `ui/update-model-context` | Validate and bound content; show a host-owned preview; use only a user-approved content hash on a future turn |
| `ui/request-display-mode` | Intersect app and host capabilities and return the actual mode |

MCP-specific `autoApprove` is not restored. App-origin tool calls use the source-aware main-process
broker defined by `docs/architecture/remove-mcp-permission-system/`. An App call may occur outside
an active model turn, so main derives its conversation,
immutable server identity, tool, and arguments hash from the sandbox descriptor and passes source
`mcp-app` to the broker. The App cannot provide or reuse approval identity.

Polling Apps must not create a permission-dialog storm. If the user denies an App-origin
`tools/call`, main marks that App instance's tool channel suspended, returns a structured
denial, and rejects later App-origin tool calls for that instance without opening another dialog. A
host-owned Retry action clears only the suspension and sends the next call through the broker again;
it does not approve the call. Teardown clears the suspension. This is ephemeral execution state,
not an App grant, MCP permission cache, or persisted decision.

Continuous polling succeeds without prompts only when the current agent/session permission mode
already permits it, such as `auto_approve` or `full_access`. A one-time approval in `default` mode
does not become an App-instance grant.

```text
+------------------------------------------------------+
| Interactive content                                  |
| Tool access is paused after permission was denied.   |
| The App stays visible but cannot call server tools.  |
|                                      [Retry access]  |
+------------------------------------------------------+
```

## Host Context And Display

Provide:

- light/dark theme;
- BCP 47 locale;
- IANA timezone;
- desktop platform and pointer capabilities;
- bounded container dimensions and safe-area insets;
- standardized style variables already represented by DeepChat tokens;
- `inline`, `fullscreen`, and renderer-floating `pip` display modes.

`pip` means a floating panel inside the DeepChat renderer. It does not use the NativeKit Agent
Browser PiP or create a new native BrowserWindow. The same iframe component is moved with Vue
`Teleport`, preserving the bridge and DOM instance across inline/fullscreen/pip transitions.

Only one non-inline MCP App is active per DeepChat window. A small renderer coordinator owns that
identity; bridge instances and app state remain component-local in `shallowRef`/`markRaw`, not
Pinia.

Size changes are clamped to the current container, coalesced once per animation frame, and ignored
when invalid or excessive. Inline views use a host minimum of 120 px and maximum of 800 px height
unless the available viewport is smaller.

## Persistence And Rehydration

Persist a non-executable result envelope in the tool block `extra_json`:

```ts
interface McpAppDescriptor {
  schemaVersion: 1
  serverId: string
  configGeneration: number
  bindingHash: string
  serverName: string
  toolName: string
  resourceUri: string
  resourceMimeType: 'text/html;profile=mcp-app'
}

interface PersistedMcpToolResult {
  schemaVersion: 1
  serverId: string
  configGeneration: number
  bindingHash: string
  toolName: string
  content?: MCPContentItem[]
  structuredContent?: unknown
  meta?: Record<string, unknown>
  app?: McpAppDescriptor
  modelContext?: {
    content?: MCPContentItem[]
    structuredContent?: Record<string, unknown>
    approvedHash?: string
  }
}
```

`serverName` is a display snapshot only. On prepare/remount, main resolves `serverId` and requires
an exact generation and binding-hash match. A rename may refresh the label; a re-pointed, removed,
or mismatched server leaves the descriptor inert and preserves the text/structured result. No App
action may select a server from renderer- or iframe-supplied identity.

Every host action rechecks the binding after asynchronous server reads or user consent and
immediately before dispatch. Disabling, removing, reconfiguring, plugin-unregistering, or
OAuth-finalizing a server revokes all of its live App instances and resolves pending consent as
denied.

Apply explicit byte and nesting limits before persistence. Do not persist HTML, sandbox tokens,
permission grants, bridge request IDs, logs, or temporary display mode.

Every context update invalidates the prior approval until the user approves the new content hash.
An unapproved update may be displayed but never enters provider context. Approval is scoped to one
descriptor and one exact payload, not the server or future updates.

When a virtualized message unmounts:

1. request teardown;
2. reject pending bridge calls;
3. revoke permissions and token;
4. revoke the ephemeral instance and its HTML.

When it remounts:

1. refetch/validate the `ui://` resource;
2. create a new token and bridge;
3. initialize;
4. replay complete tool input and result exactly once.

## Package Compatibility Boundary

`@modelcontextprotocol/ext-apps@1.7.5` currently peers with
`@modelcontextprotocol/sdk@1.30.0`. DeepChat keeps that exact v1 package installed only to satisfy
the Apps SDK while MCP core moves to v2.

Instantiate `AppBridge(null, ...)` and implement its host handlers with plain validated JSON through
DeepChat's typed routes. Never pass the v2 MCP `Client` to `AppBridge`, import v1 Protocol into
main MCP code, or share v1/v2 schema objects across the boundary.

When ext-apps publishes v2-compatible host packages, remove this boundary in a focused dependency
migration.

## UI Shape

Before:

```text
+------------------------------------------------------+
| Tool · sales_report                                  |
| Completed                                            |
| {"regions":[...],"total":183029}                     |
| [Show details]                                       |
+------------------------------------------------------+
```

After:

```text
+------------------------------------------------------+
| Tool · sales_report                    [Expand] [...] |
| Completed                                            |
| +--------------------------------------------------+ |
| | Sales by region                                  | |
| |                                                  | |
| |   North  ################  42%                   | |
| |   South  ###########       29%                   | |
| |   West   ########          21%                   | |
| |   East   ###               8%                    | |
| |                                                  | |
| | [Revenue v] [Quarter v]                          | |
| +--------------------------------------------------+ |
| Interactive content from analytics.example          |
+------------------------------------------------------+

+------------------------------------------------------+
| Interactive content requests camera access           |
| Server: analytics.example                            |
| View: ui://analytics/scanner                         |
|                                                      |
|                         [Deny] [Allow this view]      |
+------------------------------------------------------+
```

The host supplies a visible boundary unless the resource explicitly prefers no border and the
surrounding tool block still communicates origin. The server identity and interactive-content
status remain visible in fullscreen and pip. A details surface lists the effective normalized CSP
origins and declared sensitive permissions before the user interacts with the view.

## Accessibility

- The outer host controls an accessible title, server label, loading/error state, and display-mode
  controls.
- Keyboard focus enters and leaves the iframe predictably.
- Escape returns fullscreen/pip to inline before closing any parent dialog.
- Host permission/confirmation dialogs trap and restore focus.
- Size updates do not move focus or cause unbounded layout shift.
- DeepChat cannot repair inaccessible third-party HTML, but it must not remove browser accessibility
  APIs from the sandbox.

## Resource Limits

- 2 MiB decoded HTML per resource.
- 20 MiB serialized proxy JSON-RPC message.
- 2 MiB per App action/list/resource payload, 8 MiB per App tool result, and 256 KiB per
  model-context update.
- 64 live App instances process-wide and 32 per renderer WebContents.
- 64 pending host consent or permission requests, each with a 2-minute timeout.
- No raw HTML, result payload, model context, or user message in routine logs.

## Non-Goals

- No direct remote URL Apps; only MCP `ui://` resources with the stable MIME type.
- No trust based solely on server name, description, or HTML hash.
- No direct access to preload, Electron IPC, filesystem, shell, cookies, or conversation stores.
- No custom Apps protocol or fork of the SDK.
- No App logging capability until a bounded redacted diagnostics sink exists.
- No persistence of executable App content.
- No cross-server app tool calls.
- No background App that remains alive after its tool block/window is gone.
- No reuse of current artifact iframes or native Agent Browser PiP.

## Acceptance Criteria

- A stable MCP App tool renders inline after normal tool execution.
- Nested and deprecated resource URI metadata are read with deterministic precedence.
- Model-only and app-only tool visibility is enforced at both listing and call time.
- The resource MIME, URI, byte limit, CSP, permissions, and origin are validated.
- Untrusted HTML never enters the DeepChat renderer DOM or origin.
- The double iframe passes parent DOM, cookie/storage, top-navigation, popup, file, Electron API,
  undeclared-network, and message-spoofing attack fixtures.
- Form submissions cannot exfiltrate to self, declared, or undeclared origins because the effective
  response-header policy contains `form-action 'none'`.
- App-origin tools use the source-aware single permission broker and cannot select another server,
  conversation, tool, or changed argument payload.
- Denying one App-origin tool call suspends that instance's tool channel until host-owned retry,
  preventing automatic polling from reopening permission dialogs without creating a grant/cache.
- Link, message, and sensitive browser capabilities require host-owned consent.
- Initialize, completed input/result, context, display, size, and teardown ordering matches the stable
  protocol.
- Inline/fullscreen/pip transitions retain one bridge and return the actual granted mode.
- Virtualized unmount tears down; remount refetches and replays input/result once.
- Reloaded conversations render from a bounded descriptor without persisted HTML.
- Rename preserves App binding; server re-pointing or generation/binding mismatch leaves the
  descriptor inert.
- A missing/offline server leaves the text/structured result and a retry state.
- No v1 SDK object crosses into v2 MCP core.
- Format, i18n validation, lint, typecheck, focused main/renderer tests, malicious App fixtures, and
  packaged Electron smokes pass.
