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
- [ ] Repair autocomplete/search active selection and remaining conversation surface barriers.
