import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { DirectiveContributionManifest, MemoryInjectionManifest } from '@/memory/injection'

export interface MemorySessionHandle {
  readonly sessionId: AppSessionId
}

export interface MemoryContextContribution {
  readonly content: string | null
  readonly manifest: MemoryInjectionManifest | null
  readonly anchorEntryId: number | null
}

export interface DirectiveContextContribution {
  readonly content: string | null
  readonly manifest: DirectiveContributionManifest | null
  readonly anchorEntryId: number | null
}

export interface MemoryPromptContribution {
  readonly memory: MemoryContextContribution
  readonly directives: DirectiveContextContribution
}

export const EMPTY_MEMORY_CONTEXT_CONTRIBUTION: MemoryContextContribution = Object.freeze({
  content: null,
  manifest: null,
  anchorEntryId: null
})

export const EMPTY_DIRECTIVE_CONTEXT_CONTRIBUTION: DirectiveContextContribution = Object.freeze({
  content: null,
  manifest: null,
  anchorEntryId: null
})

export const EMPTY_MEMORY_PROMPT_CONTRIBUTION: MemoryPromptContribution = Object.freeze({
  memory: EMPTY_MEMORY_CONTEXT_CONTRIBUTION,
  directives: EMPTY_DIRECTIVE_CONTEXT_CONTRIBUTION
})

export interface MemoryPromptContributor {
  contribute(input: {
    readonly session: MemorySessionHandle
    readonly query: string
    readonly messageId?: string | null
  }): Promise<MemoryPromptContribution>
}
