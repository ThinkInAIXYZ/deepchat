import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  debugCloseSplashScenarioRoute,
  debugCreateMockChatSessionRoute,
  debugShowSplashScenarioRoute
} from '@shared/contracts/routes'
import type { SplashDebugMode } from '@shared/contracts/splash'
import { getDeepchatBridge } from './core'

export function createDebugClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function createMockChatSession() {
    return await bridge.invoke(debugCreateMockChatSessionRoute.name, {})
  }

  async function showSplashScenario(mode: SplashDebugMode) {
    return await bridge.invoke(debugShowSplashScenarioRoute.name, { mode })
  }

  async function closeSplashScenario() {
    return await bridge.invoke(debugCloseSplashScenarioRoute.name, {})
  }

  return {
    createMockChatSession,
    showSplashScenario,
    closeSplashScenario
  }
}

export type DebugClient = ReturnType<typeof createDebugClient>
