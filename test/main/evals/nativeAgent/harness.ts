import { vi } from 'vitest'
import { ModelType } from '@shared/model'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolCall, MCPToolDefinition } from '@shared/types/core/mcp'
import type { ToolServicePort } from '@shared/types/tool'
import type { SessionTranscript } from '@/session/data/transcript'
import { processStream } from '@/agent/deepchat/runtime/process'
import { ToolOutputGuard } from '@/agent/deepchat/runtime/toolOutputGuard'
import {
  createToolExecutionPort,
  createToolResultPort
} from '@/agent/deepchat/runtime/toolAdapters'
import { createState } from '@/agent/deepchat/runtime/types'
import type { ProcessParams, ProcessResult } from '@/agent/deepchat/runtime/types'
import { createLoopRun } from '@/agent/deepchat/loop/loopRun'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'

vi.mock('@/events', () => ({
  STREAM_EVENTS: {
    RESPONSE: 'stream:response',
    END: 'stream:end',
    ERROR: 'stream:error'
  }
}))

export interface ScriptedProviderRound {
  events: LLMCoreStreamEvent[]
  abortBeforeEventIndex?: number
}

export interface ScriptedToolBehavior {
  response?: string
  error?: string
  permission?: {
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
  }
}

export type EvalPersistedStatus = 'none' | 'pending' | 'sent' | 'error'

export interface ScriptedProviderUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens?: number
  cacheWriteInputTokens?: number
}

export interface NativeAgentEvalUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cachedInputTokens: number | null
  cacheWriteInputTokens: number | null
}

export interface NativeAgentEvalExpected {
  status: ProcessResult['status']
  stopReason: string | null
  persistedStatus: EvalPersistedStatus
  persistedRunOutcome: ProcessResult['status']
  persistedRunStopReason: string
  providerRounds: number
  toolCalls: number
  finalTextIncludes?: string
  terminalErrorIncludes?: string
  errorMessageIncludes?: string
  toolMessageIncludes?: string[]
  failedToolCalls?: number
  permissionRequests?: number
  usage: NativeAgentEvalUsage
}

export interface NativeAgentEvalScenario {
  id: string
  rounds: ScriptedProviderRound[]
  tools?: Record<string, ScriptedToolBehavior>
  permissionMode?: ProcessParams['permissionMode']
  maxProviderRounds?: number
  yieldForPendingInput?: boolean
  budget: {
    maxProviderRounds: number
    maxToolCalls: number
  }
  expected: NativeAgentEvalExpected
}

export interface NativeAgentEvalToolCall {
  id: string
  name: string
  arguments: string
  status: 'success' | 'error'
}

export interface NativeAgentEvalReport {
  schemaVersion: 1
  scenarioId: string
  passed: boolean
  outcome: {
    status: ProcessResult['status']
    stopReason: string | null
    terminalError: string | null
    errorMessage: string | null
  }
  persistedStatus: EvalPersistedStatus
  persistedRunId: string | null
  persistedRunOutcome: string | null
  persistedRunStopReason: string | null
  persistedProviderRounds: number | null
  persistedToolCalls: number | null
  persistedUsage: NativeAgentEvalUsage
  providerRounds: number
  toolCalls: {
    total: number
    succeeded: number
    failed: number
  }
  permissionRequests: number
  elapsedMs: number
  usage: NativeAgentEvalUsage
  finalText: string
  expectationFailures: string[]
}

export interface NativeAgentEvalAggregate {
  schemaVersion: 1
  scenarios: number
  passed: number
  passRate: number
  totalProviderRounds: number
  providerRoundBudget: number
  totalToolCalls: number
  toolCallBudget: number
  totalTokens: number
  withinCallBudgets: boolean
}

interface EvalMessageStoreState {
  persistedStatus: EvalPersistedStatus
  blocks: AssistantMessageBlock[]
  metadata: Record<string, unknown>
}

interface ToolServiceHarness {
  presenter: ToolServicePort
  calls: NativeAgentEvalToolCall[]
}

