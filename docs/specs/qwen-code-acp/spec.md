# Qwen Code ACP Integration Specification

**Status:** Draft
**Created:** 2026-01-16
**Author:** System Analysis
**Target Version:** TBD

## 1. Overview

### 1.1 Motivation

Qwen Code is an open-source agentic coding command-line interface (CLI) tool developed by Alibaba Cloud's QwenLM team. As of late 2025/early 2026, it represents a mature and actively developed ACP agent with the following advantages:

- **Open-Source & Free**: MIT licensed, completely free to use
- **ACP Protocol Support**: Native support for Agent Client Protocol with stable `--acp` flag
- **Advanced AI Capabilities**: Powered by Qwen3-Coder models with 256K-1M token context
- **Multi-Language Support**: Supports 358 programming languages
- **Agentic Features**: Interactive REPL, file system operations, codebase navigation
- **Provider Flexibility**: OpenAI protocol compatible, works with multiple AI providers
- **Large Context Management**: Intelligent chunking for codebases beyond context limits
- **Active Development**: Regular updates and improvements from Alibaba Cloud

DeepChat currently supports five ACP agents (kimi-cli, claude-code-acp, codex-acp, opencode, gemini-cli). Adding Qwen Code will:
1. Provide users with Alibaba's advanced coding AI capabilities
2. Offer a completely free and open-source alternative
3. Leverage Qwen3-Coder's exceptional code understanding and generation
4. Support extremely large codebases with intelligent context management
5. Expand the diversity of available AI agents with Chinese tech ecosystem representation

### 1.2 Goals

- Integrate Qwen Code as a builtin ACP agent in DeepChat
- Support both pip/uv-based installation and direct execution
- Provide seamless authentication flow (API keys, OAuth)
- Enable all standard ACP features (streaming, permissions, MCP integration)
- Add appropriate branding (icon, display name, description)
- Support Qwen Code's advanced features (large context, multi-language)

### 1.3 Non-Goals

