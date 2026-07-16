import type { PendingInputEnqueueSource, SendMessageInput } from '@shared/types/agent-interface'

export interface AgentSessionSendInput {
  content: SendMessageInput
  context?: {
    projectDir?: string | null
    emitRefreshBeforeStream?: boolean
    maxProviderRounds?: number
  }
  queue?: {
    source: PendingInputEnqueueSource
    projectDir?: string | null
  }
}
