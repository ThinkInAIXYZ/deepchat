/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FileItem } from './file'
import type {
  MCPToolDefinition as CoreMCPToolDefinition,
  ToolDispatchCommit,
  ToolOutcomeProjectionRegistrar
} from './core/mcp'

export { TOOL_EXECUTION, stripToolExecutionContract } from './core/mcp'
export type {
  MCPToolDefinitionBase,
  ToolEffect,
  ToolDispatchCommit,
  ToolDispatchCommitInput,
  ToolExecutionContract,
  ToolExecutionMode,
  ToolOutcomeProjection,
  ToolOutcomeProjectionRegistrar
} from './core/mcp'

export interface McpClient {
  name: string
  icon: string
  isRunning: boolean
  tools: MCPToolDefinition[]
  prompts?: PromptListEntry[]
  resources?: ResourceListEntry[]
}

export interface Resource {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
  _meta?: Record<string, unknown>
}

export interface PromptListEntry {
  name: string
  description?: string
  arguments?: {
    name: string
    description?: string
    required: boolean
  }[]
  files?: FileItem[]
  client: {
    name: string
    icon: string
  }
}

export interface ToolCallResult {
  isError?: boolean
  content: MCPContentItem[]
  structuredContent?: unknown
  _meta?: Record<string, unknown>
}

export interface McpToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
  [key: string]: unknown
}

export interface Tool {
  name: string
  title?: string
  description?: string
  icons?: Array<{
    src: string
    mimeType?: string
    sizes?: string[]
    theme?: 'light' | 'dark'
  }>
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: McpToolAnnotations
  _meta?: Record<string, unknown>
  execution?: Record<string, unknown>
}

export interface McpExpectedToolTarget {
  finalName: string
  serverName: string
  serverId: string
  configGeneration: number
  bindingHash: string
  originalName: string
}

export interface ResourceListEntry {
  uri: string
  name?: string
  client: {
    name: string
    icon: string
  }
}

export interface MCPServerConfig {
  command: string
  args: string[]
  env: Record<string, unknown>
  descriptions: string
  icons: string
  enabled: boolean
  disable?: boolean
  baseUrl?: string
  customHeaders?: Record<string, string>
  customNpmRegistry?: string
  type: 'sse' | 'stdio' | 'inmemory' | 'http'
  source?: string
  sourceId?: string
  ownerPluginId?: string
  inheritEnv?: 'legacy' | 'minimal'
  /**
   * Host-owned identity. Importers must not use a mutable display name as durable identity.
   */
  serverId?: string
  configGeneration?: number
  bindingHash?: string
  authorization?: McpAuthorizationConfig
  /**
   * Temporary compatibility diagnostic. It must not be exposed as a new-server setting.
   */
  forceLegacyWire?: boolean
}

export type McpAuthorizationMode =
  | 'none'
  | 'interactive'
  | 'client_credentials'
  | 'private_key_jwt'
  | 'cross_app_access'

export interface McpAuthorizationConfig {
  mode: McpAuthorizationMode
  protectedResourceUrl?: string
  authorizationServerIssuer?: string
  clientMetadataUrl?: string
  clientId?: string
  scopes?: string[]
  identityProfileId?: string
  keyAlgorithm?: 'RS256' | 'ES256'
}

export interface McpServerIdentity {
  serverId: string
  configGeneration: number
  bindingHash: string
}

export type McpCredentialKind = 'client_secret' | 'private_key' | 'enterprise_resource_secret'

export interface McpCredentialBinding extends McpServerIdentity {
  endpoint: string
  protectedResourceUrl?: string
  authorizationServerIssuer?: string
  clientId?: string
}

export interface McpCredentialStatus {
  serverId: string
  kind: McpCredentialKind
  configured: boolean
  persistent: boolean
  updatedAt?: number
  fingerprint?: string
}

export type McpCredentialInput =
  | {
      kind: 'client_secret'
      secret: string
    }
  | {
      kind: 'private_key'
      privateKey: string
      algorithm: 'RS256' | 'ES256'
    }
  | {
      kind: 'enterprise_resource_secret'
      secret: string
    }

export interface McpEnterpriseIdentityProfile {
  id: string
  label: string
  issuer: string
  clientId: string
  scopes: string[]
  clientAuthentication: 'none' | 'client_secret'
}

export interface McpEnterpriseIdentityStatus {
  profileId: string
  state: 'signed_out' | 'authenticating' | 'authenticated' | 'error'
  authenticated: boolean
  persistent: boolean
  clientSecretConfigured: boolean
  subjectLabel?: string
  error?: string
  updatedAt?: number
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
  mcpEnabled: boolean
  ready: boolean
}

export type McpServerAuthState =
  | 'unsupported'
  | 'none'
  | 'required'
  | 'authenticating'
  | 'authenticated'
  | 'error'

