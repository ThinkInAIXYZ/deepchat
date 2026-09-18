# Baizhi Cloud Agent Toolkit for DeepChat

[简体中文](./README.zh-CN.md)

An optional, MCP-only user plugin contributed by Baizhi Cloud. It connects DeepChat directly to
[Agent Toolkit](https://baizhi.cloud/landing/agent-toolkit), a hosted commercial tool service for
search, webpage/document processing and other tasks. It is not a model provider, a bundled
DeepChat plugin, or a listing in the MCPRouter store.

The package contains only a manifest and remote MCP declaration, plus documentation and a license.
It has no local commands, hooks, Skills, install scripts or automatic tool-approval rules.
Installing it does not enable it or change your model settings.

## Requirements and data use

- Use a DeepChat version with **Plugins → Install from ZIP** and user-plugin
  MCP credential setup. This flow is available in `v1.1.2-beta.5`; `v1.1.1` does not include it.
  The source revision used to build the ZIP must also contain this example directory.
- Create your own account and API key in the [Baizhi Cloud console](https://agent-toolkit.app.baizhi.cloud/).
  Review the service terms, permissions, balance and usage limits. Calls may consume credits.
- The endpoint is `https://agent-toolkit.app.baizhi.cloud/mcp`, using Streamable HTTP and Bearer
  authentication. There is no MCPRouter account, intermediary key or OAuth sign-in in this flow.
- Tool inputs, including search queries, URLs, documents and extraction requests, are sent to
  Baizhi Cloud when you invoke the corresponding tools. Do not submit sensitive data without
  permission. Review the current service privacy information before use; this example makes no
  promises about retention, residency or zero logging.

## Install and enter your key

1. Obtain a source checkout containing this example and create a ZIP containing **only this
   directory**, including hidden files. From the repository root on a system with `zip`:

   ```sh
   cd examples/user-plugins/baizhi-agent-toolkit
   archive_dir="$(mktemp -d)"
   zip -r "$archive_dir/baizhi-agent-toolkit.zip" .codex-plugin .mcp.json README.md README.zh-CN.md LICENSE
   ```

   For a review build, use the contributor's exact PR commit. A pending PR is not part of upstream
   `dev`. Check the source before packaging; never include `.env`, credentials, `.git`,
   `node_modules` or an entire repository checkout.
2. Open **Plugins → Install from ZIP**, select the resulting archive and review the package.
   It should declare just the `agent-toolkit` MCP server, the HTTPS endpoint
   above, and the required variable `BAIZHI_API_KEY`. Select **MCP** and confirm installation;
   this package has no Skills or hooks to select. The plugin is initially **disabled**.
3. Open the installed **baizhi-agent-toolkit** plugin and explicitly enable it. Its MCP setup
   section's `BAIZHI_API_KEY` password field becomes editable.
4. Enter the **raw API key only** in that password field, without `Bearer`, quotes or a full
   Authorization header, and click **Save and reconnect**. Do not put the key in either JSON file, a chat,
   an issue, or a screenshot. The variable name is a binding identifier; setting an operating
   system environment variable does not configure a user plugin.
5. Check the MCP status card on the plugin detail page for running state or an error; use its
   reload action if necessary. In a conversation using DeepChat's built-in agent, open
   **Advanced Settings → Plugins** to check the discovered tool count. Installation or saving a
   key alone is not evidence that the server authenticated successfully. The ordinary MCP
   settings list excludes plugin-owned servers; do not use that list to judge this plugin's state.

The existing DeepChat credential form stores the value separately through its SecretStore;
the MCP configuration retains `Authorization: Bearer ${BAIZHI_API_KEY}`. Stored values are not
shown back in the form. Platform encryption availability is handled by DeepChat; if saving fails,
resolve the reported credential-storage problem rather than putting the key in the manifest.

Do not use the entire DeepChat repository with **Install from Git** for this example: the current
installer checks the whole repository archive before selecting a package subdirectory, and that
archive exceeds the plugin file-count limit. Packaging only this example avoids that limitation
without weakening installation checks.

## Verify and control tool use

After the connection succeeds, confirm the plugin appears with discovered tools in the built-in
agent's **Advanced Settings → Plugins** group and review any permission prompts when using them.
That group shows the tool count, not a per-tool selection checklist. This example does not configure external ACP agents. A small,
non-sensitive first task can use `websearch_search`,
`web_scrape` or `web_extract`, if your account exposes them. Check the result and console usage.
Discovery does not prove that every tool is authorized or that the account has sufficient credit.

These three names are suggested starting points, **not a configured allowlist**. The plugin imports
the service's discovered tools, whose availability depends on the service and your key. It does
not auto-approve calls or override DeepChat's tool-selection and permission controls.

## Rotate, disable and remove

- **Rotate:** create a replacement key in Baizhi Cloud, enter it in the same plugin MCP setup form,
  save and verify the new connection before revoking the previous key. Existing values are not
  displayed for editing.
- **Disable:** disable the plugin to stop its integration. This does not revoke the cloud key.
- **Remove:** uninstall the plugin to remove its owned local configuration and bindings. Revoke
  the key in Baizhi Cloud if it is no longer needed. Uninstalling does not erase prior conversation
  records or revoke credentials held by other applications.
- **Update:** use **Review update**, inspect any endpoint or credential changes, and explicitly
  approve the new snapshot. Changed destinations can require fresh credential setup. Updating
  a source checkout does not silently update an installed plugin.

## Troubleshooting

- **No install or credential UI:** check the DeepChat version and that this is installed as a user
  plugin, not pasted into the ordinary MCP configuration editor or MCPRouter store.
- **Missing variable:** enable the plugin, enter a nonempty key in its own MCP setup form, and save.
- **401 / unauthorized:** confirm the key is current and entered without the `Bearer` prefix.
- **Connected but a tool fails:** check the key's permissions, quota, balance and required tool inputs.
  Avoid repeated retries of a potentially billable call.
- **Connection failure:** check network access to the fixed HTTPS endpoint and the connection
  diagnostic. Redact credentials and sensitive tool inputs before sharing logs.

For service/account support, use the [Baizhi Cloud integration repository](https://github.com/chaitin/baizhi-agent-toolkit).
For DeepChat installation behavior, see the repository's
[user-plugin guide](https://github.com/ThinkInAIXYZ/deepchat/blob/dev/docs/features/user-plugins/authoring.md).
When reporting an issue, include versions and redacted diagnostics, never a real API key.

These example files are licensed under [Apache-2.0](./LICENSE), consistent with DeepChat.
The hosted service is separately operated by Baizhi Cloud and subject to its own terms; its backend
source is not included. Providing this example does not imply DeepChat certification or endorsement.
