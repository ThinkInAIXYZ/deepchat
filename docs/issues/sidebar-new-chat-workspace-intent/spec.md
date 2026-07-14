# Sidebar new chat workspace intent

Status: implemented and validated

Related contracts:

- `docs/features/sidebar-chat-section-actions/spec.md`
- `docs/features/default-workspace/spec.md`

## Issue

Starting a new conversation from another sidebar workspace while a conversation is active can open
the new-thread page with the active conversation's directory instead of the workspace whose `+`
button was clicked.

This affects both the `Chats` header action and project-folder header actions. The same action usually
works when no conversation is active.

## Reproduction

1. Configure a DeepChat agent with a default directory, then activate one of its conversations.
2. In project grouping, click `+` on `Chats` or on a different project folder.
3. Submit the new conversation.
4. Inspect the created session's `projectDir`.

Actual behavior: the selected directory can be replaced by the active agent's default directory,
which commonly matches the active conversation's directory.

Expected behavior: the workspace selected by the sidebar action is the directory used by the new
conversation. An explicit `Chats` selection must also preserve its existing nullable/default-chat
workspace semantics.

## Behavior shape

Before:

```text
Active session: Project A
        |
        +-- click Project B [+]
                  |
                  +-- select Project B
                  +-- close active session
                  +-- mount NewThreadPage
                  +-- apply agent default (Project A)
                  `-- create session in Project A
```

After:

```text
Active session: Project A
        |
        +-- click Project B [+]
                  |
                  +-- carry explicit Project B intent through navigation
                  +-- close active session
                  +-- mount NewThreadPage
                  +-- resolve defaults without replacing the explicit intent
                  `-- create session in Project B
```

## Impact

- The sidebar action communicates a specific target workspace but creates the conversation in a
  different directory.
- Agent tools, file references, workspace panels, and ACP workdir validation can operate against the
  wrong directory.
- The defect is conditional on the active-session transition, so the same button appears reliable
  from an already-open new-thread page and unreliable from an active chat.

## Root cause

The defect is in renderer navigation and draft initialization, before session creation reaches the
main process.

1. `WindowSideBar.vue::handleNewChatForProject` writes the clicked path to the general
   `projectStore` selection and then calls `sessionStore.startNewConversation()`.
2. With an active conversation, `startNewConversation()` calls `closeSession()`. This changes the
   internal page route from `ChatPage` to a newly mounted `NewThreadPage`.
3. `NewThreadPage` immediately runs `applyDraftDefaultsForSelectedAgent()` from its selected-agent
   watcher.
4. For DeepChat agents, that initializer resolves directories as
   `agentDefaultProjectPath ?? currentProjectPath ?? globalDefaultProjectPath` and calls
   `projectStore.selectProject(agentDefaultProjectPath, ...)` whenever an agent default exists.
5. The active conversation keeps its agent selected during the transition, so the new page applies
   that agent's default and overwrites the workspace selected by the sidebar action.

There is no direct copy from `activeSession.projectDir` in this path. The apparent inheritance is an
indirect result of losing the explicit sidebar intent and reapplying the active agent's default.

The main-process assignment policy is not the source of the bug:
`SessionAgentAssignmentPolicy.resolveProjectDir()` already gives a provided `input.projectDir`
precedence over agent and global defaults. The wrong value has already been selected in the renderer
before submission.

## Regression origin and coverage gap

Commit `810fe691c` added the `Chats` and project-folder new-conversation actions. Its sidebar tests
mock `startNewConversation()` and assert only that selection and navigation methods were called. They
do not exercise active-session teardown followed by `NewThreadPage` initialization.

Separately, `NewThreadPage` has a test that intentionally verifies an agent default wins over the
ordinary current selection. Both unit contracts pass while their composition drops the stronger,
one-shot workspace intent.

## Correct ownership

- `WindowSideBar` owns the clicked target workspace.
- `sessionStore` / `pageRouter` own the active-session-to-new-thread transition.
- `NewThreadPage` owns agent/default draft initialization.
- The explicit workspace target must be represented across those owners; a pre-navigation mutation
  of generic project selection is insufficient.

## Fix plan

1. Extend the unified new-conversation navigation with an optional one-shot workspace intent. The
   representation must distinguish an omitted intent from an explicit `null` used by `Chats`.
2. Pass the `Chats` or project-folder target through that navigation intent instead of relying only
   on `projectStore.selectProject()` before active-session teardown.
3. Resolve the intent inside `NewThreadPage`'s draft-default initialization with this precedence:
   explicit navigation intent (including `null`) > existing agent/default resolution.
4. Consume the intent after initial application. Keep it renderer-local and non-persisted.
5. Preserve current behavior for generic New Chat actions with no workspace intent: agent defaults,
   current selection, and global defaults keep their existing precedence.
6. Do not change `SessionAgentAssignmentPolicy`; it already honors explicit session input.

Avoid timing-based fixes such as delayed reselection or extra `nextTick()` calls. They would leave the
result dependent on async agent-config resolution and component mount timing.

## Task checklist

- [x] Trace the sidebar action through active-session teardown and new-thread initialization.
- [x] Confirm the main-process project-directory precedence is correct.
- [x] Record the regression and existing test gap.
- [x] Add a one-shot workspace intent to the unified new-conversation path.
- [x] Apply and consume the intent during new-thread draft initialization.
- [x] Update sidebar and session-store tests for the intent payload.
- [x] Add a regression test where an active agent default differs from the clicked workspace.
- [x] Add coverage for both a project-folder target and an explicit `Chats` target.
- [x] After implementation, rerun formatter, i18n validation, lint, and focused renderer tests.

## Validation

- Active Project A + Project B header `+` creates the next session with Project B as `projectDir`.
- Active Project A + `Chats` header `+` preserves the configured default-chat workspace or explicit
  nullable project selection used by the existing `Chats` contract.
- The same actions behave identically whether a session is active or the new-thread page is already
  open.
- Generic New Chat without a workspace target still applies the selected agent's default directory.
- Explicit `projectDir` continues to outrank agent and global defaults in the main-process assignment
  policy.

## Non-goals

- Changing sidebar layout or labels.
- Changing agent default-directory settings.
- Persisting a new workspace preference.
- Changing session database schemas or main-process assignment policy.

## Linked GitHub issue

Not synced; GitHub issue creation requires explicit developer approval.
