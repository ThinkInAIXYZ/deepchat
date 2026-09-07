import type { ProgrammaticToolCapabilityV1 } from '@/agent/deepchat/runtime/programmaticToolSurface'
import type { CliRouteCaller } from '@/routes/routeRegistry'
import { canonicalJsonStringifyData, hashJsonData } from '@/tape/domain/canonicalJson'
import type { AgentCliProgrammaticOperationGrant } from './agentTokenAuthority'
import { parseBoundedJsonBytes } from './body'
import { CliRequestError } from './errors'
import { ProgrammaticParentOperationError } from './programmaticToolParentController'
import type { ProgrammaticToolParentRegistry } from './programmaticToolParentRegistry'
import {
  PROGRAMMATIC_TOOL_DESCRIPTION_MAX_CHARACTERS,
  PROGRAMMATIC_TOOL_EXAMPLE_MAX_CHARACTERS,
  PROGRAMMATIC_TOOL_NAME_MAX_CHARACTERS,
  PROGRAMMATIC_TOOL_SIGNATURE_MAX_CHARACTERS,
  ProgrammaticToolStepResultSchema,
  decodeProgrammaticToolJsonPointer,
  parseProgrammaticToolBindingSource,
  toolBatchRoute,
  toolCallRoute,
  toolDescribeRoute,
  toolSearchRoute
} from '@shared/contracts/routes/tools.routes'
import type { JsonValue } from '@shared/contracts/common'
import type {
  MCPToolCall,
  MCPToolResponse,
  ToolDispatchCommit,
  ToolOutcomeProjectionRegistrar
} from '@shared/types/core/mcp'
import type { ToolPermissionPreCheckResult } from '@shared/types/tool'
import {
  CommittedToolOutcomeProjectionError,
  ExecutionJournalError,
  isExecutionJournalError
} from '@/tape/domain/executionJournal'
import {
  recordToolSurfaceCanaryDiscovery,
  recordToolSurfaceCanarySettledToolResult
} from '@/agent/deepchat/runtime/toolSurfaceCanaryDiagnostics'
import { ToolSurfaceError } from '@/agent/deepchat/runtime/toolSurface'
import { ExecutionContractDispatchError } from '@/tape/domain/executionContract'
import { McpPreDispatchError } from '@/mcp/errors'

const DEFAULT_SEARCH_LIMIT = 5
const MAX_SEARCH_TOKENS = 32
const MAX_SIGNATURE_PROPERTIES = 64
const SEARCH_ABORT_CHECK_INTERVAL = 32
const MAX_CHILD_ERROR_CHARACTERS = 4_096
const CHILD_OUTPUT_QUOTA_TEXT = 'Programmatic Tool result exceeds its output quota'
const CHILD_OUTPUT_QUOTA_TEXT_BYTES = Buffer.byteLength(CHILD_OUTPUT_QUOTA_TEXT, 'utf8')

type ProgrammaticToolEntry = ProgrammaticToolCapabilityV1['entries'][number]
type ProgrammaticToolStepResult = ReturnType<typeof ProgrammaticToolStepResultSchema.parse>
type ProgrammaticToolBatchInput = ReturnType<typeof toolBatchRoute.input.parse>
type ProgrammaticToolBatchStep = ProgrammaticToolBatchInput['steps'][number]
type ProgrammaticToolInvocation = ReturnType<ProgrammaticToolParentRegistry['resolveInvocation']>

type ProgrammaticExecutedChild = Readonly<{
  step: ProgrammaticToolStepResult
  journalResponseText: string | null
}>

type ProgrammaticToolSummary = Readonly<{
  name: string
  source: 'mcp' | 'plugin'
  effect: 'read' | 'write'
  description: string
  inputSignature: string
  callExample: string
}>

export type ProgrammaticToolDispatcherOptions = Readonly<{
  parents: Pick<
    ProgrammaticToolParentRegistry,
    | 'commitChildDispatch'
    | 'commitChildOutcome'
    | 'failToolInvocationBeforePlan'
    | 'materializeChild'
    | 'recordDiscoveryResult'
    | 'recordToolInvocationResult'
    | 'reserveChildren'
    | 'resolveInvocation'
    | 'stopBeforeChild'
  >
  executeChild(input: {
    request: MCPToolCall
    capability: ProgrammaticToolCapabilityV1
    snapshot: ReturnType<ProgrammaticToolParentRegistry['resolveInvocation']>['snapshot']
    entry: ProgrammaticToolEntry
    assertAuthorityActive: ReturnType<
      ProgrammaticToolParentRegistry['resolveInvocation']
    >['assertAuthorityActive']
    permissionMode: ReturnType<
      ProgrammaticToolParentRegistry['resolveInvocation']
    >['permissionMode']
    signal: AbortSignal
    commitDispatch: ToolDispatchCommit
    registerOutcomeProjection: ToolOutcomeProjectionRegistrar
  }): Promise<{ content: unknown; rawData: MCPToolResponse }>
  authorizeChild(input: {
    caller: CliRouteCaller
    grant: AgentCliProgrammaticOperationGrant
    childOrdinal: number
    entry: ProgrammaticToolEntry
    arguments: Readonly<Record<string, JsonValue>>
    permission: ToolPermissionPreCheckResult
    signal: AbortSignal
  }): Promise<void>
  cancelChildPermission(requestId: string, sessionId: string): void
}>

function normalizeText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return ''
  const normalized = value
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Cs}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const truncated = normalized.slice(0, maximum)
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1)
  return finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff ? truncated.slice(0, -1) : truncated
}

