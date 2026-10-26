# New Conversation Agent Selection

## Goal

Closes https://github.com/ThinkInAIXYZ/deepchat/issues/2462.

The sidebar Agent selector filters session history only. The new-conversation composer displays
and selects its execution Agent independently, beside the model controls. Every generic New Chat
entry point uses the same selection rule.

## Ownership And Behavior

- `agentStore.filterAgentId` owns history filtering. Changing it neither closes the active session
  nor changes the route, execution Agent, composer draft, or selected workspace.
- `draftStore.agentId` remembers the current window's new-conversation Agent, initially `deepchat`.
  Only explicit selection and new-conversation initialization update it; default-configuration
  watchers and browsing existing sessions do not overwrite it. No new persisted setting is required.
- `agentStore.selectedAgentId` remains the execution-context projection consumed by existing
  renderer controls. Entering New Thread restores it from the new-conversation draft. Existing
  sessions retain their own durable Agent assignment.
- Ordinary New Chat, keyboard/menu commands, the collapsed header action, workspace plus actions,
  and empty workspace activation use the draft Agent. Workspace entry points only supply a
  one-shot project-directory intent, including an explicit null intent for Chats.
- Explicit Agent commands may select an Agent through the same new-conversation action without
  modifying history filtering. Provider start deeplinks retain their explicit DeepChat target.
- A deleted or disabled draft Agent falls back to the enabled built-in DeepChat Agent. Agent list
  ordering and workspace/session history never choose an execution Agent.
- New Thread always opens the composer. Remove the separate Agent welcome-selection page and its
  unused translations and tests. Agent management remains available through existing Settings.

## Composer Interaction

The composer offers the existing enabled Agent catalog, using AgentAvatar and the existing
dropdown primitives. Selection is visible by name, keyboard-accessible, and disabled during a
submission. Model and ACP controls continue to use the selected execution context.

Switching Agents uses existing per-Agent composer drafts and default-model/configuration loading.
It preserves manually chosen workspaces, including an explicitly cleared workspace. Stale default
or ACP preparation results must not overwrite newer choices. Existing session Agents are immutable
through this control; it appears only on New Thread.

```text
BEFORE
Sidebar Agent -> history filter + execution selection
New Thread   -> Agent welcome -> composer with model control

AFTER
Sidebar      -> history filter
New Thread   -> [message composer                     ]
               [Agent v] [model / ACP controls] [send]
```

## Compatibility And Acceptance

No database, preload, IPC, provider configuration, or backend contract changes are needed.
An active Agent B conversation remains open while the sidebar filters Agent A. Creating another
B conversation retains that filter, so B's new history row is absent from the A-only list.

Acceptance requires consistent Agent assignments across new-conversation entry points, unchanged
filtering during composer selection, direct composer startup, preservation of per-Agent drafts and
explicit workspace choices, and matching visible/created Agent identities. Validate multiple
configured Agents using an isolated copy of the local real profile as well as durable regression
checks; never mutate the live database through an external tool.
