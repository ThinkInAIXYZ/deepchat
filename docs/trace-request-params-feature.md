# Trace Request Parameters Feature

## Overview
This feature adds a development-mode debugging tool that allows developers to inspect the actual request parameters sent to LLM providers for any assistant message. This helps understand data flow, verify prompt construction, and debug provider-specific formatting issues.

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                      Renderer Process                        │
│                                                              │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────┐ │
│  │ MessageToolbar │→ │MessageItemAssist │→ │ MessageList │ │
│  │  (Trace Btn)   │  │     (Event)      │  │  (Handler)  │ │
│  └────────────────┘  └──────────────────┘  └──────┬──────┘ │
│                                                     │        │
│                                           ┌─────────▼──────┐ │
│                                           │  TraceDialog   │ │
│                                           │  (UI Display)  │ │
│                                           └────────┬───────┘ │
└──────────────────────────────────────────────────┼─────────┘
                                                    │ IPC
                           ┌────────────────────────▼─────────────┐
                           │         Main Process                 │
                           │                                      │
                           │  ┌───────────────────────────────┐  │
                           │  │    ThreadPresenter             │  │
                           │  │  getMessageRequestPreview()    │  │
                           │  └──────────┬─────────────────────┘  │
                           │             │                         │
                           │    ┌────────▼──────────┐             │
                           │    │ LLMProviderPresenter│            │
                           │    │   getProvider()    │             │
                           │    └────────┬───────────┘             │
                           │             │                         │
                           │    ┌────────▼───────────┐            │
                           │    │  BaseLLMProvider   │            │
                           │    │ getRequestPreview()│            │
                           │    └────────┬───────────┘            │
                           │             │                         │
                           │  ┌──────────▼────────────────────┐   │
                           │  │  Concrete Provider Impl       │   │
                           │  │  - OpenAICompatibleProvider   │   │
                           │  │  - OpenAIResponsesProvider    │   │
                           │  │  - (23+ child providers)      │   │
                           │  └──────────┬────────────────────┘   │
                           │             │                         │
                           │    ┌────────▼────────────┐           │
                           │    │  Redaction Utility  │           │
                           │    │   (lib/redact.ts)   │           │
                           │    └─────────────────────┘           │
                           └──────────────────────────────────────┘
