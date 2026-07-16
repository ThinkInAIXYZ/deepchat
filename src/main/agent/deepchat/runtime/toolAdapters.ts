import type { ProviderModelResolutionPort } from '@/provider/settings'
import type {
  ToolCatalogPort,
  ToolExecutionPort,
  ToolResultPort
} from '@/agent/deepchat/loop/ports'
import type { ProviderExecutionPort } from '@shared/types/provider'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition, MCPToolResponse } from '@shared/types/core/mcp'
import type { ToolServicePort, ToolDefinitionContext } from '@shared/types/tool'
import { resolveSessionVisionTarget } from '@/agent/vision/sessionVisionResolver'
import type { ToolOutputGuard } from './toolOutputGuard'
import type { AgentSettingsPort } from '@/agent/settings'

export interface ToolCatalogCacheEntry<TProfile extends string = string> {
  profile: TProfile
  fingerprint: string
  tools: MCPToolDefinition[]
}

export function createToolCatalogPort<TProfile extends string>(input: {
  toolService: ToolServicePort
  resolveContext(activeSkillNames?: string[]): Promise<{
    profile: TProfile
    fingerprint: string
    context: ToolDefinitionContext
    cached?: ToolCatalogCacheEntry<TProfile>
  }>
  commitCache(entry: ToolCatalogCacheEntry<TProfile>): void
}): ToolCatalogPort {
  return {
    resolve: async (request) => {
      const resolved = await input.resolveContext(request?.activeSkillNames)
      if (
        resolved.cached?.profile === resolved.profile &&
        resolved.cached.fingerprint === resolved.fingerprint
      ) {
        input.toolService.syncAgentToolContext({
          chatMode: resolved.context.chatMode,
          agentWorkspacePath: resolved.context.agentWorkspacePath
        })
        return resolved.cached.tools
      }

      const tools = await input.toolService.getAllToolDefinitions(resolved.context)
      input.commitCache({
        profile: resolved.profile,
        fingerprint: resolved.fingerprint,
        tools
      })
      return tools
    }
  }
}

export function createToolExecutionPort(toolService: ToolServicePort): ToolExecutionPort {
  return {
    preCheck: (call, options) => toolService.preCheckToolPermission(call, options),
    execute: (call, options) => toolService.callTool(call, options)
  }
}

export function createToolResultPort(input: {
  outputGuard: Pick<ToolOutputGuard, 'prepareToolOutput' | 'fitToolBatchOutputs'>
  normalize: ToolResultPort['normalize']
}): ToolResultPort {
  return {
    normalize: input.normalize,
    prepare: (request) => input.outputGuard.prepareToolOutput(request),
    fitBatch: (request) => input.outputGuard.fitToolBatchOutputs(request)
  }
}

export interface ToolResultNormalizerDependencies {
  providerSettings: ProviderModelResolutionPort
  agentSettings: Pick<
    AgentSettingsPort,
    'resolveDeepChatAgentConfig' | 'agentSupportsCapability'
  >
  providerRuntime: Pick<
    ProviderExecutionPort,
    'executeWithRateLimit' | 'generateCompletionStandalone'
  >
  getAbortSignal(sessionId: string): AbortSignal | undefined
  getSessionModel(sessionId: string): {
    providerId?: string
    modelId?: string
    agentId?: string
  }
}

function throwIfAbortRequested(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (typeof DOMException !== 'undefined') {
    throw new DOMException('Aborted', 'AbortError')
  }
  const error = new Error('Aborted')
  error.name = 'AbortError'
  throw error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')
}

