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

The main shell (`ChatMainApp` → `WindowSideBar` / `ChatTabView`) and settings shell own navigation landmarks. Session state remains in the existing session/page-router stores. `WindowSideBarSessionItem` currently attaches selection to a non-focusable wrapper; its existing sibling pin/delete buttons must remain independent. `DcButton` owns shared button naming; rich editor semantics belong to `ChatInputBox` and TipTap editor attributes. No main-process API changes are planned until exploration establishes a need.

## Phase 1 validation

The exploration agent accepted keyboard session selection with Enter and Space, named multiline input, main/settings skip controls, unique main landmarks, and settings navigation focus in an isolated Electron profile with a local streaming provider. The accessibility Electron smoke test passed. The relevant sidebar/editor/button renderer suites passed (108 tests). Format, i18n, lint, and both TypeScript checks passed.

## Conversation feedback context

`ChatPage` owns session generation state and pending interactions; a persistent polite status region announces running, waiting for permission/input, completed, and failed states. It depends on semantic state rather than token content. The transcript gains a named focusable region so keyboard users can reach and scroll responses. Existing message toolbar keyboard actions remain at their owners. Long-history virtualization and pagination require independent exploration before selecting their repair.

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
