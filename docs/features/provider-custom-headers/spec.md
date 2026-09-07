# Provider Custom Request Headers Spec

## Status

Implemented and validated on 2026-08-26.

## Context

DeepChat provider profiles currently persist an API type, API key, base URL, model settings, and a
small number of provider-specific fields. Runtime requests add DeepChat device headers and
transport-owned authentication headers, but users cannot attach supplemental HTTP headers required
by an API gateway, tenant router, or self-hosted proxy.

The settings renderer already owns provider configuration drafts, while the main process owns
provider persistence, validation, runtime instances, and outbound HTTP. Custom headers therefore
belong to the persisted provider profile and must cross the existing typed provider route; the
renderer must not implement request behavior.

The shell-backed provider settings page lets the model list grow with every model and currently
places Advanced after it. A large catalog therefore pushes unrelated provider settings far down the
page. Advanced belongs before Models so configuration remains reachable without changing the model
list's established outer-page scrolling behavior.

## Goals

- Let a user configure supplemental HTTP request headers as a JSON object on an HTTP(S) URL-backed
  provider profile.
- Apply the headers consistently to chat, model discovery, connection checks, embeddings, and
  media-generation requests made to that provider origin.
- Make invalid or unsafe header configuration impossible to persist through either the renderer or
  the main-process route.
- Preserve existing provider behavior when the field is absent.
- Keep custom header values out of logs, request traces, public CLI projections, and error text.
- Place Advanced before Models on shell-backed provider pages while preserving the model list's
  natural height and outer-page scrolling.

## Non-Goals

- Per-model, per-conversation, per-request, or MCP-server headers.
- Template or environment-variable expansion inside header values.
- Replacing the existing API-key, OAuth, AWS signing, or Google credential flows.
- Sending custom headers to OAuth/device-login endpoints or cross-origin media/download URLs.
- Supporting providers without a profile-owned HTTP(S) base URL, currently ACP and AWS Bedrock.
- Adding a new editor dependency; the renderer already ships Monaco and its JSON worker.
- Adding model pagination, changing model sort/filter behavior, or redesigning Ollama's separate
  model-management layout.

## User Experience

The JSON editor is not embedded in the settings page. A compact request-header row opens one
standalone dialog built from the existing `Dialog` and Monaco integration. Standard providers place
the row in Advanced settings, and the shared provider shell places Advanced before Models. Ollama
places the row below its connection fields because its detail page has no Advanced section. The
custom-provider creation flow places the same row after the connection fields so a
gateway-protected provider can be created successfully.

The row shows only `Not configured` or the configured header count and an Edit action. It never
previews values. This keeps credentials out of the normal settings surface and avoids making
Advanced tall merely because the JSON is long.

Before:

```text
+ Provider ---------------------------------------------------+
| Connection                                                  |
| API URL   [ https://gateway.example.com/v1              ]   |
| API Key   [ ******************************************** ]   |
|                                                             |
| Models                                                      |
| model-1                                                    | |
| model-2                                                    | |
| ...                                                        | |
| model-80                                                   | |
|                                                             |
| Advanced                                                [v] |
+-------------------------------------------------------------+
```

After:

```text
+ Provider ---------------------------------------------------+
| Connection                                                  |
| API URL   [ https://gateway.example.com/v1              ]   |
| API Key   [ ******************************************** ]   |
|                                                             |
| Advanced                                                [^] |
|   Rate limit                                                |
|                                                             |
|   Custom request headers        2 configured        [Edit]  |
|                                                             |
| Models                                      12/80 [Refresh] |
| +---------------------------------------------------------+ |
| | [ Search models... ] [Filter] [Sort] [Add]              | |
| | model-1                                                 | |
| | model-2                                                 | |
| | ...                                                     | |
| | model-80                                                | |
| +---------------------------------------------------------+ |
+-------------------------------------------------------------+

                    Edit opens a standalone dialog

        + Custom request headers ------------------------+
        | JSON object with string values        [Format] |
        | +---------------------------------------------+ |
        | | 1  {                                        | |
        | | 2    "X-Tenant-ID": "team-a",             | |
        | | 3    "CF-Access-Client-Id": "..."          | |
        | | 4  }                                        | |
        | +---------------------------------------------+ |
        | Validation message                              |
        |                              [Cancel] [Save]    |
        +-------------------------------------------------+
```

