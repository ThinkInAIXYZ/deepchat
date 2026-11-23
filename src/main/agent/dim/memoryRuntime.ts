import type { JsonValue } from '@shared/contracts/json'
import type { SessionDatabase } from '@/session/data/database'
import type { SessionTranscriptPort } from '@/session/data/contracts'
import type { MemoryRuntimePort } from '@/memory/injection'
import {
  MemoryRuntimeCoordinator,
  type MemoryRuntimeCoordinatorDependencies
} from '@/memory/session/memoryRuntimeCoordinator'
import type { MemorySessionHandle } from '@/memory/session/memoryPromptContributor'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimEvent } from './sessionConnection'
import type { DimProductContextReply, DimProductContextRequest } from './productGateway'
import { DimContent } from './content'
import { DimMemorySource } from './memorySource'
import { DimMemoryEvidence } from './memoryEvidence'
import { DimMemoryViews } from './memoryViews'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'

interface MemoryOptions {
  database: SessionDatabase
  host: DimRuntimeSupervisor
  port: MemoryRuntimePort
  identity: MemoryRuntimeCoordinatorDependencies['identity']
  transcript: Pick<SessionTranscriptPort, 'getNextOrderSeq' | 'getMessagesUpToOrderSeq'>
  cursors: Pick<
    MemoryRuntimeCoordinatorDependencies,
    'getMemoryCursorOrderSeq' | 'updateMemoryCursorOrderSeq' | 'rewindMemoryCursorOrderSeq'
  >
}

/** Product memory keeps its policies; every conversation source and audit belongs to dim. */
export function createDimMemoryRuntime(options: MemoryOptions) {
  const startedAt = Date.now()
  const handles = new Map<
    string,
    { nativeId: string; branchId: string; generation: number; handle: MemorySessionHandle }
  >()
  const content = new DimContent(options.host)
  const source = new DimMemorySource({ ...options, content })
  const getSession: MemoryRuntimeCoordinatorDependencies['getSession'] = (id) => {
    const binding = options.database.dimSessionBindingsTable.get(id)
    const state = options.database.deepchatSessionsTable.get(id)
    if (!binding || !state || options.database.dimScopeChangesTable.get(id)) return undefined
    let scope = handles.get(id)
    if (
      !scope ||
      scope.nativeId !== binding.dimSessionId ||
      scope.branchId !== binding.branchId ||
      scope.generation !== binding.generation
    ) {
      if (scope) coordinator.bumpSessionEpoch(id)
      scope = {
        nativeId: binding.dimSessionId,
        branchId: binding.branchId,
        generation: binding.generation,
        handle: Object.freeze({ sessionId: toAppSessionId(id) })
      }
      handles.set(id, scope)
    }
    return { handle: scope.handle, providerId: state.provider_id, modelId: state.model_id }
  }
  const coordinator = new MemoryRuntimeCoordinator({
    memoryPort: options.port,
    getSession,
    identity: options.identity,
    ...options.cursors,
    getNextMessageOrderSeq: (id) => options.transcript.getNextOrderSeq(id),
    getMessagesUpToOrderSeq: (id, order) => options.transcript.getMessagesUpToOrderSeq(id, order),
    audit: source.audit,
    readIngestionRange: source.readRange
  })
  const contribute = async (
    binding: Readonly<DimSessionBinding>,
    request: DimProductContextRequest,
    signal: AbortSignal
  ): Promise<DimProductContextReply> => {
    const session = getSession(toAppSessionId(binding.sessionId))
    if (!session) throw new Error('Memory context belongs to a closed native scope')
    const contribution = await coordinator.contribute({
      session: session.handle,
      query: request.query,
      messageId: request.turnId,
      signal
    })
    signal.throwIfAborted()
    return {
      messages: [contribution.memory.content, contribution.directives.content]
        .filter((text): text is string => !!text)
        .map((text) => ({ role: 'user', content: text })),
      receipts: [
        { source: 'deepchat/memory', ...contribution.memory },
        { source: 'deepchat/directives', ...contribution.directives }
      ]
        .filter((receipt) => receipt.manifest !== null)
        .map(({ content: _content, ...receipt }) => receipt as unknown as JsonValue)
    }
  }
  const observe = (sessionId: string, event: DimEvent) => {
    // Rebuilding a desktop projection cannot initiate auxiliary memory inference.
    if (event.create_at < startedAt) return
    const session = getSession(toAppSessionId(sessionId))
    if (!session) return
    if (event.type === 'turn' && event.name === 'end') {
      coordinator.afterTurnSettled({
        session: session.handle,
        origin: 'initial',
        outcome: {
          kind: 'returned',
          status:
            event.data.status === 'completed'
              ? 'completed'
              : event.data.status === 'cancelled'
                ? 'aborted'
                : 'error'
        }
      })
    } else if (
      event.type === 'context' &&
      event.name === 'compaction' &&
      event.data.status === 'completed'
    ) {
      coordinator.afterCompactionApplyReturned({
        session: session.handle,
        origin: 'context-pressure',
        targetCursorOrderSeq: options.transcript.getNextOrderSeq(sessionId) - 1
      })
    }
  }
  const closed = (id: string) => {
    coordinator.beginSessionDestroy(id)
    coordinator.finishSessionDestroy(id)
    handles.delete(id)
  }
  return {
    coordinator,
    evidence: new DimMemoryEvidence({ database: options.database, content }),
    views: new DimMemoryViews({ database: options.database, content }),
    contribute,
    observe,
    closed,
    beginDestroy: async (id: string) => {
      coordinator.beginSessionDestroy(id)
      await coordinator.waitForSession(id)
    },
    finishDestroy: (id: string) => {
      coordinator.finishSessionDestroy(id)
      handles.delete(id)
    }
  }
}
