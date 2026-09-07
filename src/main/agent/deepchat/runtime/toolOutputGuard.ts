import fs from 'fs/promises'
import path from 'path'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import { resolveToolOffloadPath } from '@/agent/shared/storage/sessionPaths'
import type {
  PreparedToolOutput,
  ToolBatchOutputCandidate,
  ToolBatchOutputFit,
  ToolBatchOutputFitItem
} from '@/agent/deepchat/loop/ports'
import {
  resolveAgentOutputLimits,
  type AgentOutputLimits
} from '@shared/lib/agentOutputLimits'
import { throwIfAbortRequested } from './abortErrors'
import { preflightRequestContext } from './contextBudget'
import { getProviderProjectionIdentities } from '@/agent/deepchat/loop/providerProjectionIdentity'

const TOOL_OUTPUT_PREVIEW_LENGTH = 1024
const TOOL_OUTPUT_OFFLOAD_MARKER = '[Tool output offloaded]'
const TOOL_OUTPUT_VIEW_COMPACTION_MARKER = '[Tool output compacted from provider View]'
const TOOL_OUTPUT_VIEW_COMPACTION_THRESHOLD = 8192
const TOOL_OUTPUT_VIEW_COMPACTION_HEAD = 4096
const TOOL_OUTPUT_VIEW_COMPACTION_TAIL = 1024
const TOOLS_REQUIRING_OFFLOAD = new Set(['ls', 'find', 'grep', 'cdp_send'])
const CONTEXT_FALLBACK_OFFLOAD_TOOLS = new Set([
  ...TOOLS_REQUIRING_OFFLOAD,
  'exec',
  'skill_run'
])

type ToolMessageUpdateMode = 'append' | 'replace'

export type ToolOutputGuardResult =
  | {
      kind: 'ok'
      content: string
      offloaded: boolean
      offloadPath?: string
    }
  | {
      kind: 'tool_error'
      message: string
    }
  | {
      kind: 'terminal_error'
      message: string
    }

interface PrepareToolOutputParams {
  sessionId: string
  toolCallId: string
  toolName: string
  rawContent: string
}

interface ToolOutputArtifactOwnership {
  /** Guard-created artifact backing the current response projection. */
  offloadPath?: string
  /** Tool-created artifact that the guard may reference but never overwrite or delete. */
  existingOffloadPath?: string
}

interface ContextFallbackParams extends PrepareToolOutputParams, ToolOutputArtifactOwnership {
  signal?: AbortSignal
}

interface GuardToolOutputParams extends PrepareToolOutputParams {
  conversationMessages: ChatMessage[]
  toolDefinitions: MCPToolDefinition[]
  contextLength: number
  outputCapContextLength?: number
  maxTokens: number
}

interface FitExistingToolOutputParams extends GuardToolOutputParams, ToolOutputArtifactOwnership {
  signal?: AbortSignal
}

interface ContextBudgetParams {
  conversationMessages: ChatMessage[]
  toolDefinitions: MCPToolDefinition[]
  contextLength: number
  outputCapContextLength?: number
  maxTokens: number
}

interface FitToolErrorParams extends ContextBudgetParams {
  toolCallId: string
  toolName: string
  errorMessage: string
  mode?: ToolMessageUpdateMode
}

interface FitToolBatchOutputsParams extends ContextBudgetParams {
  sessionId: string
  results: ToolBatchOutputCandidate[]
}

type AgentOutputLimitsResolver = (
  sessionId: string
) => AgentOutputLimits | Promise<AgentOutputLimits>

interface ClosedToolResultCompactionOptions {
  preserveMostRecentClosedUnit?: boolean
}

interface ClosedToolResultUnit {
  assistantIndex: number
  resultIndexes: ReadonlyMap<string, number>
}

