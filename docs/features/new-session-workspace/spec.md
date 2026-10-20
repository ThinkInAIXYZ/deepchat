# New-session workspace and browser

The new-session page exposes the existing right-hand workspace/browser panel through the same
workspace button and shortcut as a conversation. The selected project supplies the file root.
Entering a new conversation starts with the panel closed, even if it was open in the previous
conversation. Only an explicit button or shortcut action opens it. Sending the first message keeps
a manually opened panel open.
DeepChat drafts without a project offer directory selection and keep the browser available. ACP
drafts retain their existing working-directory requirement and authentication flow.

## Ownership and lifecycle

- `ChatTabView` remains the sole panel host. `NewThreadPage` coordinates its draft identity and
  composer; the draft store exposes that identity to the host and shortcuts.
- A DeepChat draft allocates an existing `isDraft` session record on demand, without initializing
  an agent runtime, requiring a model, or sending a message. Its identity belongs to one renderer.
  Empty, unowned drafts left by a crash can be reused for the same agent and project. The workspace
  button shows loading feedback while allocation is pending.
- The existing session-creation route accepts that renderer's unused draft identity. It applies
  the current submission settings and retains the normal initialization, attachment preparation,
  title generation, cancellation, and navigation behavior.
- Successful submission keeps the same workspace/browser identity. Failed submission preserves an
  unused draft for retry. If the first message was accepted before the failure, the renderer opens
  that saved conversation without sending the message again. Discarding a draft cannot delete a
  session with accepted messages.
- ACP retains its existing draft/authentication flow. Opening the panel does not start an ACP
  process. Drafts are isolated per renderer, so ACP initialization in separate windows can start
  separate processes for the same agent and project.
- Project changes invalidate old file previews. Switching agents, starting another new conversation,
  leaving an unused draft, or destroying its renderer releases unused draft resources.
- Typed IPC validates draft ownership for adoption, disposal, and native browser focus. Normal
  history and search continue excluding drafts. No database migration or dependency is added.

## Acceptance

Before sending, users can toggle the panel by button or shortcut, inspect the selected project's
files, insert a file reference in the composer, and navigate YoBrowser. Sending keeps the same
browser page and selected file. Changing project cannot show the previous project's preview.
Multiple renderers cannot adopt or discard each other's drafts. Submission failure retains the
composer and browser if no message was accepted, or recovers the saved conversation otherwise.
Accepted messages survive cleanup races, and recovery cannot override newer navigation.

```text
BEFORE
+------------------------------+
|          New session         |
|       [Project selector]     |
|       [Message composer]     |
+------------------------------+

AFTER (initial)
+------------------------------+
|                  [Workspace] |
|          New session         |
|       [Project selector]     |
|       [Message composer]     |
+------------------------------+

AFTER (opened by the user)
+------------------------------+----------------------+
|                  [Workspace] | Workspace | Browser  |
|          New session         |                      |
|       [Project selector]     | File tree / Web page |
|       [Message composer]     |                      |
+------------------------------+----------------------+
```