The dialog uses the existing `stream-monaco` wrapper with the JSON language worker, syntax
highlighting, line numbers, and two-space indentation. It is sized for roughly 16 lines inside a
body capped to the available window height. It starts with `{}`, formats persisted values when the
dialog opens, and only formats later edits through the explicit Format action. Validation still
runs as the user types. Save is disabled while the draft is invalid, unchanged, or being submitted.
A configured provider keeps the dialog open during the staged connection check; success closes it
and failure shows an inline error without changing the stored provider.

Opening the dialog always copies the currently persisted record into a dialog-local text draft.
Cancel, Escape, or closing the dialog discards that text without a second confirmation. Focus starts
in the JSON editor and returns to the Edit trigger on close. Switching providers closes the dialog and
prevents text from one profile from carrying into another.

In the custom-provider creation flow, dialog Save updates only the form's local parsed header record;
the provider is not persisted until Connect completes. The record is included in the draft validated
by `providers.validateDraft`. The compact row then reports the local header count.

### Settings Section Order

Shell-backed provider details render Connection, Advanced, and Models in that order. Advanced stays
collapsible and contains provider-specific controls, including custom request headers where
supported. Moving the section ahead of Models makes it reachable before a large catalog without
introducing a nested scroll region.

`ProviderModelList` keeps its natural height, existing sticky controls, filtering, sorting, mixed
custom and official rows, and page-mode virtualization against the outer settings scroll area. The
outer settings page remains the single vertical scroll owner.

## Data Contract

Add one optional provider field:

```ts
customHeaders?: Record<string, string>
```

Missing, `undefined`, and an empty object have the same runtime meaning. The field is stored in the
existing provider JSON payload; no schema migration or new storage entity is required. Existing
profiles remain valid and retain their current behavior.

`LlmProviderSchema` must declare and validate the field explicitly. Internal provider list/update and
draft-validation routes may carry it. Public CLI provider schemas and projections must continue to
omit it because values can contain credentials.

### Validation

Both renderer feedback and the main-process boundary use the same rules; main-process validation is
authoritative:

- the JSON root is a plain object, not `null` or an array;
- every value is a string;
- at most 64 headers are accepted;
- names are RFC HTTP field-name tokens, at most 128 characters, and unique case-insensitively;
- values are representable as HTTP `ByteString` values, contain no CR, LF, or NUL, and each value
  is at most 8 KiB;
- the complete UTF-8 encoded header map is at most 64 KiB;
- transport- and credential-owned names are rejected case-insensitively:
  `authorization`, `proxy-authorization`, `api-key`, `x-api-key`, `x-goog-api-key`,
  `content-type`, `content-length`, `host`, `connection`, `proxy-connection`,
  `transfer-encoding`, `upgrade`, `te`, `trailer`, and `keep-alive`.

The reserved list keeps the existing API-key/OAuth/signing fields authoritative and prevents body
framing or hop-by-hop headers from being corrupted by configuration. Additional authentication must
use a non-reserved gateway header.

## Runtime Design

### Ownership

- Renderer: open a provider-scoped dialog, edit its local JSON draft, show validation errors, submit
  a parsed header record, and keep Advanced ahead of Models in the shared provider shell.
- Provider store: stage configured-provider changes through the existing transient connection check,
  persist successful changes, refresh provider summaries, and invalidate stale health state.
- Shared contract: define the provider field and authoritative validation limits.
- Main provider runtime: merge and scope headers for outbound provider requests.
- Trace persistence: expose header names when useful but mask every user-configured value.

### Header Merge Order

For an eligible request, headers are resolved case-insensitively in this order:

1. DeepChat device defaults;
2. provider-definition defaults;
3. user custom headers;
4. request- and transport-owned authentication, content, and framing headers.

Validation prevents custom headers from colliding with layer 4. A custom header may override a
DeepChat or provider-definition supplemental header such as `HTTP-Referer` or `X-Title`.

Header merging must use the platform `Headers` implementation rather than object spread so casing
cannot create duplicate logical names.

