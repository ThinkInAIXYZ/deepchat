import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type {
  AssistantMessageBlock,
  ChatMessageRecord,
  PermissionMode
} from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolCall, MCPToolDefinition, MCPToolResponse } from '@shared/types/core/mcp'
import type { ModelConfig } from '@shared/presenter'
import type { DeepChatTapeViewManifest } from '@shared/types/tape-view-manifest'

export interface ProviderRequest {
  runId: string
  requestSeq: number
  messages: readonly ChatMessage[]
  tools: readonly MCPToolDefinition[]
  providerId: string
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  signal: AbortSignal
}

export interface ProviderPort {
  prepare(request: ProviderRequest): Promise<ProviderRequest>
  stream(request: ProviderRequest): AsyncGenerator<LLMCoreStreamEvent>
  cancel(input: { runId: string; abortController: AbortController }): void
}

export interface ToolCatalogPort {
  resolve(input: {
    sessionId: AppSessionId
    projectDir: string | null
    activeSkillNames: readonly string[]
  }): Promise<MCPToolDefinition[]>
}

export interface ToolExecutionPort {
  execute(input: {
    sessionId: AppSessionId
    messageId: string
    call: MCPToolCall
    permissionMode: PermissionMode
    activeSkillNames: readonly string[]
    signal: AbortSignal
  }): Promise<{ content: unknown; rawData: MCPToolResponse }>
  cancel(input: { toolCallId: string; abortController: AbortController }): void
}

export interface TapeEntryRef {
  sessionId: AppSessionId
  entryId: number
}

export interface TapeHead {
  sessionId: AppSessionId
  latestEntryId: number
}

export interface TapeFactProvenance {
  source: 'message' | 'tool_call' | 'tool_result' | 'runtime_event'
  sourceId: string
  sequence: number
}

export interface TapeToolFactInput {
  sessionId: AppSessionId
  messageId: string
  orderSeq: number
  blockIndex: number
  block: AssistantMessageBlock
  provenance: TapeFactProvenance
}

export interface TapeAnchorInput {
  sessionId: AppSessionId
  name: string
  state: Readonly<Record<string, unknown>>
  meta: Readonly<Record<string, unknown>>
  provenance: TapeFactProvenance
}

export interface TapeEffectiveView {
  sessionId: AppSessionId
  records: ChatMessageRecord[]
}

export interface TapeRecorder {
  ensureSession(input: { sessionId: AppSessionId }): Promise<TapeHead>
  appendUserMessage(input: { record: ChatMessageRecord }): Promise<TapeEntryRef>
  appendViewManifest(manifest: DeepChatTapeViewManifest): Promise<TapeEntryRef | null>
  appendAssistantFact(input: { record: ChatMessageRecord }): Promise<TapeEntryRef>
  appendToolFact(input: TapeToolFactInput): Promise<TapeEntryRef>
  appendAnchor(input: TapeAnchorInput): Promise<TapeEntryRef>
  readEffectiveView(input: { sessionId: AppSessionId }): Promise<TapeEffectiveView>
}

export interface OutputSink {
  update(input: {
    runId: string
    sessionId: AppSessionId
    messageId: string
    blocks: readonly AssistantMessageBlock[]
  }): void
  complete(input: {
    runId: string
    sessionId: AppSessionId
    messageId: string
    blocks: readonly AssistantMessageBlock[]
    metadata: Readonly<Record<string, unknown>>
  }): void
  fail(input: { runId: string; sessionId: AppSessionId; messageId: string; error: unknown }): void
}

export interface BasePromptAssemblyInput {
  sessionId: AppSessionId
  configuredPrompt: string
  toolDefinitions: readonly MCPToolDefinition[]
  activeSkillNames: readonly string[]
}

export interface BasePromptAssembler {
  assemble(input: BasePromptAssemblyInput): Promise<string>
}

export interface PromptReconstructionAnchor {
  name: string
  state: Record<string, unknown>
  createdAt: number
}

export interface PostCompactionPromptAssemblyInput {
  sessionId: AppSessionId
  basePrompt: string
  summaryText: string | null
  reconstructionAnchor: PromptReconstructionAnchor | null
  memoryQuery: string
  memoryMessageId?: string | null
}

export interface PostCompactionPromptAssembler {
  assemble(input: PostCompactionPromptAssemblyInput): Promise<string>
}