const DEFAULT_INTERLEAVED_REASONING = {
  preserveReasoningContent: false,
  forcedBySessionSetting: false,
  portraitInterleaved: false,
  reasoningSupported: false,
  providerDbSourceUrl: 'https://example.com/provider-db.json'
} as const

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createMessageStore(): {
  messageStore: SessionTranscript
  state: EvalMessageStoreState
} {
  const state: EvalMessageStoreState = {
    persistedStatus: 'none',
    blocks: [],
    metadata: {}
  }

  const captureMetadata = (rawMetadata: string | undefined): void => {
    if (!rawMetadata) return
    try {
      const metadata = JSON.parse(rawMetadata) as unknown
      if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
        state.metadata = metadata as Record<string, unknown>
      }
    } catch {
      state.metadata = {}
    }
  }

  const messageStore = {
    addSearchResult: vi.fn(),
    getMessage: vi.fn(() => null),
    updateAssistantContent: vi.fn(
      (_messageId: string, blocks: AssistantMessageBlock[], metadata?: string) => {
        if (state.persistedStatus === 'none') {
          state.persistedStatus = 'pending'
        }
        state.blocks = clone(blocks)
        captureMetadata(metadata)
      }
    ),
    finalizeAssistantMessage: vi.fn(
      (_messageId: string, blocks: AssistantMessageBlock[], metadata: string) => {
        state.persistedStatus = 'sent'
        state.blocks = clone(blocks)
        captureMetadata(metadata)
      }
    ),
    setMessageError: vi.fn(
      (_messageId: string, blocks: AssistantMessageBlock[], metadata?: string) => {
        state.persistedStatus = 'error'
        state.blocks = clone(blocks)
        captureMetadata(metadata)
      }
    )
  }

  return {
    messageStore: messageStore as unknown as SessionTranscript,
    state
  }
}

function makeToolDefinition(name: string): MCPToolDefinition {
  return {
    type: 'function',
    source: 'agent',
    function: {
      name,
      description: `Eval tool ${name}`,
      parameters: { type: 'object', properties: {} }
    },
    server: {
      name: 'native-agent-eval',
      icons: '',
      description: 'Native Agent deterministic evaluation tools'
    }
  }
}

function createToolService(behaviors: Record<string, ScriptedToolBehavior>): ToolServiceHarness {
  const calls: NativeAgentEvalToolCall[] = []

  const presenter = {
    getAllToolDefinitions: vi.fn(async () => Object.keys(behaviors).map(makeToolDefinition)),
    preCheckToolPermission: vi.fn(async (request: MCPToolCall) => {
      const permission = behaviors[request.function.name]?.permission
      if (!permission) return null

      return {
        needsPermission: true as const,
        toolName: request.function.name,
        serverName: 'native-agent-eval',
        permissionType: permission.permissionType,
        description: permission.description
      }
    }),
    callTool: vi.fn(async (request: MCPToolCall) => {
      const behavior = behaviors[request.function.name] ?? {}
      const call: NativeAgentEvalToolCall = {
        id: request.id,
        name: request.function.name,
        arguments: request.function.arguments,
        status: 'success'
      }
      calls.push(call)

      if (behavior.error) {
        call.status = 'error'
        throw new Error(behavior.error)
      }

      const content = behavior.response ?? `result for ${request.function.name}`
      return {
        content,
        rawData: {
          toolCallId: request.id,
          content,
          isError: false
        }
      }
    }),
    buildToolSystemPrompt: vi.fn(() => '')
  }

  return {
    presenter: presenter as unknown as ToolServicePort,
    calls
  }
}

function stringifyMessageContent(message: ChatMessage): string {
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
}

function collectFinalText(blocks: AssistantMessageBlock[]): string {
  return blocks
    .map((block) => (typeof block.content === 'string' ? block.content : ''))
    .filter(Boolean)
    .join('\n')
}

