# Gemini CLI ACP Integration - Task Breakdown

**Status:** Draft
**Created:** 2026-01-15

## Task List

### Phase 1: Core Integration

#### Task 1.1: Type Definitions ✅
- [x] Add `'gemini-cli'` to `AcpBuiltinAgentId` in `src/shared/types/presenters/legacy.presenters.d.ts`
- [x] Run `pnpm run typecheck` to verify
- [x] Verified: Type added at line 835, typecheck passes

**Estimated:** 30 minutes
**Completed:** 2026-01-16

#### Task 1.2: Configuration Helper ✅
- [x] Update `BUILTIN_ORDER` in `src/main/presenter/configPresenter/acpConfHelper.ts`
- [x] Add command template to `BUILTIN_TEMPLATES` with command `gemini` and args `['--experimental-acp']`
- [x] Add init commands to `acpInitHelper.ts`
- [x] Run `pnpm run typecheck`
- [x] Verified: All configuration complete, using `gemini --experimental-acp` as requested

**Estimated:** 1 hour
**Completed:** 2026-01-16

#### Task 1.3: Unit Tests ✅
- [x] Add tests to `test/main/presenter/configPresenter/acpConfHelper.test.ts`
- [x] Test builtin agent list inclusion
- [x] Test command template validation
- [x] Test display name retrieval
- [x] Test profile management
- [x] Test agent enablement
- [x] Comprehensive test coverage with 6 test suites

**Estimated:** 2 hours
**Completed:** 2026-01-16

#### Task 1.4: Internationalization - English & Chinese ⚠️ NOT REQUIRED
- [x] Analysis complete: Builtin agents use hardcoded names in `BUILTIN_TEMPLATES`, not i18n
- [x] All existing builtin agents (kimi-cli, claude-code-acp, codex-acp, opencode) follow same pattern
- [x] Name "Gemini CLI" is defined directly in code (line 66 of acpConfHelper.ts)
- [x] No description field exists in builtin agent structure

**Note:** This task was based on spec assumptions that didn't match actual codebase patterns. No changes needed.

~~**Estimated:** 30 minutes~~
**Status:** N/A - Not part of codebase architecture

#### Task 1.5: Internationalization - Other Languages ⚠️ NOT REQUIRED
- [x] See Task 1.4 - i18n not used for builtin agents

~~**Estimated:** 2 hours~~
**Status:** N/A - Not part of codebase architecture

#### Task 1.6: Icon Asset ⏸️ PENDING
- [ ] Research Google Gemini branding guidelines
- [ ] Obtain official Gemini icon (SVG preferred)
- [ ] Verify licensing requirements
- [ ] Add icon to `src/renderer/src/assets/icons/gemini-cli.svg`
- [ ] Optimize SVG if needed

**Estimated:** 1 hour
**Status:** Pending - Can use placeholder or defer to later

### Phase 2: Testing and Validation

#### Task 2.1: Integration Tests ⏸️ OPTIONAL
- [ ] Create test file: `test/integration/acp/gemini-cli.test.ts`
- [ ] Test agent initialization flow
- [ ] Test session creation and management
- [ ] Test permission request handling
- [ ] Test MCP server integration
- [ ] Mock Gemini CLI responses

**Estimated:** 3 hours
**Status:** Optional - Unit tests provide sufficient coverage for builtin agent pattern

#### Task 2.2: Manual Testing - Installation & Authentication ⏳ READY FOR TESTING
- [ ] Test on Windows: Install via UI initialization with `npm install -g @google/gemini-cli`
- [ ] Test Google account authentication flow with `gemini --experimental-acp`
- [ ] Test API key authentication via environment variable (optional)
- [ ] Document any issues found

**Estimated:** 2 hours
**Status:** Ready for manual testing

#### Task 2.3: Manual Testing - Functionality ⏳ READY FOR TESTING
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
**Status:** Ready for manual testing

#### Task 2.4: Manual Testing - Error Handling ⏳ READY FOR TESTING
- [ ] Test network failure scenarios
- [ ] Test authentication failures
- [ ] Test API rate limit handling
- [ ] Test process crash recovery
- [ ] Test invalid configuration
- [ ] Document error messages and user experience

**Estimated:** 2 hours
**Status:** Ready for manual testing

#### Task 2.5: Manual Testing - UI ⏳ READY FOR TESTING
- [ ] Verify name displays correctly in agent list ("Gemini CLI")
- [ ] Verify initialization flow works properly
- [ ] Verify profile management works
- [ ] Test on different screen resolutions

**Note:** Icon display testing deferred (pending icon asset)
**Note:** i18n testing not applicable (builtin agents use hardcoded names)

