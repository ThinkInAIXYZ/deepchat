import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AgentSessionSendInput } from '@/agent/shared/agentSessionHandle'
import type {
  DeepChatSessionState,
  IAgentImplementation,
  MessageStartResult
} from '@shared/types/agent-interface'

export interface DeepChatAgentInstanceDelegate {
  readonly compatibilityImplementation: IAgentImplementation
  send(input: AgentSessionSendInput): Promise<MessageStartResult>
  cancel(): Promise<void>
  snapshot(options?: { lightweight?: boolean }): Promise<DeepChatSessionState | null>
  close(): Promise<void>
}

export class DeepChatAgentInstance {
  readonly kind = 'deepchat' as const

  constructor(
    readonly sessionId: AppSessionId,
    private readonly delegate: DeepChatAgentInstanceDelegate,
    private readonly onClosed: (instance: DeepChatAgentInstance) => void
  ) {}

  get compatibilityImplementation(): IAgentImplementation {
    return this.delegate.compatibilityImplementation
  }

  async send(input: AgentSessionSendInput): Promise<MessageStartResult> {
    return await this.delegate.send(input)
  }

  async cancel(): Promise<void> {
    await this.delegate.cancel()
  }

  async snapshot(options?: { lightweight?: boolean }): Promise<DeepChatSessionState | null> {
    return await this.delegate.snapshot(options)
  }

  async close(): Promise<void> {
    try {
      await this.delegate.close()
    } finally {
      this.onClosed(this)
    }
  }
}
