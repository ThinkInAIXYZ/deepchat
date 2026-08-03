import type { McpAppHostPort, McpServicePort } from '@shared/types/mcp'
import {
  configGetMcpServersRoute,
  mcpAddServerRoute,
  mcpAppsAuthorizeMessageRoute,
  mcpAppsCallToolRoute,
  mcpAppsListPromptsRoute,
  mcpAppsListResourcesRoute,
  mcpAppsListResourceTemplatesRoute,
  mcpAppsListToolsRoute,
  mcpAppsOpenLinkRoute,
  mcpAppsPrepareViewRoute,
  mcpAppsReadResourceRoute,
  mcpAppsReleaseViewRoute,
  mcpAppsRetryToolAccessRoute,
  mcpAppsSubmitConsentRoute,
  mcpAppsUpdateModelContextRoute,
  mcpCancelElicitationRequestRoute,
  mcpCallToolRoute,
  mcpCancelSamplingRequestRoute,
  mcpClearNpmRegistryCacheRoute,
  mcpCompleteServerAuthFromCallbackUrlRoute,
  mcpCredentialsGetStatusRoute,
  mcpCredentialsRemoveRoute,
  mcpCredentialsSetRoute,
  mcpEnterpriseProfilesCompleteAuthRoute,
  mcpEnterpriseProfilesGetStatusRoute,
  mcpEnterpriseProfilesListRoute,
  mcpEnterpriseProfilesLogoutRoute,
  mcpEnterpriseProfilesRemoveRoute,
  mcpEnterpriseProfilesSaveRoute,
  mcpEnterpriseProfilesSetClientSecretRoute,
  mcpEnterpriseProfilesStartAuthRoute,
  mcpGetClientsRoute,
  mcpGetEnabledRoute,
  mcpGetNpmRegistryStatusRoute,
  mcpGetPromptRoute,
  mcpGetServerAuthStatusRoute,
  mcpGetServerDiagnosticsRoute,
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
  mcpSetAutoDetectNpmRegistryRoute,
  mcpSetCustomNpmRegistryRoute,
  mcpSetEnabledRoute,
  mcpSetServerEnabledRoute,
  mcpStartServerAuthRoute,
  mcpStartServerRoute,
  mcpStopServerRoute,
  mcpSubmitSamplingDecisionRoute,
  mcpSubmitElicitationDecisionRoute,
  mcpUpdateServerRoute,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap, type RouteContext } from '@/routes/routeRegistry'
import { assertBoundedMcpJson } from './schemaValidation'

const MCP_APP_ROUTE_INPUT_MAX_BYTES = 3 * 1024 * 1024

const assertAppRouteInput = (rawInput: unknown): void => {
  assertBoundedMcpJson(rawInput, 'MCP App route input', MCP_APP_ROUTE_INPUT_MAX_BYTES)
}