### Origin Boundary

Custom headers are attached only when the actual request URL has the same origin as the profile's
configured HTTP(S) base URL. This includes derived API paths for chat, Responses, model discovery,
connection checks, embeddings, speech, image, and video operations.

They are not attached to:

- OAuth, device-login, or token-exchange endpoints;
- URLs returned by a provider for media hosted on another origin;
- ACP requests;
- AWS Bedrock requests without a profile-owned base URL.

Cross-origin redirects must not forward custom headers. Same-origin redirects may retain them.

A single main-process header resolver should own validation-normalized merging, origin comparison,
reserved-name enforcement, and trace masking. AI SDK fetch middleware and direct-fetch provider paths
must use that resolver rather than copying object-spread rules.

### Update and Verification Flow

```text
JSON draft
  -> renderer parse and shared validation
  -> providers.validateDraft with candidate customHeaders
  -> transient provider sends an origin-scoped connection check
  -> providers.update persists customHeaders on success
  -> live provider config updates before the next request
  -> provider health fingerprint includes canonical header names and values
```

An already configured provider follows the existing staged API-change behavior: failure does not
replace the stored headers. An unconfigured provider may persist a valid header map without a
successful connection and remains `not_checked`. Creating a custom provider validates the headers as
part of the draft before commit.

Changing headers does not require a process-wide refresh. The provider instance receives the updated
profile through the existing atomic-update event; the next request resolves headers from that profile.

## Security and Privacy Invariants

- Custom headers are sent only by the main process and never by renderer `fetch`.
- Header values are never interpolated into URLs, logs, notifications, or error messages.
- Header values are stored inside `provider_json` alongside `apiKey`; they have the same at-rest
  protection and are not encrypted as separate fields.
- Request traces mask every custom header value regardless of its name; relying only on the current
  fixed sensitive-header allowlist is insufficient.
- Public CLI provider list/update routes do not expose or mutate custom headers.
- Cross-origin media fetches and authentication flows do not receive provider custom headers.
- Invalid persisted legacy data is treated as no custom headers and must not crash provider startup;
  the next successful save writes canonical valid data.
- Existing API-key, OAuth, AWS, and Google credential precedence is unchanged.

## Compatibility

- Existing provider records need no migration because `customHeaders` is optional and lives in
  `provider_json`.
- Default provider definitions omit the field.
- Provider import sources that do not contain custom headers continue to behave unchanged.
- Provider ordering, model configuration, rate limiting, proxy behavior, and retry behavior are not
  modified.
- Updating DeepChat device headers or provider-definition headers remains independent of user custom
  headers.
- Shell-backed model lists retain their natural height, outer scroll owner, rows, filters, sort
  order, batch actions, and virtualization.

## Acceptance Criteria

- An HTTP(S) URL-backed provider shows a compact custom-request-header row that opens a standalone
  JSON editor dialog.
- The dialog restores the current record on every open, keeps invalid or failed submissions open,
  closes after a successful save, and discards unsaved text on Cancel or Escape.
- The custom-provider creation flow can validate and commit a provider that requires a supplemental
  gateway header.
- Valid string-valued JSON is persisted and restored exactly as a provider-level setting.
- Invalid JSON, non-string values, duplicate case-insensitive names, reserved names, injection
  characters, or size-limit violations cannot be saved.
- Saved custom headers are present on chat, connection-check, model-discovery, embedding, and
  supported media-generation requests to the configured provider origin.
- Transport-owned authentication and content headers keep their existing values.
- Custom headers are absent from cross-origin media/download and authentication requests.
- Changing headers invalidates a stale verified health result and applies to the next request.
- Request trace output contains no custom header value.
- Profiles without `customHeaders` behave byte-for-byte as before at the request-header layer.
- Advanced appears before Models on shell-backed provider pages, while the model list retains its
  natural height and the settings page remains the single vertical scroll owner.
- The virtualized official-model list retains its existing rendering and toggle behavior.
- Monaco provides editable JSON highlighting and formatting without adding an editor or runtime
  dependency.

## Open Questions

None. Authorization-header replacement, per-model headers, and variable expansion require separate
designs if requested later.