```

### Data Flow

1. **User Action**: User clicks Trace button in MessageToolbar (DEV mode only)
2. **Event Propagation**: 
   - MessageToolbar emits `trace` event
   - MessageItemAssistant catches and re-emits with messageId
   - MessageList handles and sets `traceMessageId`
3. **IPC Call**: TraceDialog watches messageId and calls `threadPresenter.getMessageRequestPreview(messageId)`
4. **Main Process**:
   - ThreadPresenter retrieves message and conversation from database
   - Reconstructs prompt content using `preparePromptContent()`
   - Fetches MCP tools from McpPresenter
   - Gets model configuration
   - Calls provider's `getRequestPreview()` method
5. **Provider Layer**:
   - Provider builds request parameters (same logic as actual request)
   - Returns `{ endpoint, headers, body }`
6. **Security**: Redact sensitive information using `redactRequestPreview()`
7. **Response**: Return preview data to renderer
8. **UI Display**: TraceDialog renders JSON in a modal with copy functionality

## Key Files

### Renderer Process

- **`src/renderer/src/components/message/MessageToolbar.vue`**
  - Adds Trace button (bug icon, visible only in DEV mode for assistant messages)
  - Emits `trace` event when clicked

- **`src/renderer/src/components/message/MessageItemAssistant.vue`**
  - Listens to MessageToolbar's `trace` event
  - Re-emits with message ID

- **`src/renderer/src/components/message/MessageList.vue`**
  - Manages `traceMessageId` state
  - Renders TraceDialog component
  - Handles trace event from MessageItemAssistant

- **`src/renderer/src/components/trace/TraceDialog.vue`**
  - Modal dialog for displaying request preview
  - Shows provider, model, endpoint, headers, and body
  - Provides JSON copy functionality
  - Handles loading, error, and "not implemented" states

### Main Process

- **`src/main/presenter/threadPresenter/index.ts`**
  - `getMessageRequestPreview(messageId)`: Orchestrates preview reconstruction
  - Retrieves conversation context and settings
  - Reconstructs prompt using `preparePromptContent()`
  - Fetches MCP tools
  - Calls provider's preview method
  - Applies redaction

- **`src/main/presenter/llmProviderPresenter/baseProvider.ts`**
  - Defines abstract `getRequestPreview()` method
  - Default implementation throws "not implemented" error

- **`src/main/presenter/llmProviderPresenter/providers/openAICompatibleProvider.ts`**
  - Implements `getRequestPreview()` for OpenAI-compatible providers
  - Mirrors `handleChatCompletion()` logic without making actual API call
  - Returns endpoint, headers, and body

- **`src/main/presenter/llmProviderPresenter/providers/openAIResponsesProvider.ts`**
  - Implements `getRequestPreview()` for OpenAI Responses API
  - Mirrors `handleChatCompletion()` logic

- **`src/main/lib/redact.ts`**
  - `redactRequestPreview()`: Removes sensitive data from preview
  - Redacts API keys, tokens, passwords, secrets
  - Recursively processes nested objects and arrays

### Shared Types

- **`src/shared/provider-operations.ts`**
  - `ProviderRequestPreview`: Type definition for preview data structure
  - Fields: providerId, modelId, endpoint, headers, body, mayNotMatch, notImplemented

- **`src/shared/types/presenters/thread.presenter.d.ts`**
  - Adds `getMessageRequestPreview(messageId: string): Promise<unknown>` to IThreadPresenter

### Internationalization

- **`src/renderer/src/i18n/[locale]/traceDialog.json`**
  - UI strings for TraceDialog (title, labels, error messages)
  - Supported locales: zh-CN, en-US

- **`src/renderer/src/i18n/[locale]/thread.json`**
  - Added `toolbar.trace` key for button tooltip

## Implementation Details

### Provider Support Status

#### ✅ Fully Implemented
- `OpenAICompatibleProvider` (base class)
- `OpenAIResponsesProvider`

#### 🟡 Inherited (23 providers, auto-supported via base class)
All providers extending `OpenAICompatibleProvider` automatically inherit `getRequestPreview()`:
- OpenAIProvider
- DeepseekProvider
- DashscopeProvider
- DoubaoProvider
- GrokProvider
- GroqProvider
- GithubProvider
- MinimaxProvider
- ZhipuProvider
- SiliconcloudProvider
- ModelscopeProvider
- OpenRouterProvider
- PPIOProvider
- TogetherProvider
- TokenFluxProvider
- VercelAIGatewayProvider
- CherryInProvider
- AihubmixProvider
- _302AIProvider
- PoeProvider
- JiekouProvider
- ZenmuxProvider
- LMStudioProvider

#### ❌ Not Yet Implemented
- `AnthropicProvider` (separate base class)
- `GeminiProvider` (separate base class)
- `AwsBedrockProvider` (separate base class)
- `OllamaProvider` (separate base class)
- `GithubCopilotProvider` (separate implementation)

### Request Reconstruction Logic

The `getRequestPreview()` method in each provider:

1. **Formats Messages**: Uses same `formatMessages()` method as actual requests
2. **Prepares Function Calls**: Applies `prepareFunctionCallPrompt()` for non-FC models
3. **Converts Tools**: Uses `mcpPresenter.mcpToolsToOpenAITools()` for native FC
4. **Builds Request Params**: Constructs exact request object (stream, temperature, max_tokens, etc.)
5. **Applies Model-Specific Logic**: 
   - Reasoning models (o1, o3, gpt-5): Remove temperature, use max_completion_tokens
   - Provider-specific quirks (e.g., OpenRouter Deepseek, Dashscope response_format)
6. **Constructs Headers**: Includes Authorization, Content-Type, and custom headers
7. **Determines Endpoint**: Combines baseUrl with API path

### Security: Sensitive Data Redaction

The `redactRequestPreview()` function:

- **Headers**: Redacts authorization, api_key, x-api-key, token, password
- **Body**: Recursively scans objects/arrays for sensitive keys
- **Sensitive Keys List**:
  ```typescript
  const SENSITIVE_KEYS = [
    'api_key',
    'apikey', 
    'authorization',
    'x-api-key',
    'accesskeyid',
    'secretaccesskey',
    'password',
    'token'
  ]
  ```
- **Redaction Format**: Replaces value with `'********'`
- **Case-Insensitive**: Key matching is case-insensitive

### UI/UX Design

#### Trace Button
- **Icon**: `lucide:bug` (bug icon)
- **Visibility**: Only in DEV mode (`import.meta.env.DEV`)
- **Scope**: Only on assistant messages (not user/system)
- **Tooltip**: Localized "Trace Request" / "调试请求参数"

#### TraceDialog Layout
```
┌─────────────────────────────────────────────────┐
│ Request Preview                           [×]   │
├─────────────────────────────────────────────────┤
│ ⚠️ Note: This preview may not match actual req │
├─────────────────────────────────────────────────┤
│ Provider: openai   Model: gpt-4   Endpoint: …  │
├─────────────────────────────────────────────────┤
│ Request Body                      [Copy JSON]   │
│ ┌───────────────────────────────────────────┐  │
│ │ {                                          │  │
│ │   "messages": [...],                       │  │
│ │   "model": "gpt-4",                        │  │
│ │   "temperature": 0.7,                      │  │
│ │   ...                                      │  │
│ │ }                                          │  │
│ └───────────────────────────────────────────┘  │
│                                                 │
│                                    [Close]      │
└─────────────────────────────────────────────────┘
```

#### States
- **Loading**: Shows spinner with "Loading..." message
- **Error**: Shows error icon with retry message
- **Not Implemented**: Shows info icon with "Provider not supported" message
- **Success**: Shows formatted JSON with metadata

### Error Handling

1. **Null/Undefined Result**: Show error state
2. **Provider Not Implemented**: Show "not implemented" info state
3. **IPC Failure**: Caught in try-catch, shows error state
4. **Parse Error**: Logged to console, shows error state
5. **Copy Failure**: Logged to console, toast notification

## Usage

### Developer Workflow

1. Run app in dev mode: `pnpm run dev`
2. Start a conversation with an LLM
3. Click the bug icon (🐛) on any assistant message
4. View the reconstructed request parameters
5. Copy JSON for debugging/testing

### Use Cases

- **Debugging**: Verify prompt construction and tool definitions
- **Provider Comparison**: Compare request formats across providers
- **Tool Calling**: Inspect how tools are encoded (native vs. mock)
- **Model Quirks**: Understand provider-specific parameter handling
- **Context Analysis**: Verify which messages are included in context

## Testing

### Manual Testing Checklist
- [x] Trace button only appears in DEV mode
- [x] Trace button only appears on assistant messages
- [x] Dialog opens when clicking Trace button
- [x] Loading state displays correctly
- [x] Error state displays for invalid messages
- [x] "Not implemented" state displays for unsupported providers
- [x] Preview displays correctly for OpenAI-compatible providers
- [x] Sensitive data is redacted (API keys, tokens)
- [x] JSON copy functionality works
- [x] Dialog closes correctly
- [ ] All 23+ child providers inherit preview functionality

### Automated Testing (TODO)
- [ ] Unit tests for `redactRequestPreview()` (tests-main)
- [ ] Unit tests for TraceDialog component (tests-renderer)
- [ ] Unit tests for provider `getRequestPreview()` methods

## Future Enhancements

1. **Extend to More Providers**:
   - Implement `getRequestPreview()` for AnthropicProvider
   - Implement for GeminiProvider
   - Implement for AwsBedrockProvider
   - Implement for OllamaProvider

2. **Enhanced UI**:
   - Syntax highlighting for JSON
   - Collapsible sections (headers/body)
   - Diff view comparing multiple requests
   - Export to file

3. **Advanced Features**:
   - Historical request archive
   - Request replay/resend
   - Token counting preview
   - Cost estimation

4. **Production Use**:
   - Optional logging to file (with user consent)
   - Telemetry for provider debugging
   - Request/response matching

## Known Issues

1. **Reconstruction Limitations**:
   - Preview is reconstructed from current DB state
   - May not exactly match original request if:
     - Conversation settings changed
     - MCP tools updated
     - Provider configuration changed
   - Warning displayed to user

2. **Provider Coverage**:
   - Only OpenAI-compatible providers fully supported
   - Other provider types show "not implemented"

3. **Performance**:
   - Preview reconstruction involves DB queries
   - May be slow for large conversations
   - No caching implemented

## References

- [IPC Architecture](./ipc/ipc-architecture-complete.md)
- [Provider Architecture](./provider-optimization-summary.md)
- [MCP Tool System](./mcp-architecture.md)
- [Prompt Builder](../src/main/presenter/threadPresenter/utils/promptBuilder.ts)
