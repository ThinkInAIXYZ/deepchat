import type { DeepchatBridge } from '@shared/contracts/bridge'
import type { MCPContentItem } from '@shared/types/mcp'
import {
  mcpAppConsentRequestEvent,
  mcpConfigChangedEvent,
  mcpElicitationCancelledEvent,
  mcpElicitationDecisionEvent,
  mcpElicitationRequestEvent,
  mcpEnterpriseAuthChangedEvent,
  mcpSamplingCancelledEvent,
  mcpSamplingDecisionEvent,
  mcpSamplingRequestEvent,
  mcpServerAuthChangedEvent,
  mcpServerStartedEvent,
  mcpServerStatusChangedEvent,
  mcpServerStoppedEvent,
  mcpToolCallResultEvent
} from '@shared/contracts/events'
import {
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
  mcpCallToolRoute,
  mcpCancelElicitationRequestRoute,
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
  mcpUpdateServerRoute
} from '@shared/contracts/routes'
import type {
  MCPServerConfig,
  MCPToolCall,
  McpAppConsentRequestPayload,
  McpAppDescriptor,
  McpCredentialBinding,
  McpCredentialInput,
  McpCredentialKind,
  McpElicitationDecision,
  McpElicitationRequestPayload,
  McpEnterpriseIdentityProfile,
  McpEnterpriseIdentityStatus,
  McpSamplingDecision,
  PromptListEntry,
  ResourceListEntry
} from '@shared/types/mcp'
import { getDeepchatBridge } from './core'