function normalizeUsage(result: ProcessResult): NativeAgentEvalUsage {
  return {
    inputTokens: typeof result.usage?.inputTokens === 'number' ? result.usage.inputTokens : null,
    outputTokens: typeof result.usage?.outputTokens === 'number' ? result.usage.outputTokens : null,
    totalTokens: typeof result.usage?.totalTokens === 'number' ? result.usage.totalTokens : null,
    cachedInputTokens:
      typeof result.usage?.cachedInputTokens === 'number' ? result.usage.cachedInputTokens : null,
    cacheWriteInputTokens:
      typeof result.usage?.cacheWriteInputTokens === 'number'
        ? result.usage.cacheWriteInputTokens
        : null
  }
}

function normalizePersistedNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizePersistedUsage(metadata: Record<string, unknown>): NativeAgentEvalUsage {
  return {
    inputTokens: normalizePersistedNumber(metadata, 'inputTokens'),
    outputTokens: normalizePersistedNumber(metadata, 'outputTokens'),
    totalTokens: normalizePersistedNumber(metadata, 'totalTokens'),
    cachedInputTokens: normalizePersistedNumber(metadata, 'cachedInputTokens'),
    cacheWriteInputTokens: normalizePersistedNumber(metadata, 'cacheWriteInputTokens')
  }
}

