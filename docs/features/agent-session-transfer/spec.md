# Agent Session Transfer

## Context

[Issue #1705](https://github.com/ThinkInAIXYZ/deepchat/issues/1705) reports that deleting an
agent can make the user's valuable work feel lost because the app does not explain what happens to
that agent's chats. The current implementation is inconsistent:

- Custom DeepChat agent deletion asks for a simple browser confirm, then reassigns
  `new_sessions.agent_id` to the built-in `deepchat`.
- Manual ACP agent deletion asks for a simple browser confirm, then removes the agent record without
  reassigning sessions. Sessions that still point at the removed ACP agent can become unavailable in
  the session list.

The feature should turn agent deletion from an opaque destructive action into an explicit choice:
move/import related conversations to another eligible DeepChat agent, or delete those conversations
together with the agent.

## User Need

Users need to understand and control what happens to chats owned by an agent before deleting that
agent. They also need a normal chat-level way to move an idle conversation to another DeepChat agent
when the conversation history is useful but the next turns should use a different agent.

## Goals

- Show a structured delete-agent dialog whenever a deletable DeepChat, manual ACP, or installed
  registry ACP agent has related sessions.
- Offer two clear outcomes in that dialog:
  - Move related sessions to another enabled DeepChat agent, then delete the source agent.
  - Delete related sessions, then delete the source agent.
- Allow regular idle sessions to move from their current agent to a DeepChat agent outside the delete
  flow.
- Expose exactly two first-increment migration entry points:
  - One-shot migration while deleting an agent.
  - A chat detail action from the active conversation's top-right `...` menu.
- Support DeepChat-to-DeepChat and ACP-to-DeepChat moves for idle sessions by preserving
  conversation history and reinitializing the target DeepChat agent runtime for future turns.
- Prevent moves into ACP agents. DeepChat history must not be moved to ACP, and ACP-to-ACP moves are
  blocked to avoid future ACP session binding conflicts.
- Keep empty draft sessions from blocking deletion.

## Non-goals

- No moving sessions while a turn is generating, waiting for tool approval, or otherwise active.
- No automatic migration outside explicit delete/uninstall flows. Registry ACP uninstall uses the
  same explicit transfer/delete choice as manual ACP deletion.
- No cross-agent move for subagent sessions from the manual chat action in the first increment.
  Subagent sessions are included in delete-agent impact handling because they can still reference the
  deleted agent.
- No deep copy/duplicate UI in the first increment. The first shipped action is move/import, not
  "duplicate and keep the original under the old agent".
- No moving any conversation history into ACP agents in the first increment. ACP sessions may only
  move out to a DeepChat agent.

## Terminology

- **Move/import**: keep the same DeepChat session id and stored messages, change the owning
  `agent_id`, and make future turns use the target DeepChat agent.
- **Related sessions**: rows in `new_sessions` whose `agent_id` is the agent being deleted, including
  regular sessions, subagent sessions, and drafts.
- **Importable sessions**: related sessions that are idle and can be safely re-bound to a target
  agent.
- **Empty drafts**: draft rows without messages. These may be deleted during source-agent deletion
  without being offered as valuable chat history.

## User Stories

1. As a user deleting a custom DeepChat agent, I can see how many chats will be affected before I
   confirm deletion.
2. As a user deleting a manual ACP agent, I can move that agent's finished chats to a DeepChat agent
   so they remain visible and usable.
3. As a user uninstalling an installed registry ACP agent, I get the same session protection before
   the agent is removed from the local install.
4. As a user who does not want to keep related chats, I can explicitly delete those chats together
   with the agent.
5. As a user viewing an idle regular conversation, I can move it to a different DeepChat agent from
   the chat UI, then continue the conversation with the target agent.
6. As a user with an active conversation, I am told to stop or wait before moving the conversation.

## Acceptance Criteria

1. Deleting a custom DeepChat, manual ACP, or installed registry ACP agent with related non-empty
   sessions opens an in-app dialog rather than `window.confirm`.
2. The delete dialog shows counts for regular sessions, subagent sessions, empty drafts, and sessions
   that cannot currently be moved because they are active.
3. The primary safe action is "Move chats to..." and requires selecting an enabled DeepChat target
   agent that is not the source agent.
4. The destructive action is "Delete chats and agent"; it clearly states that related chats will be
   removed.
5. If the source agent has no non-empty related sessions, deletion can use a shorter in-app confirm
   that states there are no chats to move.
6. Moving to a DeepChat agent applies the target agent's runtime defaults for future turns while
   preserving existing messages, attachments, search documents, tape entries, and title.
7. Moving into ACP is not allowed. The UI must not list ACP agents as transfer targets, and the main
   process must reject direct move requests whose target agent resolves to ACP.
8. Active or generating sessions cannot move. The dialog lists the blocked count and disables the
   move/delete completion until those sessions are stopped or finish.
9. After a successful delete-agent move, the source agent is removed or uninstalled and moved
   sessions appear under the target agent in the session list without an app restart.
10. After a successful chat-level move, the active session remains open, the selected agent syncs to
    the target agent, and the next user message uses the target agent.
11. The chat-level move entry is in the active conversation top bar's right-side `...` menu, placed
    between "Pin/Unpin" and "Clear messages".
12. Transfer dialogs are responsive: they keep a viewport-aware maximum height, keep header/footer
    actions visible, and scroll only the detailed body content when the impact list or help text is
    long.
13. All new user-facing text uses i18n keys.
14. Tests cover impact summary, DeepChat deletion with move, manual/registry ACP deletion with move
    to a DeepChat target, explicit delete of related sessions, chat-level move, active-session
    blocking, ACP cleanup ordering, partial batch failure reporting, and rejection of ACP targets.

## UX States

### Delete Agent With Movable Chats

```text
+----------------------------------------------------------------+
| Delete Agent                                                   |
| Agent: Code Reviewer                                           |
+----------------------------------------------------------------+
| This agent has conversations attached to it. Choose how        |
| DeepChat should handle them before the agent is deleted.       |
|                                                                |
| Impact                                                         |
|   Regular chats        12                                      |
|   Subagent chats        3                                      |
|   Empty drafts          2                                      |
|   Currently active      0                                      |
|                                                                |
| What should happen to these chats?                             |
|                                                                |
| (o) Move chats to another DeepChat Agent                       |
|     Target Agent                                               |
|     [ DeepChat                                        v ]       |
|                                                                |
|     Future replies will use the target Agent. Existing         |
|     messages and files stay in the same chats.                 |
|                                                                |
| ( ) Delete chats with this Agent                               |
|     Related chats and their local files will be removed.       |
|                                                                |
| Recent affected chats                                          |
|   - Automation setup                                           |
|   - Code review workflow                                       |
|   - Release checklist                                          |
|   ... body scrolls when this area grows ...                    |
+----------------------------------------------------------------+
|                                      [ Cancel ] [ Move & Delete ] |
+----------------------------------------------------------------+
```

### Delete Agent With Active Chats

```text
+------------------------------------------------------------+
| Delete Agent                                               |
|                                                            |
| Agent: Claude Code                                         |
|                                                            |
| 2 related chats are still active. Stop or wait for those    |
| chats before deleting this agent.                          |
|                                                            |
| Impact                                                     |
|   Regular chats         5                                  |
|   Subagent chats        0                                  |
|   Empty drafts          1                                  |
|   Currently active      2                                  |
|                                                            |
| [ View Active Chats ]                         [ Close ]     |
+------------------------------------------------------------+
```

### Delete Agent With No Chats

```text
+----------------------------------------------+
| Delete Agent                                 |
|                                              |
| Delete "Scratch Agent"?                      |
| No conversations are attached to this agent. |
|                                              |
|                         [ Cancel ] [ Delete ] |
+----------------------------------------------+
```

### Chat-Level Move

```text
Chat Top Bar
+----------------------------------------------------------------+
| Project notes                                      [share] [...] |
+----------------------------------------------------------------+

Top-right ... menu
+--------------------------------------+
| Pin                                  |
| Move conversation                    |
| Clear messages                       |
| ------------------------------------ |
| Delete                               |
+--------------------------------------+

Move dialog
+------------------------------------------------------------+
| Move Conversation                                          |
| Project notes                                              |
+------------------------------------------------------------+
| Current Agent                                              |
|   DeepChat                                                 |
|                                                            |
| Target Agent                                               |
|   [ Code Reviewer                                  v ]      |
|                                                            |
| Existing messages and files stay in this conversation.      |
| Future replies will use the target DeepChat Agent.          |
| ACP agents are not listed as targets. ACP chats can move    |
| out to DeepChat, but chats cannot move into ACP.            |
+------------------------------------------------------------+
|                                      [ Cancel ] [ Move ]    |
+------------------------------------------------------------+
```

### Responsive Dialog Rules

```text
Desktop / tablet
+------------------------------------------------------------+
| Fixed header: title, source agent/session                  |
+------------------------------------------------------------+
| Scroll body: impact, affected chat samples, target picker, |
| explanatory copy, target picker, affected chats            |
+------------------------------------------------------------+
| Fixed footer: cancel + primary/destructive action          |
+------------------------------------------------------------+

Narrow mobile
+--------------------------------------+
| Fixed header                         |
+--------------------------------------+
| Single-column scroll body            |
| Controls keep full width             |
+--------------------------------------+
| Fixed footer                         |
| [ Cancel ] [ Move ]                  |
+--------------------------------------+
```

## Constraints

- Follow the existing Presenter pattern: session ownership and transfer belongs in
  `AgentSessionPresenter`; agent record deletion remains in `ConfigPresenter` /
  `AgentRepository`.
- New renderer-main APIs should use typed routes and `renderer/api/*Client` rather than adding new
  direct `useLegacyPresenter()` usage.
- Existing `new_sessions` rows, message tables, tape tables, files, search documents, and usage stats
  are user data and must not be dropped during move/import.
- The transfer flow must update both persisted state and in-memory runtime caches, otherwise hooks and
  the next message can still report the old agent id.
- ACP transfer must treat `acp_sessions` as target-agent-specific because it is keyed by
  `(conversation_id, agent_id)`.
- Clearing stale ACP provider bindings must happen only after the target DeepChat context and
  session ownership have been durably updated.

## Open Questions

None for the first increment. A future duplicate/copy feature can be specified separately after the
move/import behavior is shipped and tested.