function tokenize(value: string): readonly string[] {
  return Object.freeze(
    Array.from(new Set(value.match(/[\p{L}\p{N}_-]+/gu) ?? [])).slice(0, MAX_SEARCH_TOKENS)
  )
}

function searchableDescription(entry: ProgrammaticToolEntry): string {
  return normalizeText(
    entry.definition.function.description,
    PROGRAMMATIC_TOOL_DESCRIPTION_MAX_CHARACTERS
  )
}

function schemaType(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'value'
  const schema = value as Record<string, unknown>
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((item): item is string => typeof item === 'string')
    if (types.length > 0) return types.join('|')
  }
  return typeof schema.type === 'string' && schema.type ? schema.type : 'value'
}

function exampleValue(value: unknown, name: string): JsonValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return `<${name}>`
  const schema = value as Record<string, unknown>
  switch (schemaType(schema)) {
    case 'boolean':
      return false
    case 'integer':
    case 'number':
      return 0
    case 'array':
      return []
    case 'object':
      return {}
    case 'null':
      return null
    default:
      return `<${name}>`
  }
}

function inputSchema(entry: ProgrammaticToolEntry): Readonly<Record<string, unknown>> {
  return entry.definition.function.parameters
}

function inputSignature(entry: ProgrammaticToolEntry): string {
  const schema = inputSchema(entry)
  const properties =
    schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? schema.properties
      : {}
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : []
  )
  const fields = Object.entries(properties)
    .slice(0, MAX_SIGNATURE_PROPERTIES)
    .map(([name, property]) => `${name}${required.has(name) ? '' : '?'}: ${schemaType(property)}`)
  const suffix = Object.keys(properties).length > fields.length ? ', ...' : ''
  return normalizeText(
    `{ ${fields.join(', ')}${suffix} }`,
    PROGRAMMATIC_TOOL_SIGNATURE_MAX_CHARACTERS
  )
}

function callArguments(entry: ProgrammaticToolEntry): Readonly<Record<string, JsonValue>> {
  const schema = inputSchema(entry)
  const properties =
    schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? schema.properties
      : {}
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : []
  return Object.freeze(
    Object.fromEntries(
      required
        .filter(
          (name) =>
            name.length <= PROGRAMMATIC_TOOL_NAME_MAX_CHARACTERS && Object.hasOwn(properties, name)
        )
        .slice(0, MAX_SIGNATURE_PROPERTIES)
        .map((name) => [name, exampleValue(properties[name], name)])
    )
  )
}

function callExample(entry: ProgrammaticToolEntry): string {
  const stdin = canonicalJsonStringifyData({
    target: entry.target.providerVisibleName,
    arguments: callArguments(entry)
  })
  const example = canonicalJsonStringifyData({ command: 'deepchat tool call', stdin })
  if (Buffer.byteLength(example, 'utf8') <= PROGRAMMATIC_TOOL_EXAMPLE_MAX_CHARACTERS) {
    return example
  }
  return canonicalJsonStringifyData({
    command: 'deepchat tool call',
    stdin: canonicalJsonStringifyData({
      target: entry.target.providerVisibleName,
      arguments: {}
    })
  })
}

function summarize(entry: ProgrammaticToolEntry): ProgrammaticToolSummary {
  return Object.freeze({
    name: entry.target.providerVisibleName,
    source: 'mcp' as const,
    effect: entry.execution.effect,
    description: searchableDescription(entry),
    inputSignature: inputSignature(entry),
    callExample: callExample(entry)
  })
}

function scoreEntry(query: string, tokens: readonly string[], summary: ProgrammaticToolSummary) {
  if (!query) return 0
  const name = summary.name.toLocaleLowerCase('en-US')
  const description = summary.description.toLocaleLowerCase('en-US')
  let score = 0
  if (name === query) score += 10_000
  else if (name.includes(query)) score += 4_000
  if (description.includes(query)) score += 2_000
  for (const token of tokens) {
    if (name === token) score += 1_000
    else if (name.includes(token)) score += 500
    if (description.includes(token)) score += 200
    if (summary.effect === token) score += 50
  }
  return score
}

function unavailableTarget(): never {
  throw new CliRequestError('not_found', 'Tool is not available in the current session', {
    httpStatus: 404
  })
}

function unavailableStep(childOrdinal = 0): ProgrammaticToolStepResult {
  return Object.freeze({
    childOrdinal,
    status: 'error' as const,
    error: Object.freeze({
      code: 'not_found',
      message: 'Tool is not available in the current session',
      retriable: false
    })
  })
}

function errorStep(
  code: string,
  message: string,
  retriable: boolean,
  childOrdinal = 0
): ProgrammaticToolStepResult {
  return Object.freeze({
    childOrdinal,
    status: 'error' as const,
    error: Object.freeze({
      code,
      message:
        normalizeText(message, MAX_CHILD_ERROR_CHARACTERS) || 'Programmatic Tool execution failed',
      retriable
    })
  })
}

