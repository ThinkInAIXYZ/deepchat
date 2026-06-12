import type { DeepchatBridge } from '@shared/contracts/bridge'
import type { DeepchatEventPayload } from '@shared/contracts/events'
import { startupWorkloadChangedEvent } from '@shared/contracts/events'
import { startupGetBootstrapRoute } from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createStartupClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getBootstrap() {
    const result = await bridge.invoke(startupGetBootstrapRoute.name, {})
    return result.bootstrap
  }

  function onWorkloadChanged(
    listener: (payload: DeepchatEventPayload<'startup.workload.changed'>) => void
  ) {
    return bridge.on(startupWorkloadChangedEvent.name, listener)
  }

  return {
    getBootstrap,
    onWorkloadChanged
  }
}

export type StartupClient = ReturnType<typeof createStartupClient>
