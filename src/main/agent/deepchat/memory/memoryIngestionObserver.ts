import type { MemorySessionHandle } from './memoryPromptContributor'

export type MemoryTurnStatus = 'completed' | 'paused' | 'aborted' | 'error'

export type MemoryTurnOutcome =
  | { readonly kind: 'returned'; readonly status: MemoryTurnStatus }
  | { readonly kind: 'thrown'; readonly error: unknown }

export interface MemoryIngestionDrainOutcome {
  readonly timedOut: boolean
  readonly pendingSessions: readonly string[]
}

export interface MemoryIngestionObserver {
  afterTurnSettled(input: {
    readonly session: MemorySessionHandle
    readonly origin: 'initial' | 'resume'
    readonly outcome: MemoryTurnOutcome
  }): void

  afterCompactionApplyReturned(input: {
    readonly session: MemorySessionHandle
    readonly origin: 'initial' | 'context-pressure'
    readonly targetCursorOrderSeq: number
  }): void

  drainAndFence(): Promise<MemoryIngestionDrainOutcome>

  resumeIngestion(): void
}