export function createMcpRoutes(deps: {
  mcpService: McpServicePort
  mcpAppHost: McpAppHostPort
  isSettingsWindow(windowId: number | null): boolean
  recordSettingsActivity(input: SettingsActivityInput): Promise<unknown>
}): DeepchatRouteMap {
  const { mcpService } = deps
  const appContext = (context: RouteContext) => {
    if (context.windowId === null || deps.isSettingsWindow(context.windowId)) {
      throw new Error('MCP Apps are restricted to conversation windows')
    }
    return {
      webContentsId: context.webContentsId,
      windowId: context.windowId
    }
  }
  const assertSettingsWindow = (context: RouteContext): void => {
    if (!deps.isSettingsWindow(context.windowId)) {
      throw new Error('MCP credential changes are restricted to the settings window')
    }
  }
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
        const result = await mcpService.addMcpServer(input.serverName, input.config)
        if (result.status === 'added') {
          serverActivity(
            'created',
            input.serverName,
            'settings.controlCenter.activity.mcpServerCreated'
          )
        }
        return mcpAddServerRoute.output.parse({ result })
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
          status: await mcpService.getMcpServerAuthStatus(input.serverId)
        })
      }
    ],
    [
      mcpGetServerDiagnosticsRoute.name,
      async (rawInput) => {
        const input = mcpGetServerDiagnosticsRoute.input.parse(rawInput)
        return mcpGetServerDiagnosticsRoute.output.parse({
          diagnostics: await mcpService.getServerDiagnostics(input.serverId)
        })
      }
    ],
    [
      mcpStartServerAuthRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        const input = mcpStartServerAuthRoute.input.parse(rawInput)
        return mcpStartServerAuthRoute.output.parse({
          status: await mcpService.startMcpServerAuth(input.serverId)
        })
      }
    ],
    [
      mcpCompleteServerAuthFromCallbackUrlRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        const input = mcpCompleteServerAuthFromCallbackUrlRoute.input.parse(rawInput)
        return mcpCompleteServerAuthFromCallbackUrlRoute.output.parse({
          status: await mcpService.completeMcpServerAuthFromCallbackUrl(
            input.serverId,
            input.callbackUrl
          )
        })
      }
    ],
    [
      mcpLogoutServerAuthRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        const input = mcpLogoutServerAuthRoute.input.parse(rawInput)
        return mcpLogoutServerAuthRoute.output.parse({
          status: await mcpService.logoutMcpServerAuth(input.serverId)
        })
      }
    ],
    [
      mcpCredentialsGetStatusRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        const input = mcpCredentialsGetStatusRoute.input.parse(rawInput)
        return mcpCredentialsGetStatusRoute.output.parse({
          credentials: await mcpService.getMcpCredentialStatus(input.serverId)
        })
      }
    ],
    [
      mcpCredentialsSetRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        const input = mcpCredentialsSetRoute.input.parse(rawInput)
        return mcpCredentialsSetRoute.output.parse({
          status: await mcpService.setMcpCredential(input.binding, input.credential)
        })
      }
    ],
    [
      mcpCredentialsRemoveRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        const input = mcpCredentialsRemoveRoute.input.parse(rawInput)
        return mcpCredentialsRemoveRoute.output.parse({
          status: await mcpService.removeMcpCredential(input.binding, input.kind)
        })
      }
    ],
    [
      mcpEnterpriseProfilesListRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        mcpEnterpriseProfilesListRoute.input.parse(rawInput)
        return mcpEnterpriseProfilesListRoute.output.parse({
          profiles: await mcpService.listMcpEnterpriseProfiles()
        })
      }
    ],
    [
      mcpEnterpriseProfilesSaveRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        const input = mcpEnterpriseProfilesSaveRoute.input.parse(rawInput)
        return mcpEnterpriseProfilesSaveRoute.output.parse({
          profile: await mcpService.saveMcpEnterpriseProfile(input.profile)
        })
      }
    ],
    [
      mcpEnterpriseProfilesRemoveRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        const input = mcpEnterpriseProfilesRemoveRoute.input.parse(rawInput)
        await mcpService.removeMcpEnterpriseProfile(input.profileId)
        return mcpEnterpriseProfilesRemoveRoute.output.parse({ removed: true })
      }
    ],
    [
      mcpEnterpriseProfilesSetClientSecretRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        const input = mcpEnterpriseProfilesSetClientSecretRoute.input.parse(rawInput)
        return mcpEnterpriseProfilesSetClientSecretRoute.output.parse({
          status: await mcpService.setMcpEnterpriseProfileClientSecret(
            input.profileId,
            input.secret
          )
        })
      }
    ],
    [
      mcpEnterpriseProfilesGetStatusRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        const input = mcpEnterpriseProfilesGetStatusRoute.input.parse(rawInput)
        return mcpEnterpriseProfilesGetStatusRoute.output.parse({
          status: await mcpService.getMcpEnterpriseProfileStatus(input.profileId)
        })
      }
    ],
    [
      mcpEnterpriseProfilesStartAuthRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        const input = mcpEnterpriseProfilesStartAuthRoute.input.parse(rawInput)
        return mcpEnterpriseProfilesStartAuthRoute.output.parse({
          status: await mcpService.startMcpEnterpriseProfileAuth(input.profileId)
        })
      }
    ],
    [
      mcpEnterpriseProfilesCompleteAuthRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        const input = mcpEnterpriseProfilesCompleteAuthRoute.input.parse(rawInput)
        return mcpEnterpriseProfilesCompleteAuthRoute.output.parse({
          status: await mcpService.completeMcpEnterpriseProfileAuthFromCallbackUrl(
            input.profileId,
            input.callbackUrl
          )
        })
      }
    ],
    [
      mcpEnterpriseProfilesLogoutRoute.name,
      async (rawInput, context) => {
        assertSettingsWindow(context)
        const input = mcpEnterpriseProfilesLogoutRoute.input.parse(rawInput)
        return mcpEnterpriseProfilesLogoutRoute.output.parse({
          status: await mcpService.logoutMcpEnterpriseProfile(input.profileId)
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
      async (rawInput, context) => {
        appContext(context)
        const input = mcpSubmitSamplingDecisionRoute.input.parse(rawInput)
        await mcpService.submitSamplingDecision(input.decision)
        return mcpSubmitSamplingDecisionRoute.output.parse({ submitted: true })
      }
    ],
    [
      mcpCancelSamplingRequestRoute.name,
      async (rawInput, context) => {
        appContext(context)
        const input = mcpCancelSamplingRequestRoute.input.parse(rawInput)
        await mcpService.cancelSamplingRequest(input.requestId, input.reason)
        return mcpCancelSamplingRequestRoute.output.parse({ cancelled: true })
      }
    ],
    [
      mcpSubmitElicitationDecisionRoute.name,
      async (rawInput, context) => {
        appContext(context)
        const input = mcpSubmitElicitationDecisionRoute.input.parse(rawInput)
        await mcpService.submitElicitationDecision(input.decision)
        return mcpSubmitElicitationDecisionRoute.output.parse({ submitted: true })
      }
    ],
    [
      mcpCancelElicitationRequestRoute.name,
      async (rawInput, context) => {
        appContext(context)
        const input = mcpCancelElicitationRequestRoute.input.parse(rawInput)
        await mcpService.cancelElicitationRequest(input.requestId, input.reason)
        return mcpCancelElicitationRequestRoute.output.parse({ cancelled: true })
      }
    ],
    [
      mcpAppsPrepareViewRoute.name,
      async (rawInput, context) => {
        assertAppRouteInput(rawInput)
        const input = mcpAppsPrepareViewRoute.input.parse(rawInput)
        return mcpAppsPrepareViewRoute.output.parse({
          view: await deps.mcpAppHost.prepareView(input, appContext(context))
        })
      }
    ],
    [
      mcpAppsReleaseViewRoute.name,
      async (rawInput, context) => {
        assertAppRouteInput(rawInput)
        const input = mcpAppsReleaseViewRoute.input.parse(rawInput)
        await deps.mcpAppHost.releaseView(input.instanceId, appContext(context))
        return mcpAppsReleaseViewRoute.output.parse({ released: true })
      }
    ],
    [
      mcpAppsCallToolRoute.name,
      async (rawInput, context) => {
        assertAppRouteInput(rawInput)
        const input = mcpAppsCallToolRoute.input.parse(rawInput)
        return mcpAppsCallToolRoute.output.parse({
          call: await deps.mcpAppHost.callTool(
            input.instanceId,
            input.name,
            input.arguments,
            appContext(context)
          )
        })
      }
    ],
    [
      mcpAppsListToolsRoute.name,
      async (rawInput, context) => {
        assertAppRouteInput(rawInput)
        const input = mcpAppsListToolsRoute.input.parse(rawInput)
        return mcpAppsListToolsRoute.output.parse(
          await deps.mcpAppHost.listTools(input.instanceId, input.cursor, appContext(context))
        )
      }
    ],
    [
      mcpAppsReadResourceRoute.name,
      async (rawInput, context) => {
        assertAppRouteInput(rawInput)
        const input = mcpAppsReadResourceRoute.input.parse(rawInput)
        return mcpAppsReadResourceRoute.output.parse(
          await deps.mcpAppHost.readResource(input.instanceId, input.uri, appContext(context))
        )
      }
    ],
    [
      mcpAppsListResourcesRoute.name,
      async (rawInput, context) => {
        assertAppRouteInput(rawInput)
        const input = mcpAppsListResourcesRoute.input.parse(rawInput)
        return mcpAppsListResourcesRoute.output.parse(
          await deps.mcpAppHost.listResources(input.instanceId, input.cursor, appContext(context))
        )
      }
    ],
    [
      mcpAppsListResourceTemplatesRoute.name,
      async (rawInput, context) => {
        assertAppRouteInput(rawInput)
        const input = mcpAppsListResourceTemplatesRoute.input.parse(rawInput)
        return mcpAppsListResourceTemplatesRoute.output.parse(
          await deps.mcpAppHost.listResourceTemplates(
            input.instanceId,
            input.cursor,
            appContext(context)
          )
        )
      }
    ],
    [
      mcpAppsListPromptsRoute.name,
      async (rawInput, context) => {
        assertAppRouteInput(rawInput)
        const input = mcpAppsListPromptsRoute.input.parse(rawInput)
        return mcpAppsListPromptsRoute.output.parse(
          await deps.mcpAppHost.listPrompts(input.instanceId, input.cursor, appContext(context))
        )
      }
    ],
    [
      mcpAppsOpenLinkRoute.name,
      async (rawInput, context) => {
        assertAppRouteInput(rawInput)
        const input = mcpAppsOpenLinkRoute.input.parse(rawInput)
        return mcpAppsOpenLinkRoute.output.parse({
          opened: await deps.mcpAppHost.openLink(input.instanceId, input.url, appContext(context))
        })
      }
    ],
    [
      mcpAppsAuthorizeMessageRoute.name,
      async (rawInput, context) => {
        assertAppRouteInput(rawInput)
        const input = mcpAppsAuthorizeMessageRoute.input.parse(rawInput)
        return mcpAppsAuthorizeMessageRoute.output.parse({
          approved: await deps.mcpAppHost.authorizeMessage(
            input.instanceId,
            input.text,
            appContext(context)
          )
        })
      }
    ],
    [
      mcpAppsUpdateModelContextRoute.name,
      async (rawInput, context) => {
        assertAppRouteInput(rawInput)
        const input = mcpAppsUpdateModelContextRoute.input.parse(rawInput)
        return mcpAppsUpdateModelContextRoute.output.parse(
          await deps.mcpAppHost.updateModelContext(
            input.instanceId,
            {
              content: input.content,
              structuredContent: input.structuredContent
            },
            appContext(context)
          )
        )
      }
    ],
    [
      mcpAppsRetryToolAccessRoute.name,
      async (rawInput, context) => {
        assertAppRouteInput(rawInput)
        const input = mcpAppsRetryToolAccessRoute.input.parse(rawInput)
        await deps.mcpAppHost.retryToolAccess(input.instanceId, appContext(context))
        return mcpAppsRetryToolAccessRoute.output.parse({ retried: true })
      }
    ],
    [
      mcpAppsSubmitConsentRoute.name,
      async (rawInput, context) => {
        assertAppRouteInput(rawInput)
        const input = mcpAppsSubmitConsentRoute.input.parse(rawInput)
        await deps.mcpAppHost.submitConsent(input.requestId, input.approved, appContext(context))
        return mcpAppsSubmitConsentRoute.output.parse({ submitted: true })
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
    ]
  ])
}