function runtimeGateErrorStep(
  error: unknown,
  childOrdinal: number
): ProgrammaticToolStepResult | null {
  if (error instanceof ToolSurfaceError) {
    if (error.code === 'conflicting_tool') {
      return errorStep(
        'definition_changed',
        'Tool definition changed after the current Programmatic Surface was frozen',
        false,
        childOrdinal
      )
    }
    if (error.code === 'ineligible_exposure') {
      return errorStep(
        'authority_changed',
        'Tool execution authority changed after the current Programmatic Surface was frozen',
        false,
        childOrdinal
      )
    }
  }
  if (error instanceof McpPreDispatchError) {
    switch (error.code) {
      case 'definition_changed':
        return errorStep(
          'definition_changed',
          'Tool definition changed after the current Programmatic Surface was frozen',
          false,
          childOrdinal
        )
      case 'invalid_request':
        return errorStep(
          'invalid_request',
          'Tool arguments were rejected before dispatch',
          false,
          childOrdinal
        )
      case 'target_changed':
        return errorStep(
          'target_changed',
          'Tool target changed after the current Programmatic Surface was frozen',
          false,
          childOrdinal
        )
      case 'target_unavailable':
        return errorStep(
          'target_unavailable',
          'Tool target is no longer available in the current session',
          false,
          childOrdinal
        )
      case 'tool_not_allowed':
        return errorStep(
          'tool_disabled',
          'Tool is disabled by current runtime authority',
          false,
          childOrdinal
        )
      case 'runtime_unavailable':
        return errorStep(
          'runtime_unavailable',
          'Tool runtime is temporarily unavailable',
          true,
          childOrdinal
        )
    }
  }
  if (!(error instanceof ExecutionContractDispatchError)) return null
  switch (error.code) {
    case 'tool_not_allowed':
      return errorStep(
        'tool_disabled',
        'Tool is disabled by current runtime authority',
        false,
        childOrdinal
      )
    case 'target_mismatch':
      return errorStep(
        'target_unavailable',
        'Tool target is no longer available in the current session',
        false,
        childOrdinal
      )
    case 'invalid_runtime_authority':
      return errorStep(
        'runtime_authority_unavailable',
        'Current runtime authority is temporarily unavailable',
        true,
        childOrdinal
      )
    default:
      return null
  }
}

function abortStep(signal: AbortSignal, childOrdinal: number): ProgrammaticToolStepResult {
  const timedOut = signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
  return errorStep(
    timedOut ? 'timeout' : 'cancelled',
    timedOut
      ? 'Programmatic Tool execution timed out'
      : 'Programmatic Tool execution was cancelled',
    false,
    childOrdinal
  )
}

function formatSuccessfulOuterResponse(output: unknown): string {
  return `${JSON.stringify(output, null, 2)}\nExit Code: 0`
}

function formatFailedOuterResponse(error: CliRequestError): string {
  return `Error: ${error.message}`
}

function formatPreDispatchOuterFailure(error: CliRequestError): string {
  return JSON.stringify(
    {
      status: 'error',
      error: {
        code: error.code,
        message:
          normalizeText(error.message, MAX_CHILD_ERROR_CHARACTERS) ||
          'Programmatic Tool request failed',
        retriable: error.retriable
      }
    },
    null,
    2
  )
}

function measureOuterResponseBytes(output: unknown): number {
  return Buffer.byteLength(formatSuccessfulOuterResponse(output), 'utf8')
}

function assertOutputWithinCapabilityQuota(
  output: unknown,
  capability: ProgrammaticToolCapabilityV1
): void {
  if (measureOuterResponseBytes(output) <= capability.quotas.maxOutputBytes) return
  throw new CliRequestError(
    'result_too_large',
    'Programmatic Tool result exceeds its output quota',
    {
      httpStatus: 413
    }
  )
}

function isProgrammaticProtocolFailure(error: unknown): boolean {
  return (
    isExecutionJournalError(error) ||
    (error instanceof ProgrammaticParentOperationError &&
      error.code !== 'invalid_plan' &&
      error.code !== 'quota_exceeded')
  )
}

function notStartedStep(childOrdinal: number): ProgrammaticToolStepResult {
  return Object.freeze({ childOrdinal, status: 'not_started' as const })
}

function stoppedBatchSteps(
  stepCount: number,
  failedStep: ProgrammaticToolStepResult
): readonly ProgrammaticToolStepResult[] {
  return Object.freeze([
    failedStep,
    ...Array.from({ length: stepCount - failedStep.childOrdinal - 1 }, (_, offset) =>
      notStartedStep(failedStep.childOrdinal + offset + 1)
    )
  ])
}

function recordProgrammaticSettledToolQuality(
  invocation: ProgrammaticToolInvocation,
  success: boolean
): void {
  recordToolSurfaceCanarySettledToolResult(invocation.snapshot, success)
}

function canonicalJsonClone<T extends JsonValue>(value: T): T {
  const bytes = Buffer.from(canonicalJsonStringifyData(value), 'utf8')
  return parseBoundedJsonBytes(bytes) as T
}

function canonicalJsonBytes(value: JsonValue): number {
  return Buffer.byteLength(canonicalJsonStringifyData(value), 'utf8')
}

function readJsonPointer(
  value: JsonValue,
  pointer: string
): Readonly<{ found: true; value: JsonValue }> | Readonly<{ found: false }> {
  if (pointer === '') return { found: true, value }
  let current: JsonValue = value
  for (const segment of decodeProgrammaticToolJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(segment)) return { found: false }
      const index = Number(segment)
      if (!Number.isSafeInteger(index) || index >= current.length) return { found: false }
      current = current[index]
      continue
    }
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, segment)) {
      return { found: false }
    }
    current = current[segment]
  }
  return { found: true, value: current }
}

