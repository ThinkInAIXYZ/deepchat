import type {
  AgentTapeAnchorsOptions,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeHandoffState,
  AgentTapeSearchOptions,
  ChatMessageRecord,
  SubagentTapeLinkInput,
  SubagentTapeLinkReceipt
} from '@shared/types/agent-interface'
import type {
  DeepChatTapeViewManifest,
  DeepChatTapeViewManifestRecord
} from '@shared/types/tape-view-manifest'
import type {
  DeepChatCausalObservationReadOptions,
  DeepChatCausalObservationSlice,
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice
} from '@shared/types/tape-replay'
import type { DeepChatNestedExecutionAudit } from '@shared/types/execution-journal-audit'
import type {
  ExportTapeInspectorSupportFactsInput,
  ExportTapeInspectorSupportFactsOutput,
  GetTapeInspectorRecordDetailInput,
  GetTapeInspectorRecordDetailOutput,
  ListTapeInspectorPageInput,
  ListTapeInspectorPageOutput,
  ResolveTapeInspectorEvidenceEntriesInput,
  ResolveTapeInspectorEvidenceEntriesOutput,
  TapeInspectorHead
} from '@shared/types/tape-inspector'
import type { DeepChatTapeEntryRow, TapeAnchorAppendInput } from '../domain/entry'
import type { TapeMessageReplacementOptions, TapeToolFactInput } from '../domain/facts'
import type {
  TapeProviderAttemptInput,
  TapeProviderContextPressureRecord
} from '../domain/providerAttempt'
import type {
  TapeCompactionModelCallInput,
  TapeCompactionModelCallReceipt
} from '../domain/compactionUsage'
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
  ExecutionJournalCommitReceipt,
  ExecutionRecoveryReport
} from '../domain/executionJournal'
import type {
  TapeAnchorReader,
  TapeAnchorWriter,
  TapeEffectiveMessageSourceEntry,
  TapeEffectiveUserMessageSourceReader,
  TapeExecutionViewManifestReader,
  TapeIncarnationReader,
  TapeInspectionReader,
  TapeSessionInspectionReader,
  TapeLifecycleAdmin,
  TapeMessageFactWriter,
  TapeProviderAttemptReader,
  TapeProviderAttemptWriter,
  TapeCompactionModelCallReader,
  TapeCompactionModelCallWriter,
  TapeToolSurfaceViewReader,
  TapeToolSurfaceViewWriter,
  ExecutionJournalAuditReader,
  TapeRunViewManifestReader,
  TapeRuntimeSkillViewContextReader,
  TapeSkillViewResultFactWriter,
  TapeSkillRequestAuthorityBinding,
  TapeSkillRequestAuthorityReader,
  TapeSkillMaterializationReader,
  TapeSkillMaterializationWriter,
  ExecutionJournalRecoveryReader,
  ExecutionJournalWriter,
  TapeNonContextEntryReader,
  TapeReconciliationPort,
  TapeToolFactAppendReceipt,
  TapeToolFactWriter,
  TapeTranscriptReader,
  TapeMemoryViewManifestInspection,
  CommitTapeToolSurfaceViewInput,
  TapeToolSurfaceViewCommitReceipt,
  TapeViewManifestReader,
  TapeViewManifestWriter
} from '../ports/capabilities'
import {
  createTapeApplicationProviders,
  type TapeApplicationDatabase,
  type TapeApplicationProviders
} from '../ports/application'
import type {
  TapeAnchorResult,
  TapeBackfillResult,
  TapeContextOccupancyEvidence,
  TapeForkHandle,
  TapeInfo,
  TapeMigrationState,
  TapeSearchResult,
  TapeViewManifestAssemblySources
} from './contracts'
import { normalizeTapeHandoffState, TapeFactService } from './factService'
import { TapeForkService } from './forkService'
import { deleteTapeGeneration, resetTapeGeneration } from './generationLifecycle'
import {
  AgentTapeViewError,
  normalizeSubagentTapeLinkInput,
  TapeLineageService,
  type AgentTapeViewErrorCode
} from './lineageService'
import { TapeProviderAttemptService } from './providerAttemptService'
import { TapeCompactionUsageService } from './compactionUsageService'
import { TapeRecallService } from './recallService'
import { TapeReconcilerService } from './reconcilerService'
import { TapeViewReplayService } from './viewReplayService'
import { ExecutionJournalService } from './executionJournalService'
import { ToolSurfaceProvenanceService } from './toolSurfaceProvenanceService'
import { TapeSkillMaterializationService } from './skillMaterializationService'
import { TapeTraceInspectorService } from './traceInspectorService'

