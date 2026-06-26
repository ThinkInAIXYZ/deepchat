# Zod 4 Native Migration Tasks

- [x] Upgrade dependency declarations and lockfile.
- [x] Add native Zod JSON Schema helper.
- [x] Replace `zod-to-json-schema` imports and calls.
- [x] Migrate legacy Zod schema APIs to Zod 4 recommended APIs.
- [x] Add migration-focused tests.
- [x] Harden provider-facing JSON Schema root output and AI SDK normalization.
- [x] Address CodeRabbit schema normalization comments for root `allOf`
      rejection and shared root field preservation.
- [x] Run focused migration, route, tool presenter, and MCP presenter tests.
- [x] Run formatting, i18n, lint, and typecheck.
- [ ] Full `pnpm test` has been run but is not green because of existing renderer
      test failures outside this migration:
  - `test/renderer/pages/NewThreadPage.test.ts`
  - `test/renderer/components/ChatTabView.test.ts`
  - `test/renderer/components/MemoryConfigPanel.test.ts`