export interface McpServerAuthStatus {
  serverName: string
  serverId?: string
  state: McpServerAuthState
  authenticated: boolean
  error?: string
  updatedAt?: number
  storage?: 'safeStorage' | 'memory' | 'none'
  persistent?: boolean
  mode?: McpAuthorizationMode
  credential?: McpCredentialStatus
}

export type MCPToolDefinition = CoreMCPToolDefinition

export interface MCPToolCall {
  id: string
  type: string
  function: {
    name: string
    arguments: string
  }
  server?: {
    name: string
    icons: string
    description: string
  }
  conversationId?: string
  providerId?: string
}

export interface MCPToolResponse {
  toolCallId: string
  content: string | MCPContentItem[]
  _meta?: Record<string, any>
  isError?: boolean
  structuredContent?: unknown
  mcpResult?: PersistedMcpToolResult
  ownerPluginId?: string
  toolResult?: unknown
  outputOffloadPath?: string
  imagePreviews?: import('./core/mcp').ToolCallImagePreview[]
  requiresPermission?: boolean
  permissionRequest?: {
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
    command?: string
    commandSignature?: string
    shellProfile?: import('../commandShell').CommandShellProfile
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
    conversationId?: string
    requestId?: string
    rememberable?: boolean
    requiresUserConfirmation?: boolean
  }
}

export type McpAppDescriptor = import('./core/mcp').McpAppDescriptor
export type PersistedMcpToolResult = import('./core/mcp').PersistedMcpToolResult

export interface McpAppCsp {
  connectDomains?: string[]
  resourceDomains?: string[]
  frameDomains?: string[]
  baseUriDomains?: string[]
}

export interface McpAppPermissions {
  camera?: Record<string, never>
  microphone?: Record<string, never>
  geolocation?: Record<string, never>
  clipboardWrite?: Record<string, never>
}

export interface McpAppPreparedView {
  instanceId: string
  sandboxUrl: string
  html: string
  sandbox: string
  tool: Tool
  csp?: McpAppCsp
  permissions?: McpAppPermissions
  prefersBorder?: boolean
  advisoryDomain?: string
  expiresAt: number
}

export type McpAppConsentKind =
  | 'tool-call'
  | 'open-link'
  | 'send-message'
  | 'update-model-context'
  | 'camera'
  | 'microphone'
  | 'geolocation'
  | 'clipboard-write'

export interface McpAppConsentRequestPayload {
  requestId: string
  kind: McpAppConsentKind
  serverName: string
  title: string
  detail: string
  argumentsPreview?: string
  url?: string
}

export interface McpAppCallToolResult {
  result: ToolCallResult
  toolAccessSuspended: boolean
}

export interface McpAppServerToolListResult {
  tools: Tool[]
  nextCursor?: string
  _meta?: Record<string, unknown>
}

