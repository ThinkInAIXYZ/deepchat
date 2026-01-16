# Qwen Code ACP Integration - Implementation Plan

**Status:** Draft
**Created:** 2026-01-16
**Related Spec:** `spec.md`
**Target Branch:** `feat/acp_model_enhance` or new feature branch

## 1. Overview

This document outlines the implementation strategy for integrating Qwen Code as a builtin ACP agent in DeepChat. The implementation follows the established pattern used for previous ACP agents (gemini-cli, opencode) and leverages the existing ACP infrastructure.

## 2. Implementation Strategy

### 2.1 Approach

**Incremental Integration:**
- Follow the proven pattern from gemini-cli and opencode integrations
- Reuse 100% of existing ACP infrastructure (no new components needed)
- Focus on configuration, initialization, and localization
- Minimal code changes, maximum reuse

**Risk Mitigation:**
- Test on all three platforms (Windows, macOS, Linux)
- Verify Python dependency handling across environments
- Test both uv and pip installation methods
- Validate with various codebase sizes

### 2.2 Development Phases

```
Phase 1: Core Integration (Day 1-2)
├─ Type definitions
├─ Configuration templates
├─ Initialization commands
└─ Basic testing

Phase 2: Localization & Assets (Day 2-3)
├─ i18n strings (12 languages)
├─ Icon asset
└─ Documentation strings

Phase 3: Testing & Validation (Day 3-5)
├─ Unit tests
├─ Integration tests
├─ Manual testing (all platforms)
└─ Bug fixes

Phase 4: Documentation & Release (Day 5-6)
├─ User documentation
├─ Setup guides
├─ Release notes
└─ PR submission
```

## 3. Technical Implementation

### 3.1 File Changes Overview

| Priority | File | Type | Complexity | Est. Time |
|----------|------|------|------------|-----------|
| P0 | `src/shared/types/presenters/legacy.presenters.d.ts` | Modify | Low | 5 min |
| P0 | `src/main/presenter/configPresenter/acpConfHelper.ts` | Modify | Low | 15 min |
| P0 | `src/main/presenter/configPresenter/acpInitHelper.ts` | Modify | Medium | 30 min |
| P1 | `src/renderer/src/locales/zh-CN.json` | Modify | Low | 10 min |
| P1 | `src/renderer/src/locales/en-US.json` | Modify | Low | 10 min |
| P1 | `src/renderer/src/locales/*.json` (10 more) | Modify | Low | 60 min |
| P1 | `src/renderer/src/assets/icons/qwen-code.svg` | Create | Low | 15 min |
| P2 | `test/main/presenter/configPresenter/acpConfHelper.test.ts` | Modify | Low | 30 min |
| P2 | Documentation files | Create | Low | 60 min |

**Total Estimated Development Time:** 4-6 hours (excluding testing)

### 3.2 Detailed Implementation Steps

#### Step 1: Type Definitions (5 minutes)

**File:** `src/shared/types/presenters/legacy.presenters.d.ts`

**Change:**
```typescript
// Find the AcpBuiltinAgentId type definition
export type AcpBuiltinAgentId =
  | 'kimi-cli'
  | 'claude-code-acp'
  | 'codex-acp'
  | 'opencode'
  | 'gemini-cli'
  | 'qwen-code'  // ADD THIS LINE
```

**Verification:**
- Run `pnpm run typecheck` to ensure no type errors
- Verify TypeScript recognizes the new agent ID

#### Step 2: Configuration Helper (15 minutes)

**File:** `src/main/presenter/configPresenter/acpConfHelper.ts`

**Change 1 - Add to BUILTIN_ORDER:**
```typescript
const BUILTIN_ORDER: AcpBuiltinAgentId[] = [
  'kimi-cli',
  'claude-code-acp',
  'codex-acp',
  'opencode',
  'gemini-cli',
  'qwen-code'  // ADD THIS LINE
]
```