export function compactClosedToolResultsForContext(
  messages: ChatMessage[],
  protectedToolCallIds: ReadonlySet<string> = new Set(),
  options: ClosedToolResultCompactionOptions = {}
): ChatMessage[] {
  const activeTurnStart = messages.findLastIndex((message) => message.role === 'user')
  if (activeTurnStart < 0) return messages

  const closedUnits: ClosedToolResultUnit[] = []
  for (let index = activeTurnStart + 1; index < messages.length; index += 1) {
    const assistant = messages[index]
    if (
      assistant.role !== 'assistant' ||
      assistant.provider_replay ||
      !assistant.tool_calls?.length
    ) {
      continue
    }

    const expectedCallIds = new Set(assistant.tool_calls.map((toolCall) => toolCall.id))
    const resultIndexes = new Map<string, number>()
    let cursor = index + 1
    while (cursor < messages.length && messages[cursor].role === 'tool') {
      const toolCallId = messages[cursor].tool_call_id
      if (
        !toolCallId ||
        !expectedCallIds.has(toolCallId) ||
        resultIndexes.has(toolCallId)
      ) {
        resultIndexes.clear()
        break
      }
      resultIndexes.set(toolCallId, cursor)
      cursor += 1
    }
    if (resultIndexes.size !== expectedCallIds.size) continue

    closedUnits.push({ assistantIndex: index, resultIndexes })
    index = Math.max(index, cursor - 1)
  }

  const preservedAssistantIndex =
    options.preserveMostRecentClosedUnit === false
      ? null
      : (closedUnits.at(-1)?.assistantIndex ?? null)
  let compacted: ChatMessage[] | null = null
  for (const unit of closedUnits) {
    if (unit.assistantIndex === preservedAssistantIndex) continue

    for (const [toolCallId, resultIndex] of unit.resultIndexes) {
      const toolMessage = messages[resultIndex]
      if (
        protectedToolCallIds.has(toolCallId) ||
        toolMessage.provider_replay ||
        getProviderProjectionIdentities(toolMessage).length > 0 ||
        typeof toolMessage.content !== 'string' ||
        toolMessage.content.length <= TOOL_OUTPUT_VIEW_COMPACTION_THRESHOLD
      ) {
        continue
      }
      const original = toolMessage.content
      const compactedContent = [
        TOOL_OUTPUT_VIEW_COMPACTION_MARKER,
        `Tool call ID: ${toolCallId}`,
        `Original characters: ${original.length}`,
        'The complete result remains in Session Tape. Use tape_search and tape_context to recall persisted evidence if needed.',
        `First ${TOOL_OUTPUT_VIEW_COMPACTION_HEAD} characters:`,
        original.slice(0, TOOL_OUTPUT_VIEW_COMPACTION_HEAD),
        `Last ${TOOL_OUTPUT_VIEW_COMPACTION_TAIL} characters:`,
        original.slice(-TOOL_OUTPUT_VIEW_COMPACTION_TAIL)
      ].join('\n')
      compacted ??= [...messages]
      compacted[resultIndex] = { ...toolMessage, content: compactedContent }
    }
  }

  return compacted ?? messages
}

export class ToolOutputGuard {
  constructor(
    private readonly resolveOutputLimits: AgentOutputLimitsResolver = () =>
      resolveAgentOutputLimits()
  ) {}

  async prepareToolOutput(params: PrepareToolOutputParams): Promise<PreparedToolOutput> {
    const { sessionId, toolCallId, toolName, rawContent } = params

    if (!this.requiresOffload(toolName)) {
      return {
        kind: 'ok',
        content: rawContent,
        offloaded: false,
        offloadPath: undefined
      }
    }

    const outputLimits = await this.getOutputLimits(sessionId)
    if (rawContent.length <= outputLimits.toolOutputInlineChars) {
      return {
        kind: 'ok',
        content: rawContent,
        offloaded: false,
        offloadPath: undefined
      }
    }

    return await this.offloadToolOutput({ sessionId, toolCallId, toolName, rawContent })
  }

  private async offloadToolOutput(
    params: PrepareToolOutputParams & { signal?: AbortSignal }
  ): Promise<PreparedToolOutput> {
    const { sessionId, toolCallId, toolName, rawContent } = params
    const filePath = resolveToolOffloadPath(sessionId, toolCallId)
    if (!filePath) {
      return {
        kind: 'tool_error',
        message: this.buildOffloadFailureMessage(toolCallId, toolName)
      }
    }

    try {
      throwIfAbortRequested(params.signal)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      throwIfAbortRequested(params.signal)
      await fs.writeFile(filePath, rawContent, {
        encoding: 'utf-8',
        signal: params.signal
      })
      throwIfAbortRequested(params.signal)
    } catch (error) {
      if (params.signal?.aborted) {
        await this.cleanupOffloadedOutput(filePath)
        throw params.signal.reason ?? error
      }
      console.warn('[ToolOutputGuard] Failed to offload tool output:', error)
      return {
        kind: 'tool_error',
        message: this.buildOffloadFailureMessage(toolCallId, toolName)
      }
    }

    return {
      kind: 'ok',
      content: this.buildOffloadStub(rawContent, filePath),
      offloaded: true,
      offloadPath: filePath
    }
  }

