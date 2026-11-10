import type { JsonValue } from '@shared/contracts/json'
import type { DimMediaFrameRequest } from './productGateway'
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
  ownedPaths?: string[]
}
export interface DimBoundOwner {
  binding: Readonly<DimSessionBinding>
  assertCurrent(): void
}
export interface DimAuthorizedOwner extends DimBoundOwner {
  description: Readonly<DimScopeDescription>
}

export interface DimAuthorizedScope extends DimAuthorizedOwner {
  ref: DimSessionRef
  acceptedInput?: Pick<DimProductContextRequest, 'query' | 'hookPrompt' | 'hookPromptTooLarge'>
}

/** Native parent links establish delegation. User text and desktop status never establish it. */
export class DimScopes {
  constructor(
    private readonly options: {
      database: SessionDatabase
      host: Pick<DimRuntimeSupervisor, 'start'>
    }
  ) {}

  /** Product preferences for directly bound roots need no native session restore or I/O. */
  bound(nativeId: string, signal: AbortSignal): DimBoundOwner | null {
    signal.throwIfAborted()
    const binding = this.options.database.dimSessionBindingsTable.getByNative(nativeId)
    return binding ? this.currentBinding(binding, signal) : null
  }

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
    return {
      ...this.currentBinding(binding, signal),
      description: Object.freeze({ ...description })
    }
  }

  private currentBinding(binding: DimSessionBinding, signal: AbortSignal): DimBoundOwner {
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
    return { binding: owner, assertCurrent }
  }

  readonly mediaInput = async (
    request: DimMediaFrameRequest,
    signal: AbortSignal
  ): Promise<JsonValue> => {
    const owner = await this.owner(request.sessionId, signal)
    const frame = await (
      await this.options.host.start()
    ).call<{ mediaInput?: JsonValue }>('session.deepchat_scope.frame', {
      ...request,
      includeInput: true
    })
    owner.assertCurrent()
    if (!frame.mediaInput) throw new Error('Native media input is unavailable')
    return frame.mediaInput
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
      inputQuery: string
      hookPrompt: string | null
      hookPromptTooLarge: boolean
    }>('session.deepchat_scope.frame', {
      sessionId: request.sessionId,
      requestId: request.requestId,
      turnId: request.turnId
    })
    assertCurrent()
    if (!frame.branchId || dimSequence(frame.through) < dimSequence(request.through))
      throw new Error('Native model request has no current branch')
    dimSequence(frame.sequence)
    if (
      typeof frame.inputQuery !== 'string' ||
      typeof frame.hookPromptTooLarge !== 'boolean' ||
      (frame.hookPrompt !== null && typeof frame.hookPrompt !== 'string')
    )
      throw new Error('Native request has no canonical accepted input')
    return {
      ...owner,
      ref: { sessionId: request.sessionId, branchId: frame.branchId },
      acceptedInput: {
        query: frame.inputQuery,
        hookPrompt: frame.hookPrompt ?? undefined,
        hookPromptTooLarge: frame.hookPromptTooLarge
      },
      assertCurrent
    }
  }
}
