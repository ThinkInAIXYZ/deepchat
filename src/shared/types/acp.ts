export type AgentSessionLifecycleStatus = 'idle' | 'active' | 'error'

export interface AgentSessionState {
  providerId: string
  agentId: string
  conversationId: string
  sessionId: string
  status: AgentSessionLifecycleStatus
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export type AgentProcessStatus = 'spawning' | 'ready' | 'error'

export interface AgentProcessHandle {
  providerId: string
  agentId: string
  status: AgentProcessStatus
  pid?: number
  restarts?: number
  lastHeartbeatAt?: number
  metadata?: Record<string, unknown>
}

export interface AgentProviderMetadata {
  providerId: string
  label: string
  isEnabled: boolean
  sessionCount: number
  processCount: number
}

export type AcpDebugActionType =
  | 'initialize'
  | 'authenticate'
  | 'newSession'
  | 'loadSession'
  | 'sessionList'
  | 'sessionResume'
  | 'sessionClose'
  | 'sessionFork'
  | 'prompt'
  | 'cancel'
  | 'setSessionMode'
  | 'setSessionModel'
  | 'extMethod'
  | 'extNotification'

export type AcpDebugEventKind =
  | 'request'
  | 'response'
  | 'notification'
  | 'permission'
  | 'lifecycle'
  | 'stderr'
  | 'error'

export interface AcpDebugRequest {
  agentId: string
  action: AcpDebugActionType
  payload?: Record<string, unknown>
  sessionId?: string
  workdir?: string
  methodName?: string
  webContentsId?: number
}

export interface AcpDebugEventEntry {
  id: string
  kind: AcpDebugEventKind
  action: string
  agentId: string
  sessionId?: string
  timestamp: number
  payload?: unknown
  message?: string
}

export interface AcpDebugRunResult {
  status: 'ok' | 'error'
  sessionId?: string
  error?: string
  events: AcpDebugEventEntry[]
}

export interface AcpWorkdirInfo {
  path: string
  isCustom: boolean
}

export type AcpLegacyBuiltinAgentId = 'kimi-cli' | 'claude-code-acp' | 'codex-acp' | 'dimcode-acp'
export type AcpBuiltinAgentId = AcpLegacyBuiltinAgentId
export type AcpAgentSource = 'registry' | 'manual'
export type AcpRegistryDistributionType = 'binary' | 'npx' | 'uvx'
export type AcpAgentInstallStatus = 'not_installed' | 'installing' | 'installed' | 'error'

export interface AcpAgentProfile {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface AcpBuiltinAgent {
  id: AcpLegacyBuiltinAgentId
  name: string
  enabled: boolean
  activeProfileId: string | null
  profiles: AcpAgentProfile[]
  mcpSelections?: string[]
}

export interface AcpCustomAgent {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled: boolean
  mcpSelections?: string[]
}

export interface AcpStoreData {
  builtins: AcpBuiltinAgent[]
  customs: AcpCustomAgent[]
  enabled: boolean
  version?: string
}

export interface AcpAgentConfig {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  description?: string
  icon?: string
  source?: AcpAgentSource
  installState?: AcpAgentInstallState | null
}

export interface AcpRegistryBinaryDistribution {
  archive: string
  cmd: string
  args?: string[]
  env?: Record<string, string>
}

export interface AcpRegistryPackageDistribution {
  package: string
  args?: string[]
  env?: Record<string, string>
}

export interface AcpRegistryDistribution {
  binary?: Record<string, AcpRegistryBinaryDistribution>
  npx?: AcpRegistryPackageDistribution
  uvx?: AcpRegistryPackageDistribution
}

export interface AcpAgentInstallState {
  status: AcpAgentInstallStatus
  distributionType?: AcpRegistryDistributionType | 'manual' | null
  version?: string | null
  installedAt?: number | null
  lastCheckedAt?: number | null
  installDir?: string | null
  error?: string | null
}

export interface AcpAgentState {
  agentId: string
  enabled: boolean
  envOverride?: Record<string, string>
  updatedAt: number
}

export interface AcpAgentEnvOverride {
  agentId: string
  env: Record<string, string>
}

export interface AcpRegistryAgent {
  id: string
  name: string
  version: string
  description?: string
  repository?: string
  website?: string
  authors?: string[]
  license?: string
  icon?: string
  distribution: AcpRegistryDistribution
  source: 'registry'
  enabled: boolean
  envOverride?: Record<string, string>
  installState?: AcpAgentInstallState | null
}

export interface AcpManualAgent {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled: boolean
  description?: string
  icon?: string
  source: 'manual'
}

export interface AcpResolvedLaunchSpec {
  agentId: string
  source: AcpAgentSource
  distributionType: AcpRegistryDistributionType | 'manual'
  version?: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  installDir?: string | null
}

export interface AcpSessionEntity {
  id: number
  conversationId: string
  agentId: string
  sessionId: string | null
  workdir: string | null
  status: AgentSessionLifecycleStatus
  createdAt: number
  updatedAt: number
  metadata: Record<string, unknown> | null
}

export interface AcpSessionUpsertPayload {
  sessionId?: string | null
  workdir?: string | null
  status?: AgentSessionLifecycleStatus
  metadata?: Record<string, unknown> | null
}

export type AcpTurnStatus = 'active' | 'completed' | 'cancelled' | 'error'

export interface AcpTurnStartPayload {
  id: string
  acpSessionId: string
  conversationId: string
  userMessageId?: string | null
  startedAt: number
}

export interface AcpTurnFinishPayload {
  id: string
  status: Exclude<AcpTurnStatus, 'active'>
  stopReason?: string | null
  completedAt: number
}

export type AcpConfigOptionValue = {
  value: string
  label: string
  description?: string | null
  groupId?: string | null
  groupLabel?: string | null
}

export type AcpConfigOption = {
  id: string
  label: string
  description?: string | null
  type: 'select' | 'boolean'
  category?: string | null
  currentValue: string | boolean
  options?: AcpConfigOptionValue[]
}

export type AcpConfigState = {
  source: 'configOptions' | 'legacy'
  options: AcpConfigOption[]
}
