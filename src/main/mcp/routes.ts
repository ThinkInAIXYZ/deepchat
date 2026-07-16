import type { McpServicePort } from '@shared/types/mcp'
import {
  configGetMcpServersRoute,
  mcpAddServerRoute,
  mcpCallToolRoute,
  mcpCancelSamplingRequestRoute,
  mcpClearNpmRegistryCacheRoute,
  mcpCompleteServerAuthFromCallbackUrlRoute,
  mcpGetClientsRoute,
  mcpGetEnabledRoute,
  mcpGetNpmRegistryStatusRoute,
  mcpGetPromptRoute,
  mcpGetServerAuthStatusRoute,
  mcpGetServersRoute,
  mcpIsServerRunningRoute,
  mcpListPromptsRoute,
  mcpListResourcesRoute,
  mcpListToolDefinitionsRoute,
  mcpLogoutServerAuthRoute,
  mcpReadResourceRoute,
  mcpRefreshNpmRegistryRoute,
  mcpRemoveServerRoute,
  mcpRouterGetApiKeyRoute,
  mcpRouterInstallServerRoute,
  mcpRouterIsServerInstalledRoute,
  mcpRouterListInstalledServerIdsRoute,
  mcpRouterListServersRoute,
  mcpRouterSetApiKeyRoute,
  mcpRouterUpdateServersAuthRoute,
  mcpSetAutoDetectNpmRegistryRoute,
  mcpSetCustomNpmRegistryRoute,
  mcpSetEnabledRoute,
  mcpSetServerEnabledRoute,
  mcpStartServerAuthRoute,
  mcpStartServerRoute,
  mcpStopServerRoute,
  mcpSubmitSamplingDecisionRoute,
  mcpUpdateServerRoute,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export function createMcpRoutes(deps: {
  mcpService: McpServicePort
  recordSettingsActivity(input: SettingsActivityInput): Promise<unknown>
}): DeepchatRouteMap {
  const { mcpService } = deps
  const recordActivity = (input: SettingsActivityInput): void => {
    void deps.recordSettingsActivity(input).catch((error) => {
      console.warn('[SettingsActivity] Failed to record MCP activity:', error)
    })
  }
  const serverActivity = (
    action: SettingsActivityInput['action'],
    serverName: string,
    summaryKey: string
  ): void => {
    recordActivity({
      category: 'mcp',
      action,
      targetType: 'mcp-server',
      targetId: serverName,
      targetLabel: serverName,
      routeName: 'settings-mcp',
      summaryKey,
      summaryParams: { name: serverName }
    })
  }

  return createRouteMap([
    [
      configGetMcpServersRoute.name,
      async (rawInput) => {
        configGetMcpServersRoute.input.parse(rawInput)
        return configGetMcpServersRoute.output.parse({ servers: await mcpService.getMcpServers() })
      }
    ],
    [
      mcpGetServersRoute.name,
      async (rawInput) => {
        mcpGetServersRoute.input.parse(rawInput)
        return mcpGetServersRoute.output.parse({ servers: await mcpService.getMcpServers() })
      }
    ],
    [
      mcpGetEnabledRoute.name,
      async (rawInput) => {
        mcpGetEnabledRoute.input.parse(rawInput)
        return mcpGetEnabledRoute.output.parse({ enabled: await mcpService.getMcpEnabled() })
      }
    ],
    [
      mcpGetClientsRoute.name,
      async (rawInput) => {
        mcpGetClientsRoute.input.parse(rawInput)
        return mcpGetClientsRoute.output.parse({ clients: await mcpService.getMcpClients() })
      }
    ],
    [
      mcpListToolDefinitionsRoute.name,
      async (rawInput) => {
        const input = mcpListToolDefinitionsRoute.input.parse(rawInput)
        return mcpListToolDefinitionsRoute.output.parse({
          tools: await mcpService.getAllToolDefinitions(input.enabledMcpTools)
        })
      }
    ],
    [
      mcpListPromptsRoute.name,
      async (rawInput) => {
        mcpListPromptsRoute.input.parse(rawInput)
        return mcpListPromptsRoute.output.parse({ prompts: await mcpService.getAllPrompts() })
      }
    ],
    [
      mcpListResourcesRoute.name,
      async (rawInput) => {
        mcpListResourcesRoute.input.parse(rawInput)
        return mcpListResourcesRoute.output.parse({ resources: await mcpService.getAllResources() })
      }
    ],
    [
      mcpCallToolRoute.name,
      async (rawInput) => {
        const input = mcpCallToolRoute.input.parse(rawInput)
        return mcpCallToolRoute.output.parse(await mcpService.callTool(input.request))
      }
    ],
    [
      mcpAddServerRoute.name,
      async (rawInput) => {
        const input = mcpAddServerRoute.input.parse(rawInput)
        const success = await mcpService.addMcpServer(input.serverName, input.config)
        if (success) {
          serverActivity(
            'created',
            input.serverName,
            'settings.controlCenter.activity.mcpServerCreated'
          )
        }
        return mcpAddServerRoute.output.parse({ success })
      }
    ],
    [
      mcpUpdateServerRoute.name,
      async (rawInput) => {
        const input = mcpUpdateServerRoute.input.parse(rawInput)
        await mcpService.updateMcpServer(input.serverName, input.config)
        serverActivity(
          'updated',
          input.serverName,
          'settings.controlCenter.activity.mcpServerUpdated'
        )
        return mcpUpdateServerRoute.output.parse({ updated: true })
      }
    ],
    [
      mcpRemoveServerRoute.name,
      async (rawInput) => {
        const input = mcpRemoveServerRoute.input.parse(rawInput)
        await mcpService.removeMcpServer(input.serverName)
        serverActivity(
          'removed',
          input.serverName,
          'settings.controlCenter.activity.mcpServerRemoved'
        )
        return mcpRemoveServerRoute.output.parse({ removed: true })
      }
    ],
    [
      mcpSetServerEnabledRoute.name,
      async (rawInput) => {
        const input = mcpSetServerEnabledRoute.input.parse(rawInput)
        await mcpService.setMcpServerEnabled(input.serverName, input.enabled)
        serverActivity(
          input.enabled ? 'enabled' : 'disabled',
          input.serverName,
          'settings.controlCenter.activity.mcpServerStatusChanged'
        )
        return mcpSetServerEnabledRoute.output.parse({ enabled: input.enabled })
      }
    ],
    [
      mcpSetEnabledRoute.name,
      async (rawInput) => {
        const input = mcpSetEnabledRoute.input.parse(rawInput)
        await mcpService.setMcpEnabled(input.enabled)
        recordActivity({
          category: 'mcp',
          action: input.enabled ? 'enabled' : 'disabled',
          targetType: 'mcp',
          targetId: 'global',
          targetLabel: 'MCP',
          routeName: 'settings-mcp',
          summaryKey: 'settings.controlCenter.activity.mcpGlobalStatusChanged',
          summaryParams: { status: input.enabled ? 'enabled' : 'disabled' }
        })
        return mcpSetEnabledRoute.output.parse({ enabled: input.enabled })
      }
    ],
    [
      mcpIsServerRunningRoute.name,
      async (rawInput) => {
        const input = mcpIsServerRunningRoute.input.parse(rawInput)
        return mcpIsServerRunningRoute.output.parse({
          running: await mcpService.isServerRunning(input.serverName)
        })
      }
    ],
    [
      mcpStartServerRoute.name,
      async (rawInput) => {
        const input = mcpStartServerRoute.input.parse(rawInput)
        await mcpService.startServer(input.serverName)
        serverActivity(
          'enabled',
          input.serverName,
          'settings.controlCenter.activity.mcpServerStarted'
        )
        return mcpStartServerRoute.output.parse({ started: true })
      }
    ],
    [
      mcpStopServerRoute.name,
      async (rawInput) => {
        const input = mcpStopServerRoute.input.parse(rawInput)
        await mcpService.stopServer(input.serverName)
        serverActivity(
          'disabled',
          input.serverName,
          'settings.controlCenter.activity.mcpServerStopped'
        )
        return mcpStopServerRoute.output.parse({ stopped: true })
      }
    ],
    [
      mcpGetServerAuthStatusRoute.name,
      async (rawInput) => {
        const input = mcpGetServerAuthStatusRoute.input.parse(rawInput)
        return mcpGetServerAuthStatusRoute.output.parse({
          status: await mcpService.getMcpServerAuthStatus(input.serverName)
        })
      }
    ],
    [
      mcpStartServerAuthRoute.name,
      async (rawInput) => {
        const input = mcpStartServerAuthRoute.input.parse(rawInput)
        return mcpStartServerAuthRoute.output.parse({
          status: await mcpService.startMcpServerAuth(input.serverName)
        })
      }
    ],
    [
      mcpCompleteServerAuthFromCallbackUrlRoute.name,
      async (rawInput) => {
        const input = mcpCompleteServerAuthFromCallbackUrlRoute.input.parse(rawInput)
        return mcpCompleteServerAuthFromCallbackUrlRoute.output.parse({
          status: await mcpService.completeMcpServerAuthFromCallbackUrl(
            input.serverName,
            input.callbackUrl
          )
        })
      }
    ],
    [
      mcpLogoutServerAuthRoute.name,
      async (rawInput) => {
        const input = mcpLogoutServerAuthRoute.input.parse(rawInput)
        return mcpLogoutServerAuthRoute.output.parse({
          status: await mcpService.logoutMcpServerAuth(input.serverName)
        })
      }
    ],
    [
      mcpGetPromptRoute.name,
      async (rawInput) => {
        const input = mcpGetPromptRoute.input.parse(rawInput)
        return mcpGetPromptRoute.output.parse({
          result: await mcpService.getPrompt(input.prompt, input.args)
        })
      }
    ],
    [
      mcpReadResourceRoute.name,
      async (rawInput) => {
        const input = mcpReadResourceRoute.input.parse(rawInput)
        return mcpReadResourceRoute.output.parse({
          resource: await mcpService.readResource(input.resource)
        })
      }
    ],
    [
      mcpSubmitSamplingDecisionRoute.name,
      async (rawInput) => {
        const input = mcpSubmitSamplingDecisionRoute.input.parse(rawInput)
        await mcpService.submitSamplingDecision(input.decision)
        return mcpSubmitSamplingDecisionRoute.output.parse({ submitted: true })
      }
    ],
    [
      mcpCancelSamplingRequestRoute.name,
      async (rawInput) => {
        const input = mcpCancelSamplingRequestRoute.input.parse(rawInput)
        await mcpService.cancelSamplingRequest(input.requestId, input.reason)
        return mcpCancelSamplingRequestRoute.output.parse({ cancelled: true })
      }
    ],
    [
      mcpGetNpmRegistryStatusRoute.name,
      async (rawInput) => {
        mcpGetNpmRegistryStatusRoute.input.parse(rawInput)
        return mcpGetNpmRegistryStatusRoute.output.parse({
          status: await mcpService.getNpmRegistryStatus()
        })
      }
    ],
    [
      mcpRefreshNpmRegistryRoute.name,
      async (rawInput) => {
        mcpRefreshNpmRegistryRoute.input.parse(rawInput)
        const registry = await mcpService.refreshNpmRegistry()
        recordActivity({
          category: 'mcp',
          action: 'refreshed',
          targetType: 'npm-registry',
          targetId: 'npm',
          targetLabel: registry,
          routeName: 'settings-mcp',
          summaryKey: 'settings.controlCenter.activity.mcpRegistryRefreshed',
          summaryParams: {}
        })
        return mcpRefreshNpmRegistryRoute.output.parse({ registry })
      }
    ],
    [
      mcpSetCustomNpmRegistryRoute.name,
      async (rawInput) => {
        const input = mcpSetCustomNpmRegistryRoute.input.parse(rawInput)
        await mcpService.setCustomNpmRegistry(input.registry)
        return mcpSetCustomNpmRegistryRoute.output.parse({ updated: true })
      }
    ],
    [
      mcpSetAutoDetectNpmRegistryRoute.name,
      async (rawInput) => {
        const input = mcpSetAutoDetectNpmRegistryRoute.input.parse(rawInput)
        await mcpService.setAutoDetectNpmRegistry(input.enabled)
        return mcpSetAutoDetectNpmRegistryRoute.output.parse({ enabled: input.enabled })
      }
    ],
    [
      mcpClearNpmRegistryCacheRoute.name,
      async (rawInput) => {
        mcpClearNpmRegistryCacheRoute.input.parse(rawInput)
        await mcpService.clearNpmRegistryCache()
        return mcpClearNpmRegistryCacheRoute.output.parse({ cleared: true })
      }
    ],
    [
      mcpRouterListServersRoute.name,
      async (rawInput) => {
        const input = mcpRouterListServersRoute.input.parse(rawInput)
        const data = await mcpService.listMcpRouterServers(input.page, input.limit)
        return mcpRouterListServersRoute.output.parse({ servers: data.servers })
      }
    ],
    [
      mcpRouterInstallServerRoute.name,
      async (rawInput) => {
        const input = mcpRouterInstallServerRoute.input.parse(rawInput)
        return mcpRouterInstallServerRoute.output.parse({
          installed: await mcpService.installMcpRouterServer(input.serverKey)
        })
      }
    ],
    [
      mcpRouterGetApiKeyRoute.name,
      async (rawInput) => {
        mcpRouterGetApiKeyRoute.input.parse(rawInput)
        return mcpRouterGetApiKeyRoute.output.parse({
          key: await mcpService.getMcpRouterApiKey()
        })
      }
    ],
    [
      mcpRouterSetApiKeyRoute.name,
      async (rawInput) => {
        const input = mcpRouterSetApiKeyRoute.input.parse(rawInput)
        await mcpService.setMcpRouterApiKey(input.key)
        return mcpRouterSetApiKeyRoute.output.parse({ saved: true })
      }
    ],
    [
      mcpRouterIsServerInstalledRoute.name,
      async (rawInput) => {
        const input = mcpRouterIsServerInstalledRoute.input.parse(rawInput)
        return mcpRouterIsServerInstalledRoute.output.parse({
          installed: await mcpService.isServerInstalled(input.source, input.sourceId)
        })
      }
    ],
    [
      mcpRouterListInstalledServerIdsRoute.name,
      async (rawInput) => {
        const input = mcpRouterListInstalledServerIdsRoute.input.parse(rawInput)
        return mcpRouterListInstalledServerIdsRoute.output.parse({
          installedSourceIds: await mcpService.listInstalledServerIds(input.source, input.sourceIds)
        })
      }
    ],
    [
      mcpRouterUpdateServersAuthRoute.name,
      async (rawInput) => {
        const input = mcpRouterUpdateServersAuthRoute.input.parse(rawInput)
        await mcpService.updateMcpRouterServersAuth(input.apiKey)
        return mcpRouterUpdateServersAuthRoute.output.parse({ updated: true })
      }
    ]
  ])
}
