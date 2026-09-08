# Accessibility implementation plan

The behavior contract is in [spec.md](spec.md). The dedicated exploration agent owns [exploration.md](exploration.md); the implementation agent owns product changes, validation, commits, and the PR. Each phase requires a concrete exploration report, implementation, independent acceptance, and a commit before advancing.

- [x] Phase 1 — Entry, shell navigation, session selection, accessible controls, and focus. Inspect ownership and callers, repair reported barriers, and obtain keyboard/AX acceptance.
- [x] Phase 2 — Conversation input and output, history, streaming, search, attachments, model options, message actions, and approval/recovery flows.
- [ ] Phase 3 — Onboarding, all settings pages, provider/agent/model forms, plugin/MCP/skill installation and configuration.
- [ ] Phase 4 — Projects, workspace files, artifacts, terminal, browser, auxiliary windows, and remaining feature inventory.
- [ ] Review the complete change for semantic correctness, focus restoration, localization, lifecycle/performance effects, and scope.
- [ ] Select and retain only behavior-focused regression protection; remove temporary probes.
- [ ] Run format, i18n, lint, typecheck, and relevant renderer/Electron suites; preserve normal registry refreshes.
- [ ] Close every exploration blocker with evidence or explicitly identify an external verification limit. Push accepted phase commits and open a PR against `dev` with behavior, validation, limitations, and BEFORE/AFTER ASCII.

## Current engineering context

The main shell (`ChatMainApp` → `WindowSideBar` / `ChatTabView`) and settings shell own navigation landmarks. Session state remains in the existing session/page-router stores. `WindowSideBarSessionItem` uses a native selection button with independent sibling pin/delete controls. `DcButton` owns shared button naming; rich editor semantics belong to `ChatInputBox` and TipTap editor attributes. The main process publishes native assistive-technology state and owns the guarded embedded-browser focus boundary.

## Phase 1 validation

The exploration agent accepted keyboard session selection with Enter and Space, named multiline input, main/settings skip controls, unique main landmarks, and settings navigation focus in an isolated Electron profile with a local streaming provider. The accessibility Electron smoke test passed. The relevant sidebar/editor/button renderer suites passed (108 tests). Format, i18n, lint, and both TypeScript checks passed.

## Conversation feedback context

`ChatPage` owns session generation state and pending interactions; a persistent polite status region announces running, waiting for permission/input, completed, and failed states. It depends on semantic state rather than token content. The transcript gains a named focusable region so keyboard users can reach and scroll responses. Existing message toolbar keyboard actions remain at their owners. History pagination preserves the reading position; assistive-technology mode retains all loaded message and Markdown nodes.

## Conversation feedback and history validation

- [x] Persistent generation/interaction status accepted with a local streaming provider.
- [x] Explicit earlier-history navigation accepted across 222 messages with Enter/Space, focus restoration, exhausted pagination, and a window resize that preserves reading position.
- [x] Reactive pagination cursors are serialized through the typed API contract; the cloneability regression passes.
- [x] Relevant message/API/scroll/ChatPage tests and streaming/keyboard Electron checks pass; format, i18n, lint, and typecheck pass.
- [x] Preserve complete message and Markdown content while assistive technology is active. Independent Electron acceptance exposed all 200 Markdown headings and all 222 loaded history rows after enabling the isolated app accessibility flag. Native state subscription, lifecycle/race, virtualization, Markdown, and ChatPage regressions pass; format, i18n, lint, and typecheck pass.
- [x] Repair autocomplete/search active selection, Escape cleanup, modal search focus, conversation-find focus return, and first-send composer continuity. Independent Electron acceptance and relevant renderer regression suites pass.
- [ ] Complete remaining conversation surfaces and settings/auxiliary journeys.

## Blocking tool interaction context

`ChatToolInteractionOverlay` owns question/permission presentation and is reused by the interaction dock and read-only sessions. Shared choice groups must use whitespace-free IDs independent of user-supplied values. Questions name the group and describe options. The overlay receives focus when it appears; resolving the active interaction returns focus to the composer (or read-only transcript) unless the user moved elsewhere. Radio navigation only changes selection; an explicit confirmation submits it. This prevents arrow-key exploration from answering a question accidentally. Existing asynchronous response, stale-interaction recovery, and raw translated action values remain at their current owners.

