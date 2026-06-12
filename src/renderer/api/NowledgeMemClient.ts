import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  nowledgeMemGetConfigRoute,
  nowledgeMemTestConnectionRoute,
  nowledgeMemUpdateConfigRoute,
  type NowledgeMemConfig,
  type NowledgeMemConnectionResult
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createNowledgeMemClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getConfig(): Promise<NowledgeMemConfig> {
    const result = await bridge.invoke(nowledgeMemGetConfigRoute.name, {})
    return result.config
  }

  async function updateConfig(config: Partial<NowledgeMemConfig>): Promise<NowledgeMemConfig> {
    const result = await bridge.invoke(nowledgeMemUpdateConfigRoute.name, { config })
    return result.config
  }

  async function testConnection(): Promise<NowledgeMemConnectionResult> {
    const result = await bridge.invoke(nowledgeMemTestConnectionRoute.name, {})
    return result.result
  }

  return {
    getConfig,
    updateConfig,
    testConnection
  }
}

export type NowledgeMemClient = ReturnType<typeof createNowledgeMemClient>
