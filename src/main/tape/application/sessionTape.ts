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
import type { DeepChatTapeEntryRow, TapeAnchorAppendInput } from '../domain/entry'
import type { TapeEntryRef, TapeToolFactInput } from '../domain/facts'
import type {
  TapeAnchorReader,
  TapeAnchorWriter,
  TapeEffectiveMessageSourceEntry,
  TapeInspectionReader,
  TapeLifecycleAdmin,
  TapeMessageFactWriter,
  TapeRawEntryReader,
  TapeReconciliationPort,
  TapeToolFactWriter,
  TapeTranscriptReader,
  TapeMemoryViewManifestInspection,
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
import { TapeRecallService } from './recallService'
import { TapeReconcilerService } from './reconcilerService'
import { TapeViewReplayService } from './viewReplayService'

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
    TapeRawEntryReader,
    TapeReconciliationPort,
    TapeViewManifestReader,
    TapeViewManifestWriter,
    TapeAnchorReader,
    TapeAnchorWriter,
    TapeInspectionReader,
    TapeLifecycleAdmin
{
  private readonly providers: TapeApplicationProviders
  private readonly facts: TapeFactService
  private readonly reconciler: TapeReconcilerService
  private readonly recall: TapeRecallService
  private readonly lineage: TapeLineageService
  private readonly viewReplay: TapeViewReplayService
  private readonly forks: TapeForkService

  constructor(database: TapeApplicationDatabase) {
    this.providers = createTapeApplicationProviders(database)
    this.facts = new TapeFactService(this.providers)
    this.lineage = new TapeLineageService(this.providers)
    this.reconciler = new TapeReconcilerService(this.providers, this.facts)
    this.recall = new TapeRecallService(this.providers, this.lineage)
    this.viewReplay = new TapeViewReplayService(this.providers)
    this.forks = new TapeForkService(this.providers)
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

  appendMessageReplacement(record: ChatMessageRecord, reason: string): number {
    return this.facts.appendMessageReplacement(record, reason)
  }

  appendMessageRetraction(record: ChatMessageRecord, reason: string): number {
    return this.facts.appendMessageRetraction(record, reason)
  }

  appendToolFact(input: TapeToolFactInput): Promise<TapeEntryRef> {
    return this.facts.appendToolFact(input)
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

  appendViewManifest(manifest: DeepChatTapeViewManifest): DeepChatTapeEntryRow {
    return this.viewReplay.appendViewManifest(manifest)
  }

  listViewManifestsByMessage(
    sessionId: string,
    messageId: string
  ): DeepChatTapeViewManifestRecord[] {
    return this.viewReplay.listViewManifestsByMessage(sessionId, messageId)
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
    return this.providers.getEntryStore().getBySession(sessionId)
  }

  getLatestReconstructionAnchor(sessionId: string): DeepChatTapeEntryRow | undefined {
    return this.providers.getEntryStore().getLatestReconstructionAnchor(sessionId)
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
