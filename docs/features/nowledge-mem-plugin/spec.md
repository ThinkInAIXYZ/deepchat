# Nowledge Mem plugin

## Contract

DeepChat provides an optional official Nowledge Mem plugin containing Skills and a native HTTP MCP
connection. Users enter a server address and an optional API key. The verified connection supplies
both MCP tools and REST conversation exports. Requests capture their destination before asynchronous
work; an export confirmation cannot silently follow a changed destination.

## Ownership

The main-process Nowledge connection service owns endpoint resolution, verification, connection
settings, credential references and legacy import. Credentials use the existing SecretStore, bound
to the full API and MCP destinations. The official plugin host registers HTTP servers and Skills;
the existing MCP client resolves credentials only at connection time. The conversation exporter
uses the same connection service. Renderer forms use typed plugin action payloads and never receive
stored keys. No new dependency, CLI installation, global nmem config edits or local-server fallback
is needed. DeepChat Skills use host MCP tools and the host export action, not unscoped nmem commands.

## Endpoints and authentication

The address defaults to http://127.0.0.1:14242 and accepts HTTP or HTTPS addresses, including LAN
hosts, server roots, API prefixes and MCP URLs. No local/remote category restricts the address.
API keys are optional; verification determines whether the server requires authentication. Root
API routes are tried first, then /remote-api only on an unavailable REST route (404). Authentication,
network and TLS failures stop verification. Credentials are never forwarded across origins or
redirects. URL credentials, query and fragment are rejected. Saved effective API/MCP endpoints are
preserved when re-verifying the same address.

Saving verifies health, an authenticated REST read, MCP initialization and one read-only Mem tool
call before committing settings. Failed verification leaves the previous connection usable. Saved
credentials are reusable only for the identical API/MCP destinations. Old destination credentials
are retained on a switch. Unchanged keys reuse their entry; a successful rotation deletes the
superseded key for that destination. Clear connection disables the plugin and removes every
saved connection and retained credential. The bundled official plugin has no uninstall action.
Keys and upstream response bodies never appear in diagnostic output.

If verification and persistence succeed but plugin activation fails, the saved state is returned
with an activation warning. The plugin is disabled and partially registered resources are removed;
re-enabling retries activation without re-saving credentials. Connection state and wrapped keys
are machine-local: backups omit them, and imports preserve the receiving computer's values.

Invalid plugin manifests and packages are isolated during discovery. When a valid official source
exists, an obsolete or corrupt installed manifest is replaced while preserving plugin configuration.
Plugin host initialization failures are logged as component failures; they do not abort Skills,
MCP initialization or the main application startup.

## Compatibility

Existing export and MCP configurations are shown as explicit import candidates when no plugin
connection is saved. Previous profile-based settings retain their selected export destination as
the shared connection and preserve all destination-bound credentials. Import does not
silently choose between different services, overwrite a connection or remove a user-managed MCP
server. An imported export key is removed from the legacy plaintext setting only after encrypted
storage succeeds. Users can retire the old MCP entry after checking the new plugin. The old knowledge
settings entry links to the plugin. Existing export APIs return redacted configuration and direct
configuration changes to the plugin. Conversation exports use a stable `deepchat-<session-id>`
thread ID, with the title kept as metadata. The explicitly requested export uses the documented `/threads/import` endpoint for replay-safe
imports and missing-message appends; a matching thread ID and acknowledged message count are required before
reporting successful export. The current chat menu has a separate Send to Nowledge Mem action. It
shows the session title and API destination for confirmation, exports committed messages only, and
rejects a changed destination before sending. Existing JSON download remains available.

## UI

Plugin catalog, detail, settings and MCP entries use the official logo from
https://mem.nowledge.co/images/nowledge-mem-logo.webp, bundled locally for offline rendering.
The product summary paraphrases the introduction at https://mem.nowledge.co/ and is localized
through vue-i18n. Publisher metadata remains separate from the displayed product introduction.

```text
BEFORE
MCP settings       -> Nowledge URL / headers
Knowledge settings -> Nowledge API URL / key

AFTER
Plugins > Nowledge Mem
  Server URL          [...]
  API key (optional)  [...]
  [Verify and save]
  Changing an existing address asks for confirmation when saving.
  Existing settings: [Load configuration], when no connection is saved
  [Clear connection] -> Confirm deletion
Chat menu > Send to Nowledge Mem > Confirm session and destination > Send
```

The settings component owns its draft, busy state, error and dirty guard. It is embedded in the
existing plugin detail ScrollArea or the settings-window plugin page; no window or overlay is added. Inputs have labels, secrets are
password fields, pending operations disable conflicting actions, and discarded drafts are cleared.

## Acceptance

- Localhost, LAN and remote server addresses use the same two-field form.
- API keys may be omitted when the server permits unauthenticated access.
- API exports and MCP use the same selected connection credentials without plaintext duplication.
- Remote auth/connectivity errors never select localhost or commit a failed configuration.
- Updating a destination does not reuse another destination's credential.
- Plugin enable/disable and app restart restore the same verified connections.
- Both standard /mcp and legacy /remote-api/mcp deployments are supported.
- Packaging includes the plugin on every supported OS/architecture.
- The manual verification guide covers local/remote success, failure, migration and restart.

Connection labels are translated in Simplified and Traditional Chinese; other locales currently
use English fallback copy for this feature. Main-process diagnostic errors remain technical text.

Thread import contract: https://mem.nowledge.co/docs/api/threads/import/post. A server without
this endpoint returns an upgrade error; export never falls back to a non-idempotent create.
