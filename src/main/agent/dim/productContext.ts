import type { SessionDatabase } from '@/session/data/database'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimContent } from './content'
import type { DimProductContextRequest, DimProductContextReply } from './productGateway'
import { dimSequence } from './sessionConnection'
import type { DimAuthorizedScope } from './scopes'

interface ProductContextOptions {
  database: SessionDatabase
  content: Pick<DimContent, 'latest'>
  resolve?(request: DimProductContextRequest, signal: AbortSignal): Promise<DimAuthorizedScope>
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
    const resolved = await this.options.resolve?.(request, signal)
    const binding =
      resolved?.binding ??
      this.options.database.dimSessionBindingsTable.getByNative(request.sessionId)
    if (!binding) throw new Error('Native context has no current desktop binding')
    const scope = Object.freeze({ ...binding })
    const check = () => {
      resolved?.assertCurrent()
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
    // desktop's asynchronous status projection. Internal branches/children first resolve their
    // native owner and current root generation through the public delegation boundary.
    const current = await this.options.content.latest(
      resolved?.ref ?? {
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
    // File ids remain immutable across a cold restore. The owner resolves their physical
    // directories in this profile, so earlier absolute history paths can be located again.
    const roots = [
      ...new Set(
        (resolved?.description.ownedPaths ?? []).flatMap((value) => {
          if (/[\\/]dimcode\.sqlite\.session-files[\\/][a-f0-9-]{36}$/.test(value))
            return [value.slice(0, Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')))]
          const normalized = value.replaceAll('\\', '/')
          const marker = '/command-output/'
          const position = normalized.lastIndexOf(marker)
          return position >= 0 &&
            /^[a-f0-9-]{36}\//.test(normalized.slice(position + marker.length))
            ? [value.slice(0, position + marker.length - 1)]
            : []
        })
      )
    ]
    if (!roots.length) return prepared
    return {
      ...prepared,
      messages: [
        ...prepared.messages,
        {
          role: 'user',
          content: `Native session-owned file roots: ${JSON.stringify(roots)}. Resolve archived paths under the current root using the original file-ID/name or command-session-ID/output-name suffix.`
        }
      ]
    }
  }
}
