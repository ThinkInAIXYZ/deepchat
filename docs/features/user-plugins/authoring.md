# Creating and sharing a user plugin

DeepChat accepts a directory containing `.codex-plugin/plugin.json`, directly from a public
HTTPS Git repository or a ZIP file. No marketplace, account service, DeepChat SDK or publishing
registration is needed. Installed files are a private snapshot: editing the original checkout
does not change an installed plugin. Use **Review update** to import new bytes.

A plugin can contain Skills, context hooks and MCP server configuration. Users choose these
capabilities independently. Installation creates a disabled plugin. Enabling it registers the
selected Skills and MCP servers and authorizes the reviewed hooks for subsequent DeepChat work.
Direct ACP agents do not receive these hooks.

## A complete skills-and-hooks package

```text
example-plugin/
  .codex-plugin/plugin.json
  skills/focused-review/SKILL.md
  hooks/hooks.json
  hooks/context.cjs
```

`.codex-plugin/plugin.json`:

```json
{
  "name": "focused-review",
  "version": "1.0.0",
  "description": "Focused code review with a short context reminder.",
  "author": { "name": "Example Author" },
  "license": "MIT",
  "skills": "./skills",
  "hooks": "./hooks/hooks.json"
}
```

`skills/focused-review/SKILL.md` uses DeepChat's existing Skill format. Metadata is declarative;
JavaScript front matter is rejected during inspection, import and discovery:

```markdown
---
name: focused-review
description: Review a code change for concrete correctness regressions.
---

Read the changed code and its callers. Report reproducible correctness problems with file
locations and a practical fix. If no problem is found, state what was checked and what remains
unverified. Respect the user's requested scope.
```

`hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${PLUGIN_ROOT}/hooks/context.cjs\"",
            "commandWindows": "node \"%PLUGIN_ROOT%\\hooks\\context.cjs\"",
            "timeout": 5,
            "statusMessage": "Preparing review context"
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${PLUGIN_ROOT}/hooks/context.cjs\"",
            "commandWindows": "node \"%PLUGIN_ROOT%\\hooks\\context.cjs\""
          }
        ]
      }
    ]
  }
}
```

`hooks/context.cjs`:

```javascript
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  const event = JSON.parse(input)
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event.hook_event_name,
      additionalContext: 'When reviewing code, prioritize observable correctness problems and explain how to reproduce them.'
    },
    systemMessage: 'Review context ready'
  }))
})
```

Use `.cjs` for CommonJS helpers and `.mjs` for ES modules. A package's `package.json` can affect
how Node interprets `.js` files. Supply required interpreters yourself; importing a plugin does
not run `pnpm install`, lifecycle scripts or arbitrary setup commands.

## Add an MCP server to the same package

Add `"mcpServers": "./.mcp.json"` to the manifest. DeepChat accepts a direct server map, the
`mcp_servers` wrapper, and the `mcpServers` compatibility alias. Inline maps are also accepted.
For an already-built local server:

```json
{
  "mcp_servers": {
    "review-helper": {
      "command": "node",
      "args": ["${PLUGIN_ROOT}/dist/server.cjs"],
      "cwd": "${PLUGIN_ROOT}",
      "env": { "REVIEW_DATA": "${PLUGIN_DATA}" }
    }
  }
}
```

Here is a minimal server source using the MCP SDK version used by this repository. Create
`mcp.mjs` in your authoring checkout:

```javascript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({ name: 'review-helper', version: '1.0.0' })
server.registerTool('review_checklist', {
  description: 'Return a short correctness review checklist',
  inputSchema: {}
}, async () => ({
  content: [{ type: 'text', text: 'Check callers, failure paths, state transitions and observable regressions.' }]
}))
server.connect(new StdioServerTransport()).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
```

Build in the authoring checkout, outside DeepChat:

```sh
pnpm add --save-exact @modelcontextprotocol/sdk@1.30.0
pnpm add --save-dev esbuild
pnpm exec esbuild mcp.mjs --bundle --platform=node --format=cjs --outfile=dist/server.cjs
```

Distribute the resulting `dist/server.cjs` with the manifest, Skills and hooks. The bundled
server has no dependency on DeepChat's internal Node modules. Exclude `node_modules`, `.git`,
credentials and unrelated build outputs from the package. The package installer rejects links,
including the symlinks in typical pnpm `node_modules` trees.

For an independently authenticated HTTP server, use your actual service endpoint:

```json
{
  "review-service": {
    "url": "https://your-service.example/mcp",
    "bearer_token_env_var": "REVIEW_SERVICE_TOKEN"
  }
}
```

The variable name and header template are disclosed during review. Enter its value in the plugin's
MCP setup form; user plugins cannot read that value from DeepChat's process environment. Values are
encrypted in the existing SecretStore, separately from MCP configuration. Configuration retains
placeholders, and the same form accepts replacement values for credential rotation without revealing
saved values. Changes to the destination or command/binding configuration require fresh setup. OAuth uses the
existing MCP authentication controls and credential binding. OpenAI `.app.json` connector IDs
are not public MCP endpoints and cannot reuse a Codex login inside DeepChat.

Supported transport configurations are stdio, HTTP and explicitly declared legacy SSE. Remote
endpoints require HTTPS; plain HTTP is allowed only for `localhost`, `127.0.0.1` and `[::1]`.
`headers`, `http_headers`, `env_http_headers`, `bearer_token_env_var`, `env`, `env_vars`, `args` and `cwd`
are imported where applicable. Unknown operational or restrictive fields make that server
unavailable with an inspection finding. `autoApprove` never grants tool permission.