function replaceJsonPointer(
  value: Record<string, JsonValue>,
  pointer: string,
  replacement: JsonValue
): void {
  const segments = decodeProgrammaticToolJsonPointer(pointer)
  const property = segments.pop()
  if (property === undefined) {
    throw new CliRequestError(
      'invalid_request',
      'Programmatic Tool binding destination is invalid',
      { httpStatus: 400 }
    )
  }
  let current: JsonValue = value
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) {
        throw new CliRequestError(
          'invalid_request',
          'Programmatic Tool binding destination is unavailable',
          { httpStatus: 400 }
        )
      }
      current = current[index]
      continue
    }
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, segment)) {
      throw new CliRequestError(
        'invalid_request',
        'Programmatic Tool binding destination is unavailable',
        { httpStatus: 400 }
      )
    }
    current = current[segment]
  }
  if (Array.isArray(current)) {
    const index = Number(property)
    if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) {
      throw new CliRequestError(
        'invalid_request',
        'Programmatic Tool binding destination is unavailable',
        { httpStatus: 400 }
      )
    }
    current[index] = replacement
  } else if (current && typeof current === 'object' && Object.hasOwn(current, property)) {
    Object.defineProperty(current, property, {
      configurable: true,
      enumerable: true,
      value: replacement,
      writable: true
    })
  } else {
    throw new CliRequestError(
      'invalid_request',
      'Programmatic Tool binding destination is unavailable',
      { httpStatus: 400 }
    )
  }
}

function materializeBatchArguments(
  step: ProgrammaticToolBatchStep,
  completedSteps: readonly ProgrammaticToolStepResult[],
  maximumBytes: number,
  signal: AbortSignal
): Readonly<Record<string, JsonValue>> {
  const argumentsValue = canonicalJsonClone(step.arguments)
  let materializedBytes = canonicalJsonBytes(argumentsValue)
  for (const binding of step.bindings ?? []) {
    signal.throwIfAborted()
    const source = parseProgrammaticToolBindingSource(binding.from)
    const sourceStep = source ? completedSteps[source.stepIndex] : undefined
    if (!source || !sourceStep || sourceStep.status !== 'success') {
      throw new CliRequestError(
        'invalid_request',
        'Programmatic Tool binding source is unavailable',
        { httpStatus: 400 }
      )
    }
    const selected = readJsonPointer(sourceStep.result, source.resultPointer)
    if (!selected.found) {
      throw new CliRequestError(
        'invalid_request',
        'Programmatic Tool binding source is unavailable',
        { httpStatus: 400 }
      )
    }
    const destination = readJsonPointer(argumentsValue, binding.to)
    if (!destination.found) {
      throw new CliRequestError(
        'invalid_request',
        'Programmatic Tool binding destination is unavailable',
        { httpStatus: 400 }
      )
    }
    materializedBytes += canonicalJsonBytes(selected.value) - canonicalJsonBytes(destination.value)
    if (materializedBytes > maximumBytes) {
      throw new ProgrammaticParentOperationError(
        'Programmatic materialized arguments exceed the aggregate input quota',
        'quota_exceeded'
      )
    }
    replaceJsonPointer(argumentsValue, binding.to, selected.value)
  }
  return Object.freeze(canonicalJsonClone(argumentsValue))
}

function childResultValue(result: { content: unknown; rawData: MCPToolResponse }): JsonValue {
  if (result.rawData.structuredContent !== undefined) {
    try {
      return canonicalJsonClone(result.rawData.structuredContent as JsonValue)
    } catch {
      // Invalid or unsafe structured content is not a binding-capable result. The provider-visible
      // bounded text remains the canonical fallback.
    }
  }
  return childResponseText(result)
}

function childResponseText(result: { content: unknown; rawData: MCPToolResponse }): string {
  if (typeof result.content === 'string') return result.content
  if (typeof result.rawData.content === 'string') return result.rawData.content
  return result.rawData.content
    .map((item) => {
      if (item.type === 'text') return item.text
      if (item.type === 'resource' && item.resource?.text) return item.resource.text
      return `[${item.type}]`
    })
    .join('\n')
}

function boundedChildOutcome(input: {
  childOrdinal: number
  result: { content: unknown; rawData: MCPToolResponse }
  maximumResponseBytes: number
  acceptsStep: (step: ProgrammaticToolStepResult) => boolean
}): Readonly<{
  responseText: string
  isError: boolean
  step: ProgrammaticToolStepResult
}> {
  const responseText = childResponseText(input.result)
  const isError = input.result.rawData.isError === true
  const step = ProgrammaticToolStepResultSchema.parse(
    isError
      ? errorStep('tool_error', responseText, false, input.childOrdinal)
      : {
          childOrdinal: input.childOrdinal,
          status: 'success',
          result: childResultValue(input.result)
        }
  )
  if (
    Buffer.byteLength(responseText, 'utf8') <= input.maximumResponseBytes &&
    input.acceptsStep(step)
  ) {
    return Object.freeze({ responseText, isError, step })
  }

  const quotaStep = ProgrammaticToolStepResultSchema.parse(
    errorStep('result_too_large', CHILD_OUTPUT_QUOTA_TEXT, false, input.childOrdinal)
  )
  if (CHILD_OUTPUT_QUOTA_TEXT_BYTES > input.maximumResponseBytes || !input.acceptsStep(quotaStep)) {
    throw new ExecutionJournalError(
      'Programmatic child output quota cannot represent its bounded nested outcome.',
      'invalid_fact'
    )
  }
  return Object.freeze({
    responseText: CHILD_OUTPUT_QUOTA_TEXT,
    isError: true,
    step: quotaStep
  })
}

export class ProgrammaticToolDispatcher {
  constructor(private readonly options: ProgrammaticToolDispatcherOptions) {}

