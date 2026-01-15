# Gemini CLI ACP Integration - Task Breakdown

**Status:** Draft
**Created:** 2026-01-15

## Task List

### Phase 1: Core Integration

#### Task 1.1: Type Definitions ✅
- [x] Add `'gemini-cli'` to `AcpBuiltinAgentId` in `src/shared/types/presenters/legacy.presenters.d.ts`
- [x] Run `pnpm run typecheck` to verify
- [ ] Commit: `feat(acp): add gemini-cli type definition`

**Estimated:** 30 minutes
**Completed:** 2026-01-15

#### Task 1.2: Configuration Helper ✅
- [x] Update `BUILTIN_ORDER` in `src/main/presenter/configPresenter/acpConfHelper.ts`
- [x] Add command template to `BUILTIN_TEMPLATES`
- [x] Add init commands to `acpInitHelper.ts`
- [x] Run `pnpm run typecheck`
- [ ] Commit: `feat(acp): add gemini-cli configuration`

**Estimated:** 1 hour

#### Task 1.3: Unit Tests
- [ ] Add tests to `test/main/presenter/configPresenter/acpConfHelper.test.ts`
- [ ] Test builtin agent list inclusion
- [ ] Test command template validation
- [ ] Test display name retrieval
- [ ] Test icon path retrieval
- [ ] Run `pnpm test:main` to verify
- [ ] Commit: `test(acp): add gemini-cli unit tests`

**Estimated:** 2 hours

#### Task 1.4: Internationalization - English & Chinese
- [ ] Add i18n keys to `src/renderer/src/locales/en-US.json`
- [ ] Add i18n keys to `src/renderer/src/locales/zh-CN.json`
- [ ] Keys: `acp.builtin.gemini-cli.name` and `acp.builtin.gemini-cli.description`
- [ ] Run `pnpm run i18n` to verify
- [ ] Commit: `feat(acp): add gemini-cli i18n for en-US and zh-CN`

**Estimated:** 30 minutes

#### Task 1.5: Internationalization - Other Languages
- [ ] Add i18n keys to remaining 10 locale files:
  - `ja-JP.json`, `ko-KR.json`, `zh-TW.json`
  - `es-ES.json`, `fr-FR.json`, `de-DE.json`
  - `ru-RU.json`, `pt-BR.json`, `it-IT.json`, `ar-SA.json`
- [ ] Run `pnpm run i18n` to verify completeness
- [ ] Run `pnpm run i18n:types` to regenerate types
- [ ] Commit: `feat(acp): add gemini-cli i18n for all languages`

**Estimated:** 2 hours

#### Task 1.6: Icon Asset
- [ ] Research Google Gemini branding guidelines
- [ ] Obtain official Gemini icon (SVG preferred)
- [ ] Verify licensing requirements
- [ ] Add icon to `src/renderer/src/assets/icons/gemini-cli.svg`
- [ ] Optimize SVG if needed
- [ ] Commit: `feat(acp): add gemini-cli icon asset`

**Estimated:** 1 hour

### Phase 2: Testing and Validation

#### Task 2.1: Integration Tests
- [ ] Create test file: `test/integration/acp/gemini-cli.test.ts`
- [ ] Test agent initialization flow
- [ ] Test session creation and management
- [ ] Test permission request handling
- [ ] Test MCP server integration
- [ ] Mock Gemini CLI responses
- [ ] Run `pnpm test` to verify
- [ ] Commit: `test(acp): add gemini-cli integration tests`

**Estimated:** 3 hours

#### Task 2.2: Manual Testing - Installation & Authentication
- [ ] Test on Windows: Install via UI initialization
- [ ] Test on macOS: Install via UI initialization
- [ ] Test on Linux: Install via UI initialization
- [ ] Test Google account authentication flow
- [ ] Test API key authentication (optional)
- [ ] Document any issues found

**Estimated:** 2 hours

#### Task 2.3: Manual Testing - Functionality
- [ ] Test conversation with streaming responses
- [ ] Test file read operations (permission requests)
- [ ] Test file write operations (permission requests)
- [ ] Test MCP tool integration
- [ ] Test mode switching (if supported)
- [ ] Test model switching (if supported)
- [ ] Test session persistence across app restarts
- [ ] Test multiple concurrent sessions
- [ ] Document any issues found