```text
BEFORE  Waiting → lost focus → unnamed radio → selection submits
AFTER   Question → named options → Confirm → composer
```

The exploration agent accepted named question/permission regions, multiword option names and descriptions, arrow/Space selection without submission, explicit confirmation, successful continuation, permission denial, and restored composer focus. Both single- and multiple-choice label regressions pass. Relevant MessageBlock/ChatPage suites, format, i18n, lint, and typecheck pass.

## Autocomplete and search context

TipTap retains textbox focus while `SuggestionList` exposes a named listbox, selected option, and a stable active-descendant relationship. `useChatInputMentions` owns popup lifetime and reactive editor attributes; Escape removes both the popup and its keyboard/ARIA state. Empty suggestions use localized status text. Global Spotlight uses the existing Reka dialog focus scope, a combobox/listbox relationship, a keyboard close control, and restoration to the opener. Existing result execution and store ownership remain unchanged.

```text
BEFORE  Editor → visual highlight only; search overlay → page focus can escape
AFTER   Editor → announced active option; search dialog → Close → opener
```

## Files and secondary controls context

Message editing receives its existing localized action name. Image preview and prompt attachment upload use native buttons with visible keyboard focus and existing dialog/file APIs; image dialogs restore their trigger. The shared context-menu trigger translates Menu/Shift+F10 into the existing anchored context-menu path because Reka's installed trigger only handles pointer events. No separate menus or action implementations are introduced.

## Workspace navigation context and validation

The side-panel owner excludes closed content with `inert` and hidden accessibility semantics, focuses the named panel when opened, and returns to its opener when closed. Its separator uses the store's existing width limits and supports arrows/Home/End. Workspace sections expose disclosure state; recursive files use native nested lists and disclosure buttons. The viewer receives focus after a selected file replaces the list, and Back returns to that file. The exploration agent accepted these paths, image preview/menu/return, named message editing, and prompt upload's actual filechooser invocation. Keyboard context-menu activation and relevant side-panel/workspace/prompt/message regressions pass.

```text
BEFORE  Closed panel remains reachable; file activation → lost focus
AFTER   Open panel → named region → file preview → Back → original file
```

## Settings operation context

Existing settings owners retain their data operations. Field and switch names use their visible localized labels; repeated actions include their target. Knowledge provider headers become disclosure buttons, with independent named switches instead of nested tooltip buttons. Data sync folder selection becomes a keyboard button. New scheduled jobs focus their name; agent saves announce persisted success/failure and recover focus when disabling Save removed it. The settings shell restores its main landmark after internal route changes invalidate focus. The plugin hub focuses its named content region after installation/removal. Programmatic dialogs restore their opener, including skills loaded asynchronously. Memory panels focus their named create/details region and return to the independent row button on Escape. Provider selection and reordering use native buttons and the existing persisted order; successful connection focuses the result region. Model controls expose their names and values.

```text
BEFORE  Switch / combo value; unnamed provider button; save → lost focus
AFTER   Field name + state; provider disclosure + enable; saved → Name
```

The exploration agent accepted all 22 primary settings routes, keyboard knowledge disclosures, scheduled-job creation, saved-agent feedback, memory creation/edit/details/return, plugin installation/removal, skill details, and provider connection/model configuration/persisted keyboard reordering. Settings and dialog regression suites pass (223 tests, including the updated provider-button selectors). Format, i18n, lint, typecheck, and the production Electron build pass. Font selection exposes contextual names and pressed state; the upload limit is a named native spinbutton.

## Auxiliary control semantics and validation

Welcome and shared setup guides expose named nonmodal dialogs, focus each active step, and return to the underlying task when dismissed. The floating overview uses native expand/collapse controls and excludes its inactive layer. Diff tables identify old/new lines and describe changes in words. Calendar dates expose exact daily input, output and cached-token values without hundreds of additional Tab stops. Font controls expose purpose and selection; file-size limits use a named spinbutton. Hook creation focuses Name, and local test execution announces its outcome, names its output region and restores the Test control.

```text
BEFORE  Unnamed guide; hidden floating controls; punctuation-only diff
AFTER   Named guide -> task; Expand -> sessions -> Escape; named diff columns

BEFORE  Static size number; hover-only calendar; hook test -> lost focus
AFTER   Size spinbutton; readable date + usage; test status -> Test
```