**Change 2 - Add to BUILTIN_TEMPLATES:**
```typescript
const BUILTIN_TEMPLATES: Record<AcpBuiltinAgentId, BuiltinTemplate> = {
  // ... existing templates ...
  'qwen-code': {
    command: 'qwen',
    args: ['--acp']
  }
}
```

**Verification:**
- Run `pnpm run typecheck` to ensure no type errors
- Verify the template structure matches existing agents

#### Step 3: Initialization Helper (30 minutes)

**File:** `src/main/presenter/configPresenter/acpInitHelper.ts`

**Change 1 - Add to BUILTIN_INIT_COMMANDS:**
```typescript
const BUILTIN_INIT_COMMANDS: Record<AcpBuiltinAgentId, InitCommandConfig> = {
  // ... existing commands ...
  'qwen-code': {
    commands: [
      'uv tool install qwen-code',
      'qwen --version'
    ],
    description: 'Initialize Qwen Code'
  }
}
```

**Change 2 - Add Python dependency (if not already present):**
```typescript
const EXTERNAL_DEPENDENCIES: ExternalDependency[] = [
  // ... existing dependencies ...
  {
    name: 'Python',
    description: 'Python runtime for Qwen Code',
    platform: ['win32', 'darwin', 'linux'],
    checkCommand: 'python --version',
    minVersion: '3.8',
    installCommands: {
      winget: 'winget install Python.Python.3.12',
      chocolatey: 'choco install python',
      scoop: 'scoop install python',
      brew: 'brew install python@3.12',
      apt: 'sudo apt install python3 python3-pip'
    },
    downloadUrl: 'https://python.org',
    requiredFor: ['qwen-code']
  }
]
```

**Verification:**
- Check if Python dependency already exists for other agents
- Verify command structure matches existing patterns
- Test initialization flow manually

#### Step 4: Localization - Chinese (10 minutes)

**File:** `src/renderer/src/locales/zh-CN.json`

**Change:**
```json
{
  "acp": {
    "builtin": {
      "qwen-code": {
        "name": "通义千问代码助手",
        "description": "阿里巴巴开源的智能编码 CLI 工具，基于 Qwen3-Coder 模型。支持 358 种编程语言、256K-1M 上下文长度和智能代码库管理。"
      }
    }
  }
}
```

**Note:** Merge into existing structure, don't replace entire file.

#### Step 5: Localization - English (10 minutes)

**File:** `src/renderer/src/locales/en-US.json`

**Change:**
```json
{
  "acp": {
    "builtin": {
      "qwen-code": {
        "name": "Qwen Code",
        "description": "Alibaba's open-source agentic coding CLI powered by Qwen3-Coder. Supports 358 languages, 256K-1M token context, and intelligent codebase management."
      }
    }
  }
}
```

#### Step 6: Localization - Other Languages (60 minutes)

**Files:** All remaining locale files in `src/renderer/src/locales/`

**Languages to update:**
- ja-JP (Japanese)
- ko-KR (Korean)
- fr-FR (French)
- de-DE (German)
- es-ES (Spanish)
- pt-BR (Portuguese)
- ru-RU (Russian)
- it-IT (Italian)
- nl-NL (Dutch)
- pl-PL (Polish)

**Translation Strategy:**
1. Use the English description as base
2. Translate key points:
   - "Alibaba's open-source agentic coding CLI"
   - "powered by Qwen3-Coder"
   - "Supports 358 languages"
   - "256K-1M token context"
   - "intelligent codebase management"
3. Keep "Qwen Code" and "Qwen3-Coder" as proper nouns (untranslated)
4. Verify translations with native speakers if possible

**Verification:**
- Run `pnpm run i18n` to check completeness
- Verify all 12 languages have the new keys

#### Step 7: Icon Asset (15 minutes)

**File:** `src/renderer/src/assets/icons/qwen-code.svg`

**Tasks:**
1. Obtain official Qwen/Alibaba Cloud icon
   - Check qwen.ai website
   - Check Alibaba Cloud brand resources
   - Check Qwen Code repository
