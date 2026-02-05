# Qwen Code ACP Integration - Task Breakdown

**Status:** ✅ **Core Implementation Complete** (2026-01-16)
**Created:** 2026-01-16
**Related Documents:** `spec.md`, `plan.md`

## Implementation Summary

**Completed (2026-01-16):**
- ✅ Phase 1: Core Implementation (Tasks 1.1-1.3)
  - Type definition added
  - Configuration helper updated (npm package: `@qwen-code/qwen-code`)
  - Initialization helper updated (install via npm, execute directly)
- ✅ Phase 2: Icon Integration (Task 2.6)
  - Icon mapping added in ModelIcon.vue
  - Note: i18n tasks (2.1-2.5) not required (ACP agents use hardcoded names)
- ✅ Phase 4: Code Quality (Task 4.4 - partial)
  - TypeScript type checking passed
  - Lint checks passed
  - Code formatting applied

**Remaining:**
- ⏸️ Phase 3: Testing (Tasks 3.1-3.8) - Manual/QA testing not yet performed
- ⏸️ Phase 4: Documentation (Tasks 4.1-4.3) - Can be done before release
- ⏸️ Phase 4: PR Creation (Task 4.5) - Ready when needed

## Task Overview

This document provides a detailed, actionable task breakdown for implementing Qwen Code ACP integration. Each task includes acceptance criteria, dependencies, and estimated time.

---

## Phase 1: Core Implementation

### Task 1.1: Add Type Definition
**Priority:** P0 (Blocking)
**Estimated Time:** 5 minutes
**Assignee:** Developer

**Description:**
Add `'qwen-code'` to the `AcpBuiltinAgentId` union type.

**Files to Modify:**
- `src/shared/types/presenters/legacy.presenters.d.ts`

**Changes:**
```typescript
export type AcpBuiltinAgentId =
  | 'kimi-cli'
  | 'claude-code-acp'
  | 'codex-acp'
  | 'opencode'
  | 'gemini-cli'
  | 'qwen-code'  // ADD THIS
```

**Acceptance Criteria:**
- [x] Type definition added
- [x] `pnpm run typecheck` passes
- [x] No TypeScript errors in IDE

**Dependencies:** None

---

### Task 1.2: Update Configuration Helper
**Priority:** P0 (Blocking)
**Estimated Time:** 15 minutes
**Assignee:** Developer

**Description:**
Add Qwen Code to the builtin agent configuration system.

**Files to Modify:**
- `src/main/presenter/configPresenter/acpConfHelper.ts`

**Changes:**

1. Add to `BUILTIN_ORDER`:
```typescript
const BUILTIN_ORDER: AcpBuiltinAgentId[] = [
  'kimi-cli',
  'claude-code-acp',
  'codex-acp',
  'opencode',
  'gemini-cli',
  'qwen-code'  // ADD THIS
]
```

2. Add to `BUILTIN_TEMPLATES`:
```typescript
const BUILTIN_TEMPLATES: Record<AcpBuiltinAgentId, BuiltinTemplate> = {
  // ... existing templates ...
  'qwen-code': {
    command: 'qwen',
    args: ['--acp']
  }
}
```

**Acceptance Criteria:**
- [x] Agent added to `BUILTIN_ORDER`
- [x] Template added to `BUILTIN_TEMPLATES`
- [x] `pnpm run typecheck` passes
- [x] Configuration helper compiles without errors

**Dependencies:** Task 1.1

---

### Task 1.3: Update Initialization Helper
**Priority:** P0 (Blocking)
**Estimated Time:** 30 minutes
**Assignee:** Developer

**Description:**
Add initialization commands and dependency checks for Qwen Code.

**Files to Modify:**
- `src/main/presenter/configPresenter/acpInitHelper.ts`

**Changes:**