The independent explorer accepted A19, A29, A31, A34, A36 and A37 in the production Electron build. Relevant floating, dashboard, display and hook suites pass. Format, i18n, lint and both TypeScript checks pass. Full renderer verification identified stale route fixtures and a knowledge-overview unmount contract; the corrected cases pass in their targeted suites. Complete-suite verification remains pending until the remaining repairs are accepted.

## Native browser focus acceptance

The embedded-browser toolbar exposes an Enter webpage action and an F6 return hint. The typed main-process route only focuses the active session's visible browser attached to the caller's focused window. F6 returns from browser content to the host controls. Unit checks cover valid focus, hidden/wrong-window rejection, return keys and detached content. Native keyboard acceptance remains pending because the macOS UI controller reports the machine is locked; this is not a passing browser journey.

```text
BEFORE  Address -> Expand -> host sidebar (webpage skipped)
AFTER   Enter webpage -> page controls -> F6 -> browser controls
```

## Knowledge, memory directives, MCP and backup actions

Knowledge documents expose a native upload action, named search, contextual result copy/retry/delete controls, named detail/overview regions and focus on Return. Memory directives focus the created row and preserve its DOM while background refreshes run; confirmed deletion returns to Instruction. MCP capability actions identify the server, feature and count. Tool and prompt debugging names JSON parameters, associates validation errors, announces execution and focuses named results. Custom prompt actions include their target, and configuration events invalidate the suggestion cache immediately. Local backup restores its action focus; import modes form a named radio group with associated option labels.

```text
BEFORE  MCP "1" -> "{}" -> result text / lost focus
AFTER   Server + Tools -> Parameters + name -> Result region

BEFORE  Create directive -> refresh removes focus; unnamed import choices
AFTER   Created row survives refresh; Import Data -> named import modes
```

The independent explorer accepted local document upload/search/copy/delete/Return, directive creation/deletion, local MCP tool/prompt execution, immediate custom-prompt application and local backup/incremental import. Relevant MCP/directive tests pass, including invalid JSON and focused results and preservation during refresh. The Data & Privacy suite passes (36 tests). A complete renderer run passes all 2447 tests across 274 files; subsequent draft, scheduled-task and memory-lifecycle changes have separate targeted checks and acceptance.

## Composer controls and asynchronous management

Embedded controls retain native Enter/Space activation and Tab navigation without triggering composer submission. Attachment and Skill removal returns focus to the editor. New-thread draft synchronization compares document content and restores snapshots only for external changes or replacement input handles, preserving freshly inserted Skill nodes and drafts across agents. Memory archive/restore returns to the surviving row or Add memory. Scheduled tasks announce their latest state, expose output previews, retain Run now focus, and refresh unfinished manual runs even when the next scheduled time is unchanged. MCP resources have named selection, loading feedback and a focused result region.

```text
BEFORE  Delete attachment + Enter -> sends message; Skill state and DOM disagree
AFTER   Delete + Enter/Space -> removal -> composer; draft and Skill remain consistent

BEFORE  Run now -> lost focus; History shows only a time and can stay stale
AFTER   Run now -> same control; Running -> Completed -> readable Preview
```

The independent explorer accepted attachment/Skill deletion without an extra message, Skill insertion and agent-switch draft restoration, memory archive focus, scheduled completion and keyboard Preview, and local MCP resource reads. Relevant editor, draft, memory and scheduled-task suites pass; the draft regression covers selection changes with a cloned saved document, and the scheduled regression covers completion without a changed next-run time. Electron streaming verification also removes real local attachments with both Enter and Space while preserving the draft and original message count; the keyboard navigation smoke test passes. Transfer failure and successful transfer have independent runtime acceptance. Browser focus remains pending native acceptance.


## Complete catalogs, artifacts and transition recovery

Provider model catalogs retain every filtered row while assistive technology is active, using the same row template as the existing virtual scroller. Capability/type/sort controls expose pressed state. Model deletion focuses the named Model List region; rate-limit controls expose their purpose and units and preserve focus across saves. Message Artifact cards use native buttons; HTML and React preview frames identify their document. Transfer failures focus a named alert, and leaving onboarding for chat recovers the main landmark when route replacement removes focus.

