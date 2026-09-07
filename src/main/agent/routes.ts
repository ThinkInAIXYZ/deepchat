import type {
  CreateDeepChatAgentInput,
  UpdateDeepChatAgentInput
} from '@shared/types/agent-interface'
import {
  configAddManualAcpAgentRoute,
  configCreateDeepChatAgentRoute,
  configDeleteDeepChatAgentRoute,
  configEnsureAcpAgentInstalledRoute,
  configGetAcpRegistryIconMarkupRoute,
  configGetAcpSharedMcpSelectionsRoute,
  configGetAcpStateRoute,
  configGetAgentMcpSelectionsRoute,
  configListAcpRegistryAgentsRoute,
  configListAgentsRoute,
  configListManualAcpAgentsRoute,
  configRefreshAcpRegistryRoute,
  configRemoveManualAcpAgentRoute,
  configRepairAcpAgentRoute,
  configResolveDeepChatAgentConfigRoute,
  configSetAcpAgentEnabledRoute,
  configSetAcpAgentEnvOverrideRoute,
  configSetAcpEnabledRoute,
  configSetAcpSharedMcpSelectionsRoute,
  configUninstallAcpRegistryAgentRoute,
  configUpdateDeepChatAgentRoute,
  configUpdateManualAcpAgentRoute,
  type DeepchatRouteName,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import type { AgentSettingsPort } from './settings'

export function createAgentRoutes(deps: {
  agentSettings: AgentSettingsPort
  recordActivity(input: SettingsActivityInput): void
  reconcileScheduler(): Promise<void>
}): ReadonlyMap<DeepchatRouteName, (rawInput: unknown) => Promise<unknown>> {
  const { agentSettings } = deps
  const reconcileScheduler = async (): Promise<void> => {
    try {
      await deps.reconcileScheduler()
    } catch (error) {
      console.warn('[CronJobs] Failed to reconcile jobs after agent change:', error)
    }
  }

  return new Map<DeepchatRouteName, (rawInput: unknown) => Promise<unknown>>([
    [
      configGetAcpStateRoute.name,
      async (rawInput) => {
        configGetAcpStateRoute.input.parse(rawInput)
        const [enabled, agents] = await Promise.all([
          agentSettings.getAcpEnabled(),
          agentSettings.getAcpAgents()
        ])
        return configGetAcpStateRoute.output.parse({ enabled, agents })
      }
    ],
    [
      configSetAcpEnabledRoute.name,
      async (rawInput) => {
        const input = configSetAcpEnabledRoute.input.parse(rawInput)
        await agentSettings.setAcpEnabled(input.enabled)
        const result = configSetAcpEnabledRoute.output.parse({
          enabled: await agentSettings.getAcpEnabled()
        })
        await reconcileScheduler()
        return result
      }
    ],
    [
      configListAcpRegistryAgentsRoute.name,
      async (rawInput) => {
        configListAcpRegistryAgentsRoute.input.parse(rawInput)
        return configListAcpRegistryAgentsRoute.output.parse({
          agents: await agentSettings.listAcpRegistryAgents()
        })
      }
    ],
    [
      configRefreshAcpRegistryRoute.name,
      async (rawInput) => {
        const input = configRefreshAcpRegistryRoute.input.parse(rawInput)
        return configRefreshAcpRegistryRoute.output.parse({
          agents: await agentSettings.refreshAcpRegistry(input.force ?? true)
        })
      }
    ],
    [
      configSetAcpAgentEnabledRoute.name,
      async (rawInput) => {
        const input = configSetAcpAgentEnabledRoute.input.parse(rawInput)
        await agentSettings.setAcpAgentEnabled(input.agentId, input.enabled)
        const result = configSetAcpAgentEnabledRoute.output.parse({ ok: true })
        await reconcileScheduler()
        return result
      }
    ],
    [
      configSetAcpAgentEnvOverrideRoute.name,
      async (rawInput) => {
        const input = configSetAcpAgentEnvOverrideRoute.input.parse(rawInput)
        await agentSettings.setAcpAgentEnvOverride(input.agentId, input.env)
        return configSetAcpAgentEnvOverrideRoute.output.parse({ ok: true })
      }
    ],
    [
      configEnsureAcpAgentInstalledRoute.name,
      async (rawInput) => {
        const input = configEnsureAcpAgentInstalledRoute.input.parse(rawInput)
        return configEnsureAcpAgentInstalledRoute.output.parse({
          installState: await agentSettings.ensureAcpAgentInstalled(input.agentId)
        })
      }
    ],
    [
      configRepairAcpAgentRoute.name,
      async (rawInput) => {
        const input = configRepairAcpAgentRoute.input.parse(rawInput)
        return configRepairAcpAgentRoute.output.parse({
          installState: await agentSettings.repairAcpAgent(input.agentId)
        })
      }
    ],
    [
      configUninstallAcpRegistryAgentRoute.name,
      async (rawInput) => {
        const input = configUninstallAcpRegistryAgentRoute.input.parse(rawInput)
        await agentSettings.uninstallAcpRegistryAgent(input.agentId)
        const result = configUninstallAcpRegistryAgentRoute.output.parse({ ok: true })
        await reconcileScheduler()
        return result
      }
    ],
    [
      configListManualAcpAgentsRoute.name,
      async (rawInput) => {
        configListManualAcpAgentsRoute.input.parse(rawInput)
        return configListManualAcpAgentsRoute.output.parse({
          agents: await agentSettings.listManualAcpAgents()
        })
      }
    ],
    [
      configAddManualAcpAgentRoute.name,
      async (rawInput) => {
        const input = configAddManualAcpAgentRoute.input.parse(rawInput)
        return configAddManualAcpAgentRoute.output.parse({
          agent: await agentSettings.addManualAcpAgent(input)
        })
      }
    ],
    [
      configUpdateManualAcpAgentRoute.name,
      async (rawInput) => {
        const input = configUpdateManualAcpAgentRoute.input.parse(rawInput)
        const result = configUpdateManualAcpAgentRoute.output.parse({
          agent: await agentSettings.updateManualAcpAgent(input.agentId, input.updates)
        })
        await reconcileScheduler()
        return result
      }
    ],
    [
      configRemoveManualAcpAgentRoute.name,
      async (rawInput) => {
        const input = configRemoveManualAcpAgentRoute.input.parse(rawInput)
        const result = configRemoveManualAcpAgentRoute.output.parse({
          removed: await agentSettings.removeManualAcpAgent(input.agentId)
        })
        await reconcileScheduler()
        return result
      }
    ],
    [
      configListAgentsRoute.name,
      async (rawInput) => {
        const input = configListAgentsRoute.input.parse(rawInput)
        const idSet = input.ids ? new Set(input.ids) : null
        const agents = (await agentSettings.listAgents()).filter((agent) => {
          return (
            (!input.agentType || agent.type === input.agentType) && (!idSet || idSet.has(agent.id))
          )
        })
        return configListAgentsRoute.output.parse({ agents })
      }
    ],
    [
      configCreateDeepChatAgentRoute.name,
      async (rawInput) => {
        const input = configCreateDeepChatAgentRoute.input.parse(rawInput)
        return configCreateDeepChatAgentRoute.output.parse({
          agent: await agentSettings.createDeepChatAgent(input as CreateDeepChatAgentInput)
        })
      }
    ],
    [
      configUpdateDeepChatAgentRoute.name,
      async (rawInput) => {
        const input = configUpdateDeepChatAgentRoute.input.parse(rawInput)
        const result = configUpdateDeepChatAgentRoute.output.parse({
          agent: await agentSettings.updateDeepChatAgent(
            input.agentId,
            input.updates as UpdateDeepChatAgentInput
          )
        })
        await reconcileScheduler()
        return result
      }
    ],
    [
      configDeleteDeepChatAgentRoute.name,
      async (rawInput) => {
        const input = configDeleteDeepChatAgentRoute.input.parse(rawInput)
        const result = configDeleteDeepChatAgentRoute.output.parse(
          await agentSettings.deleteDeepChatAgentWithCleanup(input.agentId)
        )
        await reconcileScheduler()
        return result
      }
    ],
    [
      configResolveDeepChatAgentConfigRoute.name,
      async (rawInput) => {
        const input = configResolveDeepChatAgentConfigRoute.input.parse(rawInput)
        return configResolveDeepChatAgentConfigRoute.output.parse({
          config: await agentSettings.resolveDeepChatAgentConfig(input.agentId)
        })
      }
    ],
    [
      configGetAgentMcpSelectionsRoute.name,
      async (rawInput) => {
        const input = configGetAgentMcpSelectionsRoute.input.parse(rawInput)
        return configGetAgentMcpSelectionsRoute.output.parse({
          selections: await agentSettings.getAgentMcpSelections(input.agentId)
        })
      }
    ],
    [
      configGetAcpSharedMcpSelectionsRoute.name,
      async (rawInput) => {
        configGetAcpSharedMcpSelectionsRoute.input.parse(rawInput)
        return configGetAcpSharedMcpSelectionsRoute.output.parse({
          selections: await agentSettings.getAcpSharedMcpSelections()
        })
      }
    ],
    [
      configSetAcpSharedMcpSelectionsRoute.name,
      async (rawInput) => {
        const input = configSetAcpSharedMcpSelectionsRoute.input.parse(rawInput)
        await agentSettings.setAcpSharedMcpSelections(input.selections)
        deps.recordActivity({
          category: 'agent',
          action: 'updated',
          targetType: 'acp-shared-mcp',
          targetLabel: 'ACP shared MCP',
          routeName: 'settings-acp',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: { key: `ACP shared MCP (${input.selections.length})` }
        })
        return configSetAcpSharedMcpSelectionsRoute.output.parse({
          selections: await agentSettings.getAcpSharedMcpSelections()
        })
      }
    ],
    [
      configGetAcpRegistryIconMarkupRoute.name,
      async (rawInput) => {
        const input = configGetAcpRegistryIconMarkupRoute.input.parse(rawInput)
        return configGetAcpRegistryIconMarkupRoute.output.parse({
          markup: (await agentSettings.getAcpRegistryIconMarkup(input.agentId, input.iconUrl)) ?? ''
        })
      }
    ]
  ])
}
