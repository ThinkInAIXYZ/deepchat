import type {
  AttachmentPreparationSummary,
  MessageStartResult,
  PendingInputEnqueueSource,
  PendingSessionInputRecord
} from '@shared/types/agent-interface'

export type PendingInputTurnSource = PendingInputEnqueueSource | 'steer'

export type ClaimedInputDisposition =
  | { kind: 'consume' }
  | { kind: 'block'; attachmentPreparation: AttachmentPreparationSummary }
  | { kind: 'release-before-user-fact' }
  | { kind: 'release-after-rollback' }

export type ClaimedInputSettlementResult<TDisposition extends ClaimedInputDisposition> =
  TDisposition extends { kind: 'consume' } ? null : PendingSessionInputRecord

export interface ClaimedPendingInputHandle {
  readonly id: string
  readonly source: PendingInputTurnSource
  readonly messageIds: string[]
  readonly assistantMessageId: string | null
  readonly disposition: ClaimedInputDisposition | null

  settle<TDisposition extends ClaimedInputDisposition>(
    disposition: TDisposition
  ): ClaimedInputSettlementResult<TDisposition>
}

export interface TurnCompletion {
  readonly messageStart: MessageStartResult
  readonly claimedInputDisposition: ClaimedInputDisposition | null
}
