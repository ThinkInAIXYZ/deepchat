import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  skillSyncDiscoveriesChangedEvent,
  skillSyncExportCompletedEvent,
  skillSyncExportProgressEvent,
  skillSyncExportStartedEvent,
  skillSyncImportCompletedEvent,
  skillSyncImportProgressEvent,
  skillSyncImportStartedEvent,
  skillSyncScanCompletedEvent,
  skillSyncScanStartedEvent
} from '@shared/contracts/events'
import {
  skillSyncAcknowledgeDiscoveriesRoute,
  skillSyncGetAgentDetailRoute,
  skillSyncGetAgentSkillDetailRoute,
  skillSyncGetNewDiscoveriesRoute,
  skillSyncGetRegisteredToolsRoute,
  skillSyncRemoveAgentSkillLinkRoute,
  skillSyncRepairAgentSkillLinkRoute,
  skillSyncScanAgentsRoute,
  skillSyncScanExternalToolsRoute
} from '@shared/contracts/routes'
import type {
  AgentSkillLinkInput,
  ExternalToolConfig,
  InstalledSkillAgent,
  InstalledSkillAgentDetail,
  LinkDeepChatSkillResult,
  NewDiscovery,
  ScanResult,
  SkillDetail,
  SyncResult
} from '@shared/types/skillSync'
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

  async function scanAgents(): Promise<InstalledSkillAgent[]> {
    const result = await bridge.invoke(skillSyncScanAgentsRoute.name, {})
    return result.agents as InstalledSkillAgent[]
  }

  async function getAgentDetail(agentId: string): Promise<InstalledSkillAgentDetail> {
    const result = await bridge.invoke(skillSyncGetAgentDetailRoute.name, { agentId })
    return result.agent as InstalledSkillAgentDetail
  }

  async function getAgentSkillDetail(agentId: string, skillName: string): Promise<SkillDetail> {
    const result = await bridge.invoke(skillSyncGetAgentSkillDetailRoute.name, {
      agentId,
      skillName
    })
    return result.detail as SkillDetail
  }

  async function repairAgentSkillLink(
    input: AgentSkillLinkInput
  ): Promise<LinkDeepChatSkillResult> {
    const result = await bridge.invoke(skillSyncRepairAgentSkillLinkRoute.name, input)
    return result.result as LinkDeepChatSkillResult
  }

  async function removeAgentSkillLink(
    input: AgentSkillLinkInput
  ): Promise<LinkDeepChatSkillResult> {
    const result = await bridge.invoke(skillSyncRemoveAgentSkillLinkRoute.name, input)
    return result.result as LinkDeepChatSkillResult
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

  function onImportStarted(listener: (total: number) => void): () => void {
    return bridge.on(skillSyncImportStartedEvent.name, (payload) => {
      listener(payload.total)
    })
  }

  function onImportProgress(
    listener: (progress: {
      current: number
      total: number
      skillName: string
      status: string
    }) => void
  ): () => void {
    return bridge.on(skillSyncImportProgressEvent.name, listener)
  }

  function onImportCompleted(listener: (result: SyncResult) => void): () => void {
    return bridge.on(skillSyncImportCompletedEvent.name, (payload) => {
      listener(payload.result as SyncResult)
    })
  }

  function onExportStarted(listener: (total: number) => void): () => void {
    return bridge.on(skillSyncExportStartedEvent.name, (payload) => {
      listener(payload.total)
    })
  }

  function onExportProgress(
    listener: (progress: {
      current: number
      total: number
      skillName: string
      status: string
    }) => void
  ): () => void {
    return bridge.on(skillSyncExportProgressEvent.name, listener)
  }

  function onExportCompleted(listener: (result: SyncResult) => void): () => void {
    return bridge.on(skillSyncExportCompletedEvent.name, (payload) => {
      listener(payload.result as SyncResult)
    })
  }

  return {
    scanExternalTools,
    getNewDiscoveries,
    acknowledgeDiscoveries,
    getRegisteredTools,
    scanAgents,
    getAgentDetail,
    getAgentSkillDetail,
    repairAgentSkillLink,
    removeAgentSkillLink,
    onDiscoveriesChanged,
    onScanStarted,
    onScanCompleted,
    onImportStarted,
    onImportProgress,
    onImportCompleted,
    onExportStarted,
    onExportProgress,
    onExportCompleted
  }
}

export type SkillSyncClient = ReturnType<typeof createSkillSyncClient>