export function createMcpClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getMcpServers() {
    const result = await bridge.invoke(mcpGetServersRoute.name, {})
    return result.servers
  }

  async function getMcpEnabled() {
    const result = await bridge.invoke(mcpGetEnabledRoute.name, {})
    return result.enabled
  }

  async function getMcpClients() {
    const result = await bridge.invoke(mcpGetClientsRoute.name, {})
    return result.clients
  }

  async function getAllToolDefinitions(enabledMcpTools?: string[]) {
    const result = await bridge.invoke(mcpListToolDefinitionsRoute.name, {
      enabledMcpTools
    })
    return result.tools
  }

  async function getAllPrompts() {
    const result = await bridge.invoke(mcpListPromptsRoute.name, {})
    return result.prompts
  }

  async function getAllResources() {
    const result = await bridge.invoke(mcpListResourcesRoute.name, {})
    return result.resources
  }

  async function callTool(request: MCPToolCall) {
    return await bridge.invoke(mcpCallToolRoute.name, { request })
  }

  async function addMcpServer(serverName: string, config: MCPServerConfig) {
    const result = await bridge.invoke(mcpAddServerRoute.name, { serverName, config })
    return result.result
  }

  async function updateMcpServer(serverName: string, config: Partial<MCPServerConfig>) {
    await bridge.invoke(mcpUpdateServerRoute.name, { serverName, config })
  }

  async function removeMcpServer(serverName: string) {
    await bridge.invoke(mcpRemoveServerRoute.name, { serverName })
  }

  async function setMcpServerEnabled(serverName: string, enabled: boolean) {
    const result = await bridge.invoke(mcpSetServerEnabledRoute.name, {
      serverName,
      enabled
    })
    return result.enabled
  }

  async function setMcpEnabled(enabled: boolean) {
    const result = await bridge.invoke(mcpSetEnabledRoute.name, { enabled })
    return result.enabled
  }

  async function isServerRunning(serverName: string) {
    const result = await bridge.invoke(mcpIsServerRunningRoute.name, { serverName })
    return result.running
  }

  async function startServer(serverName: string) {
    await bridge.invoke(mcpStartServerRoute.name, { serverName })
  }

  async function stopServer(serverName: string) {
    await bridge.invoke(mcpStopServerRoute.name, { serverName })
  }

  async function resolveServerId(serverName: string): Promise<string> {
    const servers = await getMcpServers()
    const serverId = servers[serverName]?.serverId
    if (!serverId) {
      throw new Error(`MCP server identity is unavailable for ${serverName}`)
    }
    return serverId
  }

  async function getServerAuthStatus(serverName: string) {
    const result = await bridge.invoke(mcpGetServerAuthStatusRoute.name, {
      serverId: await resolveServerId(serverName)
    })
    return result.status
  }

  async function getServerDiagnostics(serverName: string) {
    const result = await bridge.invoke(mcpGetServerDiagnosticsRoute.name, {
      serverId: await resolveServerId(serverName)
    })
    return result.diagnostics
  }

  async function startServerAuth(serverName: string) {
    const result = await bridge.invoke(mcpStartServerAuthRoute.name, {
      serverId: await resolveServerId(serverName)
    })
    return result.status
  }

  async function completeServerAuthFromCallbackUrl(serverName: string, callbackUrl: string) {
    const result = await bridge.invoke(mcpCompleteServerAuthFromCallbackUrlRoute.name, {
      serverId: await resolveServerId(serverName),
      callbackUrl
    })
    return result.status
  }

  async function logoutServerAuth(serverName: string) {
    const result = await bridge.invoke(mcpLogoutServerAuthRoute.name, {
      serverId: await resolveServerId(serverName)
    })
    return result.status
  }

  async function getCredentialStatus(serverId: string) {
    const result = await bridge.invoke(mcpCredentialsGetStatusRoute.name, { serverId })
    return result.credentials
  }

  async function setCredential(binding: McpCredentialBinding, credential: McpCredentialInput) {
    const result = await bridge.invoke(mcpCredentialsSetRoute.name, {
      binding,
      credential
    })
    return result.status
  }

  async function removeCredential(binding: McpCredentialBinding, kind: McpCredentialKind) {
    const result = await bridge.invoke(mcpCredentialsRemoveRoute.name, { binding, kind })
    return result.status
  }

  async function listEnterpriseProfiles() {
    const result = await bridge.invoke(mcpEnterpriseProfilesListRoute.name, {})
    return result.profiles
  }

  async function saveEnterpriseProfile(profile: McpEnterpriseIdentityProfile) {
    const result = await bridge.invoke(mcpEnterpriseProfilesSaveRoute.name, { profile })
    return result.profile
  }

  async function removeEnterpriseProfile(profileId: string) {
    await bridge.invoke(mcpEnterpriseProfilesRemoveRoute.name, { profileId })
  }

  async function setEnterpriseProfileClientSecret(profileId: string, secret: string) {
    const result = await bridge.invoke(mcpEnterpriseProfilesSetClientSecretRoute.name, {
      profileId,
      secret
    })
    return result.status
  }

  async function getEnterpriseProfileStatus(profileId: string) {
    const result = await bridge.invoke(mcpEnterpriseProfilesGetStatusRoute.name, { profileId })
    return result.status
  }

  async function startEnterpriseProfileAuth(profileId: string) {
    const result = await bridge.invoke(mcpEnterpriseProfilesStartAuthRoute.name, { profileId })
    return result.status
  }

  async function completeEnterpriseProfileAuth(profileId: string, callbackUrl: string) {
    const result = await bridge.invoke(mcpEnterpriseProfilesCompleteAuthRoute.name, {
      profileId,
      callbackUrl
    })
    return result.status
  }

  async function logoutEnterpriseProfile(profileId: string) {
    const result = await bridge.invoke(mcpEnterpriseProfilesLogoutRoute.name, { profileId })
    return result.status
  }

  async function getPrompt(prompt: PromptListEntry, args?: Record<string, unknown>) {
    const result = await bridge.invoke(mcpGetPromptRoute.name, { prompt, args })
    return result.result
  }

  async function readResource(resource: ResourceListEntry) {
    const result = await bridge.invoke(mcpReadResourceRoute.name, { resource })
    return result.resource
  }

  async function submitSamplingDecision(decision: McpSamplingDecision) {
    await bridge.invoke(mcpSubmitSamplingDecisionRoute.name, { decision })
  }

  async function cancelSamplingRequest(requestId: string, reason?: string) {
    await bridge.invoke(mcpCancelSamplingRequestRoute.name, { requestId, reason })
  }

  async function submitElicitationDecision(decision: McpElicitationDecision) {
    await bridge.invoke(mcpSubmitElicitationDecisionRoute.name, { decision })
  }

  async function cancelElicitationRequest(requestId: string, reason?: string) {
    await bridge.invoke(mcpCancelElicitationRequestRoute.name, { requestId, reason })
  }

  async function prepareAppView(input: {
    descriptor: McpAppDescriptor
    conversationId: string
    messageId: string
    blockId: string
    toolInput: Record<string, unknown>
  }) {
    const result = await bridge.invoke(mcpAppsPrepareViewRoute.name, input)
    return result.view
  }

  async function releaseAppView(instanceId: string) {
    await bridge.invoke(mcpAppsReleaseViewRoute.name, { instanceId })
  }

  async function callAppTool(instanceId: string, name: string, args: Record<string, unknown>) {
    const result = await bridge.invoke(mcpAppsCallToolRoute.name, {
      instanceId,
      name,
      arguments: args
    })
    return result.call
  }

  async function readAppResource(instanceId: string, uri: string) {
    return await bridge.invoke(mcpAppsReadResourceRoute.name, { instanceId, uri })
  }

  async function listAppTools(instanceId: string, cursor?: string) {
    return await bridge.invoke(mcpAppsListToolsRoute.name, { instanceId, cursor })
  }

  async function listAppResources(instanceId: string, cursor?: string) {
    return await bridge.invoke(mcpAppsListResourcesRoute.name, { instanceId, cursor })
  }

  async function listAppResourceTemplates(instanceId: string, cursor?: string) {
    return await bridge.invoke(mcpAppsListResourceTemplatesRoute.name, {
      instanceId,
      cursor
    })
  }

  async function listAppPrompts(instanceId: string, cursor?: string) {
    return await bridge.invoke(mcpAppsListPromptsRoute.name, { instanceId, cursor })
  }

  async function openAppLink(instanceId: string, url: string) {
    const result = await bridge.invoke(mcpAppsOpenLinkRoute.name, { instanceId, url })
    return result.opened
  }

  async function authorizeAppMessage(instanceId: string, text: string) {
    const result = await bridge.invoke(mcpAppsAuthorizeMessageRoute.name, { instanceId, text })
    return result.approved
  }

  async function updateAppModelContext(
    instanceId: string,
    input: {
      content?: MCPContentItem[]
      structuredContent?: Record<string, unknown>
    }
  ) {
    return await bridge.invoke(mcpAppsUpdateModelContextRoute.name, {
      instanceId,
      ...input
    })
  }

  async function retryAppToolAccess(instanceId: string) {
    await bridge.invoke(mcpAppsRetryToolAccessRoute.name, { instanceId })
  }

  async function submitAppConsent(requestId: string, approved: boolean) {
    await bridge.invoke(mcpAppsSubmitConsentRoute.name, { requestId, approved })
  }

  async function getNpmRegistryStatus() {
    const result = await bridge.invoke(mcpGetNpmRegistryStatusRoute.name, {})
    return result.status
  }

  async function refreshNpmRegistry() {
    const result = await bridge.invoke(mcpRefreshNpmRegistryRoute.name, {})
    return result.registry
  }

  async function setCustomNpmRegistry(registry: string | undefined) {
    await bridge.invoke(mcpSetCustomNpmRegistryRoute.name, { registry })
  }

  async function setAutoDetectNpmRegistry(enabled: boolean) {
    await bridge.invoke(mcpSetAutoDetectNpmRegistryRoute.name, { enabled })
  }

  async function clearNpmRegistryCache() {
    await bridge.invoke(mcpClearNpmRegistryCacheRoute.name, {})
  }

  async function listMcpRouterServers(page: number, limit: number) {
    return await bridge.invoke(mcpRouterListServersRoute.name, { page, limit })
  }

  async function installMcpRouterServer(serverKey: string) {
    const result = await bridge.invoke(mcpRouterInstallServerRoute.name, { serverKey })
    return result.installed
  }

  async function getMcpRouterApiKey() {
    const result = await bridge.invoke(mcpRouterGetApiKeyRoute.name, {})
    return result.key
  }

  async function setMcpRouterApiKey(key: string) {
    await bridge.invoke(mcpRouterSetApiKeyRoute.name, { key })
  }

  async function isServerInstalled(source: string, sourceId: string) {
    const result = await bridge.invoke(mcpRouterIsServerInstalledRoute.name, { source, sourceId })
    return result.installed
  }

  async function listInstalledServerIds(source: string, sourceIds: string[]) {
    const result = await bridge.invoke(mcpRouterListInstalledServerIdsRoute.name, {
      source,
      sourceIds
    })
    return result.installedSourceIds
  }

  function onServerStarted(listener: (payload: { serverName: string; version: number }) => void) {
    return bridge.on(mcpServerStartedEvent.name, listener)
  }

  function onServerStopped(listener: (payload: { serverName: string; version: number }) => void) {
    return bridge.on(mcpServerStoppedEvent.name, listener)
  }

  function onConfigChanged(
    listener: (payload: {
      mcpServers: Record<string, MCPServerConfig>
      mcpEnabled: boolean
      version: number
    }) => void
  ) {
    return bridge.on(mcpConfigChangedEvent.name, listener)
  }

  function onServerStatusChanged(
    listener: (payload: { serverName: string; isRunning: boolean; version: number }) => void
  ) {
    return bridge.on(mcpServerStatusChangedEvent.name, listener)
  }

  function onServerAuthChanged(
    listener: (payload: {
      serverName: string
      status: Awaited<ReturnType<typeof getServerAuthStatus>>
      version: number
    }) => void
  ) {
    return bridge.on(mcpServerAuthChangedEvent.name, listener)
  }

  function onToolCallResult(
    listener: (payload: {
      functionName?: string
      content: string | MCPContentItem[]
      version: number
    }) => void
  ) {
    return bridge.on(mcpToolCallResultEvent.name, listener)
  }

  function onSamplingRequest(listener: (payload: { request: unknown; version: number }) => void) {
    return bridge.on(mcpSamplingRequestEvent.name, (payload) => {
      listener(payload as { request: unknown; version: number })
    })
  }

  function onSamplingDecision(listener: (payload: { decision: unknown; version: number }) => void) {
    return bridge.on(mcpSamplingDecisionEvent.name, (payload) => {
      listener(payload as { decision: unknown; version: number })
    })
  }

  function onSamplingCancelled(
    listener: (payload: { requestId: string; reason?: string; version: number }) => void
  ) {
    return bridge.on(mcpSamplingCancelledEvent.name, listener)
  }

  function onElicitationRequest(
    listener: (payload: { request: McpElicitationRequestPayload; version: number }) => void
  ) {
    return bridge.on(mcpElicitationRequestEvent.name, listener)
  }

  function onElicitationDecision(
    listener: (payload: { decision: McpElicitationDecision; version: number }) => void
  ) {
    return bridge.on(mcpElicitationDecisionEvent.name, listener)
  }

  function onElicitationCancelled(
    listener: (payload: { requestId: string; reason?: string; version: number }) => void
  ) {
    return bridge.on(mcpElicitationCancelledEvent.name, listener)
  }

  function onAppConsentRequest(
    listener: (payload: { request: McpAppConsentRequestPayload; version: number }) => void
  ) {
    return bridge.on(mcpAppConsentRequestEvent.name, listener)
  }

  function onEnterpriseAuthChanged(
    listener: (payload: { status: McpEnterpriseIdentityStatus; version: number }) => void
  ) {
    return bridge.on(mcpEnterpriseAuthChangedEvent.name, listener)
  }

  return {
    getMcpServers,
    getMcpEnabled,
    getMcpClients,
    getAllToolDefinitions,
    getAllPrompts,
    getAllResources,
    callTool,
    addMcpServer,
    updateMcpServer,
    removeMcpServer,
    setMcpServerEnabled,
    setMcpEnabled,
    isServerRunning,
    startServer,
    stopServer,
    getServerAuthStatus,
    getServerDiagnostics,
    startServerAuth,
    completeServerAuthFromCallbackUrl,
    logoutServerAuth,
    getCredentialStatus,
    setCredential,
    removeCredential,
    listEnterpriseProfiles,
    saveEnterpriseProfile,
    removeEnterpriseProfile,
    setEnterpriseProfileClientSecret,
    getEnterpriseProfileStatus,
    startEnterpriseProfileAuth,
    completeEnterpriseProfileAuth,
    logoutEnterpriseProfile,
    getPrompt,
    readResource,
    submitSamplingDecision,
    cancelSamplingRequest,
    submitElicitationDecision,
    cancelElicitationRequest,
    prepareAppView,
    releaseAppView,
    callAppTool,
    listAppTools,
    readAppResource,
    listAppResources,
    listAppResourceTemplates,
    listAppPrompts,
    openAppLink,
    authorizeAppMessage,
    updateAppModelContext,
    retryAppToolAccess,
    submitAppConsent,
    getNpmRegistryStatus,
    refreshNpmRegistry,
    setCustomNpmRegistry,
    setAutoDetectNpmRegistry,
    clearNpmRegistryCache,
    listMcpRouterServers,
    installMcpRouterServer,
    getMcpRouterApiKey,
    setMcpRouterApiKey,
    isServerInstalled,
    listInstalledServerIds,
    onServerStarted,
    onServerStopped,
    onConfigChanged,
    onServerStatusChanged,
    onServerAuthChanged,
    onToolCallResult,
    onSamplingRequest,
    onSamplingDecision,
    onSamplingCancelled,
    onElicitationRequest,
    onElicitationDecision,
    onElicitationCancelled,
    onAppConsentRequest,
    onEnterpriseAuthChanged
  }
}

export type McpClient = ReturnType<typeof createMcpClient>