2. Convert to SVG if needed (64x64px or scalable)
3. Ensure transparent background
4. Verify licensing and attribution
5. Place in assets directory

**Fallback:** If official icon unavailable, create simple text-based icon with "QC" or Qwen branding colors.

#### Step 8: Unit Tests (30 minutes)

**File:** `test/main/presenter/configPresenter/acpConfHelper.test.ts`

**Add test cases:**
```typescript
describe('AcpConfHelper - Qwen Code', () => {
  it('should include qwen-code in builtin agents list', () => {
    const helper = new AcpConfHelper()
    const builtins = helper.getBuiltins()
    const qwenCode = builtins.find(agent => agent.id === 'qwen-code')
    expect(qwenCode).toBeDefined()
  })

  it('should have correct command template for qwen-code', () => {
    const helper = new AcpConfHelper()
    const builtins = helper.getBuiltins()
    const qwenCode = builtins.find(agent => agent.id === 'qwen-code')
    expect(qwenCode?.profiles).toHaveLength(1)
    expect(qwenCode?.profiles[0].command).toBe('qwen-code')
    expect(qwenCode?.profiles[0].args).toEqual(['--acp'])
  })

  it('should return correct display name for qwen-code', () => {
    // Test i18n key resolution
    const name = getBuiltinAgentDisplayName('qwen-code')
    expect(name).toBeTruthy()
  })
})
```

**Verification:**
- Run `pnpm test` to ensure all tests pass
- Verify new tests are executed

### 3.3 Code Quality Checks

After all code changes, run the following commands:

```bash
# Type checking
pnpm run typecheck

# Linting
pnpm run lint

# Formatting
pnpm run format

# i18n completeness
pnpm run i18n

# All tests
pnpm test
```

**Success Criteria:**
- All type checks pass
- No lint errors
- All files properly formatted
- i18n completeness at 100%
- All tests pass

## 4. Testing Strategy

### 4.1 Unit Testing

**Scope:**
- Configuration helper returns correct agent metadata
- Type definitions are valid
- Initialization commands are properly structured

**Tools:**
- Vitest
- Existing test infrastructure

**Coverage Target:** 100% for new code

### 4.2 Integration Testing

**Test Scenarios:**

1. **Agent Discovery:**
   - Verify Qwen Code appears in agent list
   - Verify correct display name and description
   - Verify icon renders correctly

2. **Initialization Flow:**
   - Test uv tool install command
   - Test pip install command (alternative)
   - Verify Python dependency check
   - Verify version check after installation

3. **Session Management:**
   - Create new session with Qwen Code
   - Send prompt and receive response
   - Verify streaming works correctly
   - Verify session cleanup

4. **Permission Handling:**
   - Trigger file read permission
   - Trigger file write permission
   - Verify permission dialog appears
   - Test allow/deny flows

5. **MCP Integration:**
   - Configure MCP servers for Qwen Code
   - Verify MCP servers passed to agent
   - Test MCP tool calls

### 4.3 Manual Testing

**Platform Testing Matrix:**

| Test Case | Windows | macOS | Linux |
|-----------|---------|-------|-------|
| Installation (uv) | ✓ | ✓ | ✓ |
| Installation (pip) | ✓ | ✓ | ✓ |
| Python detection | ✓ | ✓ | ✓ |
| Process spawning | ✓ | ✓ | ✓ |
| ACP communication | ✓ | ✓ | ✓ |
| File operations | ✓ | ✓ | ✓ |
| Terminal operations | ✓ | ✓ | ✓ |
| Large codebase | ✓ | ✓ | ✓ |
| Icon rendering | ✓ | ✓ | ✓ |
| i18n display | ✓ | ✓ | ✓ |

**Codebase Size Testing:**
- Small: < 100 files, < 10MB
- Medium: 100-1000 files, 10-100MB
- Large: 1000-10000 files, 100MB-1GB
- Very Large: > 10000 files, > 1GB

**Expected Results:**
- All sizes should work
- Large codebases may have slower initial analysis
- Qwen Code's intelligent chunking should handle all sizes