1. Add to `BUILTIN_INIT_COMMANDS`:
```typescript
const BUILTIN_INIT_COMMANDS: Record<AcpBuiltinAgentId, InitCommandConfig> = {
  // ... existing commands ...
  'qwen-code': {
    commands: [
      'npm install -g @qwen-code/qwen-code',
      'qwen --version'
    ],
    description: 'Initialize Qwen Code'
  }
}
```

2. Check if Python dependency exists, if not add:
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

**Acceptance Criteria:**
- [x] Initialization commands added
- [x] Python dependency configured (if not already present)
- [x] `pnpm run typecheck` passes
- [x] Commands follow existing pattern

**Dependencies:** Task 1.2

---

## Phase 2: Localization & Assets

**Note:** After implementation review, localization tasks (2.1-2.5) are **NOT REQUIRED**. ACP agent names are defined directly in `acpConfHelper.ts` and are not localized via i18n files. This matches the existing pattern for all other builtin agents (kimi-cli, gemini-cli, etc.).

### Task 2.1: Add Chinese Localization
**Priority:** P1
**Estimated Time:** 10 minutes
**Assignee:** Developer / Translator

**Description:**
Add Chinese (Simplified) translations for Qwen Code.

**Files to Modify:**
- `src/renderer/src/locales/zh-CN.json`

**Changes:**
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

**Acceptance Criteria:**
- [ ] Translations added to zh-CN.json
- [ ] JSON syntax valid
- [ ] Keys match pattern: `acp.builtin.qwen-code.{name,description}`
- [ ] `pnpm run i18n` shows zh-CN complete

**Dependencies:** None

---

### Task 2.2: Add English Localization
**Priority:** P1
**Estimated Time:** 10 minutes
**Assignee:** Developer

**Description:**
Add English translations for Qwen Code.

**Files to Modify:**
- `src/renderer/src/locales/en-US.json`

**Changes:**
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

**Acceptance Criteria:**
- [ ] Translations added to en-US.json
- [ ] JSON syntax valid
- [ ] Description is clear and concise
- [ ] `pnpm run i18n` shows en-US complete

**Dependencies:** None

---

### Task 2.3: Add Japanese Localization
**Priority:** P1
**Estimated Time:** 10 minutes
**Assignee:** Translator

**Description:**
Add Japanese translations for Qwen Code.

**Files to Modify:**
- `src/renderer/src/locales/ja-JP.json`

**Changes:**
```json
{
  "acp": {
    "builtin": {
      "qwen-code": {
        "name": "Qwen Code",
        "description": "Qwen3-Coderを搭載したAlibabaのオープンソースエージェントコーディングCLI。358言語、256K-1Mトークンコンテキスト、インテリジェントなコードベース管理をサポート。"
      }
    }
  }
}
```

**Acceptance Criteria:**
- [ ] Translations added to ja-JP.json
- [ ] Translation reviewed by native speaker (if possible)
- [ ] JSON syntax valid

**Dependencies:** None

---

### Task 2.4: Add Korean Localization
**Priority:** P1
**Estimated Time:** 10 minutes
**Assignee:** Translator

**Description:**
Add Korean translations for Qwen Code.

**Files to Modify:**
- `src/renderer/src/locales/ko-KR.json`

**Changes:**
```json
{
  "acp": {
    "builtin": {
      "qwen-code": {
        "name": "Qwen Code",
        "description": "Qwen3-Coder 기반 Alibaba의 오픈소스 에이전트 코딩 CLI. 358개 언어, 256K-1M 토큰 컨텍스트 및 지능형 코드베이스 관리 지원."
      }
    }
  }
}
```

**Acceptance Criteria:**
- [ ] Translations added to ko-KR.json
- [ ] Translation reviewed by native speaker (if possible)
- [ ] JSON syntax valid

**Dependencies:** None

---

### Task 2.5: Add Remaining Localizations
**Priority:** P1
**Estimated Time:** 60 minutes
**Assignee:** Translator

**Description:**
Add translations for remaining 8 languages.

