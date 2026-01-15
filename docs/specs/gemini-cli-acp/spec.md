# Gemini CLI ACP Integration Specification

**Status:** Draft
**Created:** 2026-01-15
**Author:** System Analysis
**Target Version:** TBD

## 1. Overview

### 1.1 Motivation

Google's Gemini CLI is the reference implementation for the Agent Client Protocol (ACP), developed in collaboration with Zed Industries. As of January 2026, it represents a mature and actively maintained ACP agent with the following advantages:

- **Official ACP Reference Implementation**: First agent to adopt ACP, ensuring protocol compliance
- **Active Development**: Recent v0.23.0 release (January 2026) with ongoing updates
- **Advanced Features**: Includes "Conductor" extension for context-driven development
- **Free Tier Available**: Accessible with personal Google account (Gemini 2.5 Pro)
- **Enterprise Support**: Vertex AI integration for higher usage limits
- **Monitoring & Observability**: OpenTelemetry-based dashboards for usage insights

DeepChat currently supports four ACP agents (kimi-cli, claude-code-acp, codex-acp, opencode). Adding Gemini CLI will:
1. Provide users with Google's AI capabilities within DeepChat
2. Expand the diversity of available AI agents
3. Leverage Google's ecosystem (Google AI Studio, Vertex AI)
4. Offer a well-documented reference implementation for ACP

### 1.2 Goals

- Integrate Gemini CLI as a builtin ACP agent in DeepChat
- Support both npm-based installation and npx execution
- Provide seamless authentication flow (Google account, API key, Vertex AI)
- Enable all standard ACP features (streaming, permissions, MCP integration)
- Add appropriate branding (icon, display name, description)

### 1.3 Non-Goals

- Custom Gemini API integration (this is ACP-only)
- Gemini-specific UI customizations beyond standard ACP features
- Integration with Google Workspace APIs
- Custom Conductor extension configuration (use defaults)

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
  'claude-code-acp',    // Claude Code ACP (Zed Industries)
  'codex-acp',          // Codex CLI ACP (OpenAI)
  'opencode'            // OpenCode agent
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

1. **Type Definitions** (`src/shared/types/acp.ts`):
   - Add agent ID to `AcpBuiltinAgentId` union type
   - Add icon mapping if custom icon needed

2. **Configuration Helper** (`src/main/presenter/configPresenter/acpConfHelper.ts`):
   - Add to `BUILTIN_ORDER` array
   - Add command template to `BUILTIN_TEMPLATES`
   - Add display metadata (name, description, icon)

3. **Internationalization** (`src/renderer/src/locales/*.json`):
   - Add translated strings for agent name and description
   - Support 12 languages (zh-CN, en-US, ja-JP, ko-KR, etc.)

4. **Assets** (optional):
   - Add agent icon to `src/renderer/src/assets/icons/`

### 2.3 Gemini CLI Characteristics

**Installation Methods:**
- Global: `npm install -g @google/gemini-cli`
- NPX: `npx @google/gemini-cli`
- Preview: `npm install -g @google/gemini-cli@preview`

**ACP Mode Invocation:**
- Standard command: `gemini` (when globally installed)
- NPX command: `npx @google/gemini-cli`
- Experimental flag: `--experimental-acp` (for TTY responsiveness)

**Authentication:**
- Personal Google account (default, prompted on first run)
- Gemini API Key (via environment variable or config)
- Vertex AI (enterprise, requires project configuration)

**Requirements:**
- Node.js >= 18 (recommended >= 20)
- Internet connection for authentication and API calls

## 3. Proposed Solution

### 3.1 Agent Configuration

Add Gemini CLI as the fifth builtin agent with the following configuration:

**Agent ID:** `gemini-cli`

**Command Template:**
```typescript
'gemini-cli': {
  command: 'npx',
  args: ['-y', '@google/gemini-cli']
}
```

**Rationale for NPX:**
- No global installation required (lower barrier to entry)
- Always uses latest version (automatic updates)
- Consistent with existing patterns (claude-code-acp, codex-acp use npx)
- `-y` flag auto-confirms installation

