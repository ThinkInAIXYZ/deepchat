import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  mcpConfigChangedEvent,
  mcpSamplingCancelledEvent,
  mcpSamplingDecisionEvent,
  mcpSamplingRequestEvent,
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
  mcpGetClientsRoute,
  mcpGetEnabledRoute,
  mcpGetNpmRegistryStatusRoute,
  mcpGetPromptRoute,
  mcpGetServersRoute,
  mcpIsServerRunningRoute,
  mcpListPromptsRoute,
  mcpListResourcesRoute,
  mcpListToolDefinitionsRoute,
  mcpReadResourceRoute,
  mcpRefreshNpmRegistryRoute,
  mcpRemoveServerRoute,
  mcpSetAutoDetectNpmRegistryRoute,
  mcpSetCustomNpmRegistryRoute,
  mcpSetEnabledRoute,
  mcpSetServerEnabledRoute,
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
} from '@shared/presenter'
import { getDeepchatBridge } from './core'

export class McpClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async getMcpServers() {
    const result = await this.bridge.invoke(mcpGetServersRoute.name, {})
    return result.servers
  }

  async getMcpEnabled() {
    const result = await this.bridge.invoke(mcpGetEnabledRoute.name, {})
    return result.enabled
  }

  async getMcpClients() {
    const result = await this.bridge.invoke(mcpGetClientsRoute.name, {})
    return result.clients
  }

  async getAllToolDefinitions(enabledMcpTools?: string[]) {
    const result = await this.bridge.invoke(mcpListToolDefinitionsRoute.name, {
      enabledMcpTools
    })
    return result.tools
  }

  async getAllPrompts() {
    const result = await this.bridge.invoke(mcpListPromptsRoute.name, {})
    return result.prompts
  }

  async getAllResources() {
    const result = await this.bridge.invoke(mcpListResourcesRoute.name, {})
    return result.resources
  }

  async callTool(request: MCPToolCall) {
    return await this.bridge.invoke(mcpCallToolRoute.name, { request })
  }

  async addMcpServer(serverName: string, config: MCPServerConfig) {
    const result = await this.bridge.invoke(mcpAddServerRoute.name, { serverName, config })
    return result.success
  }

  async updateMcpServer(serverName: string, config: Partial<MCPServerConfig>) {
    await this.bridge.invoke(mcpUpdateServerRoute.name, { serverName, config })
  }

  async removeMcpServer(serverName: string) {
    await this.bridge.invoke(mcpRemoveServerRoute.name, { serverName })
  }

  async setMcpServerEnabled(serverName: string, enabled: boolean) {
    const result = await this.bridge.invoke(mcpSetServerEnabledRoute.name, {
      serverName,
      enabled
    })
    return result.enabled
  }

  async setMcpEnabled(enabled: boolean) {
    const result = await this.bridge.invoke(mcpSetEnabledRoute.name, { enabled })
    return result.enabled
  }

  async isServerRunning(serverName: string) {
    const result = await this.bridge.invoke(mcpIsServerRunningRoute.name, { serverName })
    return result.running
  }

  async startServer(serverName: string) {
    await this.bridge.invoke(mcpStartServerRoute.name, { serverName })
  }

  async stopServer(serverName: string) {
    await this.bridge.invoke(mcpStopServerRoute.name, { serverName })
  }

  async getPrompt(prompt: PromptListEntry, args?: Record<string, unknown>) {
    const result = await this.bridge.invoke(mcpGetPromptRoute.name, { prompt, args })
    return result.result
  }

  async readResource(resource: ResourceListEntry) {
    const result = await this.bridge.invoke(mcpReadResourceRoute.name, { resource })
    return result.resource
  }

  async submitSamplingDecision(decision: McpSamplingDecision) {
    await this.bridge.invoke(mcpSubmitSamplingDecisionRoute.name, { decision })
  }

  async cancelSamplingRequest(requestId: string, reason?: string) {
    await this.bridge.invoke(mcpCancelSamplingRequestRoute.name, { requestId, reason })
  }

  async getNpmRegistryStatus() {
    const result = await this.bridge.invoke(mcpGetNpmRegistryStatusRoute.name, {})
    return result.status
  }

  async refreshNpmRegistry() {
    const result = await this.bridge.invoke(mcpRefreshNpmRegistryRoute.name, {})
    return result.registry
  }

  async setCustomNpmRegistry(registry: string | undefined) {
    await this.bridge.invoke(mcpSetCustomNpmRegistryRoute.name, { registry })
  }

  async setAutoDetectNpmRegistry(enabled: boolean) {
    await this.bridge.invoke(mcpSetAutoDetectNpmRegistryRoute.name, { enabled })
  }

  async clearNpmRegistryCache() {
    await this.bridge.invoke(mcpClearNpmRegistryCacheRoute.name, {})
  }

  onServerStarted(listener: (payload: { serverName: string; version: number }) => void) {
    return this.bridge.on(mcpServerStartedEvent.name, listener)
  }

  onServerStopped(listener: (payload: { serverName: string; version: number }) => void) {
    return this.bridge.on(mcpServerStoppedEvent.name, listener)
  }

  onConfigChanged(
    listener: (payload: {
      mcpServers: Record<string, MCPServerConfig>
      mcpEnabled: boolean
      version: number
    }) => void
  ) {
    return this.bridge.on(mcpConfigChangedEvent.name, listener)
  }

  onServerStatusChanged(
    listener: (payload: { serverName: string; isRunning: boolean; version: number }) => void
  ) {
    return this.bridge.on(mcpServerStatusChangedEvent.name, listener)
  }

  onToolCallResult(
    listener: (payload: {
      functionName?: string
      content: string | { type: string; text: string }[]
      version: number
    }) => void
  ) {
    return this.bridge.on(mcpToolCallResultEvent.name, listener)
  }

  onSamplingRequest(listener: (payload: { request: unknown; version: number }) => void) {
    return this.bridge.on(mcpSamplingRequestEvent.name, (payload) => {
      listener(payload as { request: unknown; version: number })
    })
  }

  onSamplingDecision(listener: (payload: { decision: unknown; version: number }) => void) {
    return this.bridge.on(mcpSamplingDecisionEvent.name, (payload) => {
      listener(payload as { decision: unknown; version: number })
    })
  }

  onSamplingCancelled(
    listener: (payload: { requestId: string; reason?: string; version: number }) => void
  ) {
    return this.bridge.on(mcpSamplingCancelledEvent.name, listener)
  }
}