  completePreDispatchFailure(
    method: string,
    grant: AgentCliProgrammaticOperationGrant,
    error: CliRequestError
  ): void {
    if (method !== grant.route) {
      throw new ProgrammaticParentOperationError(
        'Programmatic pre-dispatch failure does not match its exact route',
        'identity_mismatch'
      )
    }
    const result = Object.freeze({
      responseText: formatPreDispatchOuterFailure(error),
      isError: true
    })
    if (method === toolSearchRoute.name || method === toolDescribeRoute.name) {
      this.options.parents.recordDiscoveryResult(grant, result)
      return
    }
    if (method === toolCallRoute.name || method === toolBatchRoute.name) {
      this.options.parents.failToolInvocationBeforePlan(grant, result)
      return
    }
    throw new ProgrammaticParentOperationError(
      'Programmatic pre-dispatch failure has an unsupported route',
      'identity_mismatch'
    )
  }

  private async executeReservedChild(input: {
    caller: CliRouteCaller
    grant: AgentCliProgrammaticOperationGrant
    invocation: ProgrammaticToolInvocation
    capability: ProgrammaticToolCapabilityV1
    entry: ProgrammaticToolEntry
    childOrdinal: number
    arguments: Readonly<Record<string, JsonValue>>
    argumentTemplate: Readonly<Record<string, unknown>>
    signal: AbortSignal
    maximumResponseBytes: number
    acceptsStep: (step: ProgrammaticToolStepResult) => boolean
  }): Promise<ProgrammaticExecutedChild> {
    const pendingOutcomeProjections: Array<() => void> = []
    let dispatchCommitted = false
    let dispatchBoundaryFailed = false
    const nestedOperation = Object.freeze({
      kind: 'nested' as const,
      runId: input.grant.operation.runId,
      requestSeq: input.grant.operation.requestSeq,
      providerToolCallId: input.grant.operation.providerToolCallId,
      childOrdinal: input.childOrdinal
    })
    const releaseOutcomeProjections = (): void => {
      try {
        for (const project of pendingOutcomeProjections.splice(0)) project()
      } catch (cause) {
        throw new CommittedToolOutcomeProjectionError(nestedOperation, { cause })
      }
    }
    const execute = async () =>
      await this.options.executeChild({
        request: {
          id: `programmatic-${hashJsonData({
            operation: input.grant.operation,
            childOrdinal: input.childOrdinal
          }).slice(0, 32)}`,
          type: 'function',
          function: {
            name: input.entry.target.providerVisibleName,
            arguments: canonicalJsonStringifyData(input.arguments)
          },
          conversationId: input.capability.request.sessionId
        },
        capability: input.capability,
        snapshot: input.invocation.snapshot,
        entry: input.entry,
        assertAuthorityActive: input.invocation.assertAuthorityActive,
        permissionMode: input.invocation.permissionMode,
        signal: input.signal,
        commitDispatch: (dispatch) => {
          if (dispatchCommitted) {
            dispatchBoundaryFailed = true
            throw new ExecutionJournalError(
              'Programmatic child attempted more than one durable dispatch commit.',
              'duplicate_dispatch'
            )
          }
          this.options.parents.materializeChild(input.grant, {
            childOrdinal: input.childOrdinal,
            argumentTemplate: input.argumentTemplate,
            normalizedArguments: dispatch.normalizedArguments
          })
          dispatchBoundaryFailed = true
          try {
            this.options.parents.commitChildDispatch(input.grant, input.childOrdinal, dispatch)
            dispatchCommitted = true
          } finally {
            if (dispatchCommitted) dispatchBoundaryFailed = false
          }
        },
        registerOutcomeProjection: (projection) => pendingOutcomeProjections.push(projection)
      })

    let executed: Awaited<ReturnType<typeof execute>>
    try {
      executed = await execute()
      if (executed.rawData.requiresPermission) {
        const permission = executed.rawData.permissionRequest
        const requestId = permission?.requestId?.trim()
        if (dispatchCommitted) {
          if (requestId) {
            this.options.cancelChildPermission(requestId, input.capability.request.sessionId)
          }
          throw new ExecutionJournalError(
            'Programmatic child requested permission after its durable dispatch commit.',
            'invalid_fact'
          )
        }
        if (!permission || !requestId) {
          throw new CliRequestError(
            'unavailable',
            'Programmatic Tool permission authority is unavailable',
            { httpStatus: 503 }
          )
        }
        try {
          await this.options.authorizeChild({
            caller: input.caller,
            grant: input.grant,
            childOrdinal: input.childOrdinal,
            entry: input.entry,
            arguments: input.arguments,
            permission: permission as ToolPermissionPreCheckResult,
            signal: input.signal
          })
          executed = await execute()
        } finally {
          this.options.cancelChildPermission(requestId, input.capability.request.sessionId)
        }
        if (executed.rawData.requiresPermission) {
          const repeatedRequestId = executed.rawData.permissionRequest?.requestId?.trim()
          if (repeatedRequestId) {
            this.options.cancelChildPermission(
              repeatedRequestId,
              input.capability.request.sessionId
            )
          }
          throw new CliRequestError(
            'approval_denied',
            'Programmatic Tool permission was not consumed',
            { httpStatus: 403 }
          )
        }
      }
    } catch (error) {
      if (dispatchBoundaryFailed) throw error
      if (isProgrammaticProtocolFailure(error)) throw error
      if (dispatchCommitted) {
        if (input.signal.aborted) throw error
        const errorText = `Error: ${
          error instanceof Error ? error.message : 'Programmatic Tool execution failed'
        }`
        const childOutcome = boundedChildOutcome({
          childOrdinal: input.childOrdinal,
          result: {
            content: errorText,
            rawData: {
              toolCallId: nestedOperation.providerToolCallId,
              content: errorText,
              isError: true
            }
          },
          maximumResponseBytes: input.maximumResponseBytes,
          acceptsStep: input.acceptsStep
        })
        this.options.parents.commitChildOutcome(input.grant, {
          childOrdinal: input.childOrdinal,
          responseText: childOutcome.responseText,
          isError: true
        })
        recordProgrammaticSettledToolQuality(input.invocation, false)
        releaseOutcomeProjections()
        return Object.freeze({
          step: childOutcome.step,
          journalResponseText: childOutcome.responseText
        })
      }

      if (pendingOutcomeProjections.length > 0) {
        throw new ExecutionJournalError(
          'Programmatic child registered an outcome projection without a durable dispatch.',
          'invalid_fact'
        )
      }
      this.options.parents.stopBeforeChild(input.grant, input.childOrdinal)
      const runtimeGateStep = runtimeGateErrorStep(error, input.childOrdinal)
      const step = input.signal.aborted
        ? abortStep(input.signal, input.childOrdinal)
        : error instanceof CliRequestError
          ? errorStep(error.code, error.message, error.retriable, input.childOrdinal)
          : error instanceof ProgrammaticParentOperationError
            ? errorStep(
                error.code === 'quota_exceeded' ? 'quota_exceeded' : 'invalid_request',
                error.message,
                false,
                input.childOrdinal
              )
            : (runtimeGateStep ?? unavailableStep(input.childOrdinal))
      return Object.freeze({ step, journalResponseText: null })
    }

    if (!dispatchCommitted) {
      if (pendingOutcomeProjections.length > 0) {
        throw new ExecutionJournalError(
          'Programmatic child registered an outcome projection without a durable dispatch.',
          'invalid_fact'
        )
      }
      this.options.parents.stopBeforeChild(input.grant, input.childOrdinal)
      return Object.freeze({
        step: unavailableStep(input.childOrdinal),
        journalResponseText: null
      })
    }

    const childOutcome = boundedChildOutcome({
      childOrdinal: input.childOrdinal,
      result: executed,
      maximumResponseBytes: input.maximumResponseBytes,
      acceptsStep: input.acceptsStep
    })
    this.options.parents.commitChildOutcome(input.grant, {
      childOrdinal: input.childOrdinal,
      responseText: childOutcome.responseText,
      isError: childOutcome.isError
    })
    recordProgrammaticSettledToolQuality(input.invocation, !childOutcome.isError)
    releaseOutcomeProjections()
    return Object.freeze({
      step: childOutcome.step,
      journalResponseText: childOutcome.responseText
    })
  }

