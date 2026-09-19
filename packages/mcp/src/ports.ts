import type { Transport } from '@modelcontextprotocol/client'
import type { StdioServerParameters } from '@modelcontextprotocol/client/stdio'

export interface ManagedMcpStdio {
  transport: Transport
  terminate(): Promise<boolean>
}
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { MCPServerConfig } from '@deepchat/shared/types/mcp'
import type { MODEL_META } from '@deepchat/shared/types/provider'

export interface McpModelCatalog {
  getProviderModels(providerId: string): MODEL_META[]
  getCustomModels(providerId: string): MODEL_META[]
}

export type InMemoryServerFactory = (
  name: string,
  args: string[],
  env?: Record<string, unknown>
) => { startServer(transport: Transport): Promise<void> | void }

export interface McpOAuthPort {
  createRuntimeProvider(
    name: string,
    config: Partial<MCPServerConfig>
  ): Promise<OAuthClientProvider | undefined>
  getUsableAuthorizationExtensions(config: Partial<MCPServerConfig>): string[]
  handleConnectionError(name: string, config: Partial<MCPServerConfig>, error: unknown): boolean
}

export interface McpClientHost {
  identity: { name: string; version: string }
  home: string
  initializeRuntimes(): void
  expandPath(value: string): string
  rewriteCommand(command: string, args: string[]): { command: string; args: string[] }
  runtimeRoot(runtime: 'node' | 'uv'): string
  resolvedBinDirs(): string[]
  getDefaultPaths(home: string): string[]
  getPathEntriesFromEnv(env: Record<string, string>): string[]
  setPathEntriesOnEnv(
    env: Record<string, string>,
    entries: (string | string[])[],
    options: { includeDefaultPaths: false }
  ): void
  createStdio(params: StdioServerParameters, recordId: string): ManagedMcpStdio
  awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T>
}

export interface McpManagerSettings {
  getMcpServers(): Promise<Record<string, MCPServerConfig>> | Record<string, MCPServerConfig>
  getEffectiveNpmRegistry(): string | undefined | null
  getCustomNpmRegistry(): string | undefined | null
  isNpmRegistryCacheValid(): boolean
  getNpmRegistryCache(): { registry: string } | null | undefined
  setNpmRegistryCache(cache: { registry: string; lastChecked: number; isAutoDetect: boolean }): void
}

export interface McpManagerHost {
  client: McpClientHost
  probeRegistry(url: string, signal: AbortSignal): Promise<boolean>
  notifications: {
    occur(event: { code: 'mcp.connectionFailed'; serverName: string }): void
    recover(event: { code: 'mcp.connectionFailed'; serverName: string }): void
  }
}

export const AUTH_EXTENSION_CLIENT_CREDENTIALS = 'io.modelcontextprotocol/oauth-client-credentials'
export const MCP_CLIENT_CREDENTIALS_DRAFT_REVISION = 'fb374c7db2b34f18ca9183882e0beecdf661892b'
