import type { AppSessionId } from '@/agent/shared/agentSessionIds'

export interface MemorySessionHandle {
  readonly sessionId: AppSessionId
}

export interface MemoryPromptContributor {
  contribute(input: {
    readonly session: MemorySessionHandle
    readonly basePrompt: string
    readonly query: string
    readonly messageId?: string | null
  }): Promise<string>
}
