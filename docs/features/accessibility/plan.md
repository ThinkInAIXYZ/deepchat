# Accessibility implementation plan

The behavior contract is in [spec.md](spec.md). The dedicated exploration agent owns [exploration.md](exploration.md); the implementation agent owns product changes, validation, commits, and the PR. Each phase requires a concrete exploration report, implementation, independent acceptance, and a commit before advancing.

- [x] Phase 1 — Entry, shell navigation, session selection, accessible controls, and focus. Inspect ownership and callers, repair reported barriers, and obtain keyboard/AX acceptance.
- [ ] Phase 2 — Conversation input and output, history, streaming, search, attachments, model options, message actions, and approval/recovery flows.
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

The independent explorer accepted attachment/Skill deletion without an extra message, Skill insertion and agent-switch draft restoration, memory archive focus, scheduled completion and keyboard Preview, and local MCP resource reads. Relevant editor, draft, memory and scheduled-task suites pass; the draft regression covers selection changes with a cloned saved document, and the scheduled regression covers completion without a changed next-run time. Electron streaming verification also removes real local attachments with both Enter and Space while preserving the draft and original message count; the keyboard navigation smoke test passes. Browser focus and transfer-error acceptance remain separate pending items.
