import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'
import type { TapeMutationProjection } from '@/tape/ports/storage'
import type { SessionTapePort } from './contracts'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { SessionPendingInputStore } from './pendingInputStore'
import { SessionPendingInputs } from './pendingInputs'
import { SessionSettingsStore } from './settings'
import {
  normalizeTapeHandoffState,
  SessionTape,
  type SessionTapeCapabilities
} from '@/tape/application/sessionTape'
import { ExecutionJournalService } from '@/tape/application/executionJournalService'
import type {
  ExecutionJournalWriter,
  NestedExecutionJournalWriter
} from '@/tape/ports/capabilities'
import { SessionTranscript } from './transcript'
import { SessionDatabase } from './database'

export function createSessionData(
  connection: DatabaseConnectionProvider,
  getTapeMutationProjection: (() => TapeMutationProjection) | undefined,
  events: SessionDataEvents
) {
  const database = new SessionDatabase(connection, getTapeMutationProjection)
  return createSessionDataFromDatabase(database, events)
}

export type SessionDataEvents = {
  publishPendingInputsChanged(sessionId: string): void
  publishMessagesChanged(sessionId: string, messages: ChatMessageRecord[]): void
}

export function createSessionDataFromDatabase(
  database: SessionDatabase,
  events: SessionDataEvents
) {
  // The concrete facade stays inside this composition root: the SessionTapePort wrappers below
  // call its direct read helpers, while everything handed out reaches Tape only through ports.
  const sessionTape = new SessionTape(database)
  const tapeStore: SessionTapeCapabilities = sessionTape
  const programmaticJournalService = new ExecutionJournalService(
    () => database.deepchatExecutionJournalStore
  )
  const programmaticExecutionJournal: Pick<ExecutionJournalWriter, 'commitToolOutcome'> &
    NestedExecutionJournalWriter = Object.freeze({
    commitToolOutcome: (input) => programmaticJournalService.commitToolOutcome(input),
    commitNestedDispatch: (input) => programmaticJournalService.commitNestedDispatch(input),
    commitNestedToolOutcome: (input) => programmaticJournalService.commitNestedToolOutcome(input)
  })
  const transcript = new SessionTranscript(database, tapeStore, tapeStore, tapeStore)
  const pendingInputStore = new SessionPendingInputStore(database)
  const ensureTape = (sessionId: string) =>
    sessionTape.ensureSessionTapeReady(sessionId, transcript)
  const toTapeAnchor = (row: DeepChatTapeEntryRow) => ({
    sessionId: row.session_id,
    entryId: row.entry_id,
    kind: row.kind,
    name: row.name,
    payload: parseJsonObject(row.payload_json),
    meta: parseJsonObject(row.meta_json),
    createdAt: row.created_at
  })
  const tape: SessionTapePort = {
    getTapeInfo(sessionId) {
      ensureTape(sessionId)
      return Promise.resolve(sessionTape.info(sessionId))
    },
    searchTape(sessionId, query, options) {
      if (!options?.scope || options.scope === 'current') ensureTape(sessionId)
      return Promise.resolve(sessionTape.search(sessionId, query, options))
    },
    getTapeContext(sessionId, entryIds, options) {
      if (!options?.sourceSessionId || options.sourceSessionId.trim() === sessionId) {
        ensureTape(sessionId)
      }
      return Promise.resolve(sessionTape.getContext(sessionId, entryIds, options))
    },
    listTapeAnchors(sessionId, options) {
      ensureTape(sessionId)
      return Promise.resolve(sessionTape.anchors(sessionId, options))
    },
    handoffTape(sessionId, name, state) {
      normalizeTapeHandoffState(state)
      ensureTape(sessionId)
      return Promise.resolve(toTapeAnchor(sessionTape.handoff(sessionId, name, state)))
    },
    listMessageViewManifests(sessionId, messageId) {
      ensureTape(sessionId)
      return Promise.resolve(sessionTape.listViewManifestsByMessage(sessionId, messageId))
    },
    listNestedExecutionAuditForMessage(sessionId, messageId) {
      ensureTape(sessionId)
      return Promise.resolve(sessionTape.listNestedExecutionAuditForMessage(sessionId, messageId))
    },
    exportMessageTapeReplaySlice(sessionId, messageId, options) {
      ensureTape(sessionId)
      return Promise.resolve(sessionTape.exportReplaySlice(sessionId, messageId, options))
    },
    // Inspector reads must not bootstrap or write Tape state. Incarnation mismatches are returned
    // through the read contract instead.
    listTapeInspectorPage(input) {
      return sessionTape.listTapeInspectorPage(input)
    },
    resolveTapeInspectorEvidenceEntries(input) {
      return sessionTape.resolveTapeInspectorEvidenceEntries(input)
    },
    getTapeInspectorRecordDetail(input) {
      return sessionTape.getTapeInspectorRecordDetail(input)
    },
    exportTapeInspectorSupportFacts(input) {
      return sessionTape.exportTapeInspectorSupportFacts(input)
    },
    linkSubagentTape(input) {
      ensureTape(input.parentSessionId)
      ensureTape(input.childSessionId)
      return Promise.resolve(sessionTape.linkSubagentTape(input))
    }
  }

  return {
    database,
    settings: new SessionSettingsStore(database, tapeStore),
    transcript,
    tape,
    tapeStore,
    programmaticExecutionJournal,
    pendingInputs: new SessionPendingInputs(pendingInputStore, transcript, events)
  }
}

export type SessionData = ReturnType<typeof createSessionData>

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
