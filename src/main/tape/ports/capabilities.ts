import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type {
  DeepChatTapeSkillContext,
  DeepChatTapeViewManifest,
  DeepChatTapeViewManifestRecord
} from '@shared/types/tape-view-manifest'
import type { DeepChatNestedExecutionAudit } from '@shared/types/execution-journal-audit'
import type { DeepChatTapeEntryRow, TapeAnchorAppendInput } from '../domain/entry'
import type {
  TapeEntryRef,
  TapeMessageReplacementOptions,
  TapeToolFactInput
} from '../domain/facts'
import type { TapeProviderAttemptInput } from '../domain/providerAttempt'
import type {
  TapeSkillMaterializationInput,
  TapeSkillMaterializationRef,
  TapeSkillMaterializationReceipt
} from '../domain/skillMaterialization'
import type {
  TapeRuntimeSkillViewContextReceipt,
  TapeRuntimeSkillViewRecoveryInput,
  TapeSkillViewResultFactInput,
  TapeSkillViewResultFactReceipt
} from '../domain/skillContext'
import type {
  CommitExecutionDispatchInput,
  CommitExecutionRunStartedInput,
  CommitExecutionRunTerminalInput,
  CommitExecutionToolOutcomeInput,
  CommitNestedExecutionDispatchInput,
  CommitNestedExecutionToolOutcomeInput,
  ExecutionJournalCommitReceipt,
  ExecutionRecoveryReport
} from '../domain/executionJournal'
import type {
  CreateTapeProgrammaticToolSurfaceFactInput,
  CreateTapeToolCatalogFactInput,
  CreateTapeToolSurfaceFactInput,
  TapeToolCatalogFactReference,
  TapeToolResultFactReference,
  TapeToolSurfaceFact
} from '../domain/toolSurfaceFacts'

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
  listViewManifestsByMessageRequest(
    sessionId: string,
    messageId: string,
    requestSeq: number
  ): DeepChatTapeViewManifestRecord[]
}

export interface TapeExecutionViewManifestReader {
  getViewManifestByExecutionBinding(input: {
    sessionId: string
    runId: string
    requestSeq: number
  }): DeepChatTapeViewManifestRecord | null
}

export interface TapeSkillRequestAuthorityBinding {
  readonly sessionId: string
  readonly messageId: string
  readonly runId: string
  readonly requestSeq: number
  readonly manifestHash: string
  readonly tapeIncarnationId: string
  readonly promptHash: string
  readonly toolDefinitionsHash: string
  readonly skillContexts: readonly DeepChatTapeSkillContext[]
}

export interface TapeSkillRequestAuthorityReader {
  assertSkillRequestAuthority(input: TapeSkillRequestAuthorityBinding): void
}

export interface TapeRunViewManifestReader {
  getLatestViewManifestByRunBinding(input: {
    sessionId: string
    messageId: string
    runId: string
  }): DeepChatTapeViewManifestRecord | null
}

export interface TapeEffectiveUserMessageSourceReader {
  getEffectiveUserMessageSourceEntryId(sessionId: string, messageId: string): number | null
}

export interface TapeViewManifestWriter {
  appendViewManifest(manifest: DeepChatTapeViewManifest): void
}

export interface CommitTapeToolSurfaceViewInput {
  readonly manifest: DeepChatTapeViewManifest
  /** Exact provider-ordered definitions used to build the manifest; never persisted by this API. */
  readonly activeToolDefinitions: readonly MCPToolDefinition[]
  readonly catalog: CreateTapeToolCatalogFactInput
  readonly surface: Omit<CreateTapeToolSurfaceFactInput, 'manifestHash' | 'catalog'>
  /** Explicitly null outside CLI Programmatic Views. */
  readonly programmaticSurface: Omit<
    CreateTapeProgrammaticToolSurfaceFactInput,
    'manifestHash' | 'catalog' | 'contractBearing'
  > | null
}

export interface TapeToolSurfaceViewCommitReceipt {
  readonly tapeIncarnationId: string
  readonly manifest: {
    readonly sessionId: string
    readonly entryId: number
    readonly manifestHash: string
    readonly created: boolean
  }
  readonly catalog: TapeToolCatalogFactReference & { readonly created: boolean }
  readonly surface: {
    readonly sessionId: string
    readonly tapeIncarnationId: string
    readonly entryId: number
    readonly surfaceHash: string
    readonly created: boolean
  }
  readonly programmaticSurface: {
    readonly sessionId: string
    readonly tapeIncarnationId: string
    readonly entryId: number
    readonly capabilityHash: string
    readonly programmaticSurfaceHash: string
    readonly factHash: string
    readonly created: boolean
  } | null
}