### 4.4 Error Scenario Testing

**Test Cases:**
1. Python not installed → Show dependency dialog
2. qwen-code not installed → Show initialization prompt
3. API key not configured → Show configuration instructions
4. API rate limit → Display clear error message
5. Network timeout → Handle gracefully, offer retry
6. Process crash → Detect and offer restart
7. Invalid working directory → Validate and prompt for correction

## 5. Documentation

### 5.1 User Documentation

**Create:** `docs/user-guide/acp-agents/qwen-code.md`

**Content:**
- What is Qwen Code
- Installation instructions (uv and pip methods)
- API key configuration
- First conversation walkthrough
- Advanced configuration (environment variables)
- Troubleshooting common issues
- FAQ

### 5.2 Developer Documentation

**Update:** `docs/architecture/agent-system.md`

**Content:**
- Add Qwen Code to list of supported agents
- Document any Qwen-specific considerations
- Update architecture diagrams if needed

### 5.3 Release Notes

**Create:** Entry in `CHANGELOG.md`

**Content:**
```markdown
## [Version] - 2026-01-XX

### Added
- **Qwen Code ACP Agent**: Integrated Alibaba's open-source Qwen Code as a builtin ACP agent
  - Powered by Qwen3-Coder models with 256K-1M token context
  - Supports 358 programming languages
  - Intelligent codebase management for large projects
  - Free and open-source alternative to proprietary agents
  - Installation via uv or pip
```

## 6. Deployment Strategy

### 6.1 Branch Strategy

**Option A: Use existing feature branch**
- Branch: `feat/acp_model_enhance`
- Pros: Consolidates ACP improvements
- Cons: May delay if other features are blocked

**Option B: Create new feature branch**
- Branch: `feat/qwen-code-acp`
- Pros: Independent development and testing
- Cons: Requires separate PR and merge

**Recommendation:** Option B - Create dedicated feature branch for cleaner history and easier review.

### 6.2 Merge Strategy

```
1. Create feature branch from dev
   git checkout dev
   git pull origin dev
   git checkout -b feat/qwen-code-acp

2. Implement changes (following this plan)

3. Run all quality checks
   pnpm run format && pnpm run lint && pnpm run typecheck && pnpm test

4. Commit changes
   git add .
   git commit -m "feat(acp): add Qwen Code as builtin agent"

5. Push to remote
   git push origin feat/qwen-code-acp

6. Create Pull Request to dev branch

7. Address review comments

8. Merge to dev

9. Test in dev environment

10. Merge dev to main (when ready for release)
```

### 6.3 Rollback Plan

**If issues are discovered after merge:**

1. **Minor issues:** Fix forward with hotfix
2. **Major issues:** Revert the merge commit
   ```bash
   git revert <merge-commit-hash>
   ```
3. **Critical issues:** Disable agent via feature flag (if implemented)

**Prevention:**
- Thorough testing before merge
- Staged rollout (dev → staging → production)
- Monitor error rates after deployment

## 7. Risk Management

### 7.1 Technical Risks

| Risk | Mitigation | Contingency |
|------|------------|-------------|
| Python dependency issues | Test on clean systems, provide clear docs | Offer Docker-based alternative |
| ACP protocol incompatibility | Test with latest Qwen Code version | Pin to known-good version |
| Performance issues with large codebases | Test with various sizes | Document limitations |
| Installation failures | Support multiple methods (uv, pip) | Provide manual installation guide |

### 7.2 User Experience Risks

| Risk | Mitigation | Contingency |
|------|------------|-------------|
| Confusing setup process | Step-by-step guide with screenshots | Video tutorial |
| API key configuration unclear | Inline help text, tooltips | Link to detailed docs |
| Unexpected behavior | Clear error messages | Support channel |

### 7.3 Quality Risks

| Risk | Mitigation | Contingency |
|------|------------|-------------|
| Insufficient testing | Comprehensive test plan | Extended beta period |
| Translation errors | Native speaker review | Community corrections |
| Icon licensing issues | Verify before release | Use generic icon |

