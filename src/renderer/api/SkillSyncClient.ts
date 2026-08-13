import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  skillSyncDiscoveriesChangedEvent,
  skillSyncScanCompletedEvent,
  skillSyncScanStartedEvent
} from '@shared/contracts/events'
import {
  skillSyncAcknowledgeDiscoveriesRoute,
  skillSyncGetNewDiscoveriesRoute,
  skillSyncGetRegisteredToolsRoute,
  skillSyncScanExternalToolsRoute
} from '@shared/contracts/routes'
import type { ExternalToolConfig, NewDiscovery, ScanResult } from '@shared/types/skillSync'
import { getDeepchatBridge } from './core'

export function createSkillSyncClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function scanExternalTools(): Promise<ScanResult[]> {
    const result = await bridge.invoke(skillSyncScanExternalToolsRoute.name, {})
    return result.results as ScanResult[]
  }

  async function getNewDiscoveries(): Promise<NewDiscovery[]> {
    const result = await bridge.invoke(skillSyncGetNewDiscoveriesRoute.name, {})
    return result.discoveries as NewDiscovery[]
  }

  async function acknowledgeDiscoveries(): Promise<boolean> {
    const result = await bridge.invoke(skillSyncAcknowledgeDiscoveriesRoute.name, {})
    return result.acknowledged
  }

  async function getRegisteredTools(): Promise<ExternalToolConfig[]> {
    const result = await bridge.invoke(skillSyncGetRegisteredToolsRoute.name, {})
    return result.tools as ExternalToolConfig[]
  }

  function onDiscoveriesChanged(listener: (discoveries: NewDiscovery[]) => void): () => void {
    return bridge.on(skillSyncDiscoveriesChangedEvent.name, (payload) => {
      listener(payload.discoveries as NewDiscovery[])
    })
  }

  function onScanStarted(listener: () => void): () => void {
    return bridge.on(skillSyncScanStartedEvent.name, listener)
  }

  function onScanCompleted(listener: (results: ScanResult[]) => void): () => void {
    return bridge.on(skillSyncScanCompletedEvent.name, (payload) => {
      listener(payload.results as ScanResult[])
    })
  }

  return {
    scanExternalTools,
    getNewDiscoveries,
    acknowledgeDiscoveries,
    getRegisteredTools,
    onDiscoveriesChanged,
    onScanStarted,
    onScanCompleted
  }
}

export type SkillSyncClient = ReturnType<typeof createSkillSyncClient>
