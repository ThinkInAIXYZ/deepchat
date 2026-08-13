import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { DeepChatPromptAssembly } from '@shared/types/prompt-assembly'
import type { DeepChatExecutionContract } from '@shared/types/execution-contract'
import type {
  DeepChatTapeRuntimeViewSkillContextV7,
  DeepChatTapeSkillContext,
  DeepChatTapeSkillMaterializationRef
} from '@shared/types/tape-view-manifest'
import { ResolvedCommandShellSchema, type ResolvedCommandShell } from '@shared/commandShell'
import {
  hashSkillEffectiveContent,
  type TapeSkillIdentity
} from '@/tape/domain/skillMaterialization'
import {
  MAX_SKILL_CONTEXTS_PER_VIEW,
  MAX_SKILL_VIEW_RESULT_FACT_BYTES,
  validateSchema7SkillContexts,
  type TapeRuntimeSkillViewProjection
} from '@/tape/domain/skillContext'
import { canonicalJsonStringifyData } from '@/tape/domain/canonicalJson'
import {
  bindProviderProjectionIdentity,
  getProviderProjectionIdentities
} from './providerProjectionIdentity'

export interface RuntimeSkillContextBinding {
  readonly toolCallId: string
  readonly context: DeepChatTapeRuntimeViewSkillContextV7
}

export interface MaterializedSkillContextBinding {
  readonly effectiveContent: string
  readonly completeBodyFragment: string
  readonly projectionKey: string
  readonly tapeIncarnationId: string
  readonly context: DeepChatTapeSkillContext
}

export interface LoopRunResources {
  toolDefinitions: MCPToolDefinition[]
  activeSkillNames: string[]
  promptAssembly?: DeepChatPromptAssembly
  commandShell: ResolvedCommandShell
  tapeIncarnationId?: string
  materializedSkillContexts: MaterializedSkillContextBinding[]
  runtimeSkillContexts: RuntimeSkillContextBinding[]
}

export interface LoopRunProviderRecovery {
  contextOverflowHandoffAttempted: boolean
  strictProviderOverflowRetryUsed: boolean
}

export interface LoopRunRequestContractBinding {
  readonly requestSeq: number
  readonly executionContract: DeepChatExecutionContract | null
}

export interface LoopRunRequestViewBinding {
  readonly requestSeq: number
  readonly manifestHash: string
  readonly tapeIncarnationId?: string
}

export interface LoopRun<TStreamState> {
  readonly runId: string
  readonly sessionId: AppSessionId
  readonly messageId: string
  readonly abortController: AbortController
  readonly startedAt: number
  readonly initialRequestSeq: number
  logicalRound: number
  requestSeq: number
  physicalAttempt: number
  messages: ChatMessage[]
  readonly streamState: TStreamState
  resources: LoopRunResources
  providerRecovery: LoopRunProviderRecovery
  activeRequestContract: LoopRunRequestContractBinding | null
  activeRequestView: LoopRunRequestViewBinding | null
}

export interface CreateLoopRunInput<TStreamState> {
  runId: string
  sessionId: AppSessionId
  messageId: string
  abortController: AbortController
  messages: readonly ChatMessage[]
  streamState: TStreamState
  resources: {
    toolDefinitions: readonly MCPToolDefinition[]
    activeSkillNames: readonly string[]
    promptAssembly?: DeepChatPromptAssembly
    commandShell: ResolvedCommandShell
  }
  initialRequestSeq?: number
  initialLogicalRound?: number
  startedAt?: number
}

