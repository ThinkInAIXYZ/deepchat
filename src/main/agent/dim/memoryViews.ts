import type { MessageMetadata } from '@shared/types/agent-interface'
import type { JsonValue } from '@shared/contracts/json'
import {
  MemoryViewManifestSchema,
  type MemoryViewManifest
} from '@shared/contracts/routes/memory.routes'
import type { SessionDatabase } from '@/session/data/database'
import type { DimContent } from './content'
import { dimSequence } from './sessionConnection'

export interface DimMemoryViewQuery {
  sessionId?: string
  messageId?: string
  limit?: number
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Passive diagnostics use canonical plugin queries, including retired owned generations. */
export class DimMemoryViews {
  constructor(
    private readonly options: {
      database: SessionDatabase
      content: Pick<DimContent, 'events' | 'transcript'>
    }
  ) {}

  readonly list = async (
    agentId: string,
    query: DimMemoryViewQuery = {}
  ): Promise<MemoryViewManifest[]> => {
    const { database, content } = this.options
    const limit = query.limit ?? 100
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw new Error('Memory views require a limit between 1 and 500')
    const sessions = query.sessionId
      ? [database.newSessionsTable.get(query.sessionId)].filter((row) => row != null)
      : database.newSessionsTable.list({ agentId, includeSubagents: true })
    const result: MemoryViewManifest[] = []
    const guards: Array<() => void> = []
    for (const session of sessions) {
      if (session.agent_id !== agentId) continue
      for (const scope of database.dimSessionScopesTable.list(session.id)) {
        const assertOwned = () => {
          if (
            database.newSessionsTable.get(session.id)?.agent_id !== agentId ||
            !database.dimSessionScopesTable
              .list(session.id)
              .some(
                (owned) =>
                  owned.generation === scope.generation &&
                  owned.dimSessionId === scope.dimSessionId &&
                  owned.branchId === scope.branchId
              )
          )
            throw new Error('Native memory view owner changed during its read')
        }
        assertOwned()
        guards.push(assertOwned)
        const ref = { sessionId: scope.dimSessionId, branchId: scope.branchId }
        let through: string | undefined
        let turnId: string | undefined
        if (query.messageId) {
          const snapshot = await content.transcript(ref, session.id)
          assertOwned()
          through = snapshot.through
          const message = snapshot.messages.find((message) => message.id === query.messageId)
          if (!message) continue
          const metadata = JSON.parse(message.metadata) as MessageMetadata
          if (metadata.dim?.sessionId !== ref.sessionId || metadata.dim.branchId !== ref.branchId)
            continue
          turnId = message.role === 'user' ? metadata.dim.turnId : metadata.runId
          if (!turnId) continue
        }
        const equal = (path: string, value: JsonValue): JsonValue => ({
          op: 'compare',
          left: { kind: 'field', path },
          comparison: 'eq',
          right: { kind: 'value', value }
        })
        const conditions = [
          equal('position.branch_id', ref.branchId),
          equal('data.name', 'memory/view_assembled'),
          ...(turnId ? [equal('data.meta.messageId', turnId)] : [])
        ]
        let before: string | undefined
        let count = 0
        while (count < limit) {
          const page = await content.events(
            ref,
            ['deepchat/memory-audit'],
            Math.min(200, limit - count),
            {
              op: 'and',
              conditions: [
                ...conditions,
                ...(before
                  ? [
                      {
                        op: 'compare',
                        left: { kind: 'field', path: 'position.sequence' },
                        comparison: 'lt',
                        right: { kind: 'value', value: before }
                      }
                    ]
                  : [])
              ]
            },
            through
          )
          assertOwned()
          through ??= page.through
          if (!page.events.length) break
          for (const { event, position } of page.events) {
            if (
              position.branch_id !== ref.branchId ||
              event.type !== 'deepchat' ||
              event.name !== 'memory-audit' ||
              event.data.name !== 'memory/view_assembled'
            )
              throw new Error('Invalid native memory view query result')
            const sequence = dimSequence(position.sequence).toString()
            if (dimSequence(sequence) > dimSequence(through))
              throw new Error('Native memory view exceeds its immutable cutoff')
            if (before && dimSequence(sequence) >= dimSequence(before))
              throw new Error('Native memory views did not advance their cursor')
            before = sequence
            const state = object(event.data.state)
            const meta = object(event.data.meta)
            if (!state || (turnId && meta?.messageId !== turnId))
              throw new Error('Invalid native memory view manifest')
            const selected = Array.isArray(state.selected) ? state.selected : null
            const number = (value: unknown) =>
              typeof value === 'number' && Number.isFinite(value) ? value : 0
            const allocation = MemoryViewManifestSchema.shape.allocation.safeParse(state.allocation)
            result.push(
              MemoryViewManifestSchema.parse({
                sessionId: session.id,
                messageId: query.messageId ?? meta?.messageId ?? null,
                entryId: null,
                timeline: { ...ref, sequence, eventId: event.id },
                policyVersion: typeof state.policyVersion === 'number' ? state.policyVersion : null,
                tokenBudget: number(state.tokenBudget),
                estimatedTokens: number(state.estimatedTokens),
                selectedCount: selected?.length ?? 0,
                selectedIds: selected
                  ? [
                      ...new Set(
                        selected.flatMap((value) => {
                          const id = typeof value === 'string' ? value : object(value)?.id
                          return typeof id === 'string' && id.length ? [id] : []
                        })
                      )
                    ]
                  : null,
                droppedCount: Array.isArray(state.dropped) ? state.dropped.length : 0,
                queryHash: typeof state.queryHash === 'string' ? state.queryHash : null,
                allocation: allocation.success ? (allocation.data ?? null) : null,
                createdAt: event.create_at
              })
            )
            count++
          }
        }
        result.sort((left, right) => right.createdAt - left.createdAt).splice(limit)
      }
    }
    for (const guard of guards) guard()
    return result
  }
}
