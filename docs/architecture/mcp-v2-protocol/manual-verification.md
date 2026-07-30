# MCP v2 Ecosystem Manual Verification

Status: ready for human execution; no external case has been claimed as run. Research snapshot:
2026-07-29.

## Purpose

This runbook selects a small set of official, observable MCP servers for manual verification of
DeepChat's dual-era MCP core, MCP Apps host, and authorization modes. It does not replace focused
automated fixtures, and none of these servers should be called from CI.

The verification model has three tiers:

1. source-pinned or exact-version official local examples are the controlled interoperability gate;
2. public remote servers are same-day real-world smokes, not a stable baseline;
3. DeepChat-owned benign, malicious, and failure fixtures prove security and negative behavior that
   an external server cannot safely or deterministically prove.

A public endpoint may change, rate-limit, or disappear without a DeepChat change. Conversely, a
public smoke is a product failure when the same endpoint works in MCP Inspector during the same
session and DeepChat cannot complete the equivalent operation.

## Rules

- Run these steps manually from a packaged DeepChat build. Do not add public URLs, account
  credentials, or these procedures to an automated test runner.
- Use a clean test profile, disposable local processes, and test accounts or workspaces.
- Use read-only operations on public services. Never point the Linear checks at a production
  workspace.
- Pin every local source or npm package exactly. Do not substitute `latest`.
- An exact npm package can still declare ranged transitive dependencies. Record its published
  integrity and dependency metadata with the evidence, and review any change before comparing runs.
- Record the DeepChat commit, packaged version, OS, architecture, server source/version, transport,
  expected era, actual era, and result.
- Redact tokens, authorization codes, cookies, secrets, raw `Authorization` headers, and untrusted
  server error bodies from screenshots and logs.
- MCP Inspector is a same-day server preflight and comparison client, not a conformance oracle.
- Use DeepChat's MCP Tool Panel, Prompt Panel, and Resource Viewer for exact manual inputs whenever
  the case does not require a persisted chat tool block. For Apps and persisted-result cases, use a
  test model to create the tool block and record the model/provider.
- Stop a case if it would require bypassing SDK validation, modifying an external server, or
  weakening DeepChat's permission or sandbox policy.

Use these result states:

| State | Meaning |
| --- | --- |
| `PASS` | Every expected observable result occurred |
| `FAIL` | DeepChat behavior violated the expected result |
| `BLOCKED` | A named upstream API, test environment, or account prerequisite is unavailable |
| `ENVIRONMENT-DRIFT` | A public service or its documented contract changed during the run |
| `NOT-RUN` | The case was outside the current platform or feature scope |

Do not convert `BLOCKED` or `ENVIRONMENT-DRIFT` into `PASS`.

## Pinned Sources

