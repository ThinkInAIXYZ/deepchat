# Agent plan retirement follow-up

Implement the ownership and compatibility boundaries in [spec.md](./spec.md). Start from the merge
of PR #2384 on `dev`; keep this follow-up on a separate branch so it can be reviewed and reverted
independently. Do not edit user data or revive runtime capability.

- [x] Consolidate persisted metadata into a legacy-only shared type, move historical parsing and
      presentation to the renderer, and remove unused schemas and terminal lifecycle helpers.
- [x] Remove obsolete mocks, comments, UI identifiers and unreachable translations. Update directly
      affected specifications; retain historical implementation records with an explicit notice.
- [x] Review the entire diff for compatibility and scope. Then select existing checks and add only
      durable catalog, ACP negotiation/ignore, and historical-display regression assertions.
- [x] Run formatting, i18n, lint, typecheck, targeted main and renderer suites, and confirm unchanged
      historical rendering through the component tests. Inspect all tool-generated changes and
      remove temporary probes.
- [x] Commit the verified follow-up and push the separate branch under the requested commit/push
      workflow. Report delivery state; creating a new PR remains a separate action.

## Validation

- `pnpm run format`, `pnpm run format:check`, `pnpm run i18n`, `pnpm run lint`,
  `pnpm run typecheck` and `git diff --check` passed.
- Main: 20 suites / 467 tests passed across ACP runtime, DeepChat dispatch/process,
  Zod migration contracts and ToolService. New assertions use the real built-in catalog and
  generated prompts for Agent, Code and Minimal modes; a same-name MCP tool remains available.
- Renderer: 22 suites / 335 tests passed across MessageBlockToolCall, ChatPage, chat-page features
  and ACP components. DOM and accessibility assertions cover historical aliases, independent
  snapshots, malformed entries, and MCP-name isolation. No visual layout or style change was made;
  no new Electron E2E or screenshot run was performed for this follow-up.
- The i18n type generator exposed unrelated baseline drift. Only the removed plan status key was
  retained in the generated declaration; locale validation passed for all 23 locales.
- Existing data stays untouched. No external ACP-agent smoke test or full application suite was run.
