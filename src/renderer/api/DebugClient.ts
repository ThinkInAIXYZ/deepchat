import type { DeepchatBridge } from '@shared/contracts/bridge'
import { debugCreateMockChatSessionRoute } from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createDebugClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function createMockChatSession() {
    return await bridge.invoke(debugCreateMockChatSessionRoute.name, {})
  }

  return {
    createMockChatSession
  }
}

export type DebugClient = ReturnType<typeof createDebugClient>
