# Baizhi Cloud Browser for DeepChat

[简体中文](./README.zh-CN.md)

Baizhi Cloud Browser (CapyBrowser) provides remote browser Sessions, saved profiles,
human handoff and downloads. This optional MCP-only example connects its management
service. Page navigation, clicks and reading require a compatible CDP client available
to your agent; installing this plugin does not replace DeepChat's page tools.

This is a separate service from Baizhi Cloud Agent Toolkit. Use your own cloud-browser
account and key. Browser startup and runtime are billed under the service's current
[pricing and setup guide](https://capybrowser.app.baizhi.cloud/docs/installation.md).
The package has no local commands, hooks, Skills, automatic approvals or default changes.
It is a community integration example, without DeepChat certification or endorsement.

## Install and connect

1. Use a DeepChat build with **Plugins → Install from ZIP** and user-plugin MCP
   credential setup. From a source checkout containing this example, package only it:

   ```sh
   cd examples/user-plugins/baizhi-cloud-browser
   archive_dir="$(mktemp -d)"
   zip -r "$archive_dir/baizhi-cloud-browser.zip" .codex-plugin .mcp.json README.md README.zh-CN.md LICENSE
   ```

   Do not install the whole repository from Git: its archive can exceed
   the plugin file limit. Exclude credentials, `.env`, `.git` and `node_modules`.
2. Select the ZIP, inspect its single `baizhi-cloud-browser` MCP declaration and
   `https://capybrowser.app.baizhi.cloud/mcp` destination, select **MCP**, and install.
   The plugin starts **disabled**. Explicitly enable it on its detail page.
3. Enter your **raw API key**, without `Bearer`, in the plugin's
   `CAPYBROWSER_API_KEY` password field. Choose **Save and reconnect**. The host adds
   the Bearer prefix. The name is a credential binding, not a process environment
   variable. Never put a real key in JSON, chat, an issue or a screenshot.
4. Check the plugin detail's MCP status and discovered tool count. A saved key alone
   does not prove authentication. Plugin-owned servers are absent from the ordinary
   MCP settings list. The built-in agent's **Advanced Settings → Plugins** shows its
   available tool count; this example does not configure external ACP agents.

DeepChat stores credentials separately through its SecretStore and keeps placeholders
in MCP configuration. Saved values are not displayed again. Resolve any credential
storage error in DeepChat rather than putting the key in the manifest.

## Use and clean up

Read the service setup guide and check authentication and pricing before starting a
run. Confirm your agent has a compatible CDP client before creating a paid Session.
Tool inputs go to Baizhi Cloud; page activity also reaches the websites you visit.
Review service terms and privacy information, and obtain permission before sending
sensitive data. This example makes no retention or residency promises.

Stop agent actions during human interaction and keep the same run until control is
returned. This plugin does not enforce that pause for third-party agents. End each
run you create and check release and final billing separately. Viewing, waiting and
disconnecting do not stop runtime charges.

- **Rotate:** enter a replacement raw key in the same password form, save, verify
  the new connection, then revoke the old key in your cloud-browser account.
- **Update:** use **Review update** and inspect the snapshot. Changed package bytes,
  including documentation-only changes, can require entering the key again. Editing
  a source checkout does not change an installed snapshot.
- **Disable/remove:** disable or uninstall from the plugin detail page. Uninstall
  removes the plugin's local configuration and bindings. It does not stop a cloud
  Session, revoke a cloud key or erase prior conversations. End your runs and revoke
  unused keys separately; other MCP connections remain independently managed.

For a missing credential, enable the plugin and use its own password form. For a 401,
check that the current key was entered without the Bearer prefix. For connection or
storage errors, share only redacted diagnostics with versions and no key or private
inputs. Avoid repeated retries of potentially billable tools.

[Product](https://baizhibrowser.cloud/) ·
[Integration materials](https://github.com/ctcbyzx/baizhi-cloud-browser) ·
[DeepChat user-plugin guide](https://github.com/ThinkInAIXYZ/deepchat/blob/dev/docs/features/user-plugins/authoring.md)

These example files use [Apache-2.0](./LICENSE), consistent with DeepChat. The hosted
service is operated separately by Baizhi Cloud; its backend source is not included.