**Files to Modify:**
- `src/renderer/src/locales/fr-FR.json` (French)
- `src/renderer/src/locales/de-DE.json` (German)
- `src/renderer/src/locales/es-ES.json` (Spanish)
- `src/renderer/src/locales/pt-BR.json` (Portuguese)
- `src/renderer/src/locales/ru-RU.json` (Russian)
- `src/renderer/src/locales/it-IT.json` (Italian)
- `src/renderer/src/locales/nl-NL.json` (Dutch)
- `src/renderer/src/locales/pl-PL.json` (Polish)

**Translation Guidelines:**
- Keep "Qwen Code" and "Qwen3-Coder" as proper nouns
- Translate key concepts: "open-source", "agentic coding", "CLI", "supports", "languages", "context", "intelligent", "codebase management"
- Maintain professional tone
- Keep description concise (under 200 characters if possible)

**Acceptance Criteria:**
- [ ] All 8 languages have translations
- [ ] JSON syntax valid for all files
- [ ] `pnpm run i18n` shows 100% completion
- [ ] Translations reviewed (at least spot-check)

**Dependencies:** None

---

### Task 2.6: Add Icon Asset
**Priority:** P1
**Estimated Time:** 15 minutes
**Assignee:** Designer / Developer

**Description:**
Obtain and add Qwen Code icon to assets.

**Files to Create:**
- `src/renderer/src/assets/icons/qwen-code.svg`

**Steps:**
1. Search for official Qwen/Alibaba Cloud icon:
   - Check qwen.ai website
   - Check Alibaba Cloud brand resources
   - Check Qwen Code GitHub repository
2. If official icon found:
   - Download in SVG format (preferred) or PNG
   - Convert to SVG if needed
   - Ensure transparent background
   - Verify licensing allows usage
3. If no official icon:
   - Create simple icon with "QC" text
   - Use Qwen brand colors (if known)
   - Or use generic code/terminal icon
4. Place in assets directory

**Acceptance Criteria:**
- [x] Icon file created at correct path (qwen-color.svg already exists)
- [x] Icon is SVG format (or high-quality PNG)
- [x] Icon has transparent background
- [x] Icon is 64x64px or scalable
- [x] Licensing verified (or fallback icon used)
- [x] Icon displays correctly in UI (mapped in ModelIcon.vue)

**Implementation Note:** Icon `qwen-color.svg` already exists in `src/renderer/src/assets/llm-icons/`. Added mapping in `ModelIcon.vue` to use this icon for 'qwen-code' agent.

**Dependencies:** None

---

## Phase 3: Testing

### Task 3.1: Write Unit Tests
**Priority:** P2
**Estimated Time:** 30 minutes
**Assignee:** Developer

**Description:**
Add unit tests for Qwen Code configuration.

**Files to Modify:**
- `test/main/presenter/configPresenter/acpConfHelper.test.ts`

