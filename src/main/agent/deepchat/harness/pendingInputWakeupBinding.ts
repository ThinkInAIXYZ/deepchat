import type { PendingInputPump } from '@/agent/deepchat/runtime/pendingInputPump'
import type { PendingInputWakeup } from '@/agent/deepchat/runtime/runLifecycleCoordinator'

export type PendingInputDrain = Pick<PendingInputPump, 'drain'>

export interface PendingInputWakeupBinding {
  readonly wakeup: PendingInputWakeup
  bind(pump: PendingInputDrain): void
}

/**
 * Run settlement wakes the pending-input pump, and the pump starts turns through the run lifecycle
 * owner. That is the only real cycle in the runtime graph, so it is bound explicitly here instead of
 * being hidden in an anonymous closure over the composition root.
 */
export function createPendingInputWakeupBinding(): PendingInputWakeupBinding {
  let pump: PendingInputDrain | undefined

  return {
    wakeup: {
      drain: async (sessionId, reason) => {
        if (!pump) {
          throw new Error('Pending input wakeup was used before the pump was bound.')
        }
        return await pump.drain(sessionId, reason)
      }
    },
    bind(next: PendingInputDrain): void {
      if (pump) {
        throw new Error('Pending input wakeup is already bound.')
      }
      pump = next
    }
  }
}