  async dispatch(
    method: string,
    input: unknown,
    caller: CliRouteCaller,
    grant: AgentCliProgrammaticOperationGrant,
    signal: AbortSignal,
    takeSettlementOwnership: () => void
  ): Promise<unknown> {
    let settlementOwnershipTaken = false
    const claimSettlementOwnership = (): void => {
      if (settlementOwnershipTaken) return
      takeSettlementOwnership()
      settlementOwnershipTaken = true
    }
    signal.throwIfAborted()
    if (
      caller.principal !== 'agent' ||
      caller.conversationId !== grant.operation.sessionId ||
      method !== grant.route
    ) {
      throw new CliRequestError(
        'authentication_failed',
        'Programmatic invocation authority is unavailable',
        { httpStatus: 401 }
      )
    }
    let capability: ProgrammaticToolCapabilityV1
    let invocation: ReturnType<ProgrammaticToolParentRegistry['resolveInvocation']>
    try {
      invocation = this.options.parents.resolveInvocation(grant)
      capability = invocation.capability
    } catch {
      throw new CliRequestError(
        'authentication_failed',
        'Programmatic invocation authority is unavailable',
        { httpStatus: 401 }
      )
    }
    signal.throwIfAborted()

    if (method === toolSearchRoute.name) {
      try {
        const query = toolSearchRoute.input.parse(input)
        const normalizedQuery = normalizeText(query.query, query.query.length).toLocaleLowerCase(
          'en-US'
        )
        const tokens = tokenize(normalizedQuery)
        const matches: Array<
          Readonly<{
            entry: ProgrammaticToolEntry
            summary: ProgrammaticToolSummary
            score: number
          }>
        > = []
        for (let index = 0; index < capability.entries.length; index += 1) {
          if (index % SEARCH_ABORT_CHECK_INTERVAL === 0) signal.throwIfAborted()
          const summary = summarize(capability.entries[index])
          const score = scoreEntry(normalizedQuery, tokens, summary)
          if (score > 0) matches.push({ entry: capability.entries[index], summary, score })
        }
        matches.sort(
          (left, right) =>
            right.score - left.score ||
            (left.summary.name < right.summary.name
              ? -1
              : left.summary.name > right.summary.name
                ? 1
                : 0)
        )
        const limit = query.limit ?? DEFAULT_SEARCH_LIMIT
        const selected = matches.slice(0, limit)
        const output = {
          tools: selected.map((match) => match.summary),
          truncated: matches.length > limit
        }
        while (
          output.tools.length > 0 &&
          measureOuterResponseBytes(output) > capability.quotas.maxOutputBytes
        ) {
          selected.pop()
          output.tools.pop()
          output.truncated = true
        }
        assertOutputWithinCapabilityQuota(output, capability)
        signal.throwIfAborted()
        const result = toolSearchRoute.output.parse(output)
        claimSettlementOwnership()
        this.options.parents.recordDiscoveryResult(grant, {
          responseText: formatSuccessfulOuterResponse(result),
          isError: false
        })
        recordToolSurfaceCanaryDiscovery(invocation.snapshot, {
          kind: 'search',
          stableTargetKeys: selected.map((match) => match.entry.stableTargetKey)
        })
        return result
      } catch (error) {
        recordToolSurfaceCanaryDiscovery(invocation.snapshot, {
          kind: 'search',
          stableTargetKeys: Object.freeze([]),
          failed: true
        })
        if (error instanceof CliRequestError) {
          claimSettlementOwnership()
          this.options.parents.recordDiscoveryResult(grant, {
            responseText: formatFailedOuterResponse(error),
            isError: true
          })
        }
        throw error
      }
    }

    if (method === toolDescribeRoute.name) {
      try {
        const request = toolDescribeRoute.input.parse(input)
        const entry = capability.entries.find(
          (candidate) => candidate.target.providerVisibleName === request.target
        )
        if (!entry) unavailableTarget()
        const output = {
          tool: {
            ...summarize(entry),
            inputSchema: inputSchema(entry)
          }
        }
        assertOutputWithinCapabilityQuota(output, capability)
        signal.throwIfAborted()
        const result = toolDescribeRoute.output.parse(output)
        claimSettlementOwnership()
        this.options.parents.recordDiscoveryResult(grant, {
          responseText: formatSuccessfulOuterResponse(result),
          isError: false
        })
        recordToolSurfaceCanaryDiscovery(invocation.snapshot, {
          kind: 'describe',
          stableTargetKeys: [entry.stableTargetKey]
        })
        return result
      } catch (error) {
        recordToolSurfaceCanaryDiscovery(invocation.snapshot, {
          kind: 'describe',
          stableTargetKeys: Object.freeze([]),
          failed: true
        })
        if (error instanceof CliRequestError) {
          claimSettlementOwnership()
          this.options.parents.recordDiscoveryResult(grant, {
            responseText: formatFailedOuterResponse(error),
            isError: true
          })
        }
        throw error
      }
    }

    if (method === toolCallRoute.name) {
      const request = toolCallRoute.input.parse(input)
      const entry = capability.entries.find(
        (candidate) => candidate.target.providerVisibleName === request.target
      )
      if (!entry) {
        const output = toolCallRoute.output.parse({ step: unavailableStep() })
        assertOutputWithinCapabilityQuota(output, capability)
        claimSettlementOwnership()
        this.options.parents.failToolInvocationBeforePlan(grant, {
          responseText: formatSuccessfulOuterResponse(output),
          isError: true
        })
        return output
      }

      const argumentTemplate = Object.freeze({
        arguments: request.arguments,
        bindings: Object.freeze([])
      })
      claimSettlementOwnership()
      try {
        this.options.parents.reserveChildren(grant, [
          {
            childOrdinal: 0,
            toolName: entry.target.providerVisibleName,
            toolSource: 'mcp',
            target: {
              serverName: entry.target.serverName,
              originalName: entry.target.originalName
            },
            definitionHash: entry.canonicalToolDefinitionHash,
            argumentTemplate
          }
        ])
      } catch (error) {
        if (
          !(error instanceof ProgrammaticParentOperationError) ||
          (error.code !== 'invalid_plan' && error.code !== 'quota_exceeded')
        ) {
          throw error
        }
        const output = toolCallRoute.output.parse({
          step: errorStep(
            error.code === 'quota_exceeded' ? 'quota_exceeded' : 'invalid_request',
            error.message,
            false
          )
        })
        assertOutputWithinCapabilityQuota(output, capability)
        this.options.parents.recordToolInvocationResult(grant, {
          responseText: formatSuccessfulOuterResponse(output),
          isError: true
        })
        return output
      }

      const operationSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(capability.quotas.maxDurationMs)
      ])
      if (capability.quotas.maxOutputBytes < CHILD_OUTPUT_QUOTA_TEXT_BYTES) {
        this.options.parents.stopBeforeChild(grant, 0)
        const output = toolCallRoute.output.parse({
          step: errorStep(
            'quota_exceeded',
            'Programmatic Tool output quota is too small to execute a child',
            false
          )
        })
        assertOutputWithinCapabilityQuota(output, capability)
        this.options.parents.recordToolInvocationResult(grant, {
          responseText: formatSuccessfulOuterResponse(output),
          isError: true
        })
        return output
      }

