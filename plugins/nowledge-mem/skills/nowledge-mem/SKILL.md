---
name: nowledge-mem
description: Use Nowledge Mem for cross-tool startup context, recall of prior decisions, durable learnings, explicit conversation saving, and connection diagnosis. Use only the connection selected for this DeepChat agent or session.
---

# Nowledge Mem

Use the enabled `nowledge-mem-connection` MCP tools for the server configured in Plugins >
Nowledge Mem. Keep that destination, returned identity and Space for the whole operation. Never mix results from
different Mem servers or silently retry on another server.

At the beginning of related work, read Context Bundle once (`read_context_bundle`, source_app
`deepchat`) for identity, scope, rules and Working Memory. Use `read_working_memory` only when the
bundle tool is unavailable. An empty Working Memory is a successful empty result.

For continuation, reviews, regressions and prior decisions, search `memory_search` with a narrow
query and limit 5, then fetch the relevant exact IDs. Search before adding a duplicate. Distinguish
recorded facts from proposals, and keep scope returned by the server. A graph is optional; only
show one when it enforces the same identity and Space as retrieval.

Save a concise durable learning with `memory_add` or update an existing memory only when it is
useful beyond this conversation. State what was saved. Do not save speculative conclusions as
facts. Save complete conversations only when the user requests it: use DeepChat's conversation
export to Nowledge Mem, which uses the same verified connection as MCP. Do not
claim an export happened without a successful acknowledgement.

For configuration or failed access, direct the user to Plugins > Nowledge Mem. The host verifies
REST and MCP and stores credentials securely. Report the failing connection and operation; do not
switch to localhost after a remote error. Do not ask for keys in chat, invoke unscoped `nmem`, edit
`~/.nowledge-mem/config.json`, read local Mem database files, or install another connector. This
plugin uses DeepChat's HTTP client and does not require the CLI.