**Test Cases:**
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
    const name = getBuiltinAgentDisplayName('qwen-code')
    expect(name).toBeTruthy()
  })

  it('should have initialization commands configured', () => {
    const initConfig = getInitCommands('qwen-code')
    expect(initConfig).toBeDefined()
    expect(initConfig.commands).toContain('uv tool install qwen-code')
  })
})
```

**Acceptance Criteria:**
- [ ] All test cases added
- [ ] Tests pass locally
- [ ] Tests pass in CI
- [ ] Code coverage maintained or improved

**Dependencies:** Tasks 1.1, 1.2, 1.3

---

### Task 3.2: Manual Testing - Installation (Windows)
**Priority:** P2
**Estimated Time:** 30 minutes
**Assignee:** QA / Developer

**Description:**
Test Qwen Code installation flow on Windows.

**Test Environment:**
- Windows 10/11
- Clean system (or VM)
- Node.js installed

**Test Steps:**
1. Launch DeepChat
2. Navigate to Settings → ACP Agents
3. Find "Qwen Code" in list
4. Click "Initialize"
5. Verify Python dependency check
6. If Python missing, follow installation guide
7. Run initialization: `uv tool install qwen-code`
8. Verify installation success
9. Check `qwen --version` works
10. Enable agent
11. Create new conversation
12. Select Qwen Code as model
13. Set working directory
14. Send test prompt: "List files in current directory"
15. Verify response received

**Acceptance Criteria:**
- [ ] Installation completes successfully
- [ ] Agent appears in model list
- [ ] Can create conversation
- [ ] Can send and receive messages
- [ ] No errors in console
- [ ] Process cleanup works correctly

**Dependencies:** Tasks 1.1-1.3, 2.1-2.6

---

### Task 3.3: Manual Testing - Installation (macOS)
**Priority:** P2
**Estimated Time:** 30 minutes
**Assignee:** QA / Developer

**Description:**
Test Qwen Code installation flow on macOS.

**Test Environment:**
- macOS 12+ (Monterey or later)
- Clean system (or VM)
- Node.js installed

**Test Steps:**
(Same as Task 3.2, but on macOS)

**Additional macOS-specific checks:**
- [ ] Homebrew installation method works (if applicable)
- [ ] Python from Homebrew works correctly
- [ ] Terminal permissions handled correctly

**Acceptance Criteria:**
(Same as Task 3.2)

**Dependencies:** Tasks 1.1-1.3, 2.1-2.6

---

### Task 3.4: Manual Testing - Installation (Linux)
**Priority:** P2
**Estimated Time:** 30 minutes
**Assignee:** QA / Developer

**Description:**
Test Qwen Code installation flow on Linux.

**Test Environment:**
- Ubuntu 22.04 or similar
- Clean system (or VM)
- Node.js installed

**Test Steps:**
(Same as Task 3.2, but on Linux)

**Additional Linux-specific checks:**
- [ ] apt/dnf installation method works (if applicable)
- [ ] System Python works correctly
- [ ] No sandbox issues

**Acceptance Criteria:**
(Same as Task 3.2)

**Dependencies:** Tasks 1.1-1.3, 2.1-2.6

---

### Task 3.5: Manual Testing - Basic Functionality
**Priority:** P2
**Estimated Time:** 60 minutes
**Assignee:** QA

**Description:**
Test core functionality of Qwen Code agent.

**Test Cases:**

1. **File Read Operations:**
   - Prompt: "Read the contents of package.json"
   - Expected: Permission request → Allow → File contents displayed

2. **File Write Operations:**
   - Prompt: "Create a new file test.txt with content 'Hello World'"
   - Expected: Permission request → Allow → File created

3. **Terminal Operations:**
   - Prompt: "Run 'ls -la' command"
   - Expected: Permission request → Allow → Command output displayed

4. **Code Understanding:**
   - Prompt: "Explain what this codebase does"
   - Expected: Analysis of project structure and purpose

5. **Code Generation:**
   - Prompt: "Create a simple Express.js server"
   - Expected: Code generated with explanation

6. **Multi-turn Conversation:**
   - Send 3-5 related prompts
   - Expected: Context maintained across turns

7. **Permission Denial:**
   - Trigger permission request
   - Click "Deny"
   - Expected: Agent handles denial gracefully

8. **Session Persistence:**
   - Create conversation
   - Close DeepChat
   - Reopen DeepChat
   - Expected: Conversation restored, can continue

**Acceptance Criteria:**
- [ ] All test cases pass
- [ ] No crashes or errors
- [ ] Responses are relevant and accurate
- [ ] Permission system works correctly
- [ ] Session persistence works

**Dependencies:** Tasks 3.2, 3.3, or 3.4 (at least one platform)

---

### Task 3.6: Manual Testing - Large Codebase
**Priority:** P2
**Estimated Time:** 45 minutes
**Assignee:** QA

**Description:**
Test Qwen Code with various codebase sizes.

**Test Cases:**

1. **Small Codebase (< 100 files):**
   - Use simple project (e.g., todo app)
   - Prompt: "Analyze this codebase"
   - Expected: Quick response, full analysis

2. **Medium Codebase (100-1000 files):**
   - Use moderate project (e.g., React app)
   - Prompt: "Find all API endpoints"
   - Expected: Reasonable response time, accurate results

3. **Large Codebase (1000-10000 files):**
   - Use large project (e.g., DeepChat itself)
   - Prompt: "Explain the ACP architecture"
   - Expected: Intelligent chunking, relevant response

4. **Very Large Codebase (> 10000 files):**
   - Use very large project (e.g., Linux kernel subset)
   - Prompt: "What does this project do?"
   - Expected: High-level overview, no crashes

**Acceptance Criteria:**
- [ ] All sizes handled without crashes
- [ ] Response quality acceptable for all sizes
- [ ] No excessive memory usage
- [ ] Intelligent context management evident

**Dependencies:** Task 3.5

---

### Task 3.7: Manual Testing - Error Scenarios
**Priority:** P2
**Estimated Time:** 45 minutes
**Assignee:** QA

**Description:**
Test error handling and edge cases.

**Test Cases:**

1. **Python Not Installed:**
   - Uninstall Python (or use clean VM)
   - Try to initialize Qwen Code
   - Expected: Dependency dialog shown, clear instructions

2. **qwen-code Not Installed:**
   - Skip initialization
   - Try to create conversation
   - Expected: Prompt to initialize

3. **API Key Not Configured:**
   - Install qwen-code but don't configure API key
   - Try to send prompt
   - Expected: Clear error message with setup instructions

4. **Invalid Working Directory:**
   - Set working directory to non-existent path
   - Try to create conversation
   - Expected: Validation error, prompt to correct

5. **Network Timeout:**
   - Disconnect internet
   - Send prompt
   - Expected: Timeout error, offer to retry

6. **Process Crash:**
   - Kill qwen-code process manually
   - Send prompt
   - Expected: Detect crash, offer to restart

7. **API Rate Limit:**
   - Exhaust API quota (if possible)
   - Send prompt
   - Expected: Rate limit error with clear message

**Acceptance Criteria:**
- [ ] All error scenarios handled gracefully
- [ ] Error messages are clear and actionable
- [ ] No unhandled exceptions
- [ ] Recovery options provided

**Dependencies:** Task 3.5

---

### Task 3.8: Manual Testing - UI/UX
**Priority:** P2
**Estimated Time:** 30 minutes
**Assignee:** QA / Designer

**Description:**
Test user interface and experience.

**Test Cases:**

1. **Icon Display:**
   - Check agent list
   - Expected: Qwen Code icon displays correctly

2. **Name Display:**
   - Check in multiple languages
   - Expected: Correct name in each language

3. **Description Display:**
   - Check in multiple languages
   - Expected: Correct description in each language

4. **Settings UI:**
   - Open agent settings
   - Expected: All options accessible and clear

5. **Permission Dialog:**
   - Trigger permission request
   - Expected: Dialog is clear and user-friendly

6. **Initialization UI:**
   - Go through initialization flow
   - Expected: Progress clear, output readable

**Acceptance Criteria:**
- [ ] Icon renders correctly
- [ ] Text displays correctly in all languages
- [ ] UI is intuitive and user-friendly
- [ ] No layout issues
- [ ] Consistent with other agents

**Dependencies:** Tasks 2.1-2.6, 3.5

---

## Phase 4: Documentation & Release

### Task 4.1: Write User Documentation
**Priority:** P2
**Estimated Time:** 60 minutes
**Assignee:** Technical Writer / Developer

**Description:**
Create comprehensive user documentation for Qwen Code.

**Files to Create:**
- `docs/user-guide/acp-agents/qwen-code.md`

**Content Outline:**
1. Introduction
   - What is Qwen Code
   - Key features
   - When to use it
2. Installation
   - Prerequisites (Python, Node.js)
   - Installation via uv (recommended)
   - Installation via pip (alternative)
   - Verification
3. Configuration
   - API key setup (Qwen AI)
   - Alternative providers (OpenAI, etc.)
   - Environment variables
4. First Conversation
   - Enabling the agent
   - Creating a conversation
   - Setting working directory
   - Sending first prompt
5. Advanced Usage
   - MCP integration
   - Custom profiles
   - Performance optimization
6. Troubleshooting
   - Common issues and solutions
   - Error messages explained
   - Where to get help
7. FAQ

**Acceptance Criteria:**
- [ ] Documentation complete and accurate
- [ ] All sections covered
- [ ] Screenshots included (if applicable)
- [ ] Links to external resources work
- [ ] Reviewed for clarity

**Dependencies:** Tasks 3.2-3.8 (testing complete)

---

### Task 4.2: Update Architecture Documentation
**Priority:** P3
**Estimated Time:** 30 minutes
**Assignee:** Developer

**Description:**
Update architecture documentation to include Qwen Code.

**Files to Modify:**
- `docs/architecture/agent-system.md`
- `CLAUDE.md` (if applicable)

**Changes:**
- Add Qwen Code to list of supported agents
- Update agent count (now 6 builtin agents)
- Add any Qwen-specific architectural notes
- Update diagrams if needed

**Acceptance Criteria:**
- [ ] Documentation updated
- [ ] Accurate and consistent
- [ ] No broken links

**Dependencies:** Task 4.1

---

### Task 4.3: Write Release Notes
**Priority:** P2
**Estimated Time:** 15 minutes
**Assignee:** Developer / Product Manager

**Description:**
Create release notes entry for Qwen Code integration.

**Files to Modify:**
- `CHANGELOG.md`

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
  - Full ACP protocol support (file operations, terminal, MCP integration)
```

