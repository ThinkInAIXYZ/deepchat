import type { JsonValue } from '../contracts/common'

export const OFFICIAL_PLUGIN_SOURCE = 'deepchat-official'

export type PluginCapability =
  | 'runtime.manage'
  | 'mcp.register'
  | 'skills.register'
  | 'settings.contribute'
  | 'shell.openExternal'
  | 'process.execDeclared'

export type PluginActivationEvent = 'onEnable'
export type PluginResourceKind = 'runtime' | 'mcpServer' | 'skill' | 'settings' | 'toolPolicy'
export type PluginRuntimeType = 'external-helper'
export type PluginRuntimeState = 'missing' | 'installed' | 'running' | 'error'
export type PluginTrustState = 'trusted' | 'untrusted' | 'development'
export type PluginToolPolicyDecision = 'allow' | 'ask' | 'deny'

export interface PluginEngineManifest {
  deepchat: string
  platforms: string[]
}

export interface PluginSourceManifest {
  type: typeof OFFICIAL_PLUGIN_SOURCE
  url: string
  publisher: string
  signature?: string
  checksum?: string
}

export interface PluginSettingsManifest {
  entry: string
  preloadTypes: string
}

export interface PluginRuntimeManifest {
  id: string
  type: PluginRuntimeType
  displayName: string
  detect: string[]
  install?: {
    mode: 'user-confirmed'
    provider: string
    strategy: string
    minVersion?: string
    guideUrl?: string
  }
}

export interface PluginMcpServerManifest {
  id: string
  displayName: string
  transport: 'stdio'
  command: string
  args: string[]
  env?: Record<string, string>
  autoApprove: string[]
}

export interface PluginSkillManifest {
  id: string
  path: string
  scope: 'agent'
}

export interface PluginSettingsContributionManifest {
  id: string
  title: string
  placement: 'plugins'
  entry: string
  preloadTypes: string
}

export interface PluginToolPolicyManifest {
  serverId: string
  tools: Record<string, PluginToolPolicyDecision>
}

export interface DeepChatPluginManifest {
  id: string
  name: string
  version: string
  publisher: string
  engines: PluginEngineManifest
  activationEvents: PluginActivationEvent[]
  capabilities: PluginCapability[]
  source: PluginSourceManifest
  settings?: PluginSettingsManifest
  runtime?: PluginRuntimeManifest
  mcpServers?: PluginMcpServerManifest[]
  skills?: PluginSkillManifest[]
  settingsContributions?: PluginSettingsContributionManifest[]
  toolPolicies?: PluginToolPolicyManifest[]
}

export interface PluginInstallationRecord {
  pluginId: string
  version: string
  path: string
  enabled: boolean
  trusted: boolean
  source: typeof OFFICIAL_PLUGIN_SOURCE | 'development'
  installedAt: number
  updatedAt: number
}

export interface PluginResourceRecord {
  pluginId: string
  kind: PluginResourceKind
  key: string
  payload: JsonValue
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface RuntimeDependencyRecord {
  pluginId: string
  runtimeId: string
  provider: string
  command?: string
  helperAppPath?: string
  version?: string
  installSource?: string
  state: PluginRuntimeState
  lastError?: string
  checkedAt: number
}

export interface PluginRuntimeStatus {
  runtimeId: string
  displayName: string
  state: PluginRuntimeState
  command?: string
  helperAppPath?: string
  version?: string
  lastError?: string
  checkedAt?: number
}

export interface PluginMcpRuntimeStatus {
  serverId: string
  enabled: boolean
  running: boolean
}

export interface PluginSettingsContribution {
  id: string
  ownerPluginId: string
  title: string
  placement: 'plugins'
  entry: string
  preloadTypes: string
}

export interface PluginListItem {
  id: string
  name: string
  version: string
  publisher: string
  installed: boolean
  enabled: boolean
  trusted: boolean
  trustState: PluginTrustState
  official: boolean
  capabilities: PluginCapability[]
  releaseUrl?: string
  runtime?: PluginRuntimeStatus
  mcpServers?: PluginMcpRuntimeStatus[]
  settings?: PluginSettingsContribution
}

export interface PluginActionResult {
  ok: boolean
  status?: PluginListItem
  data?: JsonValue
  error?: string
}

export interface PluginInstallRequest {
  pluginId: string
  source: typeof OFFICIAL_PLUGIN_SOURCE
}

export interface PluginInstallFromFileRequest {
  filePath?: string
}

export interface PluginOpenOfficialReleaseRequest {
  pluginId?: string
}

export interface PluginInvokeActionRequest {
  pluginId: string
  actionId: string
  payload?: JsonValue
}

export interface PluginSettingsApiStatus {
  pluginId: string
  enabled: boolean
  runtime?: PluginRuntimeStatus
  mcpServers?: PluginMcpRuntimeStatus[]
}
