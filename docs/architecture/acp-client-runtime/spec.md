# ACP Client Runtime

## Problem

DeepChat's ACP integration currently behaves like a provider helper instead of a full ACP client runtime. This causes protocol drift and product bugs:

- warmup can create a temporary `session/new` with empty MCP servers, so agent configuration is probed with a different context than real turns;
- debug `initialize` can be invoked on a connection that was already initialized;
- settings updates for install/repair/enable are not always reflected automatically;
- ACP sessions, file-system access, terminal access, permissions, and session updates do not have a single runtime boundary.

## Goals

- Introduce an internal ACP client runtime boundary that owns connection, session, handler, mapping, workspace, registry, and debug concerns.
- Align DeepChat with ACP's client responsibilities: spawn stdio agents, initialize once, create/load sessions with the current cwd and MCP servers, forward prompts, handle client-side fs/terminal/permission calls, and map `session/update`.
- Preserve DeepChat's existing public model selector, Workspace, MCP, Skills, Remote Control, IPC, and renderer route surfaces.
- Match Zed's configuration boundary: DeepChat forwards cwd/env/MCP/model/mode/config options; ACP agents read their own native configuration directly.

## Non-Goals

- Do not add a Claude-specific or Codex-specific local configuration resolver.
- Do not reset or migrate already persisted ACP summary/session state beyond compatible schema additions.
- Do not redesign the model selector UI in this change.

## Protocol Matrix

| ACP area | DeepChat behavior |
| --- | --- |
| `initialize` | Sent once per process connection after stdio spawn. Capabilities and auth methods are cached on the connection handle. |
| `authenticate` | Routed through the ACP auth/terminal handler when required by the agent. |
| `session/new` | Uses the resolved conversation workdir and DeepChat MCP selections filtered by agent transport capabilities. |
| `session/load` | Used only when the agent declares load support and DeepChat has a persisted ACP session id. |
| `session/prompt` | One active prompt per ACP session; response `stopReason` is persisted as turn completion state. |
| `session/update` | Mapped to DeepChat message/content/tool/plan/diff/terminal/permission events. |
| `session/request_permission` | Routed through DeepChat permission UI/policy and remote-control-safe resolution. |
| `fs/read_text_file` and `fs/write_text_file` | Guarded by realpath validation against registered workdirs. |
| Terminal lifecycle | Bound to the session workdir and routed through DeepChat terminal management. |
| Debug | Shows lifecycle, request, response, notification, permission, stderr, and error entries without re-initializing an existing connection. |

## Acceptance Criteria

- Warmup never creates a throwaway session solely to fetch config state.
- Debug initialize starts or reports the initialized connection and does not send a second ACP initialize request.
- Real sessions are the source of models/modes/config options.
- Settings refresh after enable/install/repair/uninstall without requiring a manual reopen.
- ACP fs and terminal operations are scoped to the registered workdir.
- Non-ACP providers keep their existing context-budget behavior.
