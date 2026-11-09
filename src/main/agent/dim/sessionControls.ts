import type { JsonValue } from '@shared/contracts/json'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimSessionRef } from './sessionConnection'

export type DimSessionOperation =
  | 'queue'
  | 'withdraw'
  | 'permission'
  | 'set_permission'
  | 'set_model'
  | 'refresh_prompt'
  | 'context'
  | 'compact'
  | 'questions'
  | 'answer'
  | 'approval'
  | 'fork'
  | 'native_settings'
  | 'native_configure'

/** Fixed commands exposed by the injected plugin; dim owns validation and mutations. */
export class DimSessionControls {
  constructor(private readonly host: DimRuntimeSupervisor) {}

  async call<T = JsonValue>(
    operation: DimSessionOperation,
    ref: DimSessionRef,
    params: { [key: string]: JsonValue } = {}
  ): Promise<T> {
    const client = await this.host.start()
    return client.call(
      operation.startsWith('native_')
        ? `session.deepchat_native.${operation.slice(7)}`
        : `deepchat.session.${operation}`,
      operation === 'fork' ? { ...params, sessionId: ref.sessionId } : { ...params, ...ref },
      operation === 'compact' ? 30 * 60 * 1000 : 30_000
    )
  }
}
