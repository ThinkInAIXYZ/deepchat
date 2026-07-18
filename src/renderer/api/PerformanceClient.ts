import type { DeepchatBridge } from '@shared/contracts/bridge'
import type { RendererPerformanceRecord } from '@shared/contracts/routes'
import { performanceRecordRendererRoute } from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createPerformanceClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function recordRenderer(record: RendererPerformanceRecord): Promise<boolean> {
    const result = await bridge.invoke(performanceRecordRendererRoute.name, record)
    return result.accepted
  }

  return {
    recordRenderer
  }
}

export type PerformanceClient = ReturnType<typeof createPerformanceClient>
