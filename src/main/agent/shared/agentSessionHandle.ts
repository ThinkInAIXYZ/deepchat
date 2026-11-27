import type { PendingInputEnqueueSource, SendMessageInput } from '@shared/types/agent-interface'

export interface AgentSessionSendInput {
  content: SendMessageInput
  context?: {
    projectDir?: string | null
    emitRefreshBeforeStream?: boolean
    maxProviderRounds?: number
    preserveResolvedRepresentations?: boolean
    beforeHistoryPreparation?: () => void | Promise<void>
    reuseUserMessage?: { messageId: string; orderSeq: number; createdAt: number }
    requireIdle?: boolean
    acpResumePolicy?: {
      requirePersistedSession: boolean
      discardOnFailure: boolean
    }
    signal?: AbortSignal
  }
  queue?: {
    source: PendingInputEnqueueSource
    projectDir?: string | null
    submissionId?: string
  }
}