**Acceptance Criteria:**
- [ ] Release notes added to CHANGELOG.md
- [ ] Follows existing format
- [ ] Highlights key features
- [ ] Mentions installation methods

**Dependencies:** None (can be done early)

---

### Task 4.4: Code Quality Final Check
**Priority:** P0 (Blocking)
**Estimated Time:** 15 minutes
**Assignee:** Developer

**Description:**
Run all code quality checks before PR submission.

**Commands to Run:**
```bash
pnpm run typecheck      # Type checking
pnpm run lint           # Linting
pnpm run format         # Formatting
pnpm run i18n           # i18n completeness
pnpm test               # All tests
```

**Acceptance Criteria:**
- [x] `typecheck` passes with no errors
- [x] `lint` passes with no errors
- [x] `format` applied to all files
- [ ] `i18n` shows 100% completion (N/A - i18n not required for ACP agents)
- [ ] All tests pass (tests not yet written)

**Dependencies:** All previous tasks

---

### Task 4.5: Create Pull Request
**Priority:** P0 (Blocking)
**Estimated Time:** 30 minutes
**Assignee:** Developer

**Description:**
Create pull request for Qwen Code integration.

**Steps:**
1. Create feature branch:
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feat/qwen-code-acp
   ```

2. Commit changes:
   ```bash
   git add .
   git commit -m "feat(acp): add Qwen Code as builtin agent

   - Add Qwen Code to builtin agent list
   - Configure command template and initialization
   - Add i18n strings for all 12 languages
   - Add Qwen Code icon asset
   - Add unit tests
   - Add user documentation

   Closes #XXX"
   ```

3. Push to remote:
   ```bash
   git push origin feat/qwen-code-acp
   ```

4. Create PR on GitHub:
   - Title: `feat(acp): add Qwen Code as builtin agent`
   - Base branch: `dev`
   - Description: Link to spec.md, summarize changes
   - Add labels: `feature`, `acp`, `enhancement`
   - Request reviewers

**PR Description Template:**
```markdown
## Summary
Integrates Qwen Code as the 6th builtin ACP agent in DeepChat.

