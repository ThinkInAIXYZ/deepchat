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
import type { DeepChatTapeEntryRow } from '../domain/entry'
import type { TapeEntryRef, TapeToolFactInput } from '../domain/facts'
import type { TapeToolFactWriter } from '../ports/capabilities'
import { createTapeApplicationProviders, type TapeApplicationDatabase } from '../ports/application'
import type {
  TapeAnchorResult,
  TapeBackfillResult,
  TapeForkHandle,
  TapeInfo,
  TapeMigrationState,
  TapeSearchResult,
  TapeViewManifestSourceMaps
} from './contracts'
import { TapeFactService } from './factService'
import { normalizeTapeHandoffState, TapeForkService } from './forkService'
import {
  AgentTapeViewError,
  normalizeSubagentTapeLinkInput,
  TapeLineageService,
  type AgentTapeViewErrorCode
} from './lineageService'
import { TapeRecallService } from './recallService'
import { TapeReconcilerService, type TapeTranscriptReader } from './reconcilerService'
import { TapeViewReplayService } from './viewReplayService'

export type {
  AgentTapeViewErrorCode,
  TapeAnchorResult,
  TapeBackfillResult,
  TapeForkHandle,
  TapeInfo,
  TapeMigrationState,
  TapeSearchResult,
  TapeViewManifestSourceMaps
}
export { AgentTapeViewError, normalizeSubagentTapeLinkInput, normalizeTapeHandoffState }

export class SessionTape implements TapeToolFactWriter {
  private readonly facts: TapeFactService
  private readonly reconciler: TapeReconcilerService
  private readonly recall: TapeRecallService
  private readonly lineage: TapeLineageService
  private readonly viewReplay: TapeViewReplayService
  private readonly forks: TapeForkService

  constructor(database: TapeApplicationDatabase) {
    const providers = createTapeApplicationProviders(database)
    this.facts = new TapeFactService(providers)
    this.lineage = new TapeLineageService(providers)
    this.reconciler = new TapeReconcilerService(providers, this.facts)
    this.recall = new TapeRecallService(providers, this.lineage)
    this.viewReplay = new TapeViewReplayService(providers)
    this.forks = new TapeForkService(providers, this.facts)
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

  getViewManifestSourceMaps(sessionId: string, messageId?: string): TapeViewManifestSourceMaps {
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
    return this.forks.handoff(sessionId, name, state, meta)
  }

  handoffResult(
    sessionId: string,
    name: string,
    state: AgentTapeHandoffState,
    meta: Record<string, unknown> = {}
  ): TapeAnchorResult {
    return this.forks.handoffResult(sessionId, name, state, meta)
  }

  createFork(parentSessionId: string, forkId?: string): TapeForkHandle {
    return this.forks.createFork(parentSessionId, forkId)
  }

  appendForkMessageRecord(handle: TapeForkHandle, record: ChatMessageRecord): number {
    return this.forks.appendForkMessageRecord(handle, record)
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
}