  private async prepareContextFallback(
    params: ContextFallbackParams
  ): Promise<PreparedToolOutput | null> {
    if (!CONTEXT_FALLBACK_OFFLOAD_TOOLS.has(params.toolName)) return null
    if (!params.rawContent) return null
    if (params.offloadPath) return null

    if (params.existingOffloadPath) {
      return {
        kind: 'ok',
        content: this.buildExistingOffloadStub(params.rawContent, params.existingOffloadPath),
        offloaded: true,
        offloadPath: undefined
      }
    }

    return await this.offloadToolOutput(params)
  }

  private async tryContextFallback(
    params: ContextFallbackParams & ContextBudgetParams,
    mode: ToolMessageUpdateMode
  ): Promise<PreparedToolOutput | null> {
    const fallback = await this.prepareContextFallback(params)
    if (fallback?.kind !== 'ok') return null

    try {
      throwIfAbortRequested(params.signal)
      const fallbackMessages = this.withToolMessage(
        params.conversationMessages,
        params.toolCallId,
        fallback.content,
        mode
      )
      if (
        this.hasContextBudget({
          conversationMessages: fallbackMessages,
          toolDefinitions: params.toolDefinitions,
          contextLength: params.contextLength,
          outputCapContextLength: params.outputCapContextLength,
          maxTokens: params.maxTokens
        })
      ) {
        throwIfAbortRequested(params.signal)
        return fallback
      }
    } catch (error) {
      await this.cleanupOffloadedOutput(fallback.offloadPath)
      throw error
    }

    await this.cleanupOffloadedOutput(fallback.offloadPath)
    throwIfAbortRequested(params.signal)
    return null
  }

  async fitExistingToolOutput(
    params: FitExistingToolOutputParams
  ): Promise<ToolOutputGuardResult | null> {
    throwIfAbortRequested(params.signal)
    if (
      this.hasContextBudget({
        conversationMessages: params.conversationMessages,
        toolDefinitions: params.toolDefinitions,
        contextLength: params.contextLength,
        outputCapContextLength: params.outputCapContextLength,
        maxTokens: params.maxTokens
      })
    ) {
      return null
    }

    const fallback = await this.tryContextFallback(params, 'replace')
    if (fallback) return fallback

    throwIfAbortRequested(params.signal)
    return this.fitToolError({
      ...params,
      errorMessage: this.buildContextOverflowMessage(params.toolCallId, params.toolName),
      mode: 'replace'
    })
  }

  async guardToolOutput(params: GuardToolOutputParams): Promise<ToolOutputGuardResult> {
    const prepared = await this.prepareToolOutput(params)
    if (prepared.kind === 'tool_error') {
      return this.fitToolError({
        ...params,
        errorMessage: prepared.message
      })
    }

    const nextMessages = this.withToolMessage(
      params.conversationMessages,
      params.toolCallId,
      prepared.content,
      'append'
    )
    if (
      this.hasContextBudget({
        conversationMessages: nextMessages,
        toolDefinitions: params.toolDefinitions,
        contextLength: params.contextLength,
        outputCapContextLength: params.outputCapContextLength,
        maxTokens: params.maxTokens
      })
    ) {
      return prepared
    }

    if (!prepared.offloaded) {
      const fallback = await this.tryContextFallback(params, 'append')
      if (fallback) return fallback
    }

    const overflowResult = this.fitToolError({
      ...params,
      errorMessage: this.buildContextOverflowMessage(params.toolCallId, params.toolName)
    })
    await this.cleanupOffloadedOutput(prepared.offloadPath)
    return overflowResult
  }

