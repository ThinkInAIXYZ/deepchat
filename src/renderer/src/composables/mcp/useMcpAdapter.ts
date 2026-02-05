import { usePresenter } from '@/composables/usePresenter'
import type {
  IPresenter,
  MCPConfig,
  MCPServerConfig,
  MCPToolDefinition,
  McpClient,
  Prompt,
  PromptListEntry,
  Resource,
  ResourceListEntry
} from '@shared/presenter'

type CallToolRequest = Parameters<IPresenter['mcpPresenter']['callTool']>[0]
type CallToolResult = Awaited<ReturnType<IPresenter['mcpPresenter']['callTool']>>

export type NpmRegistryStatus = {
  currentRegistry: string | null
  isFromCache: boolean
  lastChecked?: number
  autoDetectEnabled: boolean
  customRegistry?: string
}

export type McpAdapter = {
  getMcpServers: () => Promise<MCPConfig['mcpServers']>
  getMcpDefaultServers: () => Promise<string[]>
  getMcpEnabled: () => Promise<boolean>
  getAllToolDefinitions: () => Promise<MCPToolDefinition[]>
  getMcpClients: () => Promise<McpClient[]>
  getAllResources: () => Promise<ResourceListEntry[]>
  getAllPrompts: () => Promise<PromptListEntry[]>
  getCustomPrompts: () => Promise<Prompt[]>
  callTool: (request: CallToolRequest) => Promise<CallToolResult>
  isServerRunning: (serverName: string) => Promise<boolean>
  startServer: (serverName: string) => Promise<void>
  stopServer: (serverName: string) => Promise<void>
  getPrompt: (prompt: PromptListEntry, args?: Record<string, unknown>) => Promise<unknown>
  readResource: (resource: ResourceListEntry) => Promise<Resource>
  addMcpServer: (serverName: string, config: MCPServerConfig) => Promise<boolean>
  updateMcpServer: (serverName: string, config: Partial<MCPServerConfig>) => Promise<void>
  removeMcpServer: (serverName: string) => Promise<void>
  addMcpDefaultServer: (serverName: string) => Promise<void>
  removeMcpDefaultServer: (serverName: string) => Promise<void>
  resetToDefaultServers: () => Promise<void>
  setMcpEnabled: (enabled: boolean) => Promise<void>
  getNpmRegistryStatus: () => Promise<NpmRegistryStatus>
  refreshNpmRegistry: () => Promise<string>
  setCustomNpmRegistry: (registry: string | undefined) => Promise<void>
  setAutoDetectNpmRegistry: (enabled: boolean) => Promise<void>
  clearNpmRegistryCache: () => Promise<void>
}

export function useMcpAdapter(): McpAdapter {
  const mcpPresenter = usePresenter('mcpPresenter')
  const configPresenter = usePresenter('configPresenter')

  const getNpmRegistryStatus = async () => {
    if (!mcpPresenter.getNpmRegistryStatus) {
      throw new Error('NPM Registry status method not available')
    }
    return await mcpPresenter.getNpmRegistryStatus()
  }

  const refreshNpmRegistry = async () => {
    if (!mcpPresenter.refreshNpmRegistry) {
      throw new Error('NPM Registry refresh method not available')
    }
    return await mcpPresenter.refreshNpmRegistry()
  }

  const setCustomNpmRegistry = async (registry: string | undefined) => {
    if (!mcpPresenter.setCustomNpmRegistry) {
      throw new Error('Set custom NPM Registry method not available')
    }
    await mcpPresenter.setCustomNpmRegistry(registry)
  }

  const setAutoDetectNpmRegistry = async (enabled: boolean) => {
    if (!mcpPresenter.setAutoDetectNpmRegistry) {
      throw new Error('Set auto detect NPM Registry method not available')
    }
    await mcpPresenter.setAutoDetectNpmRegistry(enabled)
  }

  const clearNpmRegistryCache = async () => {
    if (!mcpPresenter.clearNpmRegistryCache) {
      throw new Error('Clear NPM Registry cache method not available')
    }
    await mcpPresenter.clearNpmRegistryCache()
  }

  return {
    getMcpServers: () => mcpPresenter.getMcpServers(),
    getMcpDefaultServers: () => mcpPresenter.getMcpDefaultServers(),
    getMcpEnabled: () => mcpPresenter.getMcpEnabled(),
    getAllToolDefinitions: () => mcpPresenter.getAllToolDefinitions(),
    getMcpClients: () => mcpPresenter.getMcpClients(),
    getAllResources: () => mcpPresenter.getAllResources(),
    getAllPrompts: () => mcpPresenter.getAllPrompts(),
    getCustomPrompts: () => configPresenter.getCustomPrompts(),
    callTool: (request: CallToolRequest) => mcpPresenter.callTool(request),
    isServerRunning: (serverName: string) => mcpPresenter.isServerRunning(serverName),
    startServer: (serverName: string) => mcpPresenter.startServer(serverName),
    stopServer: (serverName: string) => mcpPresenter.stopServer(serverName),
    getPrompt: (prompt: PromptListEntry, args?: Record<string, unknown>) =>
      mcpPresenter.getPrompt(prompt, args),
    readResource: (resource: ResourceListEntry) => mcpPresenter.readResource(resource),
    addMcpServer: (serverName: string, config: MCPServerConfig) =>
      mcpPresenter.addMcpServer(serverName, config),
    updateMcpServer: (serverName: string, config: Partial<MCPServerConfig>) =>
      mcpPresenter.updateMcpServer(serverName, config),
    removeMcpServer: (serverName: string) => mcpPresenter.removeMcpServer(serverName),
    addMcpDefaultServer: (serverName: string) => mcpPresenter.addMcpDefaultServer(serverName),
    removeMcpDefaultServer: (serverName: string) => mcpPresenter.removeMcpDefaultServer(serverName),
    resetToDefaultServers: () => mcpPresenter.resetToDefaultServers(),
    setMcpEnabled: (enabled: boolean) => mcpPresenter.setMcpEnabled(enabled),
    getNpmRegistryStatus,
    refreshNpmRegistry,
    setCustomNpmRegistry,
    setAutoDetectNpmRegistry,
    clearNpmRegistryCache
  }
}
