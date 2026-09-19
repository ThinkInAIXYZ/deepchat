import type {
  PendingInputEnqueueSource,
  SendMessageInput
} from '@deepchat/shared/types/agent-interface'

export interface AgentSessionSendInput {
  content: SendMessageInput
  context?: {
    projectDir?: string | null
    emitRefreshBeforeStream?: boolean
    maxProviderRounds?: number
    preserveResolvedRepresentations?: boolean
    beforeHistoryPreparation?: () => void
    signal?: AbortSignal
  }
  queue?: {
    source: PendingInputEnqueueSource
    projectDir?: string | null
  }
}