**Estimated:** 3 hours

#### Task 2.4: Manual Testing - Error Handling
- [ ] Test network failure scenarios
- [ ] Test authentication failures
- [ ] Test API rate limit handling
- [ ] Test process crash recovery
- [ ] Test invalid configuration
- [ ] Document error messages and user experience

**Estimated:** 2 hours

#### Task 2.5: Manual Testing - UI & i18n
- [ ] Verify icon displays correctly in agent list
- [ ] Verify name displays correctly
- [ ] Verify description displays correctly
- [ ] Test UI in all 12 supported languages
- [ ] Test on different screen resolutions
- [ ] Document any UI issues

**Estimated:** 2 hours

#### Task 2.6: Code Quality Checks
- [ ] Run `pnpm run lint` and fix issues
- [ ] Run `pnpm run format` to format code
- [ ] Run `pnpm run typecheck` to verify types
- [ ] Run `pnpm run build` to verify build succeeds
- [ ] Test build on Windows, macOS, Linux
- [ ] Commit: `chore(acp): code quality improvements for gemini-cli`

**Estimated:** 1 hour

### Phase 3: Documentation and Release

#### Task 3.1: User Documentation
- [ ] Create setup guide for Gemini CLI
- [ ] Document authentication flow with screenshots
- [ ] Add troubleshooting section
- [ ] Document common error messages
- [ ] Add FAQ section
- [ ] Commit: `docs(acp): add gemini-cli user documentation`

**Estimated:** 2 hours

#### Task 3.2: Developer Documentation
- [ ] Update architecture documentation
- [ ] Document integration patterns used
- [ ] Add code examples
- [ ] Update API documentation if needed
- [ ] Commit: `docs(acp): add gemini-cli developer documentation`

**Estimated:** 1 hour

#### Task 3.3: Release Preparation
- [ ] Update CHANGELOG.md with new feature
- [ ] Prepare release notes
- [ ] Create feature branch: `feat/acp-gemini-cli`
- [ ] Ensure all commits follow conventional commit format
- [ ] Push branch to remote

**Estimated:** 1 hour

#### Task 3.4: Pull Request
- [ ] Create PR targeting `dev` branch
- [ ] Write comprehensive PR description
- [ ] Link to specification documents
- [ ] Add screenshots/GIFs of functionality
- [ ] Request code review from maintainers
- [ ] Address review feedback
- [ ] Ensure all CI checks pass
- [ ] Obtain approval and merge

**Estimated:** 2 hours (plus review time)

## Summary

### Total Estimated Time
- **Phase 1 (Core Integration):** ~7 hours
- **Phase 2 (Testing & Validation):** ~13 hours
- **Phase 3 (Documentation & Release):** ~6 hours
- **Total:** ~26 hours (~3-4 working days)

### Critical Path
1. Type definitions → Configuration → Tests (Phase 1)
2. Integration tests → Manual testing (Phase 2)
3. Documentation → PR (Phase 3)

### Parallel Work Opportunities
- i18n translations can be done in parallel with testing
- Documentation can start while testing is ongoing
- Icon acquisition can happen anytime in Phase 1

### Dependencies
- Icon licensing must be resolved before final release
- All tests must pass before creating PR
- Code review approval required before merge

### Risk Mitigation
- Start with English/Chinese i18n, add others later if time-constrained
- Use placeholder icon if licensing delayed
- Prioritize critical functionality tests over edge cases

## Checklist for Completion

### Before Starting
- [ ] Read specification document thoroughly
- [ ] Set up development environment
- [ ] Verify Node.js >= 20 installed
- [ ] Verify pnpm >= 10.11.0 installed

### During Development
- [ ] Follow conventional commit format
- [ ] Run tests after each significant change
- [ ] Keep specification documents updated
- [ ] Document any deviations from plan

### Before PR
- [ ] All tasks completed
- [ ] All tests passing
- [ ] Code formatted and linted
- [ ] Documentation complete
- [ ] Changelog updated

### After Merge
- [ ] Monitor for issues in dev branch
- [ ] Gather user feedback
- [ ] Address any bugs promptly
- [ ] Plan follow-up improvements

