# Nowledge Mem plugin

## Contract

DeepChat provides an optional official Nowledge Mem plugin containing Skills and native HTTP MCP
connections. Local and remote connections are saved independently. Each verified connection has a
separate MCP server, selectable through existing agent/session MCP controls. An explicit default
selects the REST conversation-export destination. Changing that default does not change MCP
selection. Requests capture their destination before asynchronous work; stale MCP tool identities
must fail rather than execute against another server.

## Ownership

The main-process Nowledge connection service owns endpoint resolution, verification, connection
settings, credential references and legacy import. Credentials use the existing SecretStore, bound
to the full API and MCP destinations. The official plugin host registers HTTP servers and Skills;
the existing MCP client resolves credentials only at connection time. The conversation exporter
uses the same connection service. Renderer forms use typed plugin action payloads and never receive
stored keys. No new dependency, CLI installation, global nmem config edits or local-server fallback
is needed. DeepChat Skills use host MCP tools and the host export action, not unscoped nmem commands.

## Endpoints and authentication

Local defaults to http://127.0.0.1:14242 with /mcp/. Remote accepts a server root or an explicit API
prefix. Auto resolution verifies the root API first, then the legacy /remote-api prefix only on an
unavailable route (404). Explicit API/MCP overrides take precedence. A 401/403, timeout, TLS error or
invalid response stops verification. Local HTTP is restricted to loopback; remote uses HTTPS.
Credentials are never forwarded across origins or redirects. URL credentials, query and fragment
are rejected. Remote credentials are entered in a password field; a one-time connect link can be
redeemed in the main process, once, without writing it to disk or logging it.

Saving verifies health, an authenticated REST read, MCP initialization and one read-only Mem tool
call before committing settings. Failed verification leaves the previous connection usable. Saved
credentials are reusable only for the identical API/MCP destinations. Old destination credentials
are retained on a switch. Unchanged keys reuse their entry; a successful rotation deletes the
superseded key for that destination. Clear all connections disables the plugin and removes every
saved connection and retained credential. The bundled official plugin has no uninstall action.
Keys and upstream response bodies never appear in diagnostic output.

If verification and persistence succeed but plugin activation fails, the saved state is returned
with an activation warning. The plugin is disabled and partially registered resources are removed;
re-enabling retries activation without re-saving credentials. Connection state and wrapped keys
are machine-local: backups omit them, and imports preserve the receiving computer's values.

## Compatibility

Existing export and MCP configurations are shown as explicit import candidates. Import does not
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

```text
BEFORE
MCP settings       -> Nowledge URL / headers
Knowledge settings -> Nowledge API URL / key

AFTER
Plugins > Nowledge Mem
  [Local] [Remote]
  Server URL          [...]
  API key             [Enter replacement / saved]
  Connect link        [One-time link, remote only]
  Advanced endpoints  [API base] [MCP URL]
  [Verify and save] [Use for exports]
  Existing connections: one [Load configuration] action per entry
  [Clear all connections] -> Confirm deletion
Chat menu > Send to Nowledge Mem > Confirm session and destination > Send
```

The settings component owns its draft, busy state, error and dirty guard. It is embedded in the
existing plugin detail ScrollArea or the settings-window plugin page; no window or overlay is added. Inputs have labels, secrets are
password fields, pending operations disable conflicting actions, and discarded drafts are cleared.

## Acceptance

- Local and remote profiles coexist and expose independent MCP selections.
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
