import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'
import type { TapeMutationProjection } from '@/tape/ports/storage'
import type { SessionTapePort } from './contracts'
import { SessionPendingInputStore } from './pendingInputStore'
import { SessionPendingInputs } from './pendingInputs'
import { SessionSettingsStore } from './settings'
import { normalizeTapeHandoffState, SessionTape } from '@/tape/application/sessionTape'
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
}

export function createSessionDataFromDatabase(
  database: SessionDatabase,
  events: SessionDataEvents
) {
  const tapeStore = new SessionTape(database)
  const transcript = new SessionTranscript(database, tapeStore)
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
      if (!options?.scope || options.scope === 'current') ensureTape(sessionId)
      return Promise.resolve(tapeStore.search(sessionId, query, options))
    },
    getTapeContext(sessionId, entryIds, options) {
      if (!options?.sourceSessionId || options.sourceSessionId.trim() === sessionId) {
        ensureTape(sessionId)
      }
      return Promise.resolve(tapeStore.getContext(sessionId, entryIds, options))
    },
    listTapeAnchors(sessionId, options) {
      ensureTape(sessionId)
      return Promise.resolve(tapeStore.anchors(sessionId, options))
    },
    handoffTape(sessionId, name, state) {
      normalizeTapeHandoffState(state)
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
    linkSubagentTape(input) {
      ensureTape(input.parentSessionId)
      ensureTape(input.childSessionId)
      return Promise.resolve(tapeStore.linkSubagentTape(input))
    }
  }

  return {
    database,
    settings: new SessionSettingsStore(database, tapeStore),
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
