import type { JsonValue } from '@shared/contracts/json'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimEvent, DimSessionRef } from './sessionConnection'

/** All native content reads cross the injected storage plugin; no desktop SQLite reader. */
export class DimContent {
  constructor(private readonly host: DimRuntimeSupervisor) {}

  async latest(
    ref: DimSessionRef,
    kinds: string[],
    extra?: JsonValue,
    through?: string
  ): Promise<{ event: DimEvent | null; through: string }> {
    const client = await this.host.start()
    const kind: JsonValue = { op: 'in', value: { kind: 'field', path: 'kind' }, values: kinds }
    const page = await client.call<{
      through: string | number
      result: { events: Array<{ event: DimEvent }> }
    }>('session.deepchat_storage.query', {
      ...ref,
      query: {
        scope: 'branch',
        ...(through ? { through } : {}),
        query: {
          filter: extra ? { op: 'and', conditions: [kind, extra] } : kind,
          select: { kind: 'events' },
          order_by: [{ key: { kind: 'position' }, direction: 'descending' }]
        },
        page: { limit: 1 }
      }
    })
    return { event: page.result.events[0]?.event ?? null, through: String(page.through) }
  }
}