## Hook boundaries and output

- `SessionStart/startup` runs before the first accepted prompt of a new eligible session.
  Ordinary turns do not rerun it.
- `SessionStart/resume` runs before new input in an existing session after an application
  restart. Retrying an already admitted input reuses its previous results. Page navigation does
  not constitute a resume boundary.
- `SessionStart/compact` runs after a successful committed compaction. Clearing messages invalidates
  cached hook history and runs startup on the next input; it does not emit a Codex `clear` event.
- `UserPromptSubmit` receives the accepted `prompt` and runs once for that input, including
  accepted steering. Editing the prompt on the same message creates a new input boundary.
  Context remains available through its tool loop and provider retries.
- `SubagentStart` runs for a child DeepChat session. `session_id` identifies its parent;
  `agent_id` identifies the child and `agent_type` identifies the selected agent. A child does
  not run a top-level startup hook.

Input JSON also includes `hook_event_name`, `cwd`, `model` and `transcript_path: null`.
The host does not manufacture an exported transcript or Codex permission-mode semantics.
Only matching `hookSpecificOutput.hookEventName` and textual `additionalContext` are accepted.
`systemMessage` is a diagnostic, not an instruction. Tool approval, blocking, rewriting,
asynchronous handlers, prompt handlers and agent handlers are unsupported.

Commands run through the platform shell. POSIX environment syntax is not translated into
Windows syntax; supply `commandWindows` when necessary. A hook has a default timeout of five
seconds, a maximum configured timeout of thirty seconds, and a shared ten-second boundary
budget starting after queue admission. Input is limited to 1 MiB, stdout/stderr to 64 KiB each, and accepted context to 8 KiB
per boundary. Failures are visible in **Recent hook activity** and do not stop model work unless
its cancellation or a persistence failure requires stopping it.

Hook PATH includes the Node/uv directories selected in DeepChat's Toolchains settings. Other
interpreters must be installed separately.

The process receives `PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`
and `DEEPCHAT_PLUGIN_ID`. Root is the reviewed snapshot; data is writable and stable across
updates. Data is shared across sessions for the same installation. In Ponytail 4.9.0 this means
one session's mode switch can affect a subsequently created child or another session; Ponytail
also keeps default-mode configuration outside plugin data.

These processes use the user's native permissions. The private data directory and reduced
environment are conventions, not an operating-system sandbox. Hooks cannot override host
permissions or explicit user instructions through their output.

## Install, update and diagnose

1. Open **Plugins → Install from Git** and enter a public HTTPS URL, optionally a branch/tag/commit
   and package subdirectory; or choose **Install from ZIP**. A single enclosing ZIP folder is
   accepted. If multiple packages are found, select one with its subdirectory.
2. Review the resolved commit/digest, commands, server destinations and compatibility findings.
   Select the components you want, then install and enable the plugin in its detail page.
3. Configure missing MCP variables or independent authentication. A declared server is not a
   connected server; use its connection status to determine readiness.
4. Use **Review update** to fetch Git again or choose a replacement ZIP. The installed ID, Skill
   assignments and plugin data remain stable. Execution consent is reviewed for each snapshot.
   Finish active DeepChat turns before applying an update.
5. Disable to revoke future execution and context. Uninstall also removes private data, Skill
   assignments and owned MCP configuration. Historical conversation evidence remains.

Source outages do not disable an installed snapshot. An interrupted update restores the previous
revision and its MCP configuration on restart. Endpoint changes invalidate the old connection
binding; signing in again may be necessary after an update or rollback. A hook left started by a
crash has an uncertain outcome and is not automatically rerun. **Run hook again** explicitly
repeats it and may repeat external side effects.

For local development, the typed renderer IPC API also accepts directory snapshots. Run this in
DeepChat's renderer developer console, replacing the absolute path and reviewing `prepared` before
submitting the installation call:

```js
const { prepared } = await window.deepchat.invoke('plugins.inspectSource', {
  source: { kind: 'directory', path: '/absolute/path/to/plugin' },
  requestId: crypto.randomUUID()
})
console.log(prepared)
```

```js
const { result } = await window.deepchat.invoke('plugins.installUser', {
  operationId: prepared.operationId,
  selection: { skills: true, hooks: false, mcp: false }
})
console.log(result)
```

Select only reviewed components, then enable the installed plugin in its detail page. Directory
sources are copied into a private immutable snapshot with the same file-kind and path checks as ZIP
sources; edits are not live. Inspect again and pass the installed `pluginId` to `installUser` for an
update. The end-user installation UI offers Git and ZIP.

Archive limits are 200 MiB compressed, 4096 entries, 64 MiB per file, and 256 MiB extracted.
Reject links, special files, traversal paths and case/Unicode path collisions. Git installation
uses a bare fetch and archive; it does not check out submodules, invoke repository hooks, load
user Git credential helpers or run package scripts.

For contributors with Node 24 or later, the DeepChat repository and its dependencies installed:

```sh
pnpm run plugin:validate -- --plugin-root /absolute/path/to/example-plugin
```

This performs static manifest/configuration validation without executing the plugin. The app's
inspection additionally checks the snapshot, archive/file limits and installation source.
Native official plugin packaging commands remain unchanged.

References: [Codex plugin documentation](https://developers.openai.com/plugins/build/plugins),
[context hook documentation](https://learn.chatgpt.com/docs/hooks),
[Ponytail](https://github.com/DietrichGebert/ponytail).
