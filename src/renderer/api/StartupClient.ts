import type { DeepchatBridge } from '@shared/contracts/bridge'
import { startupGetBootstrapRoute } from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createStartupClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getBootstrap() {
    const result = await bridge.invoke(startupGetBootstrapRoute.name, {})
    return result.bootstrap
  }

  return {
    getBootstrap
  }
}

export type StartupClient = ReturnType<typeof createStartupClient>
