# Parallel Search for DeepChat

An optional MCP-only user plugin for free web search and page fetching with
[Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp).
No account or API key is required. Anonymous searches use Fast mode; the free endpoint has
rate limits and is intended for exploration and light use.

The package contains a manifest and remote MCP configuration, with no local commands, hooks,
Skills or dependencies to install. Installation leaves the plugin disabled and preserves your
existing model and MCP settings. It connects directly to `https://search.parallel.ai/mcp` using
Streamable HTTP. Search queries and requested URLs are sent to Parallel when tools are called.

## Install

Use a DeepChat version with **Plugins → Install from ZIP**. The user-plugin installation flow
is available in `v1.1.2-beta.5` and later; `v1.1.1` does not include it.

1. Obtain a source checkout containing this example. For a pending PR, use its exact commit;
   the example will only be available in upstream `dev` after merge.
2. Package only this directory, including its hidden files. With Python 3, run from the
   repository root:

   ```sh
   cd examples/user-plugins/parallel-search
   python3 -m zipfile -c /tmp/parallel-search.zip .codex-plugin .mcp.json README.md LICENSE
   ```

   Choose another output path on Windows. Do not include the entire repository, `.git`,
   credentials or `node_modules`. **Install from Git** on the whole DeepChat repository exceeds
   the current plugin file-count limit; use the small ZIP instead.
3. Open **Plugins → Install from ZIP**, select the archive and review the package. It should
   contain only the `parallel-search` HTTP MCP server at the endpoint above, with no credential
   variables, Skills or hooks. Select **MCP** and confirm installation.
4. Explicitly enable the installed **parallel-search** plugin. No password or OAuth sign-in is
   needed. Check its MCP status card for a running connection and discovered tools. Plugin-owned
   servers do not appear in the ordinary MCP settings list.

## Tools and controls

The endpoint exposes `web_search` for finding pages and `web_fetch` for reading URLs. Under the
discovered tool schemas, `web_search` accepts arguments such as:

```json
{
  "objective": "Find the Python documentation for virtual environments",
  "search_queries": ["Python virtual environment documentation"]
}
```

Then call `web_fetch` with a URL from the result:

```json
{
  "urls": ["https://docs.python.org/3/library/venv.html"],
  "objective": "Explain how to create a virtual environment"
}
```

Inspect the returned content. Discovery alone does not prove a tool call succeeded. This package
uses DeepChat's existing tool and permission controls and does not configure external ACP agents.

Disable the plugin to stop its integration, or uninstall it to remove its local configuration.
Use **Review update** to import changes; editing your source checkout does not update an installed
snapshot. Uninstalling does not remove previous conversation records.

If a call is rate limited, wait for the service's retry time before trying again. For connection
errors, check access to the endpoint and the plugin's diagnostic. Do not add an Authorization
header to this anonymous example. For service limits and support, see the
[Parallel Search MCP guide](https://docs.parallel.ai/integrations/mcp/search-mcp); for installation
behavior, see DeepChat's [user-plugin guide](../../../docs/features/user-plugins/authoring.md).

These example files use DeepChat's [Apache-2.0 license](./LICENSE). Parallel operates the hosted
service separately. I work at Parallel.