| Source | Pin | Purpose |
| --- | --- | --- |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | `cc4b41617ce3601b1290d67216ea0b194a3cd9ac` (`@modelcontextprotocol/client` and `server` `2.0.0`) | Modern and dual-era core examples |
| [MCP reference servers](https://github.com/modelcontextprotocol/servers) | `6dd0a683e198783e30feabf7abaf42f925bd18b1` / npm `2026.7.4` | True v1 SDK legacy server |
| [MCP Apps extension](https://github.com/modelcontextprotocol/ext-apps) | `92f46a574568a3ddac7600343b7d3c4c4ed7b588` / npm `1.7.5` | Official Apps examples |
| [MCP Tasks extension](https://github.com/modelcontextprotocol/ext-tasks) | `2c1425d9a288b9b1f489430fe1e00bb392b47e48` | Upstream compatibility gate only |
| [MCP Inspector](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector) | npm `2.0.0` | Manual v2-capable preflight and comparison |

Prepare the TypeScript SDK examples once:

```bash
git clone https://github.com/modelcontextprotocol/typescript-sdk.git <sdk-checkout>
git -C <sdk-checkout> checkout cc4b41617ce3601b1290d67216ea0b194a3cd9ac
pnpm --dir <sdk-checkout> install --frozen-lockfile
```

Launch Inspector only when a same-day comparison is needed:

```bash
pnpm dlx @modelcontextprotocol/inspector@2.0.0
```

Inspector `2.0.0` is v2-capable but currently depends on v2 `2.0.0-beta.5` packages. It remains a
comparison client, not the release oracle; record its actual negotiated era/version.

Before launching any npm example, capture:

```bash
pnpm view <package>@<version> dist.integrity dependencies peerDependencies --json
```

For an SDK example over stdio, add a DeepChat server with:

```text
command: pnpm
args:
  - --dir
  - <sdk-checkout>
  - --filter
  - @mcp-examples/<story>
  - run
  - server
```

For HTTP, start the server in a terminal and use its printed `/mcp` endpoint:

```bash
pnpm --dir <sdk-checkout> --filter @mcp-examples/<story> run server -- --http --port <port>
```

Use a unique port per concurrently running story. The examples below assume `3101` and above.

## Selected Server Catalog

### Required Local Servers

| ID | Server | Era / transport | Observable coverage |
| --- | --- | --- | --- |
| `L-DUAL` | SDK `dual-era` | Modern or legacy; stdio and HTTP | Negotiation, era reporting, transport parity |
| `L-TOOLS` | SDK `tools` | Dual; stdio and HTTP | Raw schemas, annotations, output schema, structured content |
| `L-PROMPTS` | SDK `prompts` | Dual; stdio and HTTP | Prompt listing and rendering |
| `L-RESOURCES` | SDK `resources` | Dual; stdio and HTTP | Direct resource reads |
| `L-SAMPLING` | SDK `sampling` | Dual; stdio and HTTP | Host sampling approval and modern input-required flow |
| `L-MRTR` | SDK `mrtr` | Modern; stdio and HTTP | Multi-round form and URL input, opaque signed `requestState` |
| `L-CACHE` | SDK `caching` | Modern; stdio and HTTP | TTL, scope, refresh, and server-side counters |
| `L-SUB` | SDK `subscriptions` | Modern; stdio and HTTP | `subscriptions/listen` and list-change updates |
| `L-STREAM` | SDK `streaming` | Dual; stdio and HTTP | Cancellation and final structured result; progress is observed only if exposed by the host |
| `L-OAUTH` | SDK `oauth` | Dual; HTTP | External-browser authorization code + PKCE |
| `L-M2M` | SDK `oauth-client-credentials` | Dual; HTTP | `client_credentials` without a browser |
| `L-BEARER` | SDK `bearer-auth` | Dual; HTTP | Observable unauthenticated `401` classification |
| `L-EVERYTHING` | `@modelcontextprotocol/server-everything@2026.7.4` | Legacy; stdio, HTTP, and HTTP+SSE | v1 fallback and broad primitive compatibility |
| `A-DEBUG` | `@modelcontextprotocol/server-debug@1.7.5` | Legacy wire; stdio | Comprehensive Apps lifecycle and host callbacks |
| `A-BUDGET` | `@modelcontextprotocol/server-budget-allocator@1.7.5` | Legacy wire; stdio | Deterministic interactive App rendering |
| `A-MONITOR` | `@modelcontextprotocol/server-system-monitor@1.7.5` | Legacy wire; stdio | App-only tool calls and polling teardown |

The published Apps examples depend on `@modelcontextprotocol/sdk@^1.29.0`. They validate the Apps
host over the legacy wire; they do not prove modern 2026 extension encoding. A DeepChat-owned modern
App fixture remains required until an official v2 Apps example is published.

### Optional Local Server

| ID | Server | Use |
| --- | --- | --- |
| `A-MAP` | `@modelcontextprotocol/server-map@1.7.5` | Declared external-network/CSP smoke using OSM and Cesium; network-dependent |

### Public Remote Servers

| ID | Endpoint | Expected role at this snapshot |
| --- | --- | --- |
| `R-CLOUDFLARE` | `https://docs.mcp.cloudflare.com/mcp` | No-auth modern v2 smoke; contains `search_cloudflare_documentation` |
| `R-REFERENCE` | `https://example-server.modelcontextprotocol.io/mcp` | Official OAuth reference smoke for tools, resources, prompts, sampling, and elicitation |
| `R-REFERENCE-APP` | `https://example-server.modelcontextprotocol.io/{debug,budget-allocator,system-monitor,map}/mcp` | Hosted Apps fallback, subject to deployment drift |
| `R-LINEAR` | `https://mcp.linear.app/mcp/readonly` | Real OAuth 2.1/DCR read-only smoke |

Cloudflare's `/sse` URL is an alias to its stateless v2 handler and is not deprecated HTTP+SSE. It
must never be used as the legacy SSE case. Linear documents `https://mcp.linear.app/sse` as an
actual deprecated transport, but it is omitted from the required set because DeepChat's new OAuth
flow intentionally targets Streamable HTTP. `L-EVERYTHING` is the deterministic SSE gate.

The hosted feature reference server and hosted Apps examples cannot be pinned. Record their
observed server metadata and negotiated era instead of assuming the research snapshot still
matches.

These servers were selected for official ownership, fixed observable outputs, low setup cost, and
limited data risk. GitHub's remote MCP server and Context7 are valid extra spot checks, but they
duplicate OAuth/tool coverage while adding another account or key. Community Tasks servers are
excluded because they cannot satisfy the upstream public-adapter gate.

Research references:

- [SDK v2 runnable examples](https://github.com/modelcontextprotocol/typescript-sdk/tree/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/examples)
- [Everything server](https://github.com/modelcontextprotocol/servers/blob/6dd0a683e198783e30feabf7abaf42f925bd18b1/src/everything/README.md)
- [Official Apps examples](https://github.com/modelcontextprotocol/ext-apps/tree/92f46a574568a3ddac7600343b7d3c4c4ed7b588/examples)
- [Cloudflare documentation server](https://github.com/cloudflare/mcp-server-cloudflare/tree/main/apps/docs-ai-search)
- [Official hosted feature server](https://example-server.modelcontextprotocol.io/)
- [Hosted feature server source](https://github.com/modelcontextprotocol/example-remote-server)
- [Linear MCP documentation](https://linear.app/docs/mcp)
- [Enterprise-managed authorization](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization)

## Manual Preflight

Perform this once for every packaged build and platform:

1. Record the DeepChat commit, package version, OS, architecture, Node/pnpm versions used to launch
   local servers, and the clean profile location.
2. Confirm diagnostics are enabled and redact secrets by construction.
3. Confirm no unrelated MCP server with the same display name is configured.
4. Start only the server required by the case and record its exact command or public URL.
5. For a public endpoint, use Inspector to list its current capabilities and perform the same
   harmless operation before classifying a DeepChat failure.
6. Record Inspector's own negotiated era/version; a successful legacy connection is not a modern
   comparison.
7. Capture the expected and actual transport, protocol era/version, extension declarations, auth
   state, and fallback reason from DeepChat's server-card Diagnostics panel.
8. After each stdio case, disable/delete the server and verify the child process exits.

## Core And Data Cases

### `MV-CORE-01`: Modern HTTP Negotiation

Server: `L-DUAL`.

```bash
pnpm --dir <sdk-checkout> --filter @mcp-examples/dual-era run server -- --http --port 3101
```

1. Add `http://127.0.0.1:3101/mcp` as a Streamable HTTP server.
2. Enable it and inspect diagnostics.
3. Confirm the negotiated era is modern and the protocol revision is `2026-07-28`.
4. Call `greet` with `{ "name": "DeepChat" }`.
5. Confirm the result is
   `Hello, DeepChat! (served on the modern protocol era)`.
6. Disable and re-enable the server, then repeat the call.
7. Restart DeepChat and repeat once more.

Expected: no legacy fallback, stale session recovery, duplicate result, or manual initialize
lifecycle appears.

### `MV-CORE-02`: Modern Stdio Negotiation And Cleanup

Server: `L-DUAL` using the stdio configuration pattern.

1. Enable the server and confirm modern `2026-07-28` diagnostics.
2. Call `greet` with `{ "name": "DeepChat" }` and confirm the modern-era text.
3. Disable the server while idle and verify the child process exits.
4. Re-enable it, start another call, then stop the server during the call.
5. Confirm DeepChat reports one bounded failure and leaves no child process or pending tool block.
6. Re-enable and confirm a new call succeeds.

### `MV-CORE-03`: True Legacy Stdio, HTTP, And SSE

Server: `L-EVERYTHING`. Its pinned package depends on the monolithic v1 SDK.

For stdio, configure:

```text
command: pnpm
args:
  - dlx
  - @modelcontextprotocol/server-everything@2026.7.4
  - stdio
```

For each HTTP mode, start the process and use the exact endpoint printed by the server:

```bash
pnpm dlx @modelcontextprotocol/server-everything@2026.7.4 streamableHttp
pnpm dlx @modelcontextprotocol/server-everything@2026.7.4 sse
```

Select the SSE compatibility transport in the new-server form or import an existing SSE record.
Preserve the printed URL byte-for-byte.

1. Run the stdio configuration, then Streamable HTTP, then HTTP+SSE as separate cases.
2. Confirm diagnostics report legacy negotiation or the explicit legacy SSE path.
3. List tools, prompts, and resources.
4. Call `echo` with `{ "message": "DeepChat legacy" }` and confirm the same text returns once.
5. Call `get-sum` with `{ "a": 7, "b": 5 }` and confirm `12`.
6. Read one static resource and render one prompt.
7. Stop each server and confirm DeepChat recovers without an orphan process or stale session.

Do not call this server's SEP-1686 task tools. They are not the
`io.modelcontextprotocol/tasks` extension selected by the Tasks SDD.

### `MV-DATA-01`: Lossless Tool Schema And Result

Server: `L-TOOLS`.

1. Connect over modern stdio.
2. Inspect `calc` and confirm its raw definition retains `inputSchema`, `outputSchema`,
   `readOnlyHint`, and `idempotentHint`.
3. Call `calc` with `{ "op": "add", "a": 7, "b": 5 }`.
4. Confirm text content reports `12` and structured content is
   `{ "op": "add", "result": 12 }`.
5. Navigate away, reload the conversation, and restart DeepChat.
6. Confirm the persisted result still renders once with the same structured data.
7. Call `echo` to confirm a result without `structuredContent` remains valid.

Provider-specific schema reduction may be visible in diagnostics, but it must not mutate the raw
MCP definition.

### `MV-PRIMITIVES-01`: Prompts, Resources, And Updates

Servers: `L-PROMPTS` and `L-RESOURCES`.

1. Connect `L-PROMPTS` over modern stdio.
2. Confirm `review-code` is listed with `language` and `code` arguments.
3. Render the prompt with `language: "typescript"` and `code: "const n = 1"`.
4. Confirm the rendered result contains one user-role message with the selected language and code.
5. Connect `L-RESOURCES` over modern stdio.
6. Read `config://app` and confirm `{"feature":true}`.
7. Read `counter://value`, call `increment`, then read it again.
8. Confirm the second resource value equals the `increment` tool result.

### `MV-SAMPLING-01`: Host Sampling

Servers: `L-SAMPLING` for modern behavior and `L-EVERYTHING` for legacy behavior.

1. Select a disposable test model/provider and record it without recording provider credentials.
2. Connect `L-SAMPLING` over modern stdio and call `summarize` with a short fixed paragraph.
3. Reject the first sampling request and confirm no model request occurs and the tool terminates
   once with a clear denial.
4. Repeat, approve the request, and confirm exactly one model request and one non-empty tool result.
5. Confirm the modern path uses input-required continuation and does not emit a deprecated
   server-to-client sampling request.
6. Connect `L-EVERYTHING` over legacy stdio and call `trigger-sampling-request` with a short prompt.
7. Approve once and confirm the legacy push-style result completes once.
8. Confirm provider selection and permission behavior match existing DeepChat sampling policy in
   both eras.

Sampling text is nondeterministic. Assert lifecycle, approval, and non-empty content, not exact
wording.

### `MV-MRTR-01`: Multi-Round Form And URL Input

Server: `L-MRTR`.

1. Call `deploy` with `{ "env": "staging" }`.
2. Confirm a form asks whether to deploy to `staging`.
3. Cancel the host interaction and confirm the original SDK request is cancelled without another
   protocol round or duplicate tool result.
4. Start again, accept the form, and confirm the next interaction is the URL-mode sign-in request.
5. Reject the URL step and confirm one terminal error result.
6. Start a third call, accept both steps, and confirm `deployed to staging`.
7. Navigate away and back during an interaction; confirm only one active prompt is shown.

DeepChat must never display, persist, or log the opaque `requestState`.

### `MV-CACHE-01`: Cache TTL And Refresh

Server: `L-CACHE`.

1. Connect over modern HTTP or stdio.
2. Read `config://app` through the Resource Viewer.
3. Call `read-count` through the Tool Panel and record the value.
4. Read `config://app` again within its 60-second TTL.
5. Call `read-count` again and confirm it did not change.
6. Wait for the TTL to expire, read `config://app` again, and confirm `read-count` increments once.
7. Reconnect and confirm the per-client cache does not leak an old private entry into a new auth or
   server binding.

### `MV-SUB-01`: Tool List Subscription

Server: `L-SUB`.

1. Confirm `greet` and `flip_tools` are present and `farewell` is absent.
2. Call `flip_tools`.
3. Confirm `farewell` appears without reconnecting or manually refreshing.
4. Call `farewell` and confirm it returns a farewell.
5. Call `flip_tools` again and confirm `farewell` disappears without reconnecting.
6. Repeat once after a DeepChat restart to ensure only one active subscription exists.

### `MV-STREAM-01`: Cancellation And Finalization

Server: `L-STREAM`.

1. Call `countdown` with `{ "n": 20, "delayMs": 250 }`.
2. Cancel before completion.
3. Confirm the original SDK request stops, exactly one terminal cancelled/error presentation is
   shown, and no second tool call or stale pending block appears.
4. Run `{ "n": 3, "delayMs": 50 }` without cancellation.
5. Confirm one successful terminal result with
   `{ "completed": 3, "total": 3, "cancelled": false }`.

DeepChat does not expose a Logging UI. Record progress only when the packaged host
actually exposes it; lack of a progress visualization is not a failure for this case.

## MCP Apps Cases

### `MV-APP-01`: Comprehensive Host Lifecycle

Server: `A-DEBUG`.

```text
command: pnpm
args:
  - dlx
  - @modelcontextprotocol/server-debug@1.7.5
  - --stdio
```

1. Call `debug-tool` with its default input and open the App.
2. Confirm initialize completes before tool input/result delivery and the event log has no duplicate
   lifecycle event.
3. Exercise text, image, audio, resource, resource-link, mixed, multiple-block,
   `structuredContent`, `_meta`, delayed, and `isError` result variants.
4. Use the largest valid completed input offered by the example and confirm it is delivered exactly
   once after initialization. DeepChat does not advertise partial-input delivery for persisted
   completed tool blocks.
5. Exercise theme, locale, resize, host context, and every display mode DeepChat advertises.
6. Move inline to fullscreen to renderer PiP and back; confirm the same DOM/bridge instance and App
   state survive.
7. Exercise App requests for link opening, user message creation, model-context update, and
   a server tool call. Confirm every sensitive action uses host-owned preview/consent.
8. Confirm capabilities DeepChat does not implement, including file operations, are not advertised
   and fail without native side effects.
9. Deny a requested action and confirm the App receives a structured failure without closing.
10. Navigate far enough to virtualize/unmount the message, return, and confirm one clean rehydrate.
11. Reload the conversation and restart DeepChat; confirm the descriptor refetches the resource and
    no executable HTML was persisted in history.

### `MV-APP-02`: Deterministic Rendering And Display

Server: `A-BUDGET`.

```text
command: pnpm
args:
  - dlx
  - @modelcontextprotocol/server-budget-allocator@1.7.5
  - --stdio
```

1. Call `get-budget-data` and confirm the linked App opens.
2. Move every slider, change company stage, and select multiple budget presets.
3. Confirm totals, chart, sparklines, and percentile state update without another model-visible
   tool result.
4. Switch light/dark theme and resize through minimum and maximum host bounds.
5. Exercise inline/fullscreen/PiP and virtualized unmount/remount.
6. Confirm the normal text/tool result remains usable if the App is closed or fails to initialize.

### `MV-APP-03`: App-Only Tool And Teardown

Server: `A-MONITOR`. Run only on a disposable test machine because it exposes local system details.

```text
command: pnpm
args:
  - dlx
  - @modelcontextprotocol/server-system-monitor@1.7.5
  - --stdio
```

1. Select the test conversation's existing `auto_approve` agent/session permission mode.
2. Confirm `get-system-info` is model-visible and `poll-system-stats` is not exposed to the model.
3. Call `get-system-info`, open the App, and confirm metrics update about every two seconds.
4. Confirm App-origin `poll-system-stats` calls are evaluated by the source-aware permission broker,
   allowed by the session mode, and bound to this immutable server identity.
5. Close/unmount the App and confirm polling and pending calls stop.
6. Reopen under `default` permission mode and deny the first App-origin tool request.
7. Confirm metrics stop, the instance's tool channel becomes suspended, and later automatic polls
   do not reopen a permission dialog.
8. Use the host-owned Retry action and confirm the next call re-enters the broker with no retained
   approval.
9. Configure another server with a colliding display/tool name and confirm the App cannot call it.

### `MV-APP-04`: Declared External Network

Server: optional `A-MAP`.

```text
command: pnpm
args:
  - dlx
  - @modelcontextprotocol/server-map@1.7.5
  - --stdio
```

1. Call `geocode` with `{ "query": "Eiffel Tower" }`.
2. Pass a returned bounding box to `show-map`.
3. Open the host details surface and confirm the App declares the expected OSM/Cesium origins.
4. Confirm the globe loads and remains inside the sandbox.

Network failure makes this case `ENVIRONMENT-DRIFT`, not proof of a sandbox defect. The mandatory
undeclared-origin denial gate remains the DeepChat-owned malicious fixture.

## Authorization Cases

### `MV-AUTH-01`: Local Interactive OAuth

Server: `L-OAUTH`.

```bash
pnpm --dir <sdk-checkout> --filter @mcp-examples/oauth run server
```

1. Add `http://127.0.0.1:3000/mcp` without `OAUTH_DEMO_AUTO_CONSENT`.
2. Enable it and confirm DeepChat shows authentication required without opening a browser.
3. Click Authenticate and confirm the system browser, not an embedded window, opens.
4. Complete consent and confirm the callback page uses the specified DeepChat completion text.
5. Confirm the server connects and `whoami` returns authenticated identity/scope information.
6. Restart DeepChat. With secure safeStorage, confirm credentials are reused/refreshed; with
   unavailable or Linux `basic_text` storage, confirm `persistent: false` and explicit
   reauthentication.
7. Log out and confirm credentials are removed and the server returns to authentication required.

The four authorization-response `iss` cases require controlled fixtures and focused tests; this
happy-path server does not prove the full issuer matrix. The unavailable-listener paste fallback
also remains a focused loopback fixture unless a reviewed packaged-build fault injection exists;
the normal product flow binds the listener before opening the browser.

### `MV-AUTH-02`: Local Client Credentials

Server: `L-M2M`.

```bash
pnpm --dir <sdk-checkout> --filter @mcp-examples/oauth-client-credentials run server -- --http --port 3000
```

Configure:

```text
endpoint: http://127.0.0.1:3000/mcp
clientId: demo-m2m-client
clientSecret: demo-m2m-secret
scopes: mcp:tools mcp:read
```

1. Connect and confirm no browser opens.
2. Call `whoami` and confirm client ID `demo-m2m-client` and scope `mcp:tools`.
3. Replace the secret with an incorrect value.
4. Confirm a structured authorization error with secret-free credential status and no legacy-wire
   fallback.
5. Restore the secret and confirm a new token is acquired and the tool succeeds.
6. Restart DeepChat and confirm no secret appears in config, renderer state, diagnostics, or logs.

This server supports shared-secret client authentication only. It is not a
`private_key_jwt` validator.

### `MV-AUTH-03`: Real-World OAuth

Server: `R-LINEAR`. Use a disposable Linear workspace.

1. Add `https://mcp.linear.app/mcp/readonly`.
2. Confirm authentication required is shown without an automatically opened browser.
3. Authenticate in the system browser and run one read-only list/search tool.
4. Restart DeepChat and confirm reuse/refresh or required reauthentication matches the recorded
   safeStorage policy.
5. Log out and confirm the server cannot read workspace data.

Do not invoke a write-capable tool even if the remote catalog changes.

### `MV-AUTH-04`: Enterprise-Managed Authorization

There is no zero-configuration public enterprise authorization server. This case requires a
controlled Linear Enterprise workspace configured with Okta, or an equivalent controlled IdP and
MCP authorization server.

1. Record the IdP issuer, target resource server, both client registrations, and policy assignment
   without recording secrets.
2. Authenticate the user to the IdP in the external browser.
3. Confirm the IdP grant is exchanged for a target MCP token and a read-only tool succeeds.
4. Remove the user policy and confirm subsequent refresh/access is denied.
5. Rotate or remove the target authorization-server client secret and confirm only bound servers
   enter a structured error state.
6. Restore policy/secret and reauthenticate explicitly.

Report `BLOCKED` when the controlled enterprise environment is unavailable. Do not claim enterprise
support from unit fixtures or a profile form alone.

### `MV-AUTH-05`: Private Key JWT

The pinned SDK documents `PrivateKeyJwtProvider`, but its runnable M2M example authorization server
accepts only `client_secret_basic` and `client_secret_post`. Provision a controlled authorization
server that validates RFC 7523 client assertions before this case can pass.

1. Register a disposable client and public key for the expected algorithm.
2. Connect with the matching private key and confirm `whoami` or an equivalent protected tool.
3. Repeat with a wrong key, algorithm, audience, and expired assertion.
4. Confirm every failure is structured, redacted, and does not trigger protocol fallback.
5. Rotate the key and confirm old credentials are invalidated.

Report `BLOCKED` until such a server is available.

## Public Interoperability Cases

### `MV-REMOTE-01`: Zero-Account Modern Remote

Server: `R-CLOUDFLARE`.

1. Preflight the endpoint in Inspector.
2. Add the `/mcp` URL directly to DeepChat.
3. Confirm modern negotiation and no authentication prompt.
4. Confirm the catalog contains `search_cloudflare_documentation`.
5. Ask a harmless fixed documentation question and confirm a non-empty text result.
6. Disable/re-enable and restart DeepChat, then repeat the query.

Do not use Cloudflare's `/sse` alias as an SSE test.

### `MV-REMOTE-02`: Official Hosted Feature Reference

Servers: `R-REFERENCE` and, optionally, `R-REFERENCE-APP`.

1. Preflight `https://example-server.modelcontextprotocol.io/mcp` in Inspector and record current
   metadata/era.
2. Authenticate in DeepChat.
3. Call `echo` or `get-sum`, read one resource, and render one prompt.
4. Exercise one progress or elicitation operation without invoking its experimental Tasks tools.
5. Optionally connect `/debug/mcp` and `/budget-allocator/mcp` to repeat a reduced Apps smoke.
6. Compare the result with the pinned local server before assigning a DeepChat failure.

The public deployment is broad coverage, not a pinned release gate.

## Stable Identity And Negative Cases

### `MV-IDENTITY-01`: Rename And Re-Point

1. Connect `A-BUDGET`, produce one persisted App result, and record its redacted identity
   diagnostics.
2. Rename the server without changing its transport.
3. Reload the conversation and confirm the App rehydrates through the same immutable `serverId`.
4. Change the same server record's command/arguments to `A-DEBUG`.
5. Confirm generation/binding changes, the old App descriptor stays inert, and no old credential,
   permission grant, cache entry, or result is transferred.
6. Repeat with an App tool consent request open; re-point or disable the server before approving
   and confirm the request is denied/revoked and neither the old nor new server receives the call.
7. Repeat with a model-originated tool permission request open; re-point the server before approval
   and confirm final dispatch cancels because the authorized immutable target changed.
8. Restore the original `A-BUDGET` configuration as a new server record with the same display name.
9. Confirm display-name collision does not rebind the old descriptor.

### `MV-NEGATIVE-01`: Failure Classification

Use pinned local or DeepChat-owned failure fixtures, not public outages.

```bash
pnpm --dir <sdk-checkout> --filter @mcp-examples/bearer-auth run server -- --http --port 3110
```

1. Connect to a wrong local path and confirm a transport/configuration error, not legacy fallback.
2. Connect to `L-BEARER` without a token and confirm `401` enters auth handling,
   not legacy fallback.
3. Use owned endpoints that return `403` and `5xx`; confirm neither triggers legacy fallback.
4. Return a recognized modern protocol-version/method rejection and confirm one bounded fallback to
   legacy.
5. Kill a stdio/HTTP server during discovery and during a tool call.
6. Confirm one terminal failure, probe cleanup, no retry storm, and successful manual reconnect.

### `MV-SECURITY-01`: Owned Malicious Apps

Official Apps examples are benign and cannot prove denial behavior. The packaged gate must also run
DeepChat-owned Apps that attempt:

- parent DOM, preload, Electron IPC, cookie/storage, and filesystem access;
- top navigation, popups, custom schemes, and undeclared form submission;
- undeclared fetch, WebSocket, script, image, frame, and base URI;
- message source/origin/token/instance spoofing;
- cross-server or model-only tool calls;
- oversized HTML/messages and pending-call exhaustion;
- permission use after revocation or teardown.

Each attempt must fail without escaping the App instance. External examples do not replace this
case.

## Tasks Gate

### `MV-TASK-01`: Upstream-Blocked

No current official public package exposes the selected `io.modelcontextprotocol/tasks` result and
methods through the v2 client's public modern dispatch API. The v2 client rejects the draft task
result and reserved `tasks/*` methods before transport dispatch.

Therefore:

1. do not advertise Tasks;
2. do not use `@modelcontextprotocol/server-everything` SEP-1686 tools as a substitute;
3. do not select a community server that requires casts, monkey-patches, or a private transport;
4. report this case `BLOCKED`;
5. after the upstream gate passes, pin the official adapter and add a deterministic local server
   that completes after polls, sends notifications, requests input, ignores one cancellation before
   completion, returns failed state, and survives a client restart.

Core, Apps, and authorization may ship while this case is blocked, but DeepChat must not advertise
or claim MCP Tasks support.

## Platform Sweep

Run all pinned local core cases on macOS, Windows, and Linux packaged builds. For Apps:

- run `MV-APP-01`, `MV-APP-02`, `MV-APP-03`, and `MV-SECURITY-01` on every supported platform;
- run display mode, focus, keyboard, theme, permission, CSP, and preload checks in
  the packaged Electron runtime;
- verify Windows stdio command invocation and child cleanup without wrapping the command in an
  unreviewed shell;
- verify Linux safeStorage behavior both with a secure backend and with `basic_text`/unavailable
  storage;
- run public remote smokes on at least one platform per release candidate, then reproduce any
  DeepChat-specific failure on a second platform.

## Exit Criteria

The ecosystem verification is complete only when:

- every required pinned local case for the enabled feature is `PASS` on its required platforms;
- modern and legacy stdio/HTTP, actual legacy SSE, cache, subscriptions, MRTR, streaming, persisted
  results, Apps lifecycle, App-only calls, identity re-pointing, and process cleanup pass;
- owned failure and malicious-App fixtures pass;
- local interactive OAuth and client credentials pass;
- at least one current public modern endpoint and one current public OAuth/legacy endpoint complete
  a same-day smoke, or their outage is documented as `ENVIRONMENT-DRIFT` with Inspector evidence;
- no public service failure is used to hide a failure reproducible against a pinned local server;
- Tasks remains unadvertised while `MV-TASK-01` is blocked;
- private key JWT and enterprise authorization are not claimed until their controlled manual cases
  pass.

## Evidence Record

Copy this block into the release evidence, not into this runbook:

```text
Case:
Result: PASS | FAIL | BLOCKED | ENVIRONMENT-DRIFT | NOT-RUN
DeepChat commit/version:
OS/architecture:
Server ID and source:
Server pin or observed timestamp:
Package integrity/dependency metadata:
Command or redacted endpoint:
Transport:
Expected era/version:
Actual era/version:
Expected observable result:
Actual observable result:
Inspector comparison, if public:
Inspector negotiated era/version:
Redacted diagnostics/screenshots:
Child-process cleanup:
Notes and follow-up issue:
Tester/date:
```