**Alternative Consideration:**
Users who prefer global installation can create a custom agent profile with:
```typescript
{
  command: 'gemini',
  args: []
}
```

### 3.2 Display Metadata

**Name (i18n key):** `acp.builtin.gemini-cli.name`
- English: "Gemini CLI"
- Chinese: "Gemini CLI"
- (Same across languages as it's a product name)

**Description (i18n key):** `acp.builtin.gemini-cli.description`
- English: "Google's reference implementation for ACP with Gemini 2.5 Pro. Supports code understanding, file manipulation, and context-driven development."
- Chinese: "Google 的 ACP 参考实现，搭载 Gemini 2.5 Pro。支持代码理解、文件操作和上下文驱动开发。"

**Icon:**
- Use Google Gemini official icon
- Format: SVG or PNG (transparent background)
- Size: 64x64px or scalable SVG
- Location: `src/renderer/src/assets/icons/gemini-cli.svg`

### 3.3 Initialization Flow

**First-Time Setup:**
1. User selects Gemini CLI from ACP agent list
2. DeepChat checks if agent is initialized
3. If not initialized, prompt user to run initialization
4. Initialization spawns: `npx -y @google/gemini-cli`
5. Gemini CLI prompts for authentication (Google account login)
6. User completes authentication in terminal
7. Agent marked as initialized

**Subsequent Usage:**
1. User starts conversation with Gemini CLI
2. DeepChat spawns process: `npx -y @google/gemini-cli`
3. Agent uses cached authentication
4. Session begins immediately

### 3.4 Authentication Handling

**Default Flow (Personal Google Account):**
- Gemini CLI handles authentication automatically
- First run opens browser for Google login
- Credentials cached by Gemini CLI (not DeepChat)
- No additional configuration needed in DeepChat

**Advanced Configuration (Optional):**
Users can configure via environment variables:
- `GEMINI_API_KEY`: Use API key instead of account
- `GOOGLE_CLOUD_PROJECT`: Vertex AI project ID
- `GOOGLE_APPLICATION_CREDENTIALS`: Service account path

DeepChat can expose these in agent profile settings as optional environment variables.

## 4. Technical Design

### 4.1 Code Changes

#### 4.1.1 Type Definitions (`src/shared/types/acp.ts`)

```typescript
export type AcpBuiltinAgentId =
  | 'kimi-cli'
  | 'claude-code-acp'
  | 'codex-acp'
  | 'opencode'
  | 'gemini-cli'  // ADD THIS
```

#### 4.1.2 Configuration Helper (`src/main/presenter/configPresenter/acpConfHelper.ts`)

**Update BUILTIN_ORDER:**
```typescript
const BUILTIN_ORDER: AcpBuiltinAgentId[] = [
  'kimi-cli',
  'claude-code-acp',
  'codex-acp',
  'opencode',
  'gemini-cli'  // ADD THIS
]
```

**Update BUILTIN_TEMPLATES:**
```typescript
const BUILTIN_TEMPLATES: Record<AcpBuiltinAgentId, AcpAgentCommandTemplate> = {
  // ... existing agents ...
  'gemini-cli': {
    command: 'npx',
    args: ['-y', '@google/gemini-cli']
  }
}
```

**Update Display Metadata:**
```typescript
function getBuiltinAgentDisplayName(agentId: AcpBuiltinAgentId): string {
  const i18nKey = `acp.builtin.${agentId}.name`
  return i18n.t(i18nKey)
}

function getBuiltinAgentDescription(agentId: AcpBuiltinAgentId): string {
  const i18nKey = `acp.builtin.${agentId}.description`
  return i18n.t(i18nKey)
}

function getBuiltinAgentIcon(agentId: AcpBuiltinAgentId): string {
  const iconMap: Record<AcpBuiltinAgentId, string> = {
    'kimi-cli': 'kimi-icon.svg',
    'claude-code-acp': 'claude-icon.svg',
    'codex-acp': 'codex-icon.svg',
    'opencode': 'opencode-icon.svg',
    'gemini-cli': 'gemini-cli.svg'  // ADD THIS
  }
  return iconMap[agentId]
}
```

#### 4.1.3 Internationalization Files

**Add to all locale files** (`src/renderer/src/locales/*.json`):

```json
{
  "acp": {
    "builtin": {
      "gemini-cli": {
        "name": "Gemini CLI",
        "description": "Google's reference implementation for ACP with Gemini 2.5 Pro. Supports code understanding, file manipulation, and context-driven development."
      }
    }
  }
}
```

**Language-specific descriptions:**
- **zh-CN**: "Google 的 ACP 参考实现，搭载 Gemini 2.5 Pro。支持代码理解、文件操作和上下文驱动开发。"
- **ja-JP**: "Gemini 2.5 Pro を搭載した Google の ACP リファレンス実装。コード理解、ファイル操作、コンテキスト駆動開発をサポート。"
- **ko-KR**: "Gemini 2.5 Pro를 탑재한 Google의 ACP 참조 구현. 코드 이해, 파일 조작 및 컨텍스트 기반 개발 지원."
- (Continue for all 12 supported languages)

#### 4.1.4 Icon Asset

**File:** `src/renderer/src/assets/icons/gemini-cli.svg`

Obtain official Gemini icon from:
- Google Brand Resources
- Gemini CLI repository
- Google AI Studio branding guidelines

Ensure proper licensing and attribution.

### 4.2 Configuration Flow Diagram

```
User selects "Add ACP Agent"
    ↓
UI displays builtin agents list
    ├─ Kimi CLI
    ├─ Claude Code ACP
    ├─ Codex ACP
    ├─ OpenCode
    └─ Gemini CLI ← NEW
    ↓
User selects "Gemini CLI"
    ↓
ConfigPresenter.addBuiltinAgent('gemini-cli')
    ↓
AcpConfHelper.addBuiltinAgent()
    ├─ Load template: { command: 'npx', args: ['-y', '@google/gemini-cli'] }
    ├─ Create default profile
    ├─ Mark as not initialized
    └─ Save to ElectronStore
    ↓
UI prompts: "Initialize Gemini CLI?"
    ↓
User clicks "Initialize"
    ↓
AcpInitHelper.initializeAgent('gemini-cli')
    ├─ Check Node.js version (>= 18)
    ├─ Spawn PTY: npx -y @google/gemini-cli
    ├─ Stream output to UI
    ├─ Gemini CLI prompts for authentication
    ├─ User completes Google login in terminal
    └─ Mark as initialized
    ↓
Agent ready for use
```

### 4.3 Runtime Flow Diagram

```
User starts conversation with Gemini CLI
    ↓
AcpProvider.coreStream() called
    ↓
AcpSessionManager.getOrCreateSession('gemini-cli', conversationId)
    ↓
AcpProcessManager.warmupProcess('gemini-cli')
    ├─ Check if warmup process exists
    ├─ If not, spawn: npx -y @google/gemini-cli
    ├─ Initialize ACP connection (stdio)
    ├─ Fetch available models/modes
    └─ Return process handle
    ↓
AcpProcessManager.bindProcess(processId, conversationId)
    ↓
AcpSessionManager.initializeSession()
    ├─ Get MCP server selections for gemini-cli
    ├─ Call agent.newSession() with MCP servers
    ├─ Apply preferred mode/model (if any)
    └─ Return session record
    ↓
Send user prompt to agent via connection.prompt()
    ↓
Gemini CLI processes prompt
    ├─ Uses Gemini 2.5 Pro API
    ├─ Applies Conductor context (if enabled)
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
User sees Gemini CLI response in chat
```

## 5. Implementation Details

### 5.1 File Modifications Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/shared/types/acp.ts` | Modify | Add `'gemini-cli'` to `AcpBuiltinAgentId` type |
| `src/main/presenter/configPresenter/acpConfHelper.ts` | Modify | Add to `BUILTIN_ORDER`, `BUILTIN_TEMPLATES`, icon mapping |
| `src/renderer/src/locales/zh-CN.json` | Modify | Add i18n strings for gemini-cli |
| `src/renderer/src/locales/en-US.json` | Modify | Add i18n strings for gemini-cli |
| `src/renderer/src/locales/ja-JP.json` | Modify | Add i18n strings for gemini-cli |
| `src/renderer/src/locales/ko-KR.json` | Modify | Add i18n strings for gemini-cli |
| (All other locale files) | Modify | Add i18n strings for gemini-cli |
| `src/renderer/src/assets/icons/gemini-cli.svg` | Create | Add Gemini CLI icon |

### 5.2 Testing Requirements

#### 5.2.1 Unit Tests

**Test File:** `test/main/presenter/configPresenter/acpConfHelper.test.ts`

```typescript
describe('AcpConfHelper - Gemini CLI', () => {
  it('should include gemini-cli in builtin agents list', () => {
    const builtins = getBuiltinAgentIds()
    expect(builtins).toContain('gemini-cli')
  })

  it('should have correct command template for gemini-cli', () => {
    const template = getBuiltinTemplate('gemini-cli')
    expect(template.command).toBe('npx')
    expect(template.args).toEqual(['-y', '@google/gemini-cli'])
  })

  it('should return correct display name for gemini-cli', () => {
    const name = getBuiltinAgentDisplayName('gemini-cli')
    expect(name).toBe('Gemini CLI')
  })

  it('should return correct icon path for gemini-cli', () => {
    const icon = getBuiltinAgentIcon('gemini-cli')
    expect(icon).toBe('gemini-cli.svg')
  })
})
```

#### 5.2.2 Integration Tests

**Test Scenarios:**
1. **Agent Initialization:**
   - Spawn Gemini CLI process via npx
   - Verify ACP connection established
   - Verify models/modes fetched
   - Verify process cleanup on exit

2. **Session Management:**
   - Create session with Gemini CLI
   - Send prompt and receive response
   - Verify streaming events
   - Verify session cleanup

3. **Permission Handling:**
   - Trigger permission request from agent
   - Verify UI permission dialog
   - Send approval/denial
   - Verify agent receives response

4. **MCP Integration:**
   - Configure MCP servers for Gemini CLI
   - Verify MCP servers passed to agent
   - Verify agent can call MCP tools

#### 5.2.3 Manual Testing Checklist

- [ ] Install Gemini CLI via UI initialization flow
- [ ] Authenticate with Google account
- [ ] Start conversation with Gemini CLI
- [ ] Verify streaming responses
- [ ] Test file read operations (permission request)
- [ ] Test file write operations (permission request)
- [ ] Test MCP tool integration
- [ ] Test mode switching (if supported)
- [ ] Test model switching (if supported)
- [ ] Test session persistence across app restarts
- [ ] Test multiple concurrent sessions
- [ ] Test error handling (network issues, auth failures)
- [ ] Verify icon displays correctly
- [ ] Verify i18n strings in all supported languages

### 5.3 Edge Cases and Error Handling

#### 5.3.1 Installation Failures

**Scenario:** NPX fails to download Gemini CLI
- **Cause:** Network issues, npm registry unavailable
- **Handling:** Display error message with retry option
- **User Action:** Check internet connection, retry

#### 5.3.2 Authentication Failures

**Scenario:** User cancels Google login
- **Cause:** User closes browser during auth
- **Handling:** Mark agent as not initialized, prompt to retry
- **User Action:** Retry initialization

**Scenario:** API key invalid
- **Cause:** User provides expired/invalid API key
- **Handling:** Display authentication error from Gemini CLI
- **User Action:** Update API key in environment variables

#### 5.3.3 Runtime Errors

**Scenario:** Gemini CLI process crashes
- **Cause:** Internal error, API rate limit, network timeout
- **Handling:**
  - Detect process exit via ACP connection
  - Display error message to user
  - Offer to restart session
- **User Action:** Restart conversation or check logs

**Scenario:** API rate limit exceeded
- **Cause:** Free tier quota exhausted
- **Handling:** Display rate limit error from Gemini CLI
- **User Action:** Wait for quota reset or upgrade to paid tier

#### 5.3.4 Version Compatibility

**Scenario:** Node.js version < 18
- **Cause:** User has outdated Node.js
- **Handling:** Check Node.js version during initialization
- **User Action:** Upgrade Node.js

**Scenario:** Gemini CLI breaking changes
- **Cause:** New version changes ACP protocol
- **Handling:**
  - Pin to specific version if needed: `npx @google/gemini-cli@0.23.0`
  - Monitor Gemini CLI releases for breaking changes
- **User Action:** Update DeepChat if compatibility issues arise

## 6. Risks and Mitigations

### 6.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| NPX download slow/fails | High | Medium | Provide option for global installation, cache npx packages |
| Authentication flow complex | Medium | Low | Provide clear documentation, video tutorial |
| Gemini CLI updates break compatibility | High | Low | Monitor releases, pin version if needed, automated testing |
| API rate limits hit frequently | Medium | Medium | Display clear error messages, link to upgrade options |
| Process management issues | High | Low | Reuse existing ACP infrastructure, thorough testing |

### 6.2 User Experience Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Users confused by authentication | Medium | Medium | Provide step-by-step guide in UI, tooltips |
| Icon/branding unclear | Low | Low | Use official Google Gemini branding |
| Performance slower than other agents | Medium | Low | Optimize process warmup, reuse connections |
| Users expect Gemini-specific features | Low | Medium | Clearly document ACP limitations in description |

### 6.3 Legal/Compliance Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Icon usage without permission | Medium | Low | Obtain proper licensing from Google |
| Terms of service violations | High | Very Low | Review Gemini CLI ToS, ensure compliance |
| Data privacy concerns | Medium | Low | Document that data flows through Google APIs |

## 7. Success Metrics

### 7.1 Implementation Success

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual testing checklist completed
- [ ] Code review approved
- [ ] i18n completeness check passes
- [ ] Build succeeds on all platforms (Windows, macOS, Linux)

### 7.2 User Adoption

- Track number of users who enable Gemini CLI
- Track conversation count with Gemini CLI
- Monitor error rates and crash reports
- Collect user feedback on authentication flow

### 7.3 Quality Metrics

- Zero critical bugs in first release
- < 5% error rate in agent initialization
- < 1% crash rate during conversations
- Average response time < 3 seconds (excluding API latency)

## 8. Timeline and Milestones

### Phase 1: Core Integration (Estimated: 2-3 days)
- [ ] Add type definitions
- [ ] Update configuration helper
- [ ] Add i18n strings (all languages)
- [ ] Add icon asset
- [ ] Write unit tests

### Phase 2: Testing and Validation (Estimated: 2-3 days)
- [ ] Write integration tests
- [ ] Manual testing on all platforms
- [ ] Fix bugs and edge cases
- [ ] Performance optimization

### Phase 3: Documentation and Release (Estimated: 1 day)
- [ ] Update user documentation
- [ ] Create setup guide
- [ ] Prepare release notes
- [ ] Submit PR for review

**Total Estimated Time:** 5-7 days

## 9. Open Questions

1. **Icon Licensing:** Do we have permission to use Google Gemini's official icon?
   - **Action:** Contact Google or check brand guidelines

2. **Default Ordering:** Should Gemini CLI be first in the list (as reference implementation) or last (as newest)?
   - **Recommendation:** Add to end of list to avoid disrupting existing user workflows

3. **Environment Variables:** Should we expose advanced configuration (API key, Vertex AI) in UI?
   - **Recommendation:** Start with default flow, add advanced options in future iteration

4. **Version Pinning:** Should we pin to specific Gemini CLI version or always use latest?
   - **Recommendation:** Use latest initially, pin if compatibility issues arise

5. **Conductor Extension:** Should we enable Conductor by default or let users configure?
   - **Recommendation:** Let Gemini CLI use its defaults, don't override

## 10. References

### Documentation
- [Gemini CLI Official Site](https://geminicli.com)
- [Gemini CLI npm Package](https://npmjs.com/package/@google/gemini-cli)
- [ACP Protocol Specification](https://zed.dev) (Zed Industries)
- [Google AI Studio](https://google.com)

### Related Specifications
- `docs/spec-driven-dev.md` - Specification-driven development process
- Existing ACP implementation in `src/main/presenter/agentPresenter/acp/`

### Git History
- Commit `961d7627`: feat(acp): add OpenCode as builtin agent with icon support
- Commit `2c8dab55`: feat(acp): enhance warmup process and add workdir change confirmation

