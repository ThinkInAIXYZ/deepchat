import type { DeepchatBridge } from '@shared/contracts/bridge'
import type { MCPContentItem } from '@shared/types/mcp'
import {
  mcpConfigChangedEvent,
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
  mcpSetAutoDetectNpmRegistryRoute,
  mcpSetCustomNpmRegistryRoute,
  mcpSetEnabledRoute,
  mcpSetServerEnabledRoute,
  mcpStartServerAuthRoute,
  mcpStartServerRoute,
  mcpStopServerRoute,
  mcpSubmitSamplingDecisionRoute,
  mcpUpdateServerRoute
} from '@shared/contracts/routes'
import type {
  MCPServerConfig,
  MCPToolCall,
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

  async function getServerAuthStatus(serverName: string) {
    const result = await bridge.invoke(mcpGetServerAuthStatusRoute.name, { serverName })
    return result.status
  }

  async function startServerAuth(serverName: string) {
    const result = await bridge.invoke(mcpStartServerAuthRoute.name, { serverName })
    return result.status
  }

  async function completeServerAuthFromCallbackUrl(serverName: string, callbackUrl: string) {
    const result = await bridge.invoke(mcpCompleteServerAuthFromCallbackUrlRoute.name, {
      serverName,
      callbackUrl
    })
    return result.status
  }

  async function logoutServerAuth(serverName: string) {
    const result = await bridge.invoke(mcpLogoutServerAuthRoute.name, { serverName })
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
    startServerAuth,
    completeServerAuthFromCallbackUrl,
    logoutServerAuth,
    getPrompt,
    readResource,
    submitSamplingDecision,
    cancelSamplingRequest,
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
    onSamplingCancelled
  }
}

export type McpClient = ReturnType<typeof createMcpClient>
