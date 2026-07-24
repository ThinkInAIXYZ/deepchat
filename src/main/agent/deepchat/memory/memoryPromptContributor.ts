import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { MemoryInjectionManifest } from '@/memory/injection'

export interface MemorySessionHandle {
  readonly sessionId: AppSessionId
}

export interface MemoryPromptContribution {
  readonly content: string | null
  readonly manifest: MemoryInjectionManifest | null
  readonly anchorEntryId: number | null
}

export const EMPTY_MEMORY_PROMPT_CONTRIBUTION: MemoryPromptContribution = Object.freeze({
  content: null,
  manifest: null,
  anchorEntryId: null
})

export interface MemoryPromptContributor {
  contribute(input: {
    readonly session: MemorySessionHandle
    readonly query: string
    readonly messageId?: string | null
  }): Promise<MemoryPromptContribution>
}
