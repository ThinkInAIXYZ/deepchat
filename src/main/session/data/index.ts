import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import type { DeepChatTapeEntryRow } from '@/session/data/tables/deepchatTapeEntries'
import type { SessionTapePort } from './contracts'
import { SessionPendingInputStore } from './pendingInputStore'
import { SessionPendingInputs } from './pendingInputs'
import { SessionSettingsStore } from './settings'
import { SessionTape } from './tape'
import { SessionTranscript } from './transcript'
import { SessionDatabase } from './database'
import type { DeepChatTapeMutationProjection } from './tables/deepchatTapeEntries'

export function createSessionData(
  connection: DatabaseConnectionProvider,
  getTapeMutationProjection: (() => DeepChatTapeMutationProjection) | undefined,
  events: SessionDataEvents
) {
  const database = new SessionDatabase(connection, getTapeMutationProjection)
  return createSessionDataFromDatabase(database, events)
}

export type SessionDataEvents = {
  publishPendingInputsChanged(sessionId: string): void
}

export function createSessionDataFromDatabase(
  database: SessionDatabase,
  events: SessionDataEvents
) {
  const transcript = new SessionTranscript(database)
  const tapeStore = new SessionTape(database)
  const pendingInputStore = new SessionPendingInputStore(database)
  const ensureTape = (sessionId: string) => tapeStore.ensureSessionTapeReady(sessionId, transcript)
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
      return Promise.resolve(tapeStore.info(sessionId))
    },
    searchTape(sessionId, query, options) {
      ensureTape(sessionId)
      return Promise.resolve(tapeStore.search(sessionId, query, options))
    },
    getTapeContext(sessionId, entryIds, options) {
      ensureTape(sessionId)
      return Promise.resolve(tapeStore.getContext(sessionId, entryIds, options))
    },
    listTapeAnchors(sessionId, options) {
      ensureTape(sessionId)
      return Promise.resolve(tapeStore.anchors(sessionId, options))
    },
    handoffTape(sessionId, name, state = {}) {
      ensureTape(sessionId)
      return Promise.resolve(toTapeAnchor(tapeStore.handoff(sessionId, name, state)))
    },
    listMessageViewManifests(sessionId, messageId) {
      ensureTape(sessionId)
      return Promise.resolve(tapeStore.listViewManifestsByMessage(sessionId, messageId))
    },
    exportMessageTapeReplaySlice(sessionId, messageId, options) {
      ensureTape(sessionId)
      return Promise.resolve(tapeStore.exportReplaySlice(sessionId, messageId, options))
    },
    mergeSubagentTape(parentSessionId, childSessionId, meta = {}) {
      ensureTape(parentSessionId)
      ensureTape(childSessionId)
      tapeStore.recordExternalForkMerge(parentSessionId, childSessionId, childSessionId, meta)
      return Promise.resolve()
    },
    discardSubagentTape(parentSessionId, childSessionId, meta = {}) {
      ensureTape(parentSessionId)
      tapeStore.recordExternalForkDiscard(parentSessionId, childSessionId, childSessionId, meta)
      return Promise.resolve()
    }
  }

  return {
    database,
    settings: new SessionSettingsStore(database),
    transcript,
    tape,
    tapeStore,
    pendingInputs: new SessionPendingInputs(pendingInputStore, events.publishPendingInputsChanged)
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