## 8. Success Criteria

### 8.1 Implementation Complete

- [ ] All code changes implemented
- [ ] All tests passing
- [ ] All quality checks passing
- [ ] Documentation complete
- [ ] PR approved and merged

### 8.2 Functional Requirements

- [ ] Qwen Code appears in agent list
- [ ] Installation flow works on all platforms
- [ ] Can create and use sessions
- [ ] Streaming responses work correctly
- [ ] Permission system works
- [ ] MCP integration works
- [ ] Error handling is robust

### 8.3 Quality Requirements

- [ ] Zero critical bugs
- [ ] < 5% initialization failure rate
- [ ] < 1% session crash rate
- [ ] All i18n strings translated
- [ ] Icon displays correctly
- [ ] Performance acceptable for large codebases

## 9. Timeline

### Detailed Schedule

**Day 1 (4 hours):**
- Morning: Type definitions, configuration helper, initialization helper (1 hour)
- Afternoon: English and Chinese localization, icon asset (1.5 hours)
- Evening: Other language localizations (1.5 hours)

**Day 2 (4 hours):**
- Morning: Unit tests, code quality checks (2 hours)
- Afternoon: Manual testing on primary platform (2 hours)

**Day 3 (4 hours):**
- Morning: Cross-platform testing (2 hours)
- Afternoon: Bug fixes and refinements (2 hours)

**Day 4 (4 hours):**
- Morning: Integration testing, large codebase testing (2 hours)
- Afternoon: Error scenario testing (2 hours)

**Day 5 (4 hours):**
- Morning: Documentation writing (2 hours)
- Afternoon: Final review, PR preparation (2 hours)

**Day 6 (2 hours):**
- Morning: PR submission, address initial feedback (2 hours)

**Total: 22 hours over 6 days**

### Milestones

- **M1 (End of Day 1):** Core implementation complete
- **M2 (End of Day 2):** Basic testing complete
- **M3 (End of Day 4):** All testing complete
- **M4 (End of Day 5):** Documentation complete
- **M5 (End of Day 6):** PR submitted

## 10. Post-Implementation

### 10.1 Monitoring

**Metrics to track:**
- Number of Qwen Code installations
- Session creation rate
- Error rate by error type
- Average session duration
- User feedback sentiment

**Tools:**
- Application logs
- Error tracking system
- User feedback channels

### 10.2 Maintenance

**Ongoing tasks:**
- Monitor Qwen Code releases for updates
- Update documentation as needed
- Address user-reported issues
- Optimize performance based on usage patterns

### 10.3 Future Enhancements

**Potential improvements:**
- UI for API key configuration
- Advanced model selection interface
- Performance optimization for very large codebases
- Integration with Alibaba Cloud services
- Custom Qwen Code configuration profiles

## 11. Appendix

### 11.1 Reference Implementations

**Study these for patterns:**
- Gemini CLI integration: Commit `689e48bd`
- OpenCode integration: Commit `961d7627`
- Files: `docs/specs/gemini-cli-acp/spec.md`, `docs/specs/opencode-integration/spec.md`

### 11.2 Useful Commands

```bash
# Development
pnpm run dev                    # Start dev server
pnpm run dev:inspect            # Start with debugger

# Quality checks
pnpm run typecheck              # Type checking
pnpm run lint                   # Linting
pnpm run format                 # Formatting
pnpm run i18n                   # i18n completeness

# Testing
pnpm test                       # All tests
pnpm test:main                  # Main process tests
pnpm test:renderer              # Renderer tests
pnpm test:watch                 # Watch mode

# Building
pnpm run build                  # Production build
```

### 11.3 Contact Points

**For questions or issues:**
- Technical lead: [Name]
- ACP system owner: [Name]
- i18n coordinator: [Name]
- QA lead: [Name]

---

**Document Version:** 1.0
**Last Updated:** 2026-01-16
**Status:** Draft → Ready for Implementation
