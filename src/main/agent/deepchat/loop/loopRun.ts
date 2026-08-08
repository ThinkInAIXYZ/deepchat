import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import { ResolvedCommandShellSchema, type ResolvedCommandShell } from '@shared/commandShell'

export interface LoopRunResources {
  toolDefinitions: MCPToolDefinition[]
  activeSkillNames: string[]
  commandShell: ResolvedCommandShell
}

export interface LoopRunProviderRecovery {
  contextOverflowHandoffAttempted: boolean
  strictProviderOverflowRetryUsed: boolean
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
      commandShell
    },
    providerRecovery: {
      contextOverflowHandoffAttempted: false,
      strictProviderOverflowRetryUsed: false
    }
  }
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
  return nextRequestSeq
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
