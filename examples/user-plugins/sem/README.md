# Sem local code review for DeepChat

An optional MCP-only plugin for [Sem](https://github.com/Ataraxy-Labs/sem): inspect
code entities, callers, dependencies and structural diffs in a local Git repository.
No Sem account or API key is required. This example adds no hooks, Skills or bundled binaries.
It leaves existing model settings and MCP servers unchanged.

## Install

Use a DeepChat version with user plugins (v1.1.2-beta.5 or later), Git, and Node.js/npm
available through DeepChat's Toolchains settings. This example targets macOS/Linux on ARM64/x64.
Enabling the server invokes npx; first installation downloads the pinned npm package and native
Sem binary. Only connect a repository whose build/test scripts you trust.

1. Obtain a checkout containing this example. Until its PR merges, use the PR's exact commit.
2. From this directory, package the hidden files as well as the README:

   ```sh
   python3 -m zipfile -c /tmp/sem-code-review.zip .codex-plugin .mcp.json README.md
   ```

   Choose a suitable output path on your platform. Do not package the whole repository,
   credentials, `.git` or `node_modules`.
3. Open **Plugins → Install from ZIP** and inspect the archive. Expect one stdio server,
   the pinned command above, and one required variable, `SEM_REPO`. Select MCP and install.
   Installation leaves the plugin disabled.
4. Explicitly enable the plugin and use its MCP setup form to supply `SEM_REPO`: an absolute
   path to an existing local Git repository. The generic setup form masks variable values;
   this value is a directory path, not an API key. It is not inherited from your shell.
5. Check the plugin's MCP connection status and discovered tool schemas. Plugin-owned servers
   are separate from the ordinary MCP settings list. Discovery is not proof that a tool call works.

## Try it

Substitute a symbol that exists in the selected repository:

> Use Sem to locate `parse_config`, inspect its callers and explain the code. Do not edit files or run tests.

For a checkout with tracked local changes:

> Inspect the structural diff with Sem and explain the changes. Do not execute validation commands.

The graph's coverage depends on the language and source constructs. Missing results do not prove
there are no references. Retain ordinary file tools for configuration and unresolved code.
This plugin does not configure external ACP agents or provide Weave editing/merging tools.

## Permissions and privacy

- `sem_check` can run repository build/test commands. Keep normal tool approvals and only
  authorize execution intentionally; this is not a read-only server.
- `SEM_REPO` selects a repository; it is not an operating-system sandbox.
- The preset disables Sem cloud access and telemetry recording. npm/native-binary installation
  still uses the network. Those flags do not sandbox commands run by repository checks.
- Returned source code enters the conversation and may reach the configured model provider.
- Sem builds a local index. Structural results are not proof that code compiles or passes tests.

If setup fails, check Node/npm in Toolchains, Git availability, install-script permissions and the
absolute repository path. Change the path through MCP setup, not your shell environment.
Use **Review update** to change an installed package; editing the source checkout does not update
its installed snapshot. Disable or uninstall the plugin to remove its active integration.
Uninstalling does not erase earlier conversations, npm downloads or Sem's local cache.

The example files use DeepChat's Apache-2.0 license; Sem is distributed separately under its own
license. This example is contributed by Sem's maintainer at Ataraxy Labs.
