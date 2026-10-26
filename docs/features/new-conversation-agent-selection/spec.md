# New Conversation Agent Selection

## Goal

Closes https://github.com/ThinkInAIXYZ/deepchat/issues/2462.

The sidebar Agent selector filters session history only. The new-conversation context row displays
and selects its execution Agent independently, beside the workspace selector. Every generic New Chat
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
dropdown primitives. Agent and model names remain visible with their icons. Selection is disabled
during submission. Model and ACP controls continue to use the selected execution context.

The Agent selector sits beside the workspace below the composer; its loading indicator reflects
the existing ACP configuration-loading state. The composer starts with model, mode, then other ACP
options. Agent and model never collapse. Mode,
permission, reasoning, context, status, and settings controls default to icons. Hover reveals their
current values or labels using the existing motion tokens. Revealed controls remain expanded while
the pointer moves within the toolbar or a menu is open, keeping targets stable. Keyboard focus also
reveals the value; open menus keep their trigger expanded. ACP loading feedback stays visible in
the compact state. Disabled controls keep their values visible, and context usage receives keyboard
focus. Focused controls scroll into view after expanding. Disabled option rows expose complete
tooltips through a focusable wrapper without enabling their actions. Reduced-motion preferences
disable the reveal transition. Click behavior and menu contents retain their existing ownership.

Model-picker triggers and entries use the existing substring matcher on the final model-ID path
segment; hosting namespaces do not supply a model icon. Unknown models fall back to the provider
icon. Provider entries retain their existing API-type icon behavior, and ACP models use known
model-family icons while retaining the generic model icon for unknown IDs.

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
               [model v] [mode / permission icons] [send]
               [workspace v] [Agent v]
```

## ACP Preparation And Scope

The composer selector displays the existing ACP configuration-loading state until warmup completes.
Chats do not display a directory-selection prompt. ACP Chats lazily prepare an application-managed
chat directory, independently of the custom default project. The visible selection remains Chats;
its ACP session records the managed directory so first and subsequent turns have a valid workdir.
The directory follows the existing Documents/Home/user-data candidate policy and remains in Chats
history grouping even when the user has a different custom default project. A configured managed
directory is recreated before trying other candidates. If it cannot be recreated, the selected
managed fallback becomes the configured default so restoring the original directory cannot move
new Chats back to a different location. Custom defaults are preserved.
The typed `project.ensureChatWorkspace` route publishes a versioned project snapshot. Preparation
runs only when ACP needs a missing effective directory, including when a later snapshot loses it.
Failure leaves a retry icon beside the context selectors, with the reason available on hover or
keyboard focus; it does not add a directory-selection prompt.
An unavailable explicitly selected workspace still displays its localized
reason and blocks ACP preparation/submission. Native DeepChat Chats with an explicit null workspace
keep their general tool profile; selecting the managed directory explicitly still uses the code
profile, as for any other selected project. Native
Skill catalog, active-Skill requests, and runtime Skill validation only run with a DeepChat Agent
scope. ACP selection has no
local Skill scope, and late native Skill responses cannot populate ACP composer state.

Inline ACP option menus use a compact 20rem width, constrained by the viewport.
Options remain on one line with an ellipsis for overflowing values. Hover and keyboard focus show
the full value in a viewport-constrained tooltip; long lists scroll vertically without horizontal
scrolling. The same menu serves new and existing conversations.

The composer toolbar keeps attachment, Agent/model configuration, status, and send controls on one
row. Expanded labels use ellipsis when constrained while action buttons retain usable widths. When the
minimum control widths cannot fit, only the central settings region scrolls horizontally; attachment
and send remain visible at the edges, and keyboard focus can reveal every settings control.

Workspace selection distinguishes Agent defaults from manual choices. An automatic Agent directory
uses the `agent` source, follows the next Agent's default (or the global default when absent), and
survives unrelated project snapshot refreshes. Only manual selection, including an explicit clear,
blocks automatic Agent defaults. A failed active-session deactivation preserves its execution Agent.

## Compatibility And Acceptance

No database migration, persisted setting, or provider configuration change is required. A typed
project route prepares the existing managed chat directory through the preload bridge.
An active Agent B conversation remains open while the sidebar filters Agent A. Creating another
B conversation retains that filter, so B's new history row is absent from the A-only list.

Acceptance requires consistent Agent assignments across new-conversation entry points, unchanged
filtering during composer selection, direct composer startup, preservation of per-Agent drafts and
explicit workspace choices, and matching visible/created Agent identities. Validate multiple
configured Agents using an isolated copy of the local real profile as well as durable regression
checks; never mutate the live database through an external tool.