export interface TapeToolSurfaceViewWriter {
  commitToolSurfaceView(input: CommitTapeToolSurfaceViewInput): TapeToolSurfaceViewCommitReceipt
}

export interface TapeToolSurfaceFactRecord {
  readonly entryId: number
  readonly fact: TapeToolSurfaceFact
}

/** Recovery-only reader. Ordinary tool dispatch must use its process-live capability snapshot. */
export interface TapeToolSurfaceViewReader {
  listToolSurfaceFactsByMessage(sessionId: string, messageId: string): TapeToolSurfaceFactRecord[]
  listToolSurfaceFactsByMessageRequest(
    sessionId: string,
    messageId: string,
    requestSeq: number
  ): TapeToolSurfaceFactRecord[]
}

export interface TapeToolFactAppendReceipt extends TapeEntryRef {
  /** Present only for a ToolSearch result in a canonical Tape incarnation. */
  readonly toolResult: TapeToolResultFactReference | null
}

export interface TapeToolFactWriter {
  appendToolFact(input: TapeToolFactInput): Promise<TapeToolFactAppendReceipt>
}

export interface TapeIncarnationReader {
  getTapeIncarnationId(sessionId: string): string
}

export interface TapeSkillViewResultFactWriter {
  appendSkillViewResultFact(input: TapeSkillViewResultFactInput): TapeSkillViewResultFactReceipt
}

export interface TapeRuntimeSkillViewContextReader {
  recoverRuntimeSkillViewContexts(
    input: TapeRuntimeSkillViewRecoveryInput
  ): TapeRuntimeSkillViewContextReceipt[]
}

export interface TapeSkillMaterializationWriter {
  materializeSkillContexts(
    inputs: readonly TapeSkillMaterializationInput[]
  ): TapeSkillMaterializationReceipt[]
}

export interface TapeSkillMaterializationReader {
  readSkillMaterialization(ref: TapeSkillMaterializationRef): TapeSkillMaterializationReceipt
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

/** Reserved for process-live parent runtimes; ordinary tools do not receive it. */
export interface NestedExecutionJournalWriter {
  commitNestedDispatch(input: CommitNestedExecutionDispatchInput): ExecutionJournalCommitReceipt
  commitNestedToolOutcome(
    input: CommitNestedExecutionToolOutcomeInput
  ): ExecutionJournalCommitReceipt
}

export interface ExecutionJournalRecoveryReader {
  classifyRecoveryCandidates(): ExecutionRecoveryReport[]
  /**
   * Recovery-only replay fence. Deferred T1 uses a fresh physical Run identity, so Journal v1
   * conservatively treats any matching message/tool-call dispatch as spent. Ordinary dispatch
   * must not query Journal facts.
   */
  hasAnyCommittedDispatchForMessageToolCall(
    sessionId: string,
    messageId: string,
    providerToolCallId: string
  ): boolean
}

/** Read-only historical projection for renderer audit; never grants or participates in dispatch. */
export interface ExecutionJournalAuditReader {
  listNestedExecutionAuditForMessage(
    sessionId: string,
    messageId: string
  ): DeepChatNestedExecutionAudit
  listMessageIdsWithNestedExecutionAudit(
    sessionId: string,
    messageIds: readonly string[]
  ): readonly string[]
}

// The DeepChat provider loop needs the coordinated Tape contract as one collaborator; splitting it
// into individual fields describes the capability types rather than the dependency.
export interface DeepChatLoopTapePort
  extends
    TapeReconciliationPort,
    TapeViewManifestReader,
    TapeExecutionViewManifestReader,
    TapeSkillRequestAuthorityReader,
    TapeViewManifestWriter,
    TapeToolSurfaceViewWriter,
    TapeToolFactWriter,
    TapeIncarnationReader,
    TapeSkillViewResultFactWriter,
    TapeRuntimeSkillViewContextReader,
    TapeProviderAttemptWriter,
    TapeProviderAttemptReader,
    ExecutionJournalWriter,
    NestedExecutionJournalWriter {}

export interface TapeMessageFactWriter {
  appendMessageRecord(record: ChatMessageRecord): number
  appendMessageReplacement(
    record: ChatMessageRecord,
    options: TapeMessageReplacementOptions
  ): number
  appendMessageRetraction(record: ChatMessageRecord, reason: string): number
}

export interface TapeNonContextEntryReader {
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