  async fitToolBatchOutputs(params: FitToolBatchOutputsParams): Promise<ToolBatchOutputFit> {
    if (params.results.length === 0) {
      return {
        kind: 'ok',
        results: []
      }
    }

    const fittedResults: ToolBatchOutputFitItem[] = params.results.map((result) => ({
      ...result,
      contextResponseText: result.responseText,
      downgraded: false
    }))

    if (
      this.hasContextBudget({
        conversationMessages: this.withToolBatchMessages(
          params.conversationMessages,
          fittedResults
        ),
        toolDefinitions: params.toolDefinitions,
        contextLength: params.contextLength,
        outputCapContextLength: params.outputCapContextLength,
        maxTokens: params.maxTokens
      })
    ) {
      return {
        kind: 'ok',
        results: fittedResults
      }
    }

    for (let index = fittedResults.length - 1; index >= 0; index -= 1) {
      const current = fittedResults[index]
      if (current.isError || current.requiresInline) {
        continue
      }

      const fallback = await this.prepareContextFallback({
        sessionId: params.sessionId,
        toolCallId: current.toolCallId,
        toolName: current.toolName,
        rawContent: current.responseText,
        offloadPath: current.offloadPath,
        existingOffloadPath: current.existingOffloadPath
      })
      if (!fallback || fallback.kind === 'tool_error') continue

      fittedResults[index] = {
        ...current,
        responseText: fallback.content,
        contextResponseText: fallback.content,
        offloadPath: fallback.offloadPath
      }

      if (
        this.hasContextBudget({
          conversationMessages: this.withToolBatchMessages(
            params.conversationMessages,
            fittedResults
          ),
          toolDefinitions: params.toolDefinitions,
          contextLength: params.contextLength,
          outputCapContextLength: params.outputCapContextLength,
          maxTokens: params.maxTokens
        })
      ) {
        return {
          kind: 'ok',
          results: fittedResults
        }
      }
    }

    for (let index = fittedResults.length - 1; index >= 0; index -= 1) {
      const current = fittedResults[index]
      const displayResponseText = this.buildTerminalErrorMessage(
        current.toolCallId,
        current.toolName
      )
      const downgradedBase: ToolBatchOutputFitItem = {
        ...current,
        responseText: displayResponseText,
        contextResponseText: '',
        isError: true,
        downgraded: true
      }

      const contextResponseCandidates = this.buildBatchFailureContextCandidates(
        current.toolCallId,
        current.toolName
      )

      for (const contextResponseText of contextResponseCandidates) {
        fittedResults[index] = {
          ...downgradedBase,
          contextResponseText
        }

        if (
          this.hasContextBudget({
            conversationMessages: this.withToolBatchMessages(
              params.conversationMessages,
              fittedResults
            ),
            toolDefinitions: params.toolDefinitions,
            contextLength: params.contextLength,
            outputCapContextLength: params.outputCapContextLength,
            maxTokens: params.maxTokens
          })
        ) {
          await this.cleanupOffloadedResults(fittedResults.filter((result) => result.downgraded))
          return {
            kind: 'ok',
            results: fittedResults.map((result) =>
              result.downgraded ? { ...result, offloadPath: undefined } : result
            )
          }
        }
      }

      fittedResults[index] = downgradedBase
    }

    await this.cleanupOffloadedResults(fittedResults)

    return {
      kind: 'terminal_error',
      message: this.buildTerminalErrorMessage(
        fittedResults[0].toolCallId,
        fittedResults[0].toolName
      ),
      results: fittedResults.map((result) => ({
        ...result,
        offloadPath: undefined
      }))
    }
  }

  hasContextBudget(params: ContextBudgetParams): boolean {
    const {
      conversationMessages,
      toolDefinitions,
      contextLength,
      outputCapContextLength,
      maxTokens
    } = params
    return preflightRequestContext({
      messages: conversationMessages,
      tools: toolDefinitions,
      contextLength,
      outputCapContextLength,
      requestedMaxTokens: maxTokens
    }).fitsWithinContext
  }

  fitToolError(params: FitToolErrorParams): ToolOutputGuardResult {
    const mode = params.mode ?? 'append'
    const errorMessages = this.withToolMessage(
      params.conversationMessages,
      params.toolCallId,
      params.errorMessage,
      mode
    )
    if (
      this.hasContextBudget({
        conversationMessages: errorMessages,
        toolDefinitions: params.toolDefinitions,
        contextLength: params.contextLength,
        outputCapContextLength: params.outputCapContextLength,
        maxTokens: params.maxTokens
      })
    ) {
      return {
        kind: 'tool_error',
        message: params.errorMessage
      }
    }
    return {
      kind: 'terminal_error',
      message: this.buildTerminalErrorMessage(params.toolCallId, params.toolName)
    }
  }

