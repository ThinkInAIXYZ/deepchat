import type { SessionDatabase } from '@/session/data/database'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimContent } from './content'
import type { DimProductContextRequest, DimProductContextReply } from './productGateway'
import { dimSequence } from './sessionConnection'

interface ProductContextOptions {
  database: SessionDatabase
  content: Pick<DimContent, 'latest'>
  authorize(binding: Readonly<DimSessionBinding>, signal: AbortSignal): void | Promise<void>
  prepare(
    binding: Readonly<DimSessionBinding>,
    request: DimProductContextRequest,
    signal: AbortSignal
  ): Promise<DimProductContextReply>
}

/** A desktop context port for a live native request, never an execution or history owner. */
export class DimProductContext {
  constructor(private readonly options: ProductContextOptions) {}

  readonly prepare = async (
    request: DimProductContextRequest,
    signal: AbortSignal
  ): Promise<DimProductContextReply> => {
    signal.throwIfAborted()
    const binding = this.options.database.dimSessionBindingsTable.getByNative(request.sessionId)
    if (!binding) throw new Error('Native context has no current desktop binding')
    const scope = Object.freeze({ ...binding })
    const check = () => {
      signal.throwIfAborted()
      const current = this.options.database.dimSessionBindingsTable.get(binding.sessionId)
      if (
        !current ||
        current.dimSessionId !== scope.dimSessionId ||
        current.branchId !== scope.branchId ||
        current.generation !== scope.generation ||
        this.options.database.dimScopeChangesTable.get(binding.sessionId)
      )
        throw new Error('Native context belongs to a replaced session scope')
    }
    check()
    await this.options.authorize(scope, signal)
    check()
    // ContextSource fixes a history prefix. Resolve the live native step independently of the
    // desktop's asynchronous status projection, and deny requests from another native branch.
    const current = await this.options.content.latest(
      {
        sessionId: scope.dimSessionId,
        branchId: scope.branchId
      },
      ['step/model-start']
    )
    check()
    if (
      current.event?.data.request_id !== request.requestId ||
      current.event.data.turn_id !== request.turnId ||
      dimSequence(current.through) < dimSequence(request.through)
    )
      throw new Error('Native context request is no longer current')
    const prepared = await this.options.prepare(scope, request, signal)
    check()
    await this.options.authorize(scope, signal)
    check()
    return prepared
  }
}