      const child = await this.executeReservedChild({
        caller,
        grant,
        invocation,
        capability,
        entry,
        childOrdinal: 0,
        arguments: request.arguments,
        argumentTemplate,
        signal: operationSignal,
        maximumResponseBytes: capability.quotas.maxOutputBytes,
        acceptsStep: (step) =>
          measureOuterResponseBytes({ step }) <= capability.quotas.maxOutputBytes
      })
      const output = toolCallRoute.output.parse({ step: child.step })
      assertOutputWithinCapabilityQuota(output, capability)
      this.options.parents.recordToolInvocationResult(grant, {
        responseText: formatSuccessfulOuterResponse(output),
        isError: child.step.status !== 'success'
      })
      return output
    }

    if (method === toolBatchRoute.name) {
      const request = toolBatchRoute.input.parse(input)
      const entries = request.steps.map((step) =>
        capability.entries.find((candidate) => candidate.target.providerVisibleName === step.target)
      )
      if (entries.some((entry) => !entry)) {
        const output = toolBatchRoute.output.parse({
          steps: stoppedBatchSteps(request.steps.length, unavailableStep())
        })
        assertOutputWithinCapabilityQuota(output, capability)
        claimSettlementOwnership()
        this.options.parents.failToolInvocationBeforePlan(grant, {
          responseText: formatSuccessfulOuterResponse(output),
          isError: true
        })
        return output
      }

      const argumentTemplates = request.steps.map((step) =>
        Object.freeze({
          arguments: step.arguments,
          bindings: Object.freeze([...(step.bindings ?? [])])
        })
      )
      claimSettlementOwnership()
      try {
        this.options.parents.reserveChildren(
          grant,
          entries.map((candidate, childOrdinal) => {
            const entry = candidate!
            return {
              childOrdinal,
              toolName: entry.target.providerVisibleName,
              toolSource: 'mcp' as const,
              target: {
                serverName: entry.target.serverName,
                originalName: entry.target.originalName
              },
              definitionHash: entry.canonicalToolDefinitionHash,
              argumentTemplate: argumentTemplates[childOrdinal]
            }
          })
        )
      } catch (error) {
        if (
          !(error instanceof ProgrammaticParentOperationError) ||
          (error.code !== 'invalid_plan' && error.code !== 'quota_exceeded')
        ) {
          throw error
        }
        const failedStep = errorStep(
          error.code === 'quota_exceeded' ? 'quota_exceeded' : 'invalid_request',
          error.message,
          false
        )
        const output = toolBatchRoute.output.parse({
          steps: stoppedBatchSteps(request.steps.length, failedStep)
        })
        assertOutputWithinCapabilityQuota(output, capability)
        this.options.parents.recordToolInvocationResult(grant, {
          responseText: formatSuccessfulOuterResponse(output),
          isError: true
        })
        return output
      }

      const operationSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(capability.quotas.maxDurationMs)
      ])
      const completedSteps: ProgrammaticToolStepResult[] = []
      let journalOutputBytes = 0

      for (let childOrdinal = 0; childOrdinal < request.steps.length; childOrdinal += 1) {
        const step = request.steps[childOrdinal]
        const entry = entries[childOrdinal]!
        const remainingResponseBytes = capability.quotas.maxOutputBytes - journalOutputBytes
        if (remainingResponseBytes < CHILD_OUTPUT_QUOTA_TEXT_BYTES) {
          this.options.parents.stopBeforeChild(grant, childOrdinal)
          completedSteps.push(
            errorStep(
              'quota_exceeded',
              'Programmatic Tool aggregate output quota is exhausted',
              false,
              childOrdinal
            )
          )
          break
        }

        let materializedArguments: Readonly<Record<string, JsonValue>>
        try {
          operationSignal.throwIfAborted()
          materializedArguments = materializeBatchArguments(
            step,
            completedSteps,
            capability.quotas.maxInputBytes,
            operationSignal
          )
        } catch (error) {
          if (isProgrammaticProtocolFailure(error)) throw error
          this.options.parents.stopBeforeChild(grant, childOrdinal)
          completedSteps.push(
            operationSignal.aborted
              ? abortStep(operationSignal, childOrdinal)
              : error instanceof CliRequestError
                ? errorStep(error.code, error.message, error.retriable, childOrdinal)
                : error instanceof ProgrammaticParentOperationError
                  ? errorStep(
                      error.code === 'quota_exceeded' ? 'quota_exceeded' : 'invalid_request',
                      error.message,
                      false,
                      childOrdinal
                    )
                  : errorStep(
                      'invalid_request',
                      'Programmatic Tool arguments could not be materialized',
                      false,
                      childOrdinal
                    )
          )
          break
        }

        const child = await this.executeReservedChild({
          caller,
          grant,
          invocation,
          capability,
          entry,
          childOrdinal,
          arguments: materializedArguments,
          argumentTemplate: argumentTemplates[childOrdinal],
          signal: operationSignal,
          maximumResponseBytes: remainingResponseBytes,
          acceptsStep: (candidateStep) => {
            const previewSteps = [...completedSteps, candidateStep]
            if (candidateStep.status === 'success' && childOrdinal + 1 < request.steps.length) {
              previewSteps.push(
                errorStep('result_too_large', CHILD_OUTPUT_QUOTA_TEXT, false, childOrdinal + 1)
              )
            }
            while (previewSteps.length < request.steps.length) {
              previewSteps.push(notStartedStep(previewSteps.length))
            }
            return (
              measureOuterResponseBytes({ steps: previewSteps }) <= capability.quotas.maxOutputBytes
            )
          }
        })
        completedSteps.push(child.step)
        if (child.journalResponseText !== null) {
          journalOutputBytes += Buffer.byteLength(child.journalResponseText, 'utf8')
        }
        if (child.step.status !== 'success') break
      }

      while (completedSteps.length < request.steps.length) {
        completedSteps.push(notStartedStep(completedSteps.length))
      }
      const output = toolBatchRoute.output.parse({ steps: completedSteps })
      assertOutputWithinCapabilityQuota(output, capability)
      const isError = completedSteps.some((step) => step.status !== 'success')
      this.options.parents.recordToolInvocationResult(grant, {
        responseText: formatSuccessfulOuterResponse(output),
        isError
      })
      return output
    }

    throw new CliRequestError('unavailable', 'Programmatic Tool execution is not available', {
      httpStatus: 503,
      retriable: false
    })
  }
}