  replaceToolMessageContent(
    conversationMessages: ChatMessage[],
    toolCallId: string,
    content: string
  ): ChatMessage[] {
    return this.withToolMessage(conversationMessages, toolCallId, content, 'replace')
  }

  async cleanupOffloadedOutput(offloadPath?: string): Promise<void> {
    if (!offloadPath) {
      return
    }

    try {
      await fs.rm(offloadPath, { force: true })
    } catch (error) {
      console.warn('[ToolOutputGuard] Failed to delete offloaded tool output:', error)
    }
  }

  buildContextOverflowMessage(toolCallId: string, toolName: string): string {
    return `The tool call with ID ${toolCallId} and name ${toolName} could not be injected into the conversation because the remaining context window is insufficient. Treat this tool call as failed and continue without its result.`
  }

  private requiresOffload(toolName: string): boolean {
    return TOOLS_REQUIRING_OFFLOAD.has(toolName)
  }

  private async getOutputLimits(sessionId: string): Promise<AgentOutputLimits> {
    try {
      return await this.resolveOutputLimits(sessionId)
    } catch (error) {
      console.warn('[ToolOutputGuard] Failed to resolve Agent output limits:', error)
      return resolveAgentOutputLimits()
    }
  }

  private withToolMessage(
    conversationMessages: ChatMessage[],
    toolCallId: string,
    content: string,
    mode: ToolMessageUpdateMode
  ): ChatMessage[] {
    if (mode === 'replace') {
      let replaced = false
      const nextMessages = conversationMessages.map((message) => {
        if (replaced || message.role !== 'tool' || message.tool_call_id !== toolCallId) {
          return message
        }
        replaced = true
        return {
          ...message,
          content
        }
      })
      if (replaced) {
        return nextMessages
      }
      return [
        ...nextMessages,
        {
          role: 'tool',
          tool_call_id: toolCallId,
          content
        }
      ]
    }

    return [
      ...conversationMessages,
      {
        role: 'tool',
        tool_call_id: toolCallId,
        content
      }
    ]
  }

  private withToolBatchMessages(
    conversationMessages: ChatMessage[],
    results: ToolBatchOutputFitItem[]
  ): ChatMessage[] {
    if (results.length === 0) {
      return conversationMessages
    }

    return [
      ...conversationMessages,
      ...results.map((result) => ({
        role: 'tool' as const,
        tool_call_id: result.toolCallId,
        content: result.contextResponseText
      }))
    ]
  }

  private async cleanupOffloadedResults(results: ToolBatchOutputCandidate[]): Promise<void> {
    await Promise.all(results.map((result) => this.cleanupOffloadedOutput(result.offloadPath)))
  }

  private buildOffloadStub(rawContent: string, filePath: string): string {
    const preview = rawContent.slice(0, TOOL_OUTPUT_PREVIEW_LENGTH)
    return [
      TOOL_OUTPUT_OFFLOAD_MARKER,
      `Total characters: ${rawContent.length}`,
      `Offload file: ${filePath}`,
      `first ${preview.length} chars:`,
      preview
    ].join('\n')
  }

  private buildExistingOffloadStub(inlineContent: string, filePath: string): string {
    const preview = inlineContent.slice(0, TOOL_OUTPUT_PREVIEW_LENGTH)
    return [
      TOOL_OUTPUT_OFFLOAD_MARKER,
      `Offload file: ${filePath}`,
      `Inline characters before context fallback: ${inlineContent.length}`,
      `first ${preview.length} chars:`,
      preview
    ].join('\n')
  }

  private buildOffloadFailureMessage(toolCallId: string, toolName: string): string {
    return `The tool call with ID ${toolCallId} and name ${toolName} produced a large result, but offloading that result to disk failed. Treat this tool call as failed and continue without its result.`
  }

  private buildTerminalErrorMessage(toolCallId: string, toolName: string): string {
    return `The tool call with ID ${toolCallId} and name ${toolName} failed because the remaining context window is too small to continue this turn.`
  }

  private buildBatchFailureContextCandidates(toolCallId: string, toolName: string): string[] {
    return Array.from(
      new Set([
        this.buildTerminalErrorMessage(toolCallId, toolName),
        'Error: context window too small.',
        'Error',
        ''
      ])
    )
  }
}