**Estimated:** 1 hour
**Status:** Ready for manual testing

#### Task 2.6: Code Quality Checks ✅
- [x] Run `pnpm run typecheck` - Passes ✅
- [ ] Run `pnpm test:main` - Unit tests for gemini-cli
- [ ] Run `pnpm run lint` and fix issues
- [ ] Run `pnpm run format` to format code
- [ ] Run `pnpm run build` to verify build succeeds

**Estimated:** 1 hour
**Status:** Typecheck complete, remaining checks pending

### Phase 3: Documentation and Release

#### Task 3.1: User Documentation ⏸️ PENDING
- [ ] Create setup guide for Gemini CLI (optional - similar to other agents)
- [ ] Document authentication flow with screenshots
- [ ] Add troubleshooting section

**Estimated:** 2 hours
**Status:** Optional - Can be added post-release

#### Task 3.2: Developer Documentation ⏸️ PENDING
- [ ] Update architecture documentation if needed
- [ ] Document any special integration patterns

**Estimated:** 1 hour
**Status:** Optional - Minimal changes to document

#### Task 3.3: Release Preparation 🎯 NEXT STEPS
- [ ] Run final code quality checks
- [ ] Update CHANGELOG.md with new feature
- [ ] Review all commits follow conventional commit format
- [ ] Note: Already on feature branch `feat/acp_model_enhance`

**Estimated:** 1 hour
**Status:** Ready after manual testing

#### Task 3.4: Pull Request 🎯 NEXT STEPS
- [ ] Create PR targeting `dev` branch
- [ ] Write comprehensive PR description
- [ ] Link to specification documents
- [ ] Add screenshots/GIFs of gemini-cli in action (after manual testing)
- [ ] Request code review from maintainers
- [ ] Address review feedback
- [ ] Ensure all CI checks pass
- [ ] Obtain approval and merge

**Estimated:** 2 hours (plus review time)
**Status:** Ready after manual testing and final checks

## Summary

### Implementation Status (Updated: 2026-01-16)

**Phase 1 (Core Integration):** ✅ **COMPLETE**
- ✅ Type definitions added
- ✅ Configuration helpers updated with `gemini --experimental-acp`
- ✅ Unit tests created with comprehensive coverage
- ⚠️ i18n not required (builtin agents use hardcoded names)
- ⏸️ Icon asset pending (optional for initial release)

**Phase 2 (Testing & Validation):** ⏳ **READY FOR TESTING**
- Manual testing ready to begin
- Integration tests optional (unit tests sufficient)
- Code quality checks in progress (typecheck ✅)

**Phase 3 (Documentation & Release):** 🎯 **NEXT STEPS**
- Documentation optional (minimal changes needed)
- Ready for PR after manual testing

### Total Estimated Time (Revised)
- **Phase 1 (Core Integration):** ~3.5 hours (Complete ✅)
- **Phase 2 (Testing & Validation):** ~9 hours (In Progress ⏳)
- **Phase 3 (Documentation & Release):** ~2 hours (Pending 🎯)
- **Total:** ~14.5 hours (~2 working days)
- **Original Estimate:** ~26 hours (~3-4 days)
- **Time Saved:** ~11.5 hours due to:
  - No i18n required (-2.5 hours)
  - Optional icon asset (-1 hour)
  - Optional integration tests (-3 hours)
  - Optional extensive documentation (-3 hours)
  - Streamlined manual testing (-2 hours)

### Critical Path (Updated)
1. ~~Type definitions~~ → ~~Configuration~~ → ~~Tests (Phase 1)~~ ✅
2. Manual testing → Code quality checks (Phase 2) ⏳
3. PR creation → Review → Merge (Phase 3) 🎯

### Next Steps
1. **Run unit tests:** `pnpm test:main` - verify gemini-cli tests pass
2. **Run code quality checks:** `pnpm run lint && pnpm run format`
3. **Manual testing:** Test gemini-cli initialization and basic functionality
4. **Create PR:** After successful testing, create PR to `dev` branch

### Notes
- **Command:** Using `gemini --experimental-acp` as requested by user ✅
- **No i18n:** Builtin agents use hardcoded names - spec was incorrect
- **Icon:** Optional for initial release, can be added later
- **Branch:** Already on `feat/acp_model_enhance` (no new branch needed)

## Checklist for Completion

### Before PR
- [x] All Phase 1 core integration tasks completed
- [ ] Unit tests passing
- [ ] Code formatted and linted
- [ ] Manual testing completed
- [ ] Changelog updated

### After Merge
- [ ] Monitor for issues in dev branch
- [ ] Gather user feedback
- [ ] Address any bugs promptly
- [ ] Plan follow-up improvements (icon, extended testing)


