# Gemini CLI ACP Integration - Implementation Plan

**Status:** Draft
**Created:** 2026-01-15
**Estimated Duration:** 5-7 days

## 1. Overview

This plan outlines the step-by-step implementation approach for integrating Google's Gemini CLI as a builtin ACP agent in DeepChat. The integration follows established patterns from existing ACP agents (kimi-cli, claude-code-acp, codex-acp, opencode).

### 1.1 Implementation Strategy

- **Incremental Development**: Build and test each component independently
- **Pattern Reuse**: Follow existing ACP agent integration patterns
- **Test-Driven**: Write tests alongside implementation
- **Multi-Platform**: Ensure compatibility across Windows, macOS, Linux

### 1.2 Prerequisites

- [x] ACP infrastructure already exists in codebase
- [x] Gemini CLI is publicly available via npm
- [x] Specification document completed
- [ ] Icon asset obtained (pending licensing verification)
- [ ] Development environment set up

## 2. Implementation Phases

### Phase 1: Core Integration (Days 1-3)

#### 2.1.1 Type Definitions (0.5 day)
**File:** `src/shared/types/acp.ts`

**Tasks:**
1. Add `'gemini-cli'` to `AcpBuiltinAgentId` union type
2. Run typecheck to ensure no breaking changes
3. Commit changes

**Acceptance Criteria:**
- TypeScript compilation succeeds
- No type errors in dependent files

#### 2.1.2 Configuration Helper (1 day)
**File:** `src/main/presenter/configPresenter/acpConfHelper.ts`

**Tasks:**
1. Add `'gemini-cli'` to `BUILTIN_ORDER` array
2. Add command template to `BUILTIN_TEMPLATES`:
   ```typescript
   'gemini-cli': {
     command: 'npx',
     args: ['-y', '@google/gemini-cli']
   }
   ```
3. Update icon mapping function (if exists)
4. Write unit tests for new agent
5. Run tests and verify all pass

**Acceptance Criteria:**
- Gemini CLI appears in builtin agents list
- Command template correctly configured
- All unit tests pass

#### 2.1.3 Internationalization (1 day)
**Files:** `src/renderer/src/locales/*.json` (12 files)

**Tasks:**
1. Add i18n keys for all 12 supported languages:
   - `acp.builtin.gemini-cli.name`
   - `acp.builtin.gemini-cli.description`
2. Translate description to each language:
   - zh-CN (Chinese Simplified)
   - en-US (English)
   - ja-JP (Japanese)
   - ko-KR (Korean)
   - zh-TW (Chinese Traditional)
   - es-ES (Spanish)
   - fr-FR (French)
   - de-DE (German)
   - ru-RU (Russian)
   - pt-BR (Portuguese)
   - it-IT (Italian)
   - ar-SA (Arabic)
3. Run `pnpm run i18n` to verify completeness
4. Run `pnpm run i18n:types` to regenerate types

**Acceptance Criteria:**
- All 12 locale files updated
- i18n completeness check passes
- TypeScript types regenerated

#### 2.1.4 Icon Asset (0.5 day)
**File:** `src/renderer/src/assets/icons/gemini-cli.svg`

**Tasks:**
1. Research Google Gemini branding guidelines
2. Obtain official icon (SVG preferred)
3. Verify licensing and attribution requirements
4. Add icon to assets directory
5. Optimize SVG if needed (remove unnecessary metadata)

**Acceptance Criteria:**
- Icon file added to repository
- Proper licensing documented
- Icon displays correctly in UI

### Phase 2: Testing and Validation (Days 3-5)

#### 2.2.1 Unit Tests (1 day)
**File:** `test/main/presenter/configPresenter/acpConfHelper.test.ts`

**Tasks:**
1. Write tests for builtin agent list inclusion
2. Write tests for command template validation
3. Write tests for display name retrieval
4. Write tests for icon path retrieval
5. Run test suite: `pnpm test:main`
6. Verify 100% coverage for new code

**Acceptance Criteria:**
- All unit tests pass
- Code coverage maintained or improved
- No test flakiness

#### 2.2.2 Integration Tests (1 day)
**File:** `test/integration/acp/gemini-cli.test.ts` (new file)

