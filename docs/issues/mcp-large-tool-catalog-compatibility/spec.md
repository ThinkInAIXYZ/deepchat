# Large MCP Tool Catalog Compatibility

Status: Implemented

GitHub issue: [#2085](https://github.com/ThinkInAIXYZ/deepchat/issues/2085)

## Issue

A connected external stdio server can expose a large but valid tool catalog and still appear in
DeepChat with zero tools. The report in #2085 uses 151 tools and an approximately 267 KB
`tools/list` response.

The transport and SDK limits are not the immediate bottleneck. DeepChat validates the complete
control response with one global JSON key and node budget before validating each tool. A catalog
whose individual tools are all within their limits can therefore exceed the aggregate 10,000-key
budget and fail discovery while the transport remains connected.

A local synthetic catalog matching the reported tool count and approximate byte size reproduces
this failure. Both the v1 SDK and the v2 SDK legacy result schema accept that fixture; DeepChat's
aggregate bounded-JSON check rejects it. The reporter's original payload is not available, so the
fixture proves the defective boundary and matching symptom, not that every field in the reported
payload is identical.

The v2 migration also introduced stricter host-side JSON Schema semantics for every protocol era.
For example, an external `$ref` accepted by both SDK legacy schemas is rejected by DeepChat after
the SDK response has already passed validation. That is a separate compatibility gap: modern
schema policy must not silently redefine the accepted legacy wire contract.

## Related Precedents

- [`7b50b1cc`](https://github.com/ThinkInAIXYZ/deepchat/commit/7b50b1cc50867258d351b13f7b5948f866c4788f)
  stopped treating JSON object prototypes and insertion order as protocol differences. It supports
  the same boundary principle, but it does not address catalog limits or legacy schema semantics.
- [`5814a04c`](https://github.com/ThinkInAIXYZ/deepchat/commit/5814a04c8937a4fc45975dcf0ca2b4646fad8fec)
  is the closer failure-isolation precedent: an optional invalid output schema no longer removes an
  otherwise usable tool. This issue still requires collection-aware limits rather than another
  schema exception.

## Impact

- A server can show `connected` while all of its tools are absent from the model-visible catalog.
- Catalog complexity grows with tool count, so otherwise ordinary schemas can fail only when
  combined into one response.
- User-configured legacy servers can lose tools solely because DeepChat applies modern-only schema
  semantics after legacy SDK validation.
- Raising the shared JSON limits would weaken unrelated trust boundaries such as tool arguments,
  route input, and individual tool results.

## Root Cause

`McpClient.listTools()` and `McpClient.listToolsPage()` call the generic control-result validator on
the complete `tools/list` object. The validator counts every nested key and node against constants
designed for one bounded JSON value. Only after that aggregate check does DeepChat call
`validateAndCloneMcpTool()` for each member.

The MCP App host applies another aggregate bounded-JSON check when returning the already validated
tool list. Fixing only `McpClient` would therefore leave a second catalog-wide key and node quota in
the App path.

Separately, `validateAndCloneMcpTool()` always applies DeepChat's modern dialect, reference, and
composition rules. It does not distinguish a negotiated external legacy connection from a modern
connection or a DeepChat-owned packaged catalog.

The v2 client also compiles a supplied `outputSchema` before every `callTool()` request, including
legacy-era calls. The v1 client did not enforce that schema. Passing an opaque legacy definition
back to v2 unchanged can therefore reject the call before it reaches the server.

## Required Behavior

### Collection And Member Budgets

- Keep the existing total serialized-size limit on every `tools/list` response.
- Keep JSON-only values, finite numbers, cycle rejection, and depth limits on the collection.
- Do not accumulate the fixed 10,000-key and 100,000-node limits across all tools in a catalog.
- Apply existing schema and metadata byte, key, node, depth, and composition limits independently
  to every tool through `validateAndCloneMcpTool()`.
- Apply the same collection policy to the MCP App tool-list boundary so a validated catalog is not
  rejected by a second aggregate complexity count.
- Preserve the current default aggregate limits for non-collection callers. Do not increase the
  global constants.

The smallest implementation is to let the existing bounded-JSON traversal select a collection
policy at the two tool-list boundaries. The default policy remains unchanged. Collection policy
still clones and validates the complete value and enforces its byte and depth bounds, while key and
node complexity is enforced on each tool member rather than accumulated across the catalog.

### Legacy Schema Compatibility

For a user-configured external connection whose negotiated protocol era is `legacy`:

- require input and output schemas to remain bounded JSON objects;
- preserve schema documents and references as opaque protocol data;
- never network-dereference `$ref` or `$dynamicRef` values;
- do not newly reject a tool solely for an older or unknown declared dialect, a remote reference,
  or a schema-composition shape that the legacy SDK accepted.
- retain the original output schema in DeepChat's tool definition, but do not opt the legacy call
  into the v2-only output-schema compiler.

Modern external connections keep the strict host-side dialect, reference, and composition checks.
DeepChat-owned built-in servers and packaged plugin catalogs also keep strict validation regardless
of their transport implementation because those definitions cross a separate local catalog trust
boundary.

The v2 SDK legacy response schema remains the parser. No parallel v1 client or permanent dual-SDK
adapter is part of this fix. If a captured server response later proves that the v2 SDK itself
rejects a legacy response that v1 accepted, that incompatibility needs a concrete fixture and a
separate SDK-boundary decision.

### Failure Semantics

Transport connection state and tool discovery remain distinct. A rejected tool list must continue
to surface as a discovery failure with the server name and violated boundary; this change does not
relabel an established transport as disconnected or add a new renderer diagnostics contract.

## Implementation Plan

1. Extend the bounded-JSON traversal options without changing default callers, adding the
   collection behavior needed by tool-list responses.
2. Use collection validation in `McpClient.listTools()`, `McpClient.listToolsPage()`, and the MCP App
   tool-list response boundary; retain their existing total byte caps.
3. Select tool-schema semantic validation from the connection owner and negotiated protocol era:
   strict for modern and DeepChat-owned catalogs, compatibility-preserving for external legacy
   servers.
4. Keep per-tool schema and metadata cloning and structural limits in both modes, while suppressing
   v2-only output-schema compilation at the external legacy call boundary.
5. Add focused regressions at the client, ToolManager, and App-host boundaries.

## Non-Goals

- Increasing stdio buffering or the 32 MB control-result cap.
- Increasing shared key or node limits globally.
- Restoring the monolithic v1 SDK or maintaining two MCP client implementations.
- Dereferencing or fetching remote schemas.
- Quarantining arbitrary malformed members while accepting the rest of a modern catalog.
- Redefining the MCP connection-state UI.

## Task Checklist

- [x] Add collection-aware bounded JSON validation with unchanged secure defaults.
- [x] Remove catalog-wide key and node accumulation from both MCP tool-list boundaries.
- [x] Preserve strict per-tool schema and metadata limits.
- [x] Gate modern schema semantics by connection ownership and negotiated protocol era.
- [x] Preserve legacy output schemas without enabling v2-only call-time compilation.
- [x] Add a 151-tool regression fixture above 10,000 aggregate keys and near 267 KB.
- [x] Cover direct `listTools`, paginated `listToolsPage`, ToolManager registration, and MCP App
      listing.
- [x] Cover modern, external legacy, and packaged-catalog schema policies.
- [x] Run formatting, i18n validation, lint, typecheck, and the focused MCP test suites.

## Validation

- A valid 151-tool response above 10,000 aggregate keys returns and registers all 151 tools in both
  modern and legacy client modes.
- The same catalog passes through the MCP App tool-list boundary without a second aggregate-key
  failure.
- A response above the existing total byte cap still fails before renderer or provider delivery.
- A single oversized schema, metadata object, or non-collection JSON value still fails at the
  current limits.
- An external legacy fixture containing a remote `$ref` or unsupported declared dialect remains
  opaque and usable without network access.
- Calling that legacy tool preserves the raw output schema in DeepChat while preventing the v2
  client from compiling it before dispatch.
- The equivalent modern fixture fails closed, and packaged catalog drift validation remains strict.
- Existing tool discovery, catalog verification, and MCP App tests remain green.
