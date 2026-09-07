export type UserPluginSource =
  | { kind: 'git'; url: string; ref?: string; subdirectory?: string; commit?: string }
  | { kind: 'zip' | 'directory'; path: string; subdirectory?: string }

export type PluginContextEvent = 'SessionStart' | 'UserPromptSubmit' | 'SubagentStart'

export interface UserPluginHook {
  id: string
  event: PluginContextEvent
  matcher?: string
  command: string
  commandWindows?: string
  timeout: number
  statusMessage?: string
}

export interface UserPluginMcpServer {
  name: string
  type: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  requiredVariables: string[]
}

export interface UserPluginPackage {
  name: string
  version: string
  publisher: string
  description: string
  skills: { name: string; path: string }[]
  hooks: UserPluginHook[]
  mcpServers: UserPluginMcpServer[]
  findings: string[]
}

export interface PreparedUserPlugin {
  operationId: string
  source: UserPluginSource
  digest: string
  package: UserPluginPackage
  candidates?: string[]
}

export interface UserPluginSelection {
  skills: boolean
  hooks: boolean
  mcp: boolean
}

export interface UserPluginInstallInput {
  operationId: string
  selection: UserPluginSelection
  pluginId?: string
}

export interface UserPluginDetails {
  source: UserPluginSource
  digest: string
  package: UserPluginPackage
  selection: UserPluginSelection
  previousDigest?: string
  setup: Record<string, string[]>
  diagnostics: UserPluginHookDiagnostic[]
}

export interface UserPluginHookDiagnostic {
  invocationId: string
  event: PluginContextEvent
  sessionId: string
  status: 'started' | 'completed' | 'failed' | 'uncertain'
  message?: string
  at: number
}

/** Called only at accepted input / successful compaction boundaries, never view replay. */
export interface PluginContextInput {
  sessionId: string
  messageId: string
  prompt: string
  cwd: string | null
  model: string
  parentSessionId?: string
  agentId?: string
  source?: 'compact'
  boundaryId?: string
  signal?: AbortSignal
}

export interface PluginContextContribution {
  pluginId: string
  digest: string
  invocationId: string
  content: string
  entryId?: number
}

export interface PluginContextPort {
  beginRun?(sessionId: string): void
  endRun?(sessionId: string): void
  hasHooks(): boolean
  accept(input: PluginContextInput): Promise<void>
  getContext(sessionId: string, messageId: string): PluginContextContribution[]
}