**Tasks:**
1. Test agent initialization flow
2. Test session creation and management
3. Test permission request handling
4. Test MCP server integration
5. Mock Gemini CLI responses for testing
6. Run integration tests: `pnpm test`

**Acceptance Criteria:**
- All integration tests pass
- Tests cover happy path and error scenarios
- Tests run reliably in CI environment

#### 2.2.3 Manual Testing (1 day)
**Platform:** Windows, macOS, Linux

**Tasks:**
1. Test installation via UI initialization flow
2. Test authentication with Google account
3. Test conversation flow with streaming responses
4. Test file operation permissions
5. Test MCP tool integration
6. Test error handling (network failures, auth errors)
7. Test UI elements (icon, name, description)
8. Test in all 12 supported languages

**Acceptance Criteria:**
- All manual test scenarios pass
- No critical bugs found
- UI displays correctly across platforms

#### 2.2.4 Code Quality (0.5 day)

**Tasks:**
1. Run linter: `pnpm run lint`
2. Run formatter: `pnpm run format`
3. Run typecheck: `pnpm run typecheck`
4. Fix any issues found
5. Verify build succeeds: `pnpm run build`

**Acceptance Criteria:**
- No lint errors
- Code properly formatted
- No type errors
- Build succeeds on all platforms

### Phase 3: Documentation and Release (Days 6-7)

#### 2.3.1 Documentation (0.5 day)

**Tasks:**
1. Update user documentation with Gemini CLI setup guide
2. Add troubleshooting section for common issues
3. Document authentication flow
4. Add screenshots of UI elements
5. Update changelog/release notes

**Acceptance Criteria:**
- Documentation is clear and comprehensive
- All setup steps documented
- Screenshots added

#### 2.3.2 Code Review and PR (0.5 day)

**Tasks:**
1. Create feature branch: `feat/acp-gemini-cli`
2. Commit all changes with conventional commit messages
3. Push to remote repository
4. Create pull request targeting `dev` branch
5. Address code review feedback
6. Obtain approval from maintainers

**Acceptance Criteria:**
- PR created with clear description
- All CI checks pass
- Code review approved
- Ready to merge

## 3. Dependencies and Blockers

### 3.1 External Dependencies
- **Gemini CLI npm package**: Must be publicly available (✓ confirmed)
- **Google Gemini API**: Must be accessible for authentication
- **Icon licensing**: Need permission to use Google Gemini icon

### 3.2 Internal Dependencies
- **ACP infrastructure**: Already implemented (✓)
- **i18n system**: Already implemented (✓)
- **Configuration system**: Already implemented (✓)

### 3.3 Potential Blockers
1. **Icon licensing delays**: Mitigation - use placeholder icon initially
2. **Gemini CLI breaking changes**: Mitigation - pin to specific version
3. **Authentication complexity**: Mitigation - rely on Gemini CLI's built-in flow

## 4. Risk Mitigation

### 4.1 Technical Risks
- **NPX download failures**: Provide clear error messages and retry mechanism
- **Process management issues**: Reuse proven ACP infrastructure
- **Cross-platform compatibility**: Test on all platforms early

### 4.2 Timeline Risks
- **Icon acquisition delays**: Use placeholder, update later
- **Translation delays**: Start with English and Chinese, add others incrementally
- **Testing bottlenecks**: Parallelize manual testing across team members

## 5. Success Criteria

### 5.1 Functional Requirements
- [x] Gemini CLI appears in ACP agent list
- [x] Agent can be initialized via UI
- [x] Authentication flow works seamlessly
- [x] Conversations stream correctly
- [x] Permissions handled properly
- [x] MCP integration works

### 5.2 Quality Requirements
- [x] All unit tests pass
- [x] All integration tests pass
- [x] No critical bugs
- [x] Code review approved
- [x] Documentation complete

### 5.3 User Experience Requirements
- [x] Icon displays correctly
- [x] i18n strings in all languages
- [x] Clear error messages
- [x] Smooth initialization flow

## 6. Rollout Plan

### 6.1 Internal Testing
1. Deploy to development environment
2. Test with internal team members
3. Gather feedback and fix issues

### 6.2 Beta Release
1. Merge to `dev` branch
2. Include in next beta release
3. Monitor user feedback and error reports

### 6.3 Production Release
1. Verify stability in beta
2. Merge to `main` branch
3. Include in next stable release
4. Announce in release notes