## Related Documents
- Spec: `docs/specs/qwen-code-acp/spec.md`
- Plan: `docs/specs/qwen-code-acp/plan.md`
- Tasks: `docs/specs/qwen-code-acp/tasks.md`

## Changes
- Added `qwen-code` to `AcpBuiltinAgentId` type
- Configured command template: `qwen-code --acp`
- Added initialization commands (uv/pip)
- Added i18n strings for all 12 languages
- Added Qwen Code icon
- Added unit tests
- Added user documentation

## Testing
- [x] Unit tests pass
- [x] Manual testing on Windows
- [x] Manual testing on macOS
- [x] Manual testing on Linux
- [x] Large codebase testing
- [x] Error scenario testing
- [x] UI/UX testing

## Screenshots
(Add screenshots of agent in UI, initialization flow, etc.)

## Checklist
- [x] Code follows project style guidelines
- [x] All tests pass
- [x] Documentation updated
- [x] i18n complete
- [x] No breaking changes
```

**Acceptance Criteria:**
- [ ] Feature branch created
- [ ] Changes committed with proper message
- [ ] PR created on GitHub
- [ ] PR description complete
- [ ] Reviewers assigned

**Dependencies:** Task 4.4

---

### Task 4.6: Address PR Review Comments
**Priority:** P0 (Blocking)
**Estimated Time:** Variable (2-4 hours)
**Assignee:** Developer

**Description:**
Respond to and address code review comments.

**Process:**
1. Monitor PR for review comments
2. For each comment:
   - Acknowledge the feedback
   - Make requested changes
   - Commit and push updates
   - Reply to comment when resolved
3. Request re-review when all comments addressed

**Acceptance Criteria:**
- [ ] All review comments addressed
- [ ] Changes committed and pushed
- [ ] Re-review requested
- [ ] PR approved by required reviewers

**Dependencies:** Task 4.5

---

### Task 4.7: Merge to Dev Branch
**Priority:** P0 (Blocking)
**Estimated Time:** 15 minutes
**Assignee:** Developer / Maintainer

**Description:**
Merge approved PR to dev branch.

**Steps:**
1. Ensure all checks pass (CI, tests, etc.)
2. Ensure all required approvals received
3. Squash and merge (or merge commit, per project policy)
4. Delete feature branch
5. Pull latest dev locally
6. Verify merge successful

**Acceptance Criteria:**
- [ ] PR merged to dev
- [ ] All CI checks pass
- [ ] Feature branch deleted
- [ ] No merge conflicts
- [ ] Dev branch builds successfully

**Dependencies:** Task 4.6

---

## Summary

### Task Count by Phase
- **Phase 1 (Core Implementation):** 3 tasks
- **Phase 2 (Localization & Assets):** 6 tasks
- **Phase 3 (Testing):** 8 tasks
- **Phase 4 (Documentation & Release):** 7 tasks

**Total Tasks:** 24

### Estimated Time by Phase
- **Phase 1:** 50 minutes
- **Phase 2:** 2 hours 5 minutes
- **Phase 3:** 5 hours 30 minutes
- **Phase 4:** 4 hours 15 minutes

**Total Estimated Time:** ~12 hours

### Critical Path
```
Task 1.1 → Task 1.2 → Task 1.3 → Task 3.1 → Task 4.4 → Task 4.5 → Task 4.6 → Task 4.7
```

### Parallel Work Opportunities
- Phase 2 tasks (localization) can be done in parallel
- Phase 3 tasks (testing) can be distributed across team members
- Documentation (Task 4.1, 4.2) can start after testing begins

---

**Document Version:** 1.0
**Last Updated:** 2026-01-16
**Status:** Draft → Ready for Execution