function addMismatch(failures: string[], label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)}, received ${String(actual)}`)
  }
}

function evaluateReport(
  scenario: NativeAgentEvalScenario,
  report: Omit<NativeAgentEvalReport, 'passed' | 'expectationFailures'>,
  providerInputs: ChatMessage[][]
): string[] {
  const failures: string[] = []
  const expected = scenario.expected

  addMismatch(failures, 'status', report.outcome.status, expected.status)
  addMismatch(failures, 'stopReason', report.outcome.stopReason, expected.stopReason)
  addMismatch(failures, 'persistedStatus', report.persistedStatus, expected.persistedStatus)
  addMismatch(failures, 'persistedRunId', report.persistedRunId, `request-${scenario.id}`)
  addMismatch(
    failures,
    'persistedRunOutcome',
    report.persistedRunOutcome,
    expected.persistedRunOutcome
  )
  addMismatch(
    failures,
    'persistedRunStopReason',
    report.persistedRunStopReason,
    expected.persistedRunStopReason
  )
  addMismatch(failures, 'providerRounds', report.providerRounds, expected.providerRounds)
  addMismatch(failures, 'toolCalls', report.toolCalls.total, expected.toolCalls)
  addMismatch(
    failures,
    'persistedProviderRounds',
    report.persistedProviderRounds,
    expected.providerRounds
  )
  addMismatch(failures, 'persistedToolCalls', report.persistedToolCalls, expected.toolCalls)

  if (expected.finalTextIncludes && !report.finalText.includes(expected.finalTextIncludes)) {
    failures.push(`finalText does not include ${expected.finalTextIncludes}`)
  }
  if (
    expected.terminalErrorIncludes &&
    !report.outcome.terminalError?.includes(expected.terminalErrorIncludes)
  ) {
    failures.push(`terminalError does not include ${expected.terminalErrorIncludes}`)
  }
  if (
    expected.errorMessageIncludes &&
    !report.outcome.errorMessage?.includes(expected.errorMessageIncludes)
  ) {
    failures.push(`errorMessage does not include ${expected.errorMessageIncludes}`)
  }

  const toolMessages = providerInputs
    .flat()
    .filter((message) => message.role === 'tool')
    .map(stringifyMessageContent)
  for (const expectedContent of expected.toolMessageIncludes ?? []) {
    if (!toolMessages.some((content) => content.includes(expectedContent))) {
      failures.push(`provider input does not include tool message ${expectedContent}`)
    }
  }

  if (typeof expected.failedToolCalls === 'number') {
    addMismatch(failures, 'failedToolCalls', report.toolCalls.failed, expected.failedToolCalls)
  }
  if (typeof expected.permissionRequests === 'number') {
    addMismatch(
      failures,
      'permissionRequests',
      report.permissionRequests,
      expected.permissionRequests
    )
  }
  for (const field of [
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'cachedInputTokens',
    'cacheWriteInputTokens'
  ] as const) {
    addMismatch(failures, field, report.usage[field], expected.usage[field])
    addMismatch(
      failures,
      `persistedUsage.${field}`,
      report.persistedUsage[field],
      expected.usage[field]
    )
  }

  return failures
}

export async function runNativeAgentEvalScenario(
  scenario: NativeAgentEvalScenario
): Promise<NativeAgentEvalReport> {
  const abortController = new AbortController()
  const { messageStore, state: messageState } = createMessageStore()
  const toolHarness = createToolService(scenario.tools ?? {})
  const providerInputs: ChatMessage[][] = []
  let providerRounds = 0
  let permissionRequests = 0

  const coreStream = vi.fn(async function* (messages: ChatMessage[]) {
    const roundIndex = providerRounds
    providerRounds += 1
    providerInputs.push(clone(messages))
    const round = scenario.rounds[roundIndex]
    if (!round) {
      throw new Error(`No scripted provider round ${roundIndex + 1} for ${scenario.id}`)
    }

    for (let eventIndex = 0; eventIndex < round.events.length; eventIndex += 1) {
      if (round.abortBeforeEventIndex === eventIndex) {
        abortController.abort()
      }
      yield round.events[eventIndex]
    }
  }) as unknown as ProcessParams['coreStream']

  const tools = Object.keys(scenario.tools ?? {}).map(makeToolDefinition)
  const toolOutputGuard = new ToolOutputGuard()
  const sessionId = toAppSessionId(`eval-${scenario.id}`)
  const messageId = `message-${scenario.id}`
  const runId = `request-${scenario.id}`
  const params: ProcessParams = {
    run: createLoopRun({
      runId,
      sessionId,
      messageId,
      abortController,
      messages: [{ role: 'user', content: `Eval scenario: ${scenario.id}` }],
      streamState: createState(),
      resources: { toolDefinitions: tools, activeSkillNames: [] }
    }),
    toolCatalog: {
      resolve: async () => tools
    },
    toolExecution: createToolExecutionPort(toolHarness.presenter),
    toolResults: createToolResultPort({
      outputGuard: toolOutputGuard,
      normalize: async ({ content }) => content
    }),
    coreStream,
    providerId: 'native-agent-eval',
    modelId: 'scripted-provider',
    modelConfig: {
      maxTokens: 4096,
      contextLength: 32_768,
      vision: false,
      functionCall: true,
      reasoning: false,
      type: ModelType.Chat
    },
    temperature: 0,
    maxTokens: 4096,
    interleavedReasoning: DEFAULT_INTERLEAVED_REASONING,
    permissionMode: scenario.permissionMode ?? 'full_access',
    maxProviderRounds: scenario.maxProviderRounds,
    shouldYieldForPendingInput: () => scenario.yieldForPendingInput === true,
    notificationObserver: {
      notify: (notification) => {
        if (notification.event === 'PermissionRequest') {
          permissionRequests += 1
        }
      }
    },
    io: {
      messageStore,
      publishEvent: vi.fn(),
      publishSessionUpdate: vi.fn(),
      tapeRecorder: {
        appendToolFact: async () => ({ sessionId, entryId: 1 })
      }
    }
  }

  const startedAt = Date.now()
  const result = await processStream(params)
  const elapsedMs = Math.max(0, Date.now() - startedAt)
  const toolCalls = {
    total: toolHarness.calls.length,
    succeeded: toolHarness.calls.filter((call) => call.status === 'success').length,
    failed: toolHarness.calls.filter((call) => call.status === 'error').length
  }
  const baseReport: Omit<NativeAgentEvalReport, 'passed' | 'expectationFailures'> = {
    schemaVersion: 1,
    scenarioId: scenario.id,
    outcome: {
      status: result.status,
      stopReason: result.stopReason ?? null,
      terminalError: result.terminalError ?? null,
      errorMessage: result.errorMessage ?? null
    },
    persistedStatus: messageState.persistedStatus,
    persistedRunId:
      typeof messageState.metadata.runId === 'string' ? messageState.metadata.runId : null,
    persistedRunOutcome:
      typeof messageState.metadata.runOutcome === 'string'
        ? messageState.metadata.runOutcome
        : null,
    persistedRunStopReason:
      typeof messageState.metadata.runStopReason === 'string'
        ? messageState.metadata.runStopReason
        : null,
    persistedProviderRounds: normalizePersistedNumber(messageState.metadata, 'providerRounds'),
    persistedToolCalls: normalizePersistedNumber(messageState.metadata, 'toolCalls'),
    persistedUsage: normalizePersistedUsage(messageState.metadata),
    providerRounds,
    toolCalls,
    permissionRequests,
    elapsedMs,
    usage: normalizeUsage(result),
    finalText: collectFinalText(messageState.blocks)
  }
  const expectationFailures = evaluateReport(scenario, baseReport, providerInputs)

  return {
    ...baseReport,
    passed: expectationFailures.length === 0,
    expectationFailures
  }
}

export function aggregateNativeAgentEvalReports(
  scenarios: NativeAgentEvalScenario[],
  reports: NativeAgentEvalReport[]
): NativeAgentEvalAggregate {
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]))
  const providerRoundBudget = scenarios.reduce(
    (total, scenario) => total + scenario.budget.maxProviderRounds,
    0
  )
  const toolCallBudget = scenarios.reduce(
    (total, scenario) => total + scenario.budget.maxToolCalls,
    0
  )
  const totalProviderRounds = reports.reduce((total, report) => total + report.providerRounds, 0)
  const totalToolCalls = reports.reduce((total, report) => total + report.toolCalls.total, 0)
  const passed = reports.filter((report) => report.passed).length

  return {
    schemaVersion: 1,
    scenarios: reports.length,
    passed,
    passRate: reports.length === 0 ? 0 : passed / reports.length,
    totalProviderRounds,
    providerRoundBudget,
    totalToolCalls,
    toolCallBudget,
    totalTokens: reports.reduce((total, report) => total + (report.usage.totalTokens ?? 0), 0),
    withinCallBudgets: reports.every((report) => {
      const scenario = scenarioById.get(report.scenarioId)
      return (
        scenario !== undefined &&
        report.providerRounds <= scenario.budget.maxProviderRounds &&
        report.toolCalls.total <= scenario.budget.maxToolCalls
      )
    })
  }
}

export function completionRound(
  text: string,
  usage?: ScriptedProviderUsage
): ScriptedProviderRound {
  return {
    events: [
      { type: 'text', content: text },
      ...(usage
        ? [
            {
              type: 'usage' as const,
              usage: {
                prompt_tokens: usage.inputTokens,
                completion_tokens: usage.outputTokens,
                total_tokens: usage.totalTokens,
                ...(usage.cachedInputTokens === undefined
                  ? {}
                  : { cached_tokens: usage.cachedInputTokens }),
                ...(usage.cacheWriteInputTokens === undefined
                  ? {}
                  : { cache_write_tokens: usage.cacheWriteInputTokens })
              }
            }
          ]
        : []),
      { type: 'stop', stop_reason: 'complete' }
    ]
  }
}

export function toolRound(
  id: string,
  name: string,
  args: string,
  usage?: ScriptedProviderUsage
): ScriptedProviderRound {
  return {
    events: [
      ...(usage
        ? [
            {
              type: 'usage' as const,
              usage: {
                prompt_tokens: usage.inputTokens,
                completion_tokens: usage.outputTokens,
                total_tokens: usage.totalTokens,
                ...(usage.cachedInputTokens === undefined
                  ? {}
                  : { cached_tokens: usage.cachedInputTokens }),
                ...(usage.cacheWriteInputTokens === undefined
                  ? {}
                  : { cache_write_tokens: usage.cacheWriteInputTokens })
              }
            }
          ]
        : []),
      { type: 'tool_call_start', tool_call_id: id, tool_call_name: name },
      {
        type: 'tool_call_end',
        tool_call_id: id,
        tool_call_arguments_complete: args
      },
      { type: 'stop', stop_reason: 'tool_use' }
    ]
  }
}
