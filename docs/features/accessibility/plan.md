# Accessibility implementation plan

The behavior contract is in [spec.md](spec.md). The dedicated exploration agent owns [exploration.md](exploration.md); the implementation agent owns product changes, validation, commits, and the PR. Each phase requires a concrete exploration report, implementation, independent acceptance, and a commit before advancing.

- [x] Entry, shell navigation, session selection, accessible controls, and focus.
- [x] Conversation input/output, history, streaming, search, attachments, model options, message actions, and approval/recovery flows.
- [x] Onboarding, settings, provider/agent/model forms, plugin/MCP/skill installation and configuration, including external-Agent import and activity navigation.
- [x] Projects, workspace files, artifacts, terminal, browser and auxiliary windows, including native entry/return and plugin settings close shortcuts.
- [x] Review shared semantics, focus ownership, localization, lifecycle, rendering and IPC boundaries.
- [x] Retain behavior-focused regression protection; keep exploratory fixtures and probes outside the repository.
- [x] Run format, i18n, lint, typecheck, relevant renderer/main suites, production build and Electron smoke tests.
- [x] Accept post-import session refresh and same-process restored-message reading; all reported repairs have independent acceptance.
- [x] Publish [PR #2276](https://github.com/ThinkInAIXYZ/deepchat/pull/2276) against `dev` with behavior, validation, coverage boundaries, and BEFORE/AFTER ASCII.

## Ownership and implementation

### Navigation and shared controls

`ChatMainApp`, `ChatTabView` and the settings shell own named main/navigation landmarks, skip controls and route focus recovery. Sidebar sessions use native selection buttons with independent pin/delete actions. Shared `DcButton` naming, radio/checkbox IDs and descriptions, keyboard context-menu activation and programmatic dialog restoration remain in their existing primitives. Hidden panels and collapsed floating content are inert. Focus recovery preserves a valid user-selected target after asynchronous work.

### Conversation and complete reading

`ChatInputBox` exposes a named multiline textbox. Suggestions retain input focus and publish the active option; Escape removes the popup and its ARIA state. Spotlight uses the existing modal primitive, and conversation search restores the composer. Embedded attachment/Skill controls accept Enter/Space without submitting a message. Draft restoration compares document content and distinguishes local edits from external changes or replacement input handles.

`ChatPage` publishes semantic generation, waiting, completion and failure states without announcing each token. Questions use named choice groups and explicit confirmation. Resolving interactions restores the composer or read-only transcript when focus was lost. Explicit earlier-history loading preserves reading intent and makes older stored messages reachable.

The main process reports native accessibility support through the device snapshot and a typed event. One shared renderer subscription controls complete loaded-message, Markdown and provider-catalog rendering. Linux and snapshot failures preserve complete rendering. Subscribers release listeners with their Vue scope; late snapshots cannot overwrite newer native events. Complete rendering increases DOM/memory use for large loaded histories and catalogs. Normal windowing remains available when native support is known to be off.

### Settings and management

Feature owners retain their existing persistence and data operations. Fields, switches and selectors use localized visible-label names; repeated actions identify their target. Providers support persisted keyboard reordering, connection feedback, complete model catalogs and deletion focus recovery. Session parameters expose names, units and associated validation. Existing credentials remain reachable in onboarding, and setup completion preserves useful chat focus.

Knowledge providers use disclosure buttons and independent switches. Document upload/search/copy/delete, memory and directive CRUD, prompt application, scheduled task output, hooks, backup/import and update checks expose keyboard actions, outcomes and useful focus. Scheduled task history refreshes unfinished manual runs even when the next scheduled time is unchanged. Memory background refreshes preserve surviving focused rows.

Skills support native Folder/ZIP selection, Git scanning, directory synchronization, external-Agent import, editing and deletion. Conflict choices identify their group and target; imports announce results. Typed contract parsing makes reactive acknowledgement arrays cloneable before Electron IPC for deletion and overwrite. Confirmed failures retain the dialog and return to the initiating control.

MCP tools/prompts/resources identify server actions, parameters, validation and result regions; configuration events invalidate prompt suggestions. ACP authentication names methods and terminal input/output, enables xterm accessibility from native support state, and reserves F6 to return to authentication controls without sending the key to the process. Terminal initialization rechecks its instance and challenge after asynchronous loading.

### Workspace and native focus

Workspace sections and recursive file trees expose native disclosure and selection controls. Opening a file focuses its viewer; Back returns to the file. The panel separator supports arrows/Home/End. Image preview and context menus work from the keyboard; Artifact message cards use native buttons and HTML/React frames have titles. Diff tables identify old/new lines and added/removed content in words. Calendar dates expose exact usage values.

The browser toolbar has an Enter webpage action and F6 return instruction. Its typed main-process route only focuses a visible browser attached to the requesting renderer's active session and focused native host window. F6 returns from browser content to host controls. Independent native acceptance uses CUA keyboard events and read-only Electron focus snapshots: Enter webpage transfers to the child WebContents, its button and text input work, and F6 restores the host entry. Floating session activation and setup navigation also transfer native foreground focus correctly.

## Interaction layouts

```text
BEFORE  Icon rail / click-only rows | unnamed editor / incomplete loaded content
AFTER   Named navigation + Skip    | named composer + complete loaded content

BEFORE  Question -> selection submits; async action -> lost focus
AFTER   Question -> named options -> Confirm; result/status -> useful focus

BEFORE  Drop area / unnamed import choices; overwrite -> IPC failure
AFTER   Native picker -> named conflict strategy -> import result status

BEFORE  Activity row skipped by Tab; hidden panel remains reachable
AFTER   Activity button -> destination main; closed panel is inert

BEFORE  Terminal output unavailable; webpage skipped by host Tab sequence
AFTER   Named readable terminal; Enter webpage -> page -> F6 -> host controls
```

## Validation and acceptance

The explorer's matrix records completed operations, shared-component evidence and unverified external boundaries. All 63 reported barriers have independent acceptance. Local evidence covers 222 history messages, 200 Markdown headings, 250 model rows, a complete first-chat onboarding journey, successful and failed management operations, real local provider/MCP/ACP protocol calls, file/archive imports and persisted settings. Fixtures use isolated profiles and do not commit personal credentials or conversations.

The complete renderer suite passes 2452 tests across 274 files. The final external-Agent import/API suites pass 51 tests, including cloneability of nested reactive overwrite acknowledgements. Shared dialog/context-menu checks pass. Independent acceptance confirms Source Agent and conflict group names, announced import totals, persisted overwrite results, and activity navigation through Tab plus Enter/Space with focus on the destination main region. Relevant main browser/dispatcher/contracts suites pass 164 tests, with 32 device/composition checks. Both Electron keyboard-navigation and streaming smoke tests pass; streaming verification removes real attachments with Enter and Space without adding a message or losing the draft. Format, i18n, lint, both TypeScript checks and the production build pass.

Plugin settings entry, content interaction, native Close and Cmd+W have independent acceptance, with return to the named initiating control. Enable/Disable and Refresh retain useful focus. HTML/Text export produces readable files, and the React Artifact fixture renders and responds to its button. Overwrite import immediately replaces the open session list and restores backup messages without renderer reload or process restart. Incremental imports retain existing sessions; both modes permit restored IDs and reject pre-import list responses. Session caches invalidate through the existing lifecycle, and Agent repositories resolve tables through the current database connection instead of retaining closed connections. Import/store/Data Settings suites pass 144 tests, import/contracts pass 64 tests, Agent repositories pass 22 tests, and native close-shortcut checks pass 6 tests. Human VoiceOver/NVDA speech, OS-owned dialog speech, external service authorization and third-party content remain explicit verification boundaries, not accepted first-party workflows.
