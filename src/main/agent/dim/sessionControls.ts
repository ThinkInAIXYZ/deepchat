import { prepareDimPayload } from './payload'
import type { JsonValue } from '@shared/contracts/json'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimSessionRef } from './sessionConnection'

export type DimSessionOperation =
  | 'queue'
  | 'withdraw'
  | 'permission'
  | 'set_permission'
  | 'set_model'
  | 'set_agent'
  | 'agent'
  | 'refresh_prompt'
  | 'context'
  | 'compact'
  | 'questions'
  | 'answer'
  | 'approval'
  | 'fork'
  | 'rename'
  | 'close'
  | 'native_settings'
  | 'native_identity'
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
    if (operation === 'native_configure') {
      const payload = await prepareDimPayload(this.host.payloadRoot, { ...params, ...ref })
      try {
        return await client.call('session.deepchat_native.configure', {
          ...(payload.params as Record<string, JsonValue>),
          ...ref
        })
      } finally {
        await payload.dispose()
      }
    }
    return client.call(
      operation.startsWith('native_')
        ? `session.deepchat_native.${operation.slice(7)}`
        : `deepchat.session.${operation}`,
      operation === 'fork' || operation === 'close'
        ? { ...params, sessionId: ref.sessionId }
        : { ...params, ...ref },
      operation === 'compact' ? 30 * 60 * 1000 : 30_000
    )
  }
}
