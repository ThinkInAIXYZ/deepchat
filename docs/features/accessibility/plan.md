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