function normalizeInitialCounter(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function createLoopRun<TStreamState>(
  input: CreateLoopRunInput<TStreamState>
): LoopRun<TStreamState> {
  const initialRequestSeq = normalizeInitialCounter(input.initialRequestSeq)
  const parsedCommandShell = ResolvedCommandShellSchema.parse(input.resources.commandShell)
  const commandShell = Object.freeze({
    ...parsedCommandShell,
    args: Object.freeze([...parsedCommandShell.args])
  }) as ResolvedCommandShell
  return {
    runId: input.runId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    abortController: input.abortController,
    startedAt: input.startedAt ?? Date.now(),
    initialRequestSeq,
    logicalRound: normalizeInitialCounter(input.initialLogicalRound),
    requestSeq: initialRequestSeq,
    physicalAttempt: 0,
    messages: [...input.messages],
    streamState: input.streamState,
    resources: {
      toolDefinitions: [...input.resources.toolDefinitions],
      activeSkillNames: [...input.resources.activeSkillNames],
      ...(input.resources.promptAssembly ? { promptAssembly: input.resources.promptAssembly } : {}),
      commandShell,
      materializedSkillContexts: [],
      runtimeSkillContexts: []
    },
    providerRecovery: {
      contextOverflowHandoffAttempted: false,
      strictProviderOverflowRetryUsed: false
    },
    activeRequestContract: null,
    activeRequestView: null
  }
}

function sameSkillIdentity(
  left: DeepChatTapeSkillContext,
  right: DeepChatTapeSkillContext
): boolean {
  return (
    left.agentId === right.agentId &&
    left.sourceType === right.sourceType &&
    left.sourceId === right.sourceId &&
    left.skillName === right.skillName
  )
}

export function registerMaterializedSkillContext(
  run: LoopRun<unknown>,
  input: Omit<MaterializedSkillContextBinding, 'projectionKey'> & {
    providerMessageIndex: number
  }
): void {
  if (!run.resources.tapeIncarnationId) {
    throw new Error('Loop Run is not bound to a Session Tape incarnation.')
  }
  if (run.resources.tapeIncarnationId !== input.tapeIncarnationId) {
    throw new Error('Materialized Skill context belongs to another Session Tape incarnation.')
  }
  if (
    (input.context.activationScope !== 'message' && input.context.activationScope !== 'session') ||
    !input.completeBodyFragment ||
    !input.effectiveContent ||
    hashSkillEffectiveContent(input.effectiveContent) !== input.context.projectedContentHash
  ) {
    throw new Error('Materialized Skill context projection is invalid.')
  }
  if (
    !Number.isSafeInteger(input.providerMessageIndex) ||
    input.providerMessageIndex < 0 ||
    input.providerMessageIndex >= run.messages.length
  ) {
    throw new Error('Materialized Skill context provider message binding is invalid.')
  }
  const providerMessage = run.messages[input.providerMessageIndex]
  if (providerMessage.role !== input.context.providerRole) {
    throw new Error('Materialized Skill context provider role binding is invalid.')
  }
  const projectionKey = canonicalJsonStringifyData(input.context)
  const existing = run.resources.materializedSkillContexts.find((binding) =>
    sameSkillIdentity(binding.context, input.context)
  )
  if (existing) {
    if (
      existing.tapeIncarnationId === input.tapeIncarnationId &&
      existing.effectiveContent === input.effectiveContent &&
      existing.completeBodyFragment === input.completeBodyFragment &&
      existing.projectionKey === projectionKey &&
      JSON.stringify(existing.context) === JSON.stringify(input.context)
    ) {
      return
    }
    throw new Error('Materialized Skill context identity was registered with conflicting evidence.')
  }
  if (
    run.resources.materializedSkillContexts.length + run.resources.runtimeSkillContexts.length >=
    MAX_SKILL_CONTEXTS_PER_VIEW
  ) {
    throw new Error('Skill context limit was exceeded for one provider View.')
  }
  bindProviderProjectionIdentity(providerMessage, projectionKey, input.completeBodyFragment)
  run.resources.materializedSkillContexts.push({
    effectiveContent: input.effectiveContent,
    completeBodyFragment: input.completeBodyFragment,
    projectionKey,
    tapeIncarnationId: input.tapeIncarnationId,
    context: input.context
  })
}

export function registerRuntimeSkillContext(
  run: LoopRun<unknown>,
  input: {
    identity: TapeSkillIdentity
    toolCallId: string
    entryId: number
    tapeIncarnationId: string
    contentHash: string
    executionRef: DeepChatTapeSkillMaterializationRef
  }
): void {
  if (!run.resources.tapeIncarnationId) {
    throw new Error('Loop Run is not bound to a Session Tape incarnation.')
  }
  if (run.resources.tapeIncarnationId !== input.tapeIncarnationId) {
    throw new Error('Runtime Skill context belongs to another Session Tape incarnation.')
  }
  if (
    !input.executionRef ||
    input.executionRef.tapeIncarnationId !== input.tapeIncarnationId ||
    input.executionRef.agentId !== input.identity.agentId ||
    input.executionRef.sourceType !== input.identity.sourceType ||
    input.executionRef.sourceId !== input.identity.sourceId ||
    input.executionRef.skillName !== input.identity.skillName
  ) {
    throw new Error('Runtime Skill execution package does not match its activation identity.')
  }
  const executionRef = Object.freeze({ ...input.executionRef })
  const authoritativeRef = Object.freeze({
    kind: 'tool_result' as const,
    entryId: input.entryId,
    contentHash: input.contentHash
  })
  const sourceEntryIds: number[] = []
  Object.freeze(sourceEntryIds)
  const context: DeepChatTapeRuntimeViewSkillContextV7 = {
    activationScope: 'runtime_view',
    ...input.identity,
    authoritativeRef,
    executionRef,
    providerRole: 'tool',
    sourceEntryIds,
    projectedContentHash: input.contentHash,
    projectionVersion: 1,
    deduplicationSource: 'runtime_view'
  }
  validateSchema7SkillContexts([context])
  Object.freeze(context)
  if (
    run.resources.materializedSkillContexts.some((binding) =>
      sameSkillIdentity(binding.context, context)
    )
  ) {
    throw new Error('Runtime Skill context duplicates an already materialized Skill context.')
  }
  const existing = run.resources.runtimeSkillContexts.find((binding) =>
    sameSkillIdentity(binding.context, context)
  )
  if (existing) {
    if (
      existing.toolCallId === input.toolCallId &&
      existing.context.authoritativeRef.entryId === input.entryId &&
      existing.context.projectedContentHash === input.contentHash &&
      canonicalJsonStringifyData(existing.context.executionRef) ===
        canonicalJsonStringifyData(input.executionRef)
    ) {
      return
    }
    throw new Error('Runtime Skill context identity was activated with conflicting evidence.')
  }
  if (
    run.resources.materializedSkillContexts.length + run.resources.runtimeSkillContexts.length >=
    MAX_SKILL_CONTEXTS_PER_VIEW
  ) {
    throw new Error('Skill context limit was exceeded for one provider View.')
  }
  run.resources.runtimeSkillContexts.push({ toolCallId: input.toolCallId, context })
}

export function resolveSkillContextsForRequest(
  run: LoopRun<unknown>,
  messages: readonly ChatMessage[]
): DeepChatTapeSkillContext[] {
  if (
    run.resources.materializedSkillContexts.length === 0 &&
    run.resources.runtimeSkillContexts.length === 0
  ) {
    return []
  }

  const messagesByProjectionKey = new Map<string, ChatMessage[]>()
  for (const message of messages) {
    for (const projectionKey of getProviderProjectionIdentities(message)) {
      const projections = messagesByProjectionKey.get(projectionKey) ?? []
      projections.push(message)
      messagesByProjectionKey.set(projectionKey, projections)
    }
  }
  const materializedContexts = run.resources.materializedSkillContexts.map((binding) => {
    const providerMessages = messagesByProjectionKey.get(binding.projectionKey) ?? []
    if (
      providerMessages.length !== 1 ||
      providerMessages[0].role !== binding.context.providerRole
    ) {
      throw new Error(
        'Materialized Skill context must have exactly one Tape-backed provider projection.'
      )
    }
    return binding.context
  })

  const toolMessagesByCallId = new Map<string, ChatMessage | null>()
  for (const message of messages) {
    if (message.role !== 'tool' || !message.tool_call_id) continue
    toolMessagesByCallId.set(
      message.tool_call_id,
      toolMessagesByCallId.has(message.tool_call_id) ? null : message
    )
  }
  const runtimeContexts = run.resources.runtimeSkillContexts.flatMap((binding) => {
    const toolMessage = toolMessagesByCallId.get(binding.toolCallId)
    if (toolMessage === undefined) {
      throw new Error('Runtime Skill context is missing from the provider request projection.')
    }
    if (toolMessage === null) {
      throw new Error('Runtime Skill context has ambiguous provider tool-result projections.')
    }
    if (
      typeof toolMessage.content !== 'string' ||
      hashSkillEffectiveContent(toolMessage.content) !== binding.context.projectedContentHash
    ) {
      throw new Error('Runtime Skill context projection drifted from its Tape-backed tool result.')
    }
    return [binding.context]
  })
  return [...materializedContexts, ...runtimeContexts]
}

export function collectRuntimeSkillViewProjections(
  messages: readonly ChatMessage[],
  currentMessageBlocks: readonly AssistantMessageBlock[]
): TapeRuntimeSkillViewProjection[] {
  const currentResults = new Map<
    string,
    Pick<TapeRuntimeSkillViewProjection, 'responseText' | 'blockIndex' | 'timestamp'>
  >()
  for (const [blockIndex, block] of currentMessageBlocks.entries()) {
    if (
      block.type !== 'tool_call' ||
      block.status !== 'success' ||
      block.tool_call?.name !== 'skill_view' ||
      !block.tool_call.id ||
      typeof block.tool_call.response !== 'string'
    ) {
      continue
    }
    if (Buffer.byteLength(block.tool_call.response, 'utf8') > MAX_SKILL_VIEW_RESULT_FACT_BYTES) {
      throw new Error('Runtime Skill-view provider projection exceeds its recovery byte limit.')
    }
    let payload: unknown
    try {
      payload = JSON.parse(block.tool_call.response) as unknown
    } catch {
      continue
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue
    const result = payload as Record<string, unknown>
    if (result.activationEvidenceVersion !== 1) continue
    if (
      result.activatedForMessage !== true ||
      result.activationScope !== 'message' ||
      currentResults.has(block.tool_call.id) ||
      currentResults.size >= MAX_SKILL_CONTEXTS_PER_VIEW ||
      !Number.isSafeInteger(block.timestamp) ||
      block.timestamp < 0
    ) {
      throw new Error('Runtime Skill-view provider projection is invalid or ambiguous.')
    }
    currentResults.set(block.tool_call.id, {
      responseText: block.tool_call.response,
      blockIndex,
      timestamp: block.timestamp
    })
  }
  if (currentResults.size === 0) return []

  const providerResults = new Map<string, string | null>()
  for (const message of messages) {
    if (
      message.role !== 'tool' ||
      !message.tool_call_id ||
      !currentResults.has(message.tool_call_id) ||
      typeof message.content !== 'string'
    ) {
      continue
    }
    providerResults.set(
      message.tool_call_id,
      providerResults.has(message.tool_call_id) ? null : message.content
    )
  }
  return [...currentResults].flatMap(([toolCallId, projection]) => {
    const providerResult = providerResults.get(toolCallId)
    if (providerResult === undefined) {
      throw new Error('Runtime Skill-view provider projection is missing from continuation.')
    }
    if (providerResult === null || providerResult !== projection.responseText) {
      throw new Error('Runtime Skill-view provider projection is invalid or ambiguous.')
    }
    return [{ toolCallId, ...projection }]
  })
}

export function enterLogicalRound(run: LoopRun<unknown>): number {
  const nextLogicalRound = run.logicalRound + 1
  if (!Number.isSafeInteger(nextLogicalRound) || nextLogicalRound <= 0) {
    throw new Error('Provider logical round counter is exhausted.')
  }
  run.logicalRound = nextLogicalRound
  return nextLogicalRound
}

export function advanceRequestSequence(run: LoopRun<unknown>): number {
  const nextRequestSeq = run.requestSeq + 1
  if (!Number.isSafeInteger(nextRequestSeq) || nextRequestSeq <= 0) {
    throw new Error('Provider request sequence is exhausted.')
  }
  run.requestSeq = nextRequestSeq
  run.physicalAttempt = 0
  run.activeRequestContract = null
  run.activeRequestView = null
  return nextRequestSeq
}

export function bindActiveRequestContract(
  run: LoopRun<unknown>,
  requestSeq: number,
  executionContract: DeepChatExecutionContract | null
): LoopRunRequestContractBinding {
  if (requestSeq !== run.requestSeq) {
    throw new Error('Execution contract request sequence does not match the active request.')
  }
  if (
    executionContract &&
    (executionContract.request.sessionId !== run.sessionId ||
      executionContract.request.messageId !== run.messageId ||
      executionContract.request.runId !== run.runId ||
      executionContract.request.requestSeq !== requestSeq)
  ) {
    throw new Error('Execution contract identity does not match the active Loop Run.')
  }
  const binding = Object.freeze({ requestSeq, executionContract })
  run.activeRequestContract = binding
  return binding
}

export function bindActiveRequestView(
  run: LoopRun<unknown>,
  binding: LoopRunRequestViewBinding
): LoopRunRequestViewBinding {
  if (
    binding.requestSeq !== run.requestSeq ||
    !/^[a-f0-9]{64}$/.test(binding.manifestHash) ||
    (binding.tapeIncarnationId !== undefined &&
      (!binding.tapeIncarnationId ||
        binding.tapeIncarnationId !== binding.tapeIncarnationId.trim() ||
        binding.tapeIncarnationId !== binding.tapeIncarnationId.normalize('NFC')))
  ) {
    throw new Error('ViewManifest identity does not match the active provider request.')
  }
  const normalized = Object.freeze({
    requestSeq: binding.requestSeq,
    manifestHash: binding.manifestHash,
    ...(binding.tapeIncarnationId === undefined
      ? {}
      : { tapeIncarnationId: binding.tapeIncarnationId })
  })
  run.activeRequestView = normalized
  return normalized
}

export function enterPhysicalAttempt(run: LoopRun<unknown>): number {
  if (!Number.isSafeInteger(run.requestSeq) || run.requestSeq <= 0) {
    throw new Error('Provider request sequence must be started before a physical attempt.')
  }
  const nextPhysicalAttempt = run.physicalAttempt + 1
  if (!Number.isSafeInteger(nextPhysicalAttempt) || nextPhysicalAttempt <= 0) {
    throw new Error('Provider physical attempt counter is exhausted.')
  }
  run.physicalAttempt = nextPhysicalAttempt
  return nextPhysicalAttempt
}