export interface McpAppServerResource {
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
  icons?: Tool['icons']
  annotations?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

export interface McpAppServerResourceTemplate {
  uriTemplate: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  icons?: Tool['icons']
  annotations?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

export interface McpAppServerPrompt {
  name: string
  title?: string
  description?: string
  arguments?: Array<{
    name: string
    description?: string
    required?: boolean
  }>
  icons?: Tool['icons']
  _meta?: Record<string, unknown>
}

export interface McpAppServerResourceListResult {
  resources: McpAppServerResource[]
  nextCursor?: string
  _meta?: Record<string, unknown>
}

export interface McpAppServerResourceTemplateListResult {
  resourceTemplates: McpAppServerResourceTemplate[]
  nextCursor?: string
  _meta?: Record<string, unknown>
}

export interface McpAppServerPromptListResult {
  prompts: McpAppServerPrompt[]
  nextCursor?: string
  _meta?: Record<string, unknown>
}

export interface McpAppHostPort {
  prepareView(
    input: {
      descriptor: McpAppDescriptor
      conversationId: string
      messageId: string
      blockId: string
      toolInput: Record<string, unknown>
    },
    context: { webContentsId: number; windowId: number | null }
  ): Promise<McpAppPreparedView>
  releaseView(
    instanceId: string,
    context: { webContentsId: number; windowId: number | null }
  ): Promise<void>
  callTool(
    instanceId: string,
    name: string,
    args: Record<string, unknown>,
    context: { webContentsId: number; windowId: number | null }
  ): Promise<McpAppCallToolResult>
  listTools(
    instanceId: string,
    cursor: string | undefined,
    context: { webContentsId: number; windowId: number | null }
  ): Promise<McpAppServerToolListResult>
  readResource(
    instanceId: string,
    uri: string,
    context: { webContentsId: number; windowId: number | null }
  ): Promise<{ contents: Resource[] }>
  listResources(
    instanceId: string,
    cursor: string | undefined,
    context: { webContentsId: number; windowId: number | null }
  ): Promise<McpAppServerResourceListResult>
  listResourceTemplates(
    instanceId: string,
    cursor: string | undefined,
    context: { webContentsId: number; windowId: number | null }
  ): Promise<McpAppServerResourceTemplateListResult>
  listPrompts(
    instanceId: string,
    cursor: string | undefined,
    context: { webContentsId: number; windowId: number | null }
  ): Promise<McpAppServerPromptListResult>
  openLink(
    instanceId: string,
    url: string,
    context: { webContentsId: number; windowId: number | null }
  ): Promise<boolean>
  authorizeMessage(
    instanceId: string,
    text: string,
    context: { webContentsId: number; windowId: number | null }
  ): Promise<boolean>
  updateModelContext(
    instanceId: string,
    input: {
      content?: MCPContentItem[]
      structuredContent?: Record<string, unknown>
    },
    context: { webContentsId: number; windowId: number | null }
  ): Promise<{ approved: boolean; approvedHash?: string }>
  retryToolAccess(
    instanceId: string,
    context: { webContentsId: number; windowId: number | null }
  ): Promise<void>
  submitConsent(
    requestId: string,
    approved: boolean,
    context: { webContentsId: number; windowId: number | null }
  ): Promise<void>
}

export type McpProtocolEra = 'modern' | 'legacy' | 'unknown'

export type McpProbeReasonCode =
  | 'modern-accepted'
  | 'valid-legacy-signal'
  | 'authentication-required'
  | 'http-server-error'
  | 'transport-error'
  | 'timeout'

export interface McpServerDiagnostics {
  serverId: string
  serverName: string
  owner: 'deepchat' | 'plugin'
  transport: MCPServerConfig['type']
  connectionState: 'stopped' | 'starting' | 'running' | 'error'
  era: McpProtocolEra
  protocolVersion?: string
  serverImplementation?: {
    name: string
    version: string
  }
  probe: {
    outcome: 'modern' | 'legacy-fallback' | 'failed' | 'not-run'
    reasonCode?: McpProbeReasonCode
  }
  extensions: string[]
  clientExtensions: Array<{
    id: string
    revision?: string
  }>
  cacheState: 'active' | 'unknown'
  subscriptions: Array<
    | 'tools-list-changed'
    | 'prompts-list-changed'
    | 'resources-list-changed'
    | 'resource-updated'
    | 'modern-listen'
  >
  auth: {
    state: McpServerAuthState
    persistent?: boolean
    mode?: McpAuthorizationMode
  }
  updatedAt: number
}

export interface McpElicitationRequestPayload {
  requestId: string
  serverName: string
  mode: 'form' | 'url'
  message: string
  requestedSchema?: Record<string, unknown>
  url?: string
}

export interface McpElicitationDecision {
  requestId: string
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
}

export type McpSamplingMessage = import('./core/mcp').McpSamplingMessage
export type McpSamplingRequestPayload = import('./core/mcp').McpSamplingRequestPayload
export type McpSamplingDecision = import('./core/mcp').McpSamplingDecision
export type McpSamplingModelPreferences = import('./core/mcp').McpSamplingModelPreferences

export type MCPContentItem = import('./core/mcp').MCPContentItem
export type MCPTextContent = import('./core/mcp').MCPTextContent
export type MCPImageContent = import('./core/mcp').MCPImageContent
export type MCPAudioContent = import('./core/mcp').MCPAudioContent
export type MCPResourceContent = import('./core/mcp').MCPResourceContent
export type MCPResourceLinkContent = import('./core/mcp').MCPResourceLinkContent

export type McpAddServerResult = Readonly<{ status: 'added' }> | Readonly<{ status: 'duplicate' }>

export interface McpServicePort {
  initialize(): Promise<void>
  shutdown(): Promise<void>
  isReady(): boolean
  getMcpServers(): Promise<Record<string, MCPServerConfig>>
  getMcpClients(): Promise<McpClient[]>
  getEnabledMcpServers(): Promise<string[]>
  setMcpServerEnabled(serverName: string, enabled: boolean): Promise<void>
  addMcpServer(serverName: string, config: MCPServerConfig): Promise<McpAddServerResult>
  removeMcpServer(serverName: string): Promise<void>
  updateMcpServer(serverName: string, config: Partial<MCPServerConfig>): Promise<void>
  isServerRunning(serverName: string): Promise<boolean>
  isServerActive(serverName: string): Promise<boolean>
  startServer(serverName: string): Promise<void>
  stopServer(serverName: string): Promise<void>
  stopServerDuringShutdownByName(serverName: string): Promise<void>
  getServerLastError(serverName: string): string | undefined
  getMcpServerAuthStatus(serverId: string): Promise<McpServerAuthStatus>
  startMcpServerAuth(serverId: string): Promise<McpServerAuthStatus>
  completeMcpServerAuthFromCallbackUrl(
    serverId: string,
    callbackUrl: string
  ): Promise<McpServerAuthStatus>
  logoutMcpServerAuth(serverId: string): Promise<McpServerAuthStatus>
  getMcpCredentialStatus(serverId: string): Promise<McpCredentialStatus[]>
  setMcpCredential(
    binding: McpCredentialBinding,
    credential: McpCredentialInput
  ): Promise<McpCredentialStatus>
  removeMcpCredential(
    binding: McpCredentialBinding,
    kind: McpCredentialKind
  ): Promise<McpCredentialStatus>
  listMcpEnterpriseProfiles(): Promise<McpEnterpriseIdentityProfile[]>
  saveMcpEnterpriseProfile(
    profile: McpEnterpriseIdentityProfile
  ): Promise<McpEnterpriseIdentityProfile>
  removeMcpEnterpriseProfile(profileId: string): Promise<void>
  setMcpEnterpriseProfileClientSecret(
    profileId: string,
    secret: string
  ): Promise<McpEnterpriseIdentityStatus>
  getMcpEnterpriseProfileStatus(profileId: string): Promise<McpEnterpriseIdentityStatus>
  startMcpEnterpriseProfileAuth(profileId: string): Promise<McpEnterpriseIdentityStatus>
  completeMcpEnterpriseProfileAuthFromCallbackUrl(
    profileId: string,
    callbackUrl: string
  ): Promise<McpEnterpriseIdentityStatus>
  logoutMcpEnterpriseProfile(profileId: string): Promise<McpEnterpriseIdentityStatus>
  getServerDiagnostics(serverId: string): Promise<McpServerDiagnostics>
  getAllToolDefinitions(
    enabledMcpTools?:
      | string[]
      | {
          enabledTools?: string[]
          enabledServerIds?: string[]
          agentId?: string
          conversationId?: string
        }
  ): Promise<MCPToolDefinition[]>
  getAllPrompts(): Promise<Array<PromptListEntry & { client: { name: string; icon: string } }>>
  getAllResources(): Promise<Array<ResourceListEntry & { client: { name: string; icon: string } }>>
  getPrompt(prompt: PromptListEntry, args?: Record<string, unknown>): Promise<unknown>
  readResource(resource: ResourceListEntry): Promise<Resource>
  callTool(
    request: MCPToolCall,
    options?: {
      onProgress?: (update: {
        kind: 'subagent_orchestrator'
        toolCallId: string
        responseMarkdown: string
        progressJson: string
      }) => void
      signal?: AbortSignal
      agentId?: string
      enabledServerIds?: string[]
      runId?: string
      expectedTarget?: McpExpectedToolTarget
      commitDispatch?: ToolDispatchCommit
      registerOutcomeProjection?: ToolOutcomeProjectionRegistrar
    }
  ): Promise<{ content: string; rawData: MCPToolResponse }>
  handleSamplingRequest(request: McpSamplingRequestPayload): Promise<McpSamplingDecision>
  submitSamplingDecision(decision: McpSamplingDecision): Promise<void>
  cancelSamplingRequest(requestId: string, reason?: string): Promise<void>
  handleElicitationRequest(request: McpElicitationRequestPayload): Promise<McpElicitationDecision>
  submitElicitationDecision(decision: McpElicitationDecision): Promise<void>
  cancelElicitationRequest(requestId: string, reason?: string): Promise<void>
  setMcpEnabled(enabled: boolean): Promise<void>
  getMcpEnabled(): Promise<boolean>
  getNpmRegistryStatus(): Promise<{
    currentRegistry: string | null
    isFromCache: boolean
    lastChecked?: number
    autoDetectEnabled: boolean
    customRegistry?: string
  }>
  refreshNpmRegistry(): Promise<string>
  setCustomNpmRegistry(registry: string | undefined): Promise<void>
  setAutoDetectNpmRegistry(enabled: boolean): Promise<void>
  clearNpmRegistryCache(): Promise<void>
  getNpmRegistry(): string | null
  getUvRegistry(): string | null
  listMcpRouterServers(
    page: number,
    limit: number
  ): Promise<{
    servers: Array<{
      uuid: string
      created_at: string
      updated_at: string
      name: string
      author_name: string
      title: string
      description: string
      content?: string
      server_key: string
      config_name?: string
      server_url?: string
    }>
  }>
  installMcpRouterServer(serverKey: string): Promise<boolean>
  getMcpRouterApiKey(): Promise<string | ''>
  setMcpRouterApiKey(key: string): Promise<void>
  isServerInstalled(source: string, sourceId: string): Promise<boolean>
  listInstalledServerIds(source: string, sourceIds: string[]): Promise<string[]>
}