```text
BEFORE  250 models -> 19 readable rows; delete -> lost focus
AFTER   AT mode -> 250 readable rows; delete -> Model List

BEFORE  Click-only Artifact; unnamed frame; transfer error -> lost focus
AFTER   Artifact button + Enter -> titled preview; failure -> named alert
```

The independent explorer accepted all 250 model switches, model deletion, named rate controls with an actual interval save, HTML Artifact entry and frame title, transfer failure/success, and Skip All focus recovery. React uses the same message entry and has a frame-title regression assertion; React runtime execution is not counted as independently accepted. Provider/rate/Artifact tests pass (10 tests), and onboarding/startup/Skills route tests pass (29 tests). The complete renderer suite passes 2448 tests across 274 files. Format, i18n, lint, typecheck and the production build pass.


## Installation, authentication and operation recovery

Local Skill Folder and ZIP selection uses native buttons with visible focus and disabled state. Installation exposes progress, URL validation and errors. Git scanning names its repository and conflict strategy, announces selection counts, and focuses the discovered Skills. Skill deletion serializes acknowledged agent IDs through its typed contract before Electron IPC. Pending confirmation dialogs recover their initiating control after failure when focus was lost; About update checks apply the same ownership rule at their feature boundary.

ACP authentication names methods from their visible labels, identifies their descriptions, and announces authentication state and errors. Its xterm instance uses the shared native accessibility state, exposes a named terminal input and output region, and retains a visible F6 return instruction. F6 returns to the authentication controls without sending the key to the authentication process. Concurrent terminal initialization rechecks the live instance and challenge after loading xterm.

The application event catalog binds onboarding resume and accessibility changes to their distinct schemas. Contract validation checks that each catalog key matches its event name. Browser keyboard entry remains restricted to the requesting renderer's active session and native host window.

```text
BEFORE  Folder/ZIP drop area -> no keyboard chooser
AFTER   Folder/ZIP button -> native chooser -> installation feedback

BEFORE  Authentication method ID -> terminal input without readable output
AFTER   Named method -> readable sign-in terminal -> F6 -> authentication controls

BEFORE  Delete Skill -> IPC clone failure; update check -> lost focus
AFTER   Typed deletion input; failed confirmation/check -> initiating control
```

Independent acceptance covers Folder installation, editable Skill content, Git scanning/strategy/install, advanced System Prompt naming, ACP terminal output and F6/Cancel, and model/agent/settings persistence. Independent acceptance also covers successful and controlled-failure Skill deletion, ZIP and sync-directory import/export, update-check focus, resumed onboarding with an existing key, the full first-chat completion journey, named session model parameters with persisted edits, QR readiness status, and named model connectivity testing with announced success. Relevant API/dialog/About tests pass (57 tests); ACP/advanced/Skills tests pass (31 tests); main browser, dispatcher and route contracts pass (164 tests), and device/composition tests pass (32 tests). Both Electron keyboard navigation and streaming/real-attachment smoke tests pass. Repository quality gates and the production build pass.


## Setup navigation and parameter context

The main shell restores its named main landmark when outer route navigation removes the active element, including Skills-to-chat onboarding. Existing provider credentials retain a reachable guide anchored to Update key. Session numeric parameters have visible-label names and associated validation errors; optional reasoning/verbosity selectors are named. Directory imports identify their conflict strategy, preserve Refresh focus and focus their results after import. Remote QR installation and model connectivity checks expose persistent status and explicit errors.

```text
BEFORE  Saved API key -> missing guide; Skills -> chat -> lost focus
AFTER   Update key anchor -> Next; Skills -> chat -> main -> agent selection

BEFORE  Unnamed parameter value; directory import -> lost focus
AFTER   Named parameter + validation; Import -> named result region
```

All these paths have independent runtime acceptance. The complete renderer suite passes 2450 tests across 274 files; setup-focused tests pass (121 tests), Remote Settings passes (34 tests), affected main suites pass (196 tests), and both Electron smoke tests pass. Format, i18n, lint, typecheck and production build pass. Settings activity-row keyboard activation and external-Agent import source labeling remain in the exploration queue, alongside native focus acceptance after macOS unlock.
