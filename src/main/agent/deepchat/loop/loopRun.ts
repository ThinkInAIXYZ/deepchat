import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'

export interface LoopRunResources {
  toolDefinitions: MCPToolDefinition[]
  activeSkillNames: string[]
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
  requestSeq: number
  providerRoundCount: number
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
  }
  initialRequestSeq?: number
  startedAt?: number
}

export function createLoopRun<TStreamState>(
  input: CreateLoopRunInput<TStreamState>
): LoopRun<TStreamState> {
  const initialRequestSeq = input.initialRequestSeq ?? 0
  return {
    runId: input.runId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    abortController: input.abortController,
    startedAt: input.startedAt ?? Date.now(),
    initialRequestSeq,
    requestSeq: initialRequestSeq,
    providerRoundCount: 0,
    messages: [...input.messages],
    streamState: input.streamState,
    resources: {
      toolDefinitions: [...input.resources.toolDefinitions],
      activeSkillNames: [...input.resources.activeSkillNames]
    },
    providerRecovery: {
      contextOverflowHandoffAttempted: false,
      strictProviderOverflowRetryUsed: false
    }
  }
}

export function enterProviderRound(run: LoopRun<unknown>): number {
  run.providerRoundCount += 1
  return run.providerRoundCount
}

export function advanceRequestSequence(run: LoopRun<unknown>): number {
  const nextRequestSeq = run.requestSeq + 1
  if (!Number.isSafeInteger(nextRequestSeq) || nextRequestSeq <= 0) {
    throw new Error('Provider request sequence is exhausted.')
  }
  run.requestSeq = nextRequestSeq
  return nextRequestSeq
}
