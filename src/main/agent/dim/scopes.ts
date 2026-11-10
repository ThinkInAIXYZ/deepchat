import type { SessionDatabase } from '@/session/data/database'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimProductContextRequest } from './productGateway'
import type { DimSessionRef } from './sessionConnection'
import { dimSequence } from './sessionConnection'

export interface DimScopeDescription {
  sessionId: string
  origin: 'client' | 'acp' | 'internal' | 'unknown'
  parentSessionId: string | null
  cwd: string
  model: { providerId: string; modelId: string }
  role: 'leader' | 'member'
  tools: string[] | null
  title: { text: string; source: 'auto' | 'manual' } | null
  titleRevision: string
}
export interface DimAuthorizedOwner {
  binding: Readonly<DimSessionBinding>
  description: Readonly<DimScopeDescription>
  assertCurrent(): void
}

export interface DimAuthorizedScope extends DimAuthorizedOwner {
  ref: DimSessionRef
}

/** Native parent links establish delegation. User text and desktop status never establish it. */
export class DimScopes {
  constructor(
    private readonly options: {
      database: SessionDatabase
      host: Pick<DimRuntimeSupervisor, 'start'>
    }
  ) {}

  async describe(sessionId: string): Promise<DimScopeDescription> {
    const client = await this.options.host.start()
    const description = await client.call<DimScopeDescription>('deepchat.storage.scope', {
      sessionId
    })
    if (description.sessionId !== sessionId || !description.cwd)
      throw new Error('Native scope metadata has a different owner')
    dimSequence(description.titleRevision)
    return description
  }

  readonly owner = async (nativeId: string, signal: AbortSignal): Promise<DimAuthorizedOwner> => {
    signal.throwIfAborted()
    const description = await this.describe(nativeId)
    signal.throwIfAborted()
    const visited = new Set<string>()
    let ancestor = description
    let binding: DimSessionBinding | null = null
    for (let depth = 0; depth < 32; depth++) {
      if (visited.has(ancestor.sessionId)) throw new Error('Native parent links contain a cycle')
      visited.add(ancestor.sessionId)
      binding = this.options.database.dimSessionBindingsTable.getByNative(ancestor.sessionId)
      if (binding) break
      if (ancestor.origin !== 'internal' || !ancestor.parentSessionId)
        throw new Error('Native scope has no current desktop owner')
      ancestor = await this.describe(ancestor.parentSessionId)
      signal.throwIfAborted()
    }
    if (!binding) throw new Error('Native delegation exceeds its ancestry bound')
    const owner = Object.freeze({ ...binding })
    const assertCurrent = () => {
      signal.throwIfAborted()
      const current = this.options.database.dimSessionBindingsTable.get(owner.sessionId)
      if (
        !current ||
        current.dimSessionId !== owner.dimSessionId ||
        current.branchId !== owner.branchId ||
        current.generation !== owner.generation ||
        this.options.database.dimScopeChangesTable.get(owner.sessionId)
      )
        throw new Error('Native delegation belongs to a replaced desktop scope')
    }
    assertCurrent()
    return { binding: owner, description: Object.freeze({ ...description }), assertCurrent }
  }

  readonly context = async (
    request: DimProductContextRequest,
    signal: AbortSignal
  ): Promise<DimAuthorizedScope> => {
    const owner = await this.owner(request.sessionId, signal)
    const { assertCurrent } = owner
    const frame = await (
      await this.options.host.start()
    ).call<{
      branchId: string
      through: string
      sequence: string
    }>('session.deepchat_scope.frame', {
      sessionId: request.sessionId,
      requestId: request.requestId,
      turnId: request.turnId
    })
    assertCurrent()
    if (!frame.branchId || dimSequence(frame.through) < dimSequence(request.through))
      throw new Error('Native model request has no current branch')
    dimSequence(frame.sequence)
    return {
      ...owner,
      ref: { sessionId: request.sessionId, branchId: frame.branchId },
      assertCurrent
    }
  }
}
