import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type {
  DeepChatTapeViewManifest,
  DeepChatTapeViewManifestRecord
} from '@shared/types/tape-view-manifest'
import type { DeepChatTapeEntryRow, TapeAnchorAppendInput } from '../domain/entry'
import type {
  TapeEntryRef,
  TapeMessageReplacementOptions,
  TapeToolFactInput
} from '../domain/facts'
import type { TapeProviderAttemptInput } from '../domain/providerAttempt'
import type {
  CommitExecutionDispatchInput,
  CommitExecutionRunStartedInput,
  CommitExecutionRunTerminalInput,
  CommitExecutionToolOutcomeInput,
  ExecutionJournalCommitReceipt,
  ExecutionRecoveryReport
} from '../domain/executionJournal'

export type TapeMigrationState = 'none' | 'ready'

export type TapeBackfillResult = {
  sessionId: string
  migrationState: TapeMigrationState
  messageCount: number
  maxOrderSeq: number
  appendedFactCount: number
  historyRecords: ChatMessageRecord[]
}

export interface TapeTranscriptReader {
  getMessages(sessionId: string): ChatMessageRecord[]
}

export interface TapeReconciliationPort {
  ensureSessionTapeReady(sessionId: string, messageStore: TapeTranscriptReader): TapeBackfillResult
}

export type TapeViewManifestAssemblySources = {
  latestEntryId: number
  anchorEntryIds: number[]
  reconstructionAnchorEntryIds: number[]
  reconstructionAnchorEntryId: number | null
  entryIdByMessageId: Map<string, number>
  toolCallEntryIdByToolId: Map<string, number>
  toolResultEntryIdByToolId: Map<string, number>
}

export interface TapeViewManifestReader {
  getViewManifestSourceMaps(sessionId: string, messageId?: string): TapeViewManifestAssemblySources
  listViewManifestsByMessage(sessionId: string, messageId: string): DeepChatTapeViewManifestRecord[]
}

export interface TapeViewManifestWriter {
  appendViewManifest(manifest: DeepChatTapeViewManifest): void
}

export interface TapeToolFactWriter {
  appendToolFact(input: TapeToolFactInput): Promise<TapeEntryRef>
}

export interface TapeProviderAttemptWriter {
  appendProviderAttempt(input: TapeProviderAttemptInput): void
}

export interface TapeProviderAttemptReader {
  getMaxProviderAttemptRequestSeq(sessionId: string, messageId: string): number
}

export interface ExecutionJournalWriter {
  commitRunStarted(input: CommitExecutionRunStartedInput): ExecutionJournalCommitReceipt
  commitDispatch(input: CommitExecutionDispatchInput): ExecutionJournalCommitReceipt
  commitToolOutcome(input: CommitExecutionToolOutcomeInput): ExecutionJournalCommitReceipt
  commitRunTerminal(input: CommitExecutionRunTerminalInput): ExecutionJournalCommitReceipt
}

export interface ExecutionJournalRecoveryReader {
  classifyRecoveryCandidates(): ExecutionRecoveryReport[]
}

// The DeepChat provider loop needs the coordinated Tape contract as one collaborator; splitting it
// into individual fields describes the capability types rather than the dependency.
export interface DeepChatLoopTapePort
  extends
    TapeReconciliationPort,
    TapeViewManifestReader,
    TapeViewManifestWriter,
    TapeToolFactWriter,
    TapeProviderAttemptWriter,
    TapeProviderAttemptReader,
    ExecutionJournalWriter {}

export interface TapeMessageFactWriter {
  appendMessageRecord(record: ChatMessageRecord): number
  appendMessageReplacement(
    record: ChatMessageRecord,
    options: TapeMessageReplacementOptions
  ): number
  appendMessageRetraction(record: ChatMessageRecord, reason: string): number
}

export interface TapeRawEntryReader {
  getBySession(sessionId: string): DeepChatTapeEntryRow[]
}

export interface TapeAnchorReader {
  getLatestReconstructionAnchor(sessionId: string): DeepChatTapeEntryRow | undefined
}

export interface TapeAnchorWriter {
  /**
   * Compound Session settings updates require this writer to share the caller's synchronous
   * SQLite connection and transaction context. Cross-connection or asynchronous adapters cannot
   * preserve summary-and-anchor atomicity.
   */
  appendAnchor(input: TapeAnchorAppendInput): DeepChatTapeEntryRow
}

export interface TapeInspectionReader {
  getEffectiveMessageSourceSpan(
    sessionId: string,
    entryIds: number[]
  ): TapeEffectiveMessageSourceEntry[]
  listMemoryViewManifestsByAgent(
    agentId: string,
    options?: { sessionId?: string; limit?: number; messageId?: string }
  ): TapeMemoryViewManifestInspection[]
}

export interface TapeEffectiveMessageSourceEntry {
  entryId: number
  record: Pick<ChatMessageRecord, 'role' | 'content' | 'orderSeq'>
}

export interface TapeMemoryViewManifestInspection {
  sessionId: string
  messageId: string | null
  entryId: number
  policyVersion: number | null
  tokenBudget: number
  estimatedTokens: number
  selectedCount: number
  selectedIds: string[] | null
  droppedCount: number
  queryHash: string | null
  allocation?: TapeMemoryContributionBudgetInspection | null
  createdAt: number
}

export interface TapeMemoryContributionTokenInspection {
  directive: number
  persona: number
  working: number
  queryRecall: number
}

export interface TapeMemoryContributionBudgetInspection {
  policyVersion: number
  totalTokenBudget: number
  overheadTokens: number
  demand: TapeMemoryContributionTokenInspection
  allocated: TapeMemoryContributionTokenInspection
  used: TapeMemoryContributionTokenInspection
  borrowed: TapeMemoryContributionTokenInspection
  unallocatedTokens: number
  estimatedTotalTokens: number
  unusedTokens: number
  constrained: boolean
}

export interface TapeLifecycleAdmin {
  initializeSessionTape(sessionId: string): void
  deleteSessionTape(sessionId: string): void
  resetSessionTape(sessionId: string): void
}