export async function normalizeToolResultContent(
  dependencies: ToolResultNormalizerDependencies,
  params: {
    sessionId: string
    toolCallId: string
    toolName: string
    toolArgs: string
    content: MCPToolResponse['content']
    isError: boolean
    abortSignal?: AbortSignal
  }
): Promise<MCPToolResponse['content']> {
  if (params.isError) {
    return params.content
  }

  const abortSignal = params.abortSignal ?? dependencies.getAbortSignal(params.sessionId)
  const screenshotPayload = extractScreenshotToolPayload(
    params.toolName,
    params.toolArgs,
    params.content
  )
  if (!screenshotPayload) {
    return params.content
  }

  try {
    throwIfAbortRequested(abortSignal)
    const visionModel = await resolveScreenshotVisionModel(
      dependencies,
      params.sessionId,
      abortSignal
    )
    throwIfAbortRequested(abortSignal)

    if (!visionModel) {
      return 'Screenshot captured, but automatic English analysis is unavailable because neither the current session model nor the agent vision model can analyze images.'
    }

    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildScreenshotAnalysisPrompt()
          },
          {
            type: 'image_url',
            image_url: {
              url: screenshotPayload.dataUrl,
              detail: 'auto'
            }
          }
        ]
      }
    ]

    const modelConfig = dependencies.providerSettings.getModelConfig(
      visionModel.modelId,
      visionModel.providerId
    )
    await dependencies.providerRuntime.executeWithRateLimit(visionModel.providerId, {
      signal: abortSignal
    })
    const response = await dependencies.providerRuntime.generateCompletionStandalone(
      visionModel.providerId,
      messages,
      visionModel.modelId,
      modelConfig?.temperature ?? 0.2,
      Math.min(modelConfig?.maxTokens ?? 900, 900),
      { signal: abortSignal, swallowErrors: false }
    )
    throwIfAbortRequested(abortSignal)
    const normalized = response.trim()
    if (!normalized) {
      return 'Screenshot captured, but automatic English analysis returned no usable description.'
    }
    return normalized
  } catch (error) {
    if (isAbortError(error)) {
      return 'Screenshot captured, but automatic English analysis was canceled.'
    }

    const message = error instanceof Error ? error.message : String(error)
    console.warn('[DeepChatAgent] Failed to normalize screenshot tool output:', {
      sessionId: params.sessionId,
      toolCallId: params.toolCallId,
      error: message
    })
    return `Screenshot captured, but automatic English analysis failed: ${message}`
  }
}

function extractScreenshotToolPayload(
  toolName: string,
  toolArgs: string,
  content: MCPToolResponse['content']
): { dataUrl: string } | null {
  if (toolName !== 'cdp_send' || typeof content !== 'string') {
    return null
  }

  const parsedArgs = parseJsonRecord(toolArgs)
  if (!parsedArgs || parsedArgs.method !== 'Page.captureScreenshot') {
    return null
  }

  const parsedContent = parseJsonRecord(content)
  const rawData = typeof parsedContent?.data === 'string' ? parsedContent.data.trim() : ''
  if (!rawData) {
    return null
  }

  const screenshotParams = normalizeJsonRecord(parsedArgs.params)
  const mimeType = resolveScreenshotMimeType(screenshotParams?.format)
  const dataUrl = rawData.startsWith('data:image/') ? rawData : `data:${mimeType};base64,${rawData}`

  return { dataUrl }
}

function normalizeJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  return parseJsonRecord(value)
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}

  return null
}

function resolveScreenshotMimeType(format: unknown): string {
  if (format === 'jpeg') {
    return 'image/jpeg'
  }
  if (format === 'webp') {
    return 'image/webp'
  }
  return 'image/png'
}

async function resolveScreenshotVisionModel(
  dependencies: ToolResultNormalizerDependencies,
  sessionId: string,
  abortSignal?: AbortSignal
): Promise<{ providerId: string; modelId: string } | null> {
  throwIfAbortRequested(abortSignal)
  const session = dependencies.getSessionModel(sessionId)
  const agentId = session.agentId ?? 'deepchat'
  const resolved = await resolveSessionVisionTarget({
    providerId: session.providerId,
    modelId: session.modelId,
    agentId,
    providerConfig: dependencies.providerSettings,
    agentSettings: dependencies.agentSettings,
    signal: abortSignal,
    logLabel: `screenshot:${sessionId}`
  })
  throwIfAbortRequested(abortSignal)

  if (!resolved) {
    return null
  }

  if (resolved.source === 'agent-vision-model') {
    const agentSupportsVision = await dependencies.agentSettings.agentSupportsCapability(
      agentId,
      'vision'
    )
    throwIfAbortRequested(abortSignal)
    if (!agentSupportsVision) {
      return null
    }
  }

  return {
    providerId: resolved.providerId,
    modelId: resolved.modelId
  }
}

function buildScreenshotAnalysisPrompt(): string {
  return [
    'Analyze this browser screenshot and respond in English only.',
    'Describe only what is clearly visible.',
    'Include the page type or layout, the most important visible text, interactive controls, status indicators, warnings, errors, and any detail that matters for the next browser action.',
    'Do not speculate about hidden or unreadable content.',
    'Return detailed plain text in a single paragraph.'
  ].join('\n')
}

export function toolContentToText(content: MCPToolResponse['content']): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map((item) => {
      if (item.type === 'text') return item.text
      if (item.type === 'resource' && item.resource?.text) return item.resource.text
      return `[${item.type}]`
    })
    .join('\n')
}