export type {
  AgentTapeViewErrorCode,
  TapeAnchorResult,
  TapeBackfillResult,
  TapeForkHandle,
  TapeInfo,
  TapeMigrationState,
  TapeSearchResult,
  TapeViewManifestAssemblySources
}
export { AgentTapeViewError, normalizeSubagentTapeLinkInput, normalizeTapeHandoffState }

export class SessionTape
  implements
    TapeToolFactWriter,
    TapeMessageFactWriter,
    TapeProviderAttemptReader,
    TapeProviderAttemptWriter,
    TapeCompactionModelCallReader,
    TapeCompactionModelCallWriter,
    TapeNonContextEntryReader,
    TapeReconciliationPort,
    TapeViewManifestReader,
    TapeEffectiveUserMessageSourceReader,
    TapeExecutionViewManifestReader,
    TapeSkillRequestAuthorityReader,
    TapeRunViewManifestReader,
    TapeViewManifestWriter,
    TapeToolSurfaceViewReader,
    TapeToolSurfaceViewWriter,
    TapeAnchorReader,
    TapeAnchorWriter,
    TapeInspectionReader,
    TapeSessionInspectionReader,
    TapeLifecycleAdmin,
    ExecutionJournalWriter,
    ExecutionJournalAuditReader,
    ExecutionJournalRecoveryReader,
    TapeIncarnationReader,
    TapeSkillViewResultFactWriter,
    TapeRuntimeSkillViewContextReader,
    TapeSkillMaterializationWriter,
    TapeSkillMaterializationReader
{
  private readonly providers: TapeApplicationProviders
  private readonly facts: TapeFactService
  private readonly reconciler: TapeReconcilerService
  private readonly recall: TapeRecallService
  private readonly lineage: TapeLineageService
  private readonly providerAttempts: TapeProviderAttemptService
  private readonly compactionUsage: TapeCompactionUsageService
  private readonly executionJournal: ExecutionJournalService
  private readonly viewReplay: TapeViewReplayService
  private readonly toolSurfaceProvenance: ToolSurfaceProvenanceService
  private readonly forks: TapeForkService
  private readonly skillMaterializations: TapeSkillMaterializationService
  private readonly traceInspector: TapeTraceInspectorService

  constructor(database: TapeApplicationDatabase) {
    this.providers = createTapeApplicationProviders(database)
    this.facts = new TapeFactService(this.providers)
    this.lineage = new TapeLineageService(this.providers)
    this.providerAttempts = new TapeProviderAttemptService(this.providers)
    this.compactionUsage = new TapeCompactionUsageService(this.providers)
    this.executionJournal = new ExecutionJournalService(
      () => database.deepchatExecutionJournalStore
    )
    this.reconciler = new TapeReconcilerService(this.providers, this.facts)
    this.recall = new TapeRecallService(this.providers, this.lineage)
    this.viewReplay = new TapeViewReplayService(this.providers)
    this.toolSurfaceProvenance = new ToolSurfaceProvenanceService(this.providers, this.viewReplay)
    this.forks = new TapeForkService(this.providers)
    this.skillMaterializations = new TapeSkillMaterializationService(this.providers)
    this.traceInspector = new TapeTraceInspectorService(this.providers)
  }

  ensureSessionTapeReady(
    sessionId: string,
    messageStore: TapeTranscriptReader
  ): TapeBackfillResult {
    return this.reconciler.ensureSessionTapeReady(sessionId, messageStore)
  }

  appendMessageRecord(record: ChatMessageRecord): number {
    return this.facts.appendMessageRecord(record)
  }

  appendMessageReplacement(
    record: ChatMessageRecord,
    options: TapeMessageReplacementOptions
  ): number {
    return this.facts.appendMessageReplacement(record, options)
  }

  appendMessageRetraction(record: ChatMessageRecord, reason: string): number {
    return this.facts.appendMessageRetraction(record, reason)
  }

  appendToolFact(input: TapeToolFactInput): Promise<TapeToolFactAppendReceipt> {
    return this.facts.appendToolFact(input)
  }

  getTapeIncarnationId(sessionId: string): string {
    return this.facts.getTapeIncarnationId(sessionId)
  }

  appendSkillViewResultFact(input: TapeSkillViewResultFactInput): TapeSkillViewResultFactReceipt {
    return this.facts.appendSkillViewResultFact(input)
  }

  recoverRuntimeSkillViewContexts(
    input: TapeRuntimeSkillViewRecoveryInput
  ): TapeRuntimeSkillViewContextReceipt[] {
    return this.viewReplay.recoverRuntimeSkillViewContexts(input)
  }

  materializeSkillContexts(
    inputs: readonly TapeSkillMaterializationInput[]
  ): TapeSkillMaterializationReceipt[] {
    return this.skillMaterializations.materializeSkillContexts(inputs)
  }

  readSkillMaterialization(ref: TapeSkillMaterializationRef): TapeSkillMaterializationReceipt {
    return this.skillMaterializations.readSkillMaterialization(ref)
  }

  appendProviderAttempt(input: TapeProviderAttemptInput): void {
    this.providerAttempts.appendProviderAttempt(input)
  }

  appendCompactionModelCall(input: TapeCompactionModelCallInput): TapeCompactionModelCallReceipt {
    return this.compactionUsage.appendCompactionModelCall(input)
  }

  listCompactionModelCallsPage(
    cursor: { sessionId: string; entryId: number } | null,
    limit: number
  ) {
    return this.compactionUsage.listCompactionModelCallsPage(cursor, limit)
  }

  getMaxProviderAttemptRequestSeq(sessionId: string, messageId: string): number {
    return this.providerAttempts.getMaxProviderAttemptRequestSeq(sessionId, messageId)
  }

  getPendingProviderContextPressure(
    sessionId: string,
    providerId: string,
    modelId: string
  ): TapeProviderContextPressureRecord | null {
    return this.providerAttempts.getPendingProviderContextPressure(sessionId, providerId, modelId)
  }

  getContextOccupancyEvidence(sessionId: string): TapeContextOccupancyEvidence {
    const manifest = this.viewReplay.getLatestViewManifestForSession(sessionId)
    return {
      manifest,
      providerAttempt:
        manifest?.integrity === 'valid'
          ? this.providerAttempts.getLatestProviderAttemptForRequest(
              sessionId,
              manifest.messageId,
              manifest.requestSeq
            )
          : null,
      latestReconstructionAnchorEntryId:
        this.providers.getEntryStore().getLatestReconstructionAnchor(sessionId)?.entry_id ?? null
    }
  }

  commitRunStarted(input: CommitExecutionRunStartedInput): ExecutionJournalCommitReceipt {
    return this.executionJournal.commitRunStarted(input)
  }

  commitDispatch(input: CommitExecutionDispatchInput): ExecutionJournalCommitReceipt {
    return this.executionJournal.commitDispatch(input)
  }

  commitToolOutcome(input: CommitExecutionToolOutcomeInput): ExecutionJournalCommitReceipt {
    return this.executionJournal.commitToolOutcome(input)
  }

  commitRunTerminal(input: CommitExecutionRunTerminalInput): ExecutionJournalCommitReceipt {
    return this.executionJournal.commitRunTerminal(input)
  }

  classifyRecoveryCandidates(): ExecutionRecoveryReport[] {
    return this.executionJournal.classifyRecoveryCandidates()
  }

  listNestedExecutionAuditForMessage(
    sessionId: string,
    messageId: string
  ): DeepChatNestedExecutionAudit {
    return this.executionJournal.listNestedExecutionAuditForMessage(sessionId, messageId)
  }

  listMessageIdsWithNestedExecutionAudit(
    sessionId: string,
    messageIds: readonly string[]
  ): readonly string[] {
    return this.executionJournal.listMessageIdsWithNestedExecutionAudit(sessionId, messageIds)
  }

  hasAnyCommittedDispatchForMessageToolCall(
    sessionId: string,
    messageId: string,
    providerToolCallId: string
  ): boolean {
    return this.executionJournal.hasAnyCommittedDispatchForMessageToolCall(
      sessionId,
      messageId,
      providerToolCallId
    )
  }

  getMessageRecords(sessionId: string): ChatMessageRecord[] {
    return this.facts.getMessageRecords(sessionId)
  }

  info(sessionId: string): TapeInfo {
    return this.recall.info(sessionId)
  }

  search(sessionId: string, query: string, options?: AgentTapeSearchOptions): TapeSearchResult[] {
    return this.recall.search(sessionId, query, options)
  }

  getContext(
    sessionId: string,
    entryIds: number[],
    options: AgentTapeContextOptions = {}
  ): AgentTapeContextResult {
    return this.recall.getContext(sessionId, entryIds, options)
  }

  anchors(sessionId: string, options: AgentTapeAnchorsOptions = {}): TapeAnchorResult[] {
    return this.recall.anchors(sessionId, options)
  }

  getViewManifestSourceMaps(
    sessionId: string,
    messageId?: string
  ): TapeViewManifestAssemblySources {
    return this.viewReplay.getViewManifestSourceMaps(sessionId, messageId)
  }

  getEffectiveUserMessageSourceEntryId(sessionId: string, messageId: string): number | null {
    return this.viewReplay.getEffectiveUserMessageSourceEntryId(sessionId, messageId)
  }

  appendViewManifest(manifest: DeepChatTapeViewManifest): DeepChatTapeEntryRow {
    return this.viewReplay.appendViewManifest(manifest)
  }

  commitToolSurfaceView(input: CommitTapeToolSurfaceViewInput): TapeToolSurfaceViewCommitReceipt {
    return this.toolSurfaceProvenance.commitToolSurfaceView(input)
  }

  listToolSurfaceFactsByMessageRequest(
    sessionId: string,
    messageId: string,
    requestSeq: number
  ): ReturnType<TapeToolSurfaceViewReader['listToolSurfaceFactsByMessageRequest']> {
    return this.toolSurfaceProvenance.listToolSurfaceFactsByMessageRequest(
      sessionId,
      messageId,
      requestSeq
    )
  }

  listToolSurfaceFactsByMessage(
    sessionId: string,
    messageId: string
  ): ReturnType<TapeToolSurfaceViewReader['listToolSurfaceFactsByMessage']> {
    return this.toolSurfaceProvenance.listToolSurfaceFactsByMessage(sessionId, messageId)
  }

  listViewManifestsByMessage(
    sessionId: string,
    messageId: string
  ): DeepChatTapeViewManifestRecord[] {
    return this.viewReplay.listViewManifestsByMessage(sessionId, messageId)
  }

  listViewManifestsByMessageRequest(
    sessionId: string,
    messageId: string,
    requestSeq: number
  ): DeepChatTapeViewManifestRecord[] {
    return this.viewReplay.listViewManifestsByMessageRequest(sessionId, messageId, requestSeq)
  }

  getViewManifestByExecutionBinding(input: {
    sessionId: string
    runId: string
    requestSeq: number
  }): DeepChatTapeViewManifestRecord | null {
    return this.viewReplay.getViewManifestByExecutionBinding(input)
  }

  assertSkillRequestAuthority(input: TapeSkillRequestAuthorityBinding): void {
    this.viewReplay.assertSkillRequestAuthority(input)
  }

  getLatestViewManifestByRunBinding(input: {
    sessionId: string
    messageId: string
    runId: string
  }): DeepChatTapeViewManifestRecord | null {
    return this.viewReplay.getLatestViewManifestByRunBinding(input)
  }

  exportReplaySlice(
    sessionId: string,
    messageId: string,
    options: DeepChatTapeReplayExportOptions = {}
  ): DeepChatTapeReplaySlice | null {
    return this.viewReplay.exportReplaySlice(sessionId, messageId, options)
  }

  readCausalObservationSlice(
    sessionId: string,
    messageId: string,
    options: DeepChatCausalObservationReadOptions = {}
  ): DeepChatCausalObservationSlice {
    return this.viewReplay.readCausalObservationSlice(sessionId, messageId, options)
  }

  handoff(
    sessionId: string,
    name: string,
    state: AgentTapeHandoffState,
    meta: Record<string, unknown> = {}
  ): DeepChatTapeEntryRow {
    return this.facts.handoff(sessionId, name, state, meta)
  }

  handoffResult(
    sessionId: string,
    name: string,
    state: AgentTapeHandoffState,
    meta: Record<string, unknown> = {}
  ): TapeAnchorResult {
    return this.facts.handoffResult(sessionId, name, state, meta)
  }

  createFork(parentSessionId: string, forkId?: string): TapeForkHandle {
    return this.forks.createFork(parentSessionId, forkId)
  }

  appendForkMessageRecord(handle: TapeForkHandle, record: ChatMessageRecord): number {
    return this.facts.appendMessageRecordForSession(handle.forkSessionId, record)
  }

  mergeFork(parentSessionId: string, forkId: string): number {
    return this.forks.mergeFork(parentSessionId, forkId)
  }

  discardFork(parentSessionId: string, forkId: string): void {
    this.forks.discardFork(parentSessionId, forkId)
  }

  recordExternalForkMerge(
    parentSessionId: string,
    forkSessionId: string,
    forkId: string,
    meta: Record<string, unknown> = {}
  ): DeepChatTapeEntryRow {
    return this.forks.recordExternalForkMerge(parentSessionId, forkSessionId, forkId, meta)
  }

  recordExternalForkDiscard(
    parentSessionId: string,
    forkSessionId: string,
    forkId: string,
    meta: Record<string, unknown> = {}
  ): DeepChatTapeEntryRow {
    return this.forks.recordExternalForkDiscard(parentSessionId, forkSessionId, forkId, meta)
  }

  linkSubagentTape(input: SubagentTapeLinkInput): SubagentTapeLinkReceipt {
    return this.lineage.linkSubagentTape(input)
  }

  getBySession(sessionId: string): DeepChatTapeEntryRow[] {
    return this.providers.getEntryStore().getBySessionExcludingContext(sessionId)
  }

  getTapeInspectorHead(sessionId: string): TapeInspectorHead | null {
    return this.traceInspector.getHead(sessionId)
  }

  listTapeInspectorPage(input: ListTapeInspectorPageInput): ListTapeInspectorPageOutput {
    return this.traceInspector.listPage(input)
  }

  resolveTapeInspectorEvidenceEntries(
    input: ResolveTapeInspectorEvidenceEntriesInput
  ): ResolveTapeInspectorEvidenceEntriesOutput {
    return this.traceInspector.resolveEvidenceEntries(input)
  }

  getTapeInspectorRecordDetail(
    input: GetTapeInspectorRecordDetailInput
  ): GetTapeInspectorRecordDetailOutput {
    return this.traceInspector.getDetail(input)
  }

  exportTapeInspectorSupportFacts(
    input: ExportTapeInspectorSupportFactsInput
  ): ExportTapeInspectorSupportFactsOutput {
    return this.traceInspector.exportSupportFacts(input)
  }

  getLatestReconstructionAnchor(sessionId: string): DeepChatTapeEntryRow | undefined {
    return this.providers.getEntryStore().getLatestReconstructionAnchor(sessionId)
  }

  getReconstructionAnchorByCompactionAttemptId(
    sessionId: string,
    compactionAttemptId: string
  ): DeepChatTapeEntryRow | undefined {
    return this.providers
      .getEntryStore()
      .getReconstructionAnchorByCompactionAttemptId(sessionId, compactionAttemptId)
  }

  appendAnchor(input: TapeAnchorAppendInput): DeepChatTapeEntryRow {
    return this.facts.appendAnchor(input)
  }

  getEffectiveMessageSourceSpan(
    sessionId: string,
    entryIds: number[]
  ): TapeEffectiveMessageSourceEntry[] {
    return this.recall.getEffectiveMessageSourceSpan(sessionId, entryIds)
  }

  listMemoryViewManifestsByAgent(
    agentId: string,
    options?: { sessionId?: string; limit?: number; messageId?: string }
  ): TapeMemoryViewManifestInspection[] {
    return this.viewReplay.listMemoryViewManifestsByAgent(agentId, options)
  }

  initializeSessionTape(sessionId: string): void {
    this.providers.getEntryStore().ensureBootstrapAnchor(sessionId)
  }

  deleteSessionTape(sessionId: string): void {
    deleteTapeGeneration(this.providers, sessionId)
  }

  resetSessionTape(sessionId: string): void {
    resetTapeGeneration(this.providers, sessionId)
  }
}
