# Workspace new conversation Agent selection

## Problem and root cause

Creating or opening a conversation changes the same Agent selection that the sidebar uses to
filter history. From All Agents, this hides other Agents' conversations and can make a workspace
appear empty. Workspace creation also chooses a global Agent without consulting its history.

## Behavior and ownership

- The Agent store owns separate conversation selection and explicit history filter state.
  Manual Agent selection updates both. Session activation, restoration, and creation update only
  the conversation selection. All Agents remains selected until the user changes the filter.
- A workspace's new conversation uses the explicit Agent filter first. Under All Agents, it uses
  the Agent of that workspace's most recently updated regular, non-draft conversation, including
  pinned conversations. If that Agent is unavailable, the workspace has no history, or the read
  fails, the existing selected/active/first-enabled Agent fallback applies.
- Global new conversation and Chats with an explicit null workspace retain the existing fallback.
- The session store resolves workspace defaults through the existing typed lightweight query,
  with a workspace filter, drafts excluded, and a one-item limit. The database applies filters
  before pagination, so unloaded history is eligible without materializing all sessions.
- Lightweight query options remain optional and preserve existing callers' defaults. Prioritized
  records must satisfy the same filters. No schema migration or new IPC route is needed.
- A delayed workspace lookup must not override a newer navigation or explicit Agent filter change.
  Existing project intent handling and composer defaults continue to use the resolved Agent.
- Removing or disabling an Agent clears its conversation selection and history filter independently.

## Interaction

```text
BEFORE                         AFTER
[All Agents] -> workspace +    [All Agents] -> workspace +
[Agent A]                     [All Agents]
  Agent A history               Agent A and Agent B history
New conversation: Agent A     New conversation: latest workspace Agent
```

## Acceptance and validation

- [x] Creating and opening conversations preserve the explicit history filter.
- [x] Explicit Agent selection wins over workspace history; All Agents uses persisted workspace
      history even when it is outside the loaded sidebar pages.
- [x] Drafts, subagents, and other workspaces cannot determine the default Agent.
- [x] Unavailable Agents, failed reads, and superseded lookups preserve usable navigation.
- [x] Relevant regression suites, formatting, i18n, lint, and type checking pass.

Validation: 100 session store, 5 Agent store, 72 sidebar, and 78 main-process tests pass. The
persisted-history regression exercises route input parsing, SessionQuery, AppSessionService, and
real SQLite together. Main-process suites run with Electron's Node runtime and
`DEEPCHAT_REQUIRE_NATIVE_SQLITE=1`; renderer suites use the CI heap limit of 6144 MB.
Formatting, i18n, lint, type checking, renderer architecture, and icon checks pass.