- Custom Qwen API integration (this is ACP-only)
- Qwen-specific UI customizations beyond standard ACP features
- Integration with Alibaba Cloud services directly
- Custom model configuration UI (use Qwen Code's own config)

## 2. Current State Analysis

### 2.1 Existing ACP Infrastructure

DeepChat has a mature ACP implementation with the following components:

**Core Components:**
- `acpProvider.ts`: LLM provider implementation for ACP agents
- `acpSessionManager.ts`: Session lifecycle management per conversation
- `acpProcessManager.ts`: Process spawning and lifecycle management
- `acpConfHelper.ts`: Configuration storage and management
- `acpInitHelper.ts`: Agent initialization and setup interface

**Existing Builtin Agents:**
```typescript
const BUILTIN_ORDER: AcpBuiltinAgentId[] = [
  'kimi-cli',           // Kimi CLI agent
  'claude-code-acp',    // Claude Code (Zed Industries)
  'codex-acp',          // Codex (OpenAI)
  'opencode',           // OpenCode agent
  'gemini-cli'          // Gemini CLI agent (Google)
]
```

**Agent Configuration Pattern:**
```typescript
BUILTIN_TEMPLATES: {
  'agent-id': {
    command: 'command-name',
    args: ['--arg1', '--arg2']
  }
}
```

### 2.2 Integration Points

Adding a new ACP agent requires modifications to:

1. **Type Definitions** (`src/shared/types/presenters/legacy.presenters.d.ts`):
   - Add agent ID to `AcpBuiltinAgentId` union type
   - Add icon mapping if custom icon needed

2. **Configuration Helper** (`src/main/presenter/configPresenter/acpConfHelper.ts`):
   - Add to `BUILTIN_ORDER` array
   - Add command template to `BUILTIN_TEMPLATES`
   - Add display metadata (name, description, icon)

3. **Initialization Helper** (`src/main/presenter/configPresenter/acpInitHelper.ts`):
   - Add initialization commands to `BUILTIN_INIT_COMMANDS`
   - Add external dependencies if needed

4. **Internationalization** (`src/renderer/src/locales/*.json`):
   - Add translated strings for agent name and description
   - Support 12 languages (zh-CN, en-US, ja-JP, ko-KR, etc.)

5. **Assets** (optional):
   - Add agent icon to `src/renderer/src/assets/icons/`

### 2.3 Qwen Code Characteristics

**Installation Methods:**
- Python package: `pip install qwen-code` or `uv tool install qwen-code`
- Direct execution: `qwen-code` (after installation)
- Recommended: `uv tool install qwen-code` (isolated environment)

**ACP Mode Invocation:**
- Standard command: `qwen-code --acp` (stable as of late 2025)
- Legacy: `qwen-code --experimental-acp` (deprecated)
- Working directory: Automatically uses current directory or can be specified

**Authentication:**
- API Key based (Qwen API, OpenAI, etc.)
- OAuth support for Qwen AI (free daily requests)
- Configuration via `~/.qwen-code/config.json` or environment variables

**Requirements:**
- Python >= 3.8 (recommended >= 3.10)
- Internet connection for API calls
- Valid API key or OAuth credentials

**Key Features:**
- **Context Length**: 256K tokens (extendable to 1M)
- **Language Support**: 358 programming languages
- **File Operations**: Read, write, search, navigate
- **Terminal Operations**: Execute commands, manage processes
- **Codebase Understanding**: Intelligent chunking and context management
- **REPL Mode**: Interactive coding environment

## 3. Proposed Solution

### 3.1 Agent Configuration

Add Qwen Code as the sixth builtin agent with the following configuration:

**Agent ID:** `qwen-code`

**Command Template:**
```typescript
'qwen-code': {
  command: 'qwen',
  args: ['--acp']
}
```

**Rationale for Direct Command:**
- Qwen Code is designed to be installed globally via pip/uv
- Direct command execution is faster than npx-style invocation
- Follows Python CLI tool conventions
- Users can manage installation via their preferred Python package manager

**Alternative Consideration:**
Users who prefer uv tool isolation can create a custom agent profile with:
```typescript
{
  command: 'uvx',
  args: ['qwen-code', '--acp']
}
```

### 3.2 Display Metadata

**Name (i18n key):** `acp.builtin.qwen-code.name`
- English: "Qwen Code"
- Chinese: "通义千问代码助手" or "Qwen Code"
- (Localized appropriately for each language)

**Description (i18n key):** `acp.builtin.qwen-code.description`
- English: "Alibaba's open-source agentic coding CLI powered by Qwen3-Coder. Supports 358 languages, 256K-1M token context, and intelligent codebase management."
- Chinese: "阿里巴巴开源的智能编码 CLI 工具，基于 Qwen3-Coder 模型。支持 358 种编程语言、256K-1M 上下文长度和智能代码库管理。"

**Icon:**
- Use Qwen/Alibaba Cloud official branding
- Format: SVG or PNG (transparent background)
- Size: 64x64px or scalable SVG
- Location: `src/renderer/src/assets/icons/qwen-code.svg`

### 3.3 Initialization Flow

**First-Time Setup:**
1. User selects Qwen Code from ACP agent list
2. DeepChat checks if agent is initialized
3. If not initialized, prompt user to run initialization
4. Initialization options:
   - **Option A (Recommended)**: `uv tool install qwen-code`
   - **Option B**: `pip install qwen-code`
5. Verify installation: `qwen --version`
6. Prompt for API key configuration (optional, can be done later)
7. Agent marked as initialized

**Subsequent Usage:**
1. User starts conversation with Qwen Code
2. DeepChat spawns process: `qwen-code --acp`
3. Agent uses configured authentication
4. Session begins immediately

### 3.4 Authentication Handling

**Default Flow (API Key):**
- Qwen Code reads from `~/.qwen-code/config.json`
- Or from environment variables: `QWEN_API_KEY`, `OPENAI_API_KEY`, etc.
- DeepChat doesn't manage credentials directly
- Users configure via Qwen Code's own setup

**Advanced Configuration (Optional):**
Users can configure via environment variables in agent profile:
- `QWEN_API_KEY`: Qwen AI API key
- `OPENAI_API_KEY`: OpenAI API key (if using OpenAI models)
- `ANTHROPIC_API_KEY`: Anthropic API key (if using Claude models)
- `QWEN_MODEL`: Preferred model (e.g., `qwen3-coder-32b`)

DeepChat can expose these in agent profile settings as optional environment variables.

## 4. Technical Design

### 4.1 Code Changes

#### 4.1.1 Type Definitions (`src/shared/types/presenters/legacy.presenters.d.ts`)

```typescript
export type AcpBuiltinAgentId =
  | 'kimi-cli'
  | 'claude-code-acp'
  | 'codex-acp'
  | 'opencode'
  | 'gemini-cli'
  | 'qwen-code'  // ADD THIS
```

#### 4.1.2 Configuration Helper (`src/main/presenter/configPresenter/acpConfHelper.ts`)

**Update BUILTIN_ORDER:**
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

**Update BUILTIN_TEMPLATES:**
```typescript
const BUILTIN_TEMPLATES: Record<AcpBuiltinAgentId, BuiltinTemplate> = {
  // ... existing agents ...
  'qwen-code': {
    name: 'Qwen Code',
    defaultProfile: () => ({
      name: DEFAULT_PROFILE_NAME,
      command: 'qwen',
      args: ['--acp'],
      env: {}
    })
  }
}
```

#### 4.1.3 Initialization Helper (`src/main/presenter/configPresenter/acpInitHelper.ts`)

**Add to BUILTIN_INIT_COMMANDS:**
```typescript
const BUILTIN_INIT_COMMANDS: Record<AcpBuiltinAgentId, InitCommandConfig> = {
  // ... existing agents ...
  'qwen-code': {
    commands: [
      'uv tool install qwen-code',
      'qwen --version'
    ],
    description: 'Initialize Qwen Code',
    alternativeCommands: [
      'pip install qwen-code',
      'qwen --version'
    ]
  }
}
```

**External Dependencies (if needed):**
```typescript
const EXTERNAL_DEPENDENCIES: ExternalDependency[] = [
  // ... existing dependencies ...
  {
    name: 'Python',
    description: 'Python runtime for Qwen Code',
    platform: ['win32', 'darwin', 'linux'],
    checkCommand: 'python --version',
    minVersion: '3.8',
    recommendedVersion: '3.10',
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

#### 4.1.4 Internationalization Files

**Add to all locale files** (`src/renderer/src/locales/*.json`):

**zh-CN (Chinese Simplified):**
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

**en-US (English):**
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

**ja-JP (Japanese):**
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

**ko-KR (Korean):**
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

*(Continue for all 12 supported languages: fr-FR, de-DE, es-ES, pt-BR, ru-RU, it-IT, nl-NL, pl-PL)*

#### 4.1.5 Icon Asset

**File:** `src/renderer/src/assets/icons/qwen-code.svg`

Obtain official Qwen/Alibaba Cloud icon from:
- Qwen official website (qwen.ai)
- Alibaba Cloud brand resources
- Qwen Code repository

Ensure proper licensing and attribution.

### 4.2 Configuration Flow Diagram

```
User selects "Add ACP Agent"
    ↓
UI displays builtin agents list
    ├─ Kimi CLI
    ├─ Claude Code
    ├─ Codex
    ├─ OpenCode
    ├─ Gemini CLI
    └─ Qwen Code ← NEW
    ↓
User selects "Qwen Code"
    ↓
ConfigPresenter.addBuiltinAgent('qwen-code')
    ↓
AcpConfHelper.addBuiltinAgent()
    ├─ Load template: { command: 'qwen', args: ['--acp'] }
    ├─ Create default profile
    ├─ Mark as not initialized
    └─ Save to ElectronStore
    ↓
UI prompts: "Initialize Qwen Code?"
    ↓
User clicks "Initialize"
    ↓
AcpInitHelper.initializeAgent('qwen-code')
    ├─ Check Python version (>= 3.8)
    ├─ Check uv availability (recommended)
    ├─ Spawn PTY: uv tool install qwen-code
    ├─ Stream output to UI
    ├─ Verify installation: qwen --version
    ├─ (Optional) Prompt for API key configuration
    └─ Mark as initialized
    ↓
Agent ready for use
```

### 4.3 Runtime Flow Diagram

```
User starts conversation with Qwen Code
    ↓
AcpProvider.coreStream() called
    ↓
AcpSessionManager.getOrCreateSession('qwen-code', conversationId)
    ↓
AcpProcessManager.warmupProcess('qwen-code')
    ├─ Check if warmup process exists
    ├─ If not, spawn: qwen-code --acp
    ├─ Set working directory (cwd)
    ├─ Initialize ACP connection (stdio)
    ├─ Fetch available models/modes
    └─ Return process handle
    ↓
AcpProcessManager.bindProcess(processId, conversationId)
    ↓
AcpSessionManager.initializeSession()
    ├─ Get MCP server selections for qwen-code
    ├─ Call agent.newSession() with MCP servers
    ├─ Apply preferred mode/model (if any)
    └─ Return session record
    ↓
Send user prompt to agent via connection.prompt()
    ↓
Qwen Code processes prompt
    ├─ Uses Qwen3-Coder API (or configured provider)
    ├─ Applies intelligent context management
    ├─ Executes tool calls (file operations, etc.)
    └─ Sends notifications via ACP protocol
    ↓
AcpContentMapper maps notifications to LLM events
    ├─ Text content → text event
    ├─ Tool calls → tool_call event
    ├─ Permissions → permission_request event
    └─ Reasoning → reasoning event
    ↓
Events streamed to renderer
    ↓
User sees Qwen Code response in chat
```

## 5. Implementation Details

### 5.1 File Modifications Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/shared/types/presenters/legacy.presenters.d.ts` | Modify | Add `'qwen-code'` to `AcpBuiltinAgentId` type |
| `src/main/presenter/configPresenter/acpConfHelper.ts` | Modify | Add to `BUILTIN_ORDER`, `BUILTIN_TEMPLATES` |
| `src/main/presenter/configPresenter/acpInitHelper.ts` | Modify | Add to `BUILTIN_INIT_COMMANDS`, external dependencies |
| `src/renderer/src/locales/zh-CN.json` | Modify | Add i18n strings for qwen-code |
| `src/renderer/src/locales/en-US.json` | Modify | Add i18n strings for qwen-code |
| `src/renderer/src/locales/ja-JP.json` | Modify | Add i18n strings for qwen-code |
| `src/renderer/src/locales/ko-KR.json` | Modify | Add i18n strings for qwen-code |
| (All other locale files) | Modify | Add i18n strings for qwen-code |
| `src/renderer/src/assets/icons/qwen-code.svg` | Create | Add Qwen Code icon |

### 5.2 Testing Requirements

#### 5.2.1 Unit Tests

**Test File:** `test/main/presenter/configPresenter/acpConfHelper.test.ts`

```typescript
describe('AcpConfHelper - Qwen Code', () => {
  it('should include qwen-code in builtin agents list', () => {
    const helper = new AcpConfHelper()
    const builtins = helper.getBuiltins()
    const qwenCode = builtins.find(agent => agent.id === 'qwen-code')
    expect(qwenCode).toBeDefined()
    expect(qwenCode?.name).toBe('Qwen Code')
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

  it('should return correct icon path for qwen-code', () => {
    const icon = getBuiltinAgentIcon('qwen-code')
    expect(icon).toBe('qwen-code.svg')
  })
})
```

#### 5.2.2 Integration Tests

**Test Scenarios:**
1. **Agent Initialization:**
   - Spawn Qwen Code process via command
   - Verify ACP connection established
   - Verify models/modes fetched
   - Verify process cleanup on exit

2. **Session Management:**
   - Create session with Qwen Code
   - Send prompt and receive response
   - Verify streaming events
   - Verify session cleanup

3. **Permission Handling:**
   - Trigger permission request from agent
   - Verify UI permission dialog
   - Send approval/denial
   - Verify agent receives response

4. **MCP Integration:**
   - Configure MCP servers for Qwen Code
   - Verify MCP servers passed to agent
   - Verify agent can call MCP tools

5. **Large Context Handling:**
   - Test with large codebase
   - Verify intelligent chunking
   - Verify context management

#### 5.2.3 Manual Testing Checklist

- [ ] Install Qwen Code via UI initialization flow (uv tool install)
- [ ] Install Qwen Code via alternative method (pip install)
- [ ] Configure API key (via Qwen Code config or environment)
- [ ] Start conversation with Qwen Code
- [ ] Verify streaming responses
- [ ] Test file read operations (permission request)
- [ ] Test file write operations (permission request)
- [ ] Test terminal command execution
- [ ] Test MCP tool integration
- [ ] Test with large codebase (>100 files)
- [ ] Test mode switching (if supported)
- [ ] Test model switching (if supported)
- [ ] Test session persistence across app restarts
- [ ] Test multiple concurrent sessions
- [ ] Test error handling (API failures, auth issues)
- [ ] Verify icon displays correctly
- [ ] Verify i18n strings in all supported languages
- [ ] Test on Windows, macOS, Linux

### 5.3 Edge Cases and Error Handling

#### 5.3.1 Installation Failures

**Scenario:** Python not installed
- **Cause:** User doesn't have Python
- **Handling:** Check Python availability, show installation guide
- **User Action:** Install Python, retry

**Scenario:** pip/uv installation fails
- **Cause:** Network issues, package conflicts
- **Handling:** Display error message with retry option
- **User Action:** Check internet connection, resolve conflicts, retry

#### 5.3.2 Authentication Failures

**Scenario:** No API key configured
- **Cause:** User hasn't set up authentication
- **Handling:** Display setup instructions
- **User Action:** Configure API key via Qwen Code or environment variables

**Scenario:** API key invalid/expired
- **Cause:** Invalid or expired credentials
- **Handling:** Display authentication error from Qwen Code
- **User Action:** Update API key

**Scenario:** API rate limit exceeded
- **Cause:** Free tier quota exhausted
- **Handling:** Display rate limit error
- **User Action:** Wait for quota reset or upgrade

#### 5.3.3 Runtime Errors

**Scenario:** Qwen Code process crashes
- **Cause:** Internal error, API timeout, memory issues
- **Handling:**
  - Detect process exit via ACP connection
  - Display error message to user
  - Offer to restart session
- **User Action:** Restart conversation or check logs

**Scenario:** Large codebase performance issues
- **Cause:** Extremely large codebase (>10GB)
- **Handling:** Qwen Code's intelligent chunking should handle this
- **User Action:** If issues persist, reduce scope or use .gitignore

#### 5.3.4 Version Compatibility

**Scenario:** Python version < 3.8
- **Cause:** User has outdated Python
- **Handling:** Check Python version during initialization
- **User Action:** Upgrade Python

**Scenario:** Qwen Code breaking changes
- **Cause:** New version changes ACP protocol
- **Handling:**
  - Pin to specific version if needed: `uv tool install qwen-code==1.2.3`
  - Monitor Qwen Code releases for breaking changes
- **User Action:** Update DeepChat if compatibility issues arise

## 6. Risks and Mitigations

### 6.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Python dependency management | Medium | Medium | Use uv for isolated installation, provide clear docs |
| ACP protocol compatibility | High | Low | Test thoroughly, monitor Qwen Code releases |
| API rate limits | Medium | Medium | Display clear error messages, link to upgrade options |
| Large codebase performance | Medium | Low | Leverage Qwen Code's built-in chunking |
| Process management issues | High | Low | Reuse existing ACP infrastructure |

### 6.2 User Experience Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Python installation complexity | Medium | Medium | Provide step-by-step guide, support multiple methods |
| API key configuration confusion | Medium | Medium | Clear documentation, tooltips in UI |
| Icon/branding unclear | Low | Low | Use official Qwen/Alibaba branding |
| Performance expectations | Low | Low | Clearly document capabilities and limitations |

### 6.3 Legal/Compliance Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Icon usage without permission | Medium | Low | Obtain proper licensing from Alibaba |
| Terms of service violations | High | Very Low | Review Qwen Code ToS, ensure compliance |
| Data privacy concerns | Medium | Low | Document that data flows through Qwen APIs |
| Open-source license compliance | Low | Very Low | Qwen Code is MIT licensed, compatible |

## 7. Success Metrics

### 7.1 Implementation Success

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual testing checklist completed
- [ ] Code review approved
- [ ] i18n completeness check passes
- [ ] Build succeeds on all platforms (Windows, macOS, Linux)

### 7.2 User Adoption

- Track number of users who enable Qwen Code
- Track conversation count with Qwen Code
- Monitor error rates and crash reports
- Collect user feedback on installation and setup flow

### 7.3 Quality Metrics

- Zero critical bugs in first release
- < 5% error rate in agent initialization
- < 1% crash rate during conversations
- Average response time < 3 seconds (excluding API latency)
- Support for codebases up to 10GB

## 8. Timeline and Milestones

### Phase 1: Core Integration (Estimated: 2-3 days)
- [ ] Add type definitions
- [ ] Update configuration helper
- [ ] Update initialization helper
- [ ] Add i18n strings (all 12 languages)
- [ ] Add icon asset
- [ ] Write unit tests

### Phase 2: Testing and Validation (Estimated: 2-3 days)
- [ ] Write integration tests
- [ ] Manual testing on all platforms
- [ ] Test with various codebase sizes
- [ ] Fix bugs and edge cases
- [ ] Performance optimization

### Phase 3: Documentation and Release (Estimated: 1 day)
- [ ] Update user documentation
- [ ] Create setup guide
- [ ] Prepare release notes
- [ ] Submit PR for review

**Total Estimated Time:** 5-7 days

## 9. Open Questions

1. **Icon Licensing:** Do we have permission to use Qwen/Alibaba Cloud's official icon?
   - **Action:** Contact Alibaba or check brand guidelines

2. **Default Ordering:** Should Qwen Code be last in the list or positioned differently?
   - **Recommendation:** Add to end of list to avoid disrupting existing workflows

3. **Environment Variables:** Should we expose API key configuration in UI?
   - **Recommendation:** Start with external config, add UI in future iteration

4. **Version Pinning:** Should we pin to specific Qwen Code version or always use latest?
   - **Recommendation:** Use latest initially, pin if compatibility issues arise

5. **Python Version:** Should we require Python 3.10+ or support 3.8+?
   - **Recommendation:** Require 3.8+, recommend 3.10+

6. **Installation Method:** Should we prefer uv or pip?
   - **Recommendation:** Prefer uv (isolated), support both

## 10. References

### Documentation
- [Qwen AI Official Site](https://qwen.ai)
- [Qwen Code GitHub](https://github.com/QwenLM/Qwen-Agent) (Note: Qwen Code may be in separate repo)
- [Qwen3-Coder Model](https://huggingface.co/Qwen/Qwen3-Coder)
- [ACP Protocol Specification](https://agentclientprotocol.com)
- [Alibaba Cloud](https://alibabacloud.com)

### Related Specifications
- `docs/spec-driven-dev.md` - Specification-driven development process
- `docs/specs/gemini-cli-acp/spec.md` - Gemini CLI integration (reference)
- `docs/specs/opencode-integration/spec.md` - OpenCode integration (reference)
- Existing ACP implementation in `src/main/presenter/agentPresenter/acp/`

### Git History
- Commit `689e48bd`: feat(acp): add gemini-cli as builtin agent
- Commit `961d7627`: feat(acp): add OpenCode as builtin agent with icon support

### Web Sources
- [Qwen Code capabilities and API 2026](https://qwen.ai)
- [Agent Client Protocol](https://agentclientprotocol.com)
- [Qwen3-Coder announcement](https://qwenlm.github.io)

---

**Document Version:** 1.0
**Last Updated:** 2026-01-16
**Author:** DeepChat Team
**Status:** Draft → Pending Review
