/* eslint-disable @typescript-eslint/no-explicit-any */
import { ShowResponse } from 'ollama'
import type { NewApiEndpointType } from '@shared/model'
import { ApiEndpointType, ModelType } from '@shared/model'
import type { ImageGenerationOptions } from '../../imageGenerationSettings'
import type { VideoGenerationOptions } from '../../videoGenerationSettings'
import type { TtsSettings } from '../../ttsSettings'
import type { ReasoningEffort, ReasoningVisibility, Verbosity } from '../model-db'
import type { NowledgeMemThread, NowledgeMemExportSummary } from '../nowledgeMem'
import { ProviderChange, ProviderBatchUpdate } from './provider-operations'
import type { AgentSessionLifecycleStatus } from './agent-provider'
import type { DatabaseRepairReport, DatabaseSchemaDiagnosis } from '../databaseSchema'
import type { IConversationExporter } from './exporter.presenter'
import type { BuiltinKnowledgeConfig } from '../knowledge'
import type { BrowserPageInfo, DownloadInfo, ScreenshotOptions, YoBrowserStatus } from '../browser'
import type { IWindowPresenter, TabData } from './window.presenter'

export type ShortcutKeySetting = Record<string, string>
import type { OpenAICodexAuthStatus } from '../openai-codex'
import type { XaiGrokAuthStatus } from '../xai-grok'
import type {
  Agent,
  AgentType,
  CreateDeepChatAgentInput,
  DeepChatAgentConfig,
  UpdateDeepChatAgentInput
} from '../agent-interface'

export type SQLITE_MESSAGE = {
  id: string
  conversation_id: string
  parent_id?: string
  role: MESSAGE_ROLE
  content: string
  created_at: number
  order_seq: number
  token_count: number
  status: MESSAGE_STATUS
  metadata: string // JSON string of MESSAGE_METADATA
  is_context_edge: number // 0 or 1
  is_variant: number
  variants?: SQLITE_MESSAGE[]
}

export interface DirectoryMetaData {
  dirName: string
  dirPath: string
  dirCreated: Date
  dirModified: Date
}

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
}
export interface FileItem {
  id: string
  name: string
  type: string
  size: number
  path: string
  description?: string
  content?: string
  createdAt: number
}

export interface Prompt {
  id: string
  name: string
  description: string
  content?: string
  parameters?: Array<{
    name: string
    description: string
    required: boolean
  }>
  files?: FileItem[] // Associated files
  messages?: Array<{ role: string; content: { text: string } }> // Added based on getPrompt example
  enabled?: boolean // Whether enabled
  source?: 'local' | 'imported' | 'builtin' // Source type
  createdAt?: number // Creation time
  updatedAt?: number // Update time
}

export interface SystemPrompt {
  id: string
  name: string
  content: string
  isDefault?: boolean
  createdAt?: number
  updatedAt?: number
}
export interface PromptListEntry {
  name: string
  description?: string
  arguments?: {
    name: string
    description?: string
    required: boolean
  }[]
  files?: FileItem[] // Associated files
  client: {
    name: string
    icon: string
  }
}
// Interface for tool call results
export interface ToolCallResult {
  isError?: boolean
  content: Array<{
    type: string
    text: string
  }>
}

// Interface for tool lists
export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: {
    title?: string // A human-readable title for the tool.
    readOnlyHint?: boolean // default false
    destructiveHint?: boolean // default true
    idempotentHint?: boolean // default false
    openWorldHint?: boolean // default true
  }
}

export interface ResourceListEntry {
  uri: string
  name?: string
  client: {
    name: string
    icon: string
  }
}

export type ModelConfigSource = 'user' | 'provider' | 'system'

export interface ModelConfig {
  maxTokens: number
  contextLength: number
  timeout?: number
  temperature?: number
  topP?: number
  vision: boolean
  speechRecognition?: boolean
  functionCall: boolean
  reasoning: boolean
  type: ModelType
  // Whether this config is user-defined (true) or default config (false)
  isUserDefined?: boolean
  thinkingBudget?: number
  forceInterleavedThinkingCompat?: boolean
  // New parameters for GPT-5 series
  reasoningEffort?: ReasoningEffort
  reasoningVisibility?: ReasoningVisibility
  verbosity?: Verbosity
  maxCompletionTokens?: number // GPT-5 series uses this parameter to replace maxTokens
  conversationId?: string
  apiEndpoint?: ApiEndpointType
  endpointType?: NewApiEndpointType
  ownedBy?: string
  // Search-related parameters
  enableSearch?: boolean
  forcedSearch?: boolean
  searchStrategy?: 'turbo' | 'balanced' | 'precise'
  imageGeneration?: ImageGenerationOptions
  videoGeneration?: VideoGenerationOptions
  tts?: TtsSettings
}

export interface IModelConfig {
  id: string
  providerId: string
  config: ModelConfig
  source?: ModelConfigSource
}
export interface ProviderModelConfigs {
  [modelId: string]: ModelConfig
}

export interface IYoBrowserPresenter {
  initialize(): Promise<void>
  getBrowserStatus(sessionId: string): Promise<YoBrowserStatus>
  loadUrl(
    sessionId: string,
    url: string,
    timeoutMs?: number,
    hostWindowId?: number
  ): Promise<YoBrowserStatus>
  attachSessionBrowser(sessionId: string, hostWindowId: number): Promise<boolean>
  updateSessionBrowserBounds(
    sessionId: string,
    hostWindowId: number,
    bounds: {
      x: number
      y: number
      width: number
      height: number
    },
    visible: boolean
  ): Promise<void>
  detachSessionBrowser(sessionId: string): Promise<void>
  destroySessionBrowser(sessionId: string): Promise<void>
  goBack(sessionId: string): Promise<void>
  goForward(sessionId: string): Promise<void>
  reload(sessionId: string): Promise<void>
  getNavigationState(sessionId: string): Promise<{
    canGoBack: boolean
    canGoForward: boolean
  }>
  captureScreenshot(sessionId: string, options?: ScreenshotOptions): Promise<string>
  getBrowserPage(sessionId: string): Promise<BrowserPageInfo | null>
  startDownload(url: string, savePath?: string): Promise<DownloadInfo>
  clearSandboxData(): Promise<void>
  shutdown(): Promise<void>
  readonly toolHandler: {
    getToolDefinitions(): any[]
    callTool(
      toolName: string,
      args: Record<string, unknown>,
      conversationId?: string
    ): Promise<string>
  }
}

export interface ITabPresenter {
  createTab(windowId: number, url: string, options?: TabCreateOptions): Promise<number | null>
  closeTab(tabId: number): Promise<boolean>
  closeTabs(windowId: number): Promise<void>
  switchTab(tabId: number): Promise<boolean>
  getTab(tabId: number): Promise<BrowserView | undefined>
  detachTab(tabId: number): Promise<boolean>
  attachTab(tabId: number, targetWindowId: number, index?: number): Promise<boolean>
  moveTab(tabId: number, targetWindowId: number, index?: number): Promise<boolean>
  getWindowTabsData(windowId: number): Promise<Array<TabData>>
  getActiveTabId(windowId: number): Promise<number | undefined>
  getTabIdByWebContentsId(webContentsId: number): number | undefined
  getWindowIdByWebContentsId(webContentsId: number): number | undefined
  getTabWindowId(tabId: number): number | undefined
  reorderTabs(windowId: number, tabIds: number[]): Promise<boolean>
  moveTabToNewWindow(tabId: number, screenX?: number, screenY?: number): Promise<boolean>
  captureTabArea(
    tabId: number,
    rect: { x: number; y: number; width: number; height: number }
  ): Promise<string | null>
  stitchImagesWithWatermark(
    imageDataList: string[],
    options?: {
      isDark?: boolean
      version?: string
      texts?: {
        brand?: string
        time?: string
        tip?: string
      }
    }
  ): Promise<string | null>
  isLastTabInWindow(tabId: number): Promise<boolean>
  registerFloatingWindow(webContentsId: number, webContents: Electron.WebContents): void
  unregisterFloatingWindow(webContentsId: number): void
  resetTabToBlank(tabId: number): Promise<void>
  destroy(): Promise<void>
}

export interface TabCreateOptions {
  active?: boolean
  position?: number
  allowNonLocal?: boolean
}

export interface IShortcutPresenter {
  registerShortcuts(): void
  unregisterShortcuts(): void
  destroy(): void
}

export interface ISQLitePresenter {
  close(): void
  reopen(): void
  recordSettingsActivity(
    input: import('@shared/contracts/routes').SettingsActivityInput
  ): Promise<import('@shared/contracts/routes').SettingsActivityRecord>
  listSettingsActivity(
    limit?: number
  ): Promise<import('@shared/contracts/routes').SettingsActivityRecord[]>
  diagnoseSchema(): Promise<DatabaseSchemaDiagnosis>
  repairSchema(): Promise<DatabaseRepairReport>
  clearNewAgentData(): Promise<void>
  importLegacyChatDb(
    sourceDbPath: string,
    mode: 'increment' | 'overwrite'
  ): Promise<{
    importedSessions: number
    importedMessages: number
    importedSearchResults: number
  }>
  createConversation(title: string, settings?: Partial<CONVERSATION_SETTINGS>): Promise<string>
  deleteConversation(conversationId: string): Promise<void>
  renameConversation(conversationId: string, title: string): Promise<CONVERSATION>
  getConversation(conversationId: string): Promise<CONVERSATION>
  updateConversation(conversationId: string, data: Partial<CONVERSATION>): Promise<void>
  getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }>
  listChildConversationsByParent(parentConversationId: string): Promise<CONVERSATION[]>
  listChildConversationsByMessageIds(parentMessageIds: string[]): Promise<CONVERSATION[]>
  getConversationCount(): Promise<number>
  insertMessage(
    conversationId: string,
    content: string,
    role: string,
    parentId: string,
    metadata: string,
    orderSeq: number,
    tokenCount: number,
    status: string,
    isContextEdge: number,
    isVariant: number
  ): Promise<string>
  queryMessages(conversationId: string): Promise<Array<SQLITE_MESSAGE>>
  queryMessageIds(conversationId: string): Promise<string[]>
  deleteAllMessages(): Promise<void>
  runTransaction(operations: () => void): Promise<void>
  getDatabase(): any

  // Added message management methods
  getMessage(messageId: string): Promise<SQLITE_MESSAGE | null>
  getMessagesByIds(messageIds: string[]): Promise<SQLITE_MESSAGE[]>
  getMessageVariants(messageId: string): Promise<SQLITE_MESSAGE[]>
  updateMessage(
    messageId: string,
    data: {
      content?: string
      status?: string
      metadata?: string
      isContextEdge?: number
      tokenCount?: number
    }
  ): Promise<void>
  updateMessageParentId(messageId: string, parentId: string): Promise<void>
  deleteMessage(messageId: string): Promise<void>
  getMaxOrderSeq(conversationId: string): Promise<number>
  addMessageAttachment(
    messageId: string,
    attachmentType: string,
    attachmentData: string
  ): Promise<void>
  getMessageAttachments(messageId: string, type: string): Promise<{ content: string }[]>
  getLastUserMessage(conversationId: string): Promise<SQLITE_MESSAGE | null>
  getLastAssistantMessage(conversationId: string): Promise<SQLITE_MESSAGE | null>
  getMainMessageByParentId(conversationId: string, parentId: string): Promise<SQLITE_MESSAGE | null>
  deleteAllMessagesInConversation(conversationId: string): Promise<void>
  getAcpSession(conversationId: string, agentId: string): Promise<AcpSessionEntity | null>
  getAcpSessionByAgentAndSessionId(
    agentId: string,
    sessionId: string
  ): Promise<AcpSessionEntity | null>
  upsertAcpSession(
    conversationId: string,
    agentId: string,
    data: AcpSessionUpsertPayload
  ): Promise<void>
  updateAcpSessionId(
    conversationId: string,
    agentId: string,
    sessionId: string | null
  ): Promise<void>
  updateAcpWorkdir(conversationId: string, agentId: string, workdir: string | null): Promise<void>
  updateAcpSessionStatus(
    conversationId: string,
    agentId: string,
    status: AgentSessionLifecycleStatus
  ): Promise<void>
  deleteAcpSessions(conversationId: string): Promise<void>
  deleteAcpSession(conversationId: string, agentId: string): Promise<void>
  startAcpTurn(input: AcpTurnStartPayload): Promise<void>
  finishAcpTurn(input: AcpTurnFinishPayload): Promise<void>
  migrateAcpAgentReferences(aliasMap: Record<string, string>): Promise<void>
}

export interface IOAuthPresenter {
  startOAuthLogin(providerId: string, config: OAuthConfig): Promise<boolean>
  startGitHubCopilotLogin(providerId: string): Promise<boolean>
  startGitHubCopilotDeviceFlowLogin(providerId: string): Promise<boolean>
  getOpenAICodexStatus(): Promise<OpenAICodexAuthStatus>
  startOpenAICodexBrowserLogin(): Promise<OpenAICodexAuthStatus>
  completeOpenAICodexBrowserLoginFromUrl(callbackUrl: string): Promise<OpenAICodexAuthStatus>
  cancelOpenAICodexLogin(): Promise<OpenAICodexAuthStatus>
  logoutOpenAICodex(): Promise<OpenAICodexAuthStatus>
  getXaiGrokStatus(): Promise<XaiGrokAuthStatus>
  startXaiGrokDeviceLogin(): Promise<XaiGrokAuthStatus>
  cancelXaiGrokLogin(): Promise<XaiGrokAuthStatus>
  logoutXaiGrok(): Promise<XaiGrokAuthStatus>
}

export interface OAuthConfig {
  authUrl: string
  redirectUri: string
  clientId: string
  clientSecret?: string
  scope: string
  responseType: string
}

import type { ReasoningPortrait } from '../model-db'

export type ProviderDbRefreshResult = {
  status: 'updated' | 'not-modified' | 'skipped' | 'error'
  lastUpdated: number | null
  providersCount: number
  message?: string
}

export interface ConfigServicePort {
  getSetting<T>(key: string): T | undefined
  setSetting<T>(key: string, value: T): void
  getProviders(): LLM_PROVIDER[]
  setProviders(providers: LLM_PROVIDER[]): void
  cleanupLegacyProviderJsonForDatabaseEncryption(): number
  getProviderById(id: string): LLM_PROVIDER | undefined
  setProviderById(id: string, provider: LLM_PROVIDER): void
  getProviderModels(providerId: string): MODEL_META[]
  getDbProviderModels(providerId: string): RENDERER_MODEL_META[]
  getCapabilityProviderId(providerId: string, modelId: string): string
  supportsReasoningCapability(providerId: string, modelId: string): boolean
  getReasoningPortrait(providerId: string, modelId: string): ReasoningPortrait | null
  getThinkingBudgetRange(
    providerId: string,
    modelId: string
  ): { min?: number; max?: number; default?: number }
  getTemperatureCapability(providerId: string, modelId: string): boolean | undefined
  supportsTemperatureControl(providerId: string, modelId: string): boolean
  supportsSearchCapability(providerId: string, modelId: string): boolean
  getSearchDefaults(
    providerId: string,
    modelId: string
  ): { default?: boolean; forced?: boolean; strategy?: 'turbo' | 'max' }
  supportsAudioInputCapability(providerId: string, modelId: string): boolean
  supportsReasoningEffortCapability(providerId: string, modelId: string): boolean
  getReasoningEffortDefault(providerId: string, modelId: string): ReasoningEffort | undefined
  supportsVerbosityCapability(providerId: string, modelId: string): boolean
  getVerbosityDefault(providerId: string, modelId: string): Verbosity | undefined
  setProviderModels(providerId: string, models: MODEL_META[]): void
  getEnabledProviders(): LLM_PROVIDER[]
  getAllEnabledModels(): Promise<{ providerId: string; models: RENDERER_MODEL_META[] }[]>
  // Custom model management
  getCustomModels(providerId: string): MODEL_META[]
  setCustomModels(providerId: string, models: MODEL_META[]): void
  addCustomModel(providerId: string, model: MODEL_META): void
  removeCustomModel(providerId: string, modelId: string): void
  updateCustomModel(providerId: string, modelId: string, updates: Partial<MODEL_META>): void
  getModelStatus(providerId: string, modelId: string): boolean
  setModelStatus(providerId: string, modelId: string, enabled: boolean): void
  ensureModelStatus(providerId: string, modelId: string, enabled: boolean): void
  batchSetModelStatus(providerId: string, modelStatusMap: Record<string, boolean>): void
  batchSetModelStatusQuiet(providerId: string, modelStatusMap: Record<string, boolean>): void
  // Batch get model status
  getBatchModelStatus(providerId: string, modelIds: string[]): Record<string, boolean>
  // Language settings
  getLanguage(): string
  setLanguage(language: string): void
  getDefaultProviders(): LLM_PROVIDER[]
  // Proxy settings
  getProxyMode(): string
  setProxyMode(mode: string): void
  getCustomProxyUrl(): string
  setCustomProxyUrl(url: string): void
  // MCP configuration related methods
  getMcpServers(): Promise<Record<string, MCPServerConfig>>
  setMcpServers(servers: Record<string, MCPServerConfig>): Promise<void>
  getEnabledMcpServers(): Promise<string[]>
  setMcpServerEnabled(serverName: string, enabled: boolean): Promise<void>
  getMcpEnabled(): Promise<boolean>
  setMcpEnabled(enabled: boolean): Promise<void>
  addMcpServer(serverName: string, config: MCPServerConfig): Promise<boolean>
  removeMcpServer(serverName: string): Promise<void>
  updateMcpServer(serverName: string, config: Partial<MCPServerConfig>): Promise<void>
  // ACP configuration methods
  getAcpEnabled(): Promise<boolean>
  setAcpEnabled(enabled: boolean): Promise<void>
  listAcpRegistryAgents(): Promise<AcpRegistryAgent[]>
  refreshAcpRegistry(force?: boolean): Promise<AcpRegistryAgent[]>
  getAcpRegistryIconMarkup(agentId: string, iconUrl?: string): Promise<string | null>
  getAcpAgentState(agentId: string): Promise<AcpAgentState | null>
  setAcpAgentEnabled(agentId: string, enabled: boolean): Promise<void>
  setAcpAgentEnvOverride(agentId: string, env: Record<string, string>): Promise<void>
  ensureAcpAgentInstalled(agentId: string): Promise<AcpAgentInstallState>
  repairAcpAgent(agentId: string): Promise<AcpAgentInstallState>
  uninstallAcpRegistryAgent(agentId: string): Promise<void>
  listManualAcpAgents(): Promise<AcpManualAgent[]>
  addManualAcpAgent(
    agent: Omit<AcpManualAgent, 'id' | 'source'> & { id?: string }
  ): Promise<AcpManualAgent>
  updateManualAcpAgent(
    agentId: string,
    updates: Partial<Omit<AcpManualAgent, 'id' | 'source'>>
  ): Promise<AcpManualAgent | null>
  removeManualAcpAgent(agentId: string): Promise<boolean>
  resolveAcpLaunchSpec(agentId: string, workdir?: string): Promise<AcpResolvedLaunchSpec>
  getAcpSharedMcpSelections(): Promise<string[]>
  setAcpSharedMcpSelections(mcpIds: string[]): Promise<void>
  listAgents(): Promise<Agent[]>
  getAgent(agentId: string): Promise<Agent | null>
  getAgentType(agentId: string): Promise<AgentType | null>
  getDeepChatAgentConfig(agentId: string): Promise<DeepChatAgentConfig | null>
  resolveDeepChatAgentConfig(agentId: string): Promise<DeepChatAgentConfig>
  agentSupportsCapability(agentId: string, capability: 'vision'): Promise<boolean>
  createDeepChatAgent(input: CreateDeepChatAgentInput): Promise<Agent>
  updateDeepChatAgent(agentId: string, updates: UpdateDeepChatAgentInput): Promise<Agent | null>
  deleteDeepChatAgent(agentId: string): Promise<boolean>
  deleteDeepChatAgentWithCleanup(
    agentId: string
  ): Promise<{ removed: boolean; cleanupPendingRestart: boolean }>
  getAcpAgents(): Promise<AcpAgentConfig[]>
  getAgentMcpSelections(agentId: string, isBuiltin?: boolean): Promise<string[]>
  setAgentMcpSelections(agentId: string, isBuiltin: boolean, mcpIds: string[]): Promise<void>
  addMcpToAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void>
  removeMcpFromAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void>
  getMcpConfHelper(): any // Used to get MCP configuration helper
  isKnownModel(providerId: string, modelId: string): boolean
  getModelConfig(modelId: string, providerId?: string): ModelConfig
  setModelConfig(
    modelId: string,
    providerId: string,
    config: ModelConfig,
    options?: {
      source?: ModelConfigSource
    }
  ): void
  resetModelConfig(modelId: string, providerId: string): void
  getAllModelConfigs(): Record<string, IModelConfig>
  getProviderModelConfigs(providerId: string): Array<{ modelId: string; config: ModelConfig }>
  hasUserModelConfig(modelId: string, providerId: string): boolean
  exportModelConfigs(): Record<string, IModelConfig>
  importModelConfigs(configs: Record<string, IModelConfig>, overwrite: boolean): void
  // Theme settings
  initTheme(): void
  setTheme(theme: 'dark' | 'light' | 'system'): Promise<boolean>
  getTheme(): Promise<string>
  getCurrentThemeIsDark(): Promise<boolean>
  getCustomPrompts(): Promise<Prompt[]>
  setCustomPrompts(prompts: Prompt[]): Promise<void>
  addCustomPrompt(prompt: Prompt): Promise<void>
  updateCustomPrompt(promptId: string, updates: Partial<Prompt>): Promise<void>
  deleteCustomPrompt(promptId: string): Promise<void>
  // Default system prompt settings
  getDefaultSystemPrompt(): Promise<string>
  setDefaultSystemPrompt(prompt: string): Promise<void>
  resetToDefaultPrompt(): Promise<void>
  clearSystemPrompt(): Promise<void>
  // System prompt management
  getSystemPrompts(): Promise<SystemPrompt[]>
  setSystemPrompts(prompts: SystemPrompt[]): Promise<void>
  addSystemPrompt(prompt: SystemPrompt): Promise<void>
  updateSystemPrompt(promptId: string, updates: Partial<SystemPrompt>): Promise<void>
  deleteSystemPrompt(promptId: string): Promise<void>
  setDefaultSystemPromptId(promptId: string): Promise<void>
  getDefaultSystemPromptId(): Promise<string>
  // Shortcut key settings
  // Knowledge base settings
  getKnowledgeConfigs(): BuiltinKnowledgeConfig[]
  setKnowledgeConfigs(configs: BuiltinKnowledgeConfig[]): void
  diffKnowledgeConfigs(configs: BuiltinKnowledgeConfig[]): {
    added: BuiltinKnowledgeConfig[]
    deleted: BuiltinKnowledgeConfig[]
    updated: BuiltinKnowledgeConfig[]
  }
  // NPM Registry related methods
  getNpmRegistryCache(): any
  setNpmRegistryCache(cache: any): void
  isNpmRegistryCacheValid(): boolean
  getEffectiveNpmRegistry(): string | null
  getCustomNpmRegistry(): string | undefined
  setCustomNpmRegistry(registry: string | undefined): void
  getAutoDetectNpmRegistry(): boolean
  setAutoDetectNpmRegistry(enabled: boolean): void
  clearNpmRegistryCache(): void
  getProviderDb(): { providers: Record<string, unknown> } | null
  refreshProviderDb(force?: boolean): Promise<ProviderDbRefreshResult>

  // Default model settings
  getDefaultModel(): { providerId: string; modelId: string } | undefined
  setDefaultModel(model: { providerId: string; modelId: string } | undefined): void
  // Atomic operation interfaces
  updateProviderAtomic(id: string, updates: Partial<LLM_PROVIDER>): boolean
  addProviderAtomic(provider: LLM_PROVIDER): void
  removeProviderAtomic(providerId: string): void
  reorderProvidersAtomic(providers: LLM_PROVIDER[]): void
  updateProvidersBatch(batchUpdate: ProviderBatchUpdate): void
  setTraceDebugEnabled(enabled: boolean): void
}
export type RENDERER_MODEL_META = {
  id: string
  name: string
  group: string
  providerId: string
  enabled?: boolean
  isCustom?: boolean
  vision?: boolean
  functionCall?: boolean
  explicitFunctionCall?: boolean
  reasoning?: boolean
  type?: ModelType
  contextLength?: number
  maxTokens?: number
  description?: string
  supportedEndpointTypes?: NewApiEndpointType[]
  selectableEndpointTypes?: NewApiEndpointType[]
  endpointType?: NewApiEndpointType
  ownedBy?: string
}
export type MODEL_META = {
  id: string
  name: string
  group: string
  providerId: string
  enabled?: boolean
  isCustom?: boolean
  vision?: boolean
  functionCall?: boolean
  reasoning?: boolean
  type?: ModelType
  contextLength?: number
  maxTokens?: number
  description?: string
  supportedEndpointTypes?: NewApiEndpointType[]
  selectableEndpointTypes?: NewApiEndpointType[]
  endpointType?: NewApiEndpointType
  ownedBy?: string
}
export type LLM_PROVIDER = {
  id: string
  capabilityProviderId?: string
  name: string
  apiType: string
  apiKey: string
  copilotClientId?: string
  baseUrl: string
  models?: MODEL_META[]
  customModels?: MODEL_META[]
  enable: boolean
  enabledModels?: string[]
  disabledModels?: string[]
  custom?: boolean
  oauthToken?: string // OAuth token
  rateLimit?: {
    enabled: boolean
    qpsLimit: number
  }
  rateLimitConfig?: {
    enabled: boolean
    qpsLimit: number
  }
  websites?: {
    official: string
    apiKey: string
    name?: string
    icon?: string
    docs?: string
    models?: string
    defaultBaseUrl?: string
  }
}

export type LLM_PROVIDER_BASE = Omit<
  LLM_PROVIDER,
  'models' | 'customModels' | 'enabledModels' | 'disabledModels'
> & {
  models?: MODEL_META[]
  customModels?: MODEL_META[]
  enabledModels?: string[]
  disabledModels?: string[]
  websites?: {
    official: string
    apiKey: string
    name?: string
    icon?: string
    docs?: string
    models?: string
    defaultBaseUrl?: string
  }
}

export type LLM_EMBEDDING_ATTRS = {
  dimensions: number
  normalized: boolean
}

export type StandaloneImageGenerationResult = {
  providerId: string
  modelId: string
  options?: ImageGenerationOptions
  images: Array<{ data: string; mimeType: string }>
}

export type StandaloneVideoGenerationResult = {
  providerId: string
  modelId: string
  options?: VideoGenerationOptions
  videos: Array<{ data: string; mimeType: string }>
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
  /**
   * Selected MCP server names the agent can access (ACP mode).
   * Empty/undefined means no MCP access.
   */
  mcpSelections?: string[]
}

export interface AcpCustomAgent {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled: boolean
  /**
   * Selected MCP server names the agent can access (ACP mode).
   * Empty/undefined means no MCP access.
   */
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

// Simplified ModelScope MCP sync options
export interface ModelScopeMcpSyncOptions {
  page_number?: number
  page_size?: number
  timeout?: number
  retryCount?: number
}

// ModelScope MCP sync result interface
export interface ModelScopeMcpSyncResult {
  success?: boolean
  message?: string
  synced?: number
  imported: number
  skipped: number
  errors: string[]
}

export type AWS_BEDROCK_PROVIDER = LLM_PROVIDER & {
  credential?: AwsBedrockCredential
}

export type VERTEX_PROVIDER = LLM_PROVIDER & {
  projectId?: string
  location?: string
  accountPrivateKey?: string
  accountClientEmail?: string
  apiVersion?: 'v1' | 'v1beta1'
  endpointMode?: 'standard' | 'express'
}

export interface AwsBedrockCredential {
  authMode?: 'accessKeys' | 'profile'
  accessKeyId: string
  secretAccessKey: string
  region?: string
  profile?: string
}

export interface ProviderRuntimePort {
  setProviders(provider: LLM_PROVIDER[]): void
  getProviders(): LLM_PROVIDER[]
  getProviderById(id: string): LLM_PROVIDER
  getExistingProviderInstance?(providerId: string): unknown
  getModelList(providerId: string): Promise<MODEL_META[]>
  updateModelStatus(providerId: string, modelId: string, enabled: boolean): Promise<void>
  addCustomModel(
    providerId: string,
    model: Omit<MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ): Promise<MODEL_META>
  removeCustomModel(providerId: string, modelId: string): Promise<boolean>
  updateCustomModel(
    providerId: string,
    modelId: string,
    updates: Partial<MODEL_META>
  ): Promise<boolean>
  getCustomModels(providerId: string): Promise<MODEL_META[]>
  generateCompletion(
    providerId: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string>
  generateText(
    providerId: string,
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<{ content: string }>
  stopStream(eventId: string): Promise<void>
  check(providerId: string, modelId?: string): Promise<{ isOk: boolean; errorMsg: string | null }>
  getKeyStatus(providerId: string): Promise<KeyStatus | null>
  refreshModels(providerId: string): Promise<void>
  summaryTitles(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    providerId: string,
    modelId: string
  ): Promise<string>
  listOllamaModels(providerId: string): Promise<OllamaModel[]>
  showOllamaModelInfo(providerId: string, modelName: string): Promise<ShowResponse>
  listOllamaRunningModels(providerId: string): Promise<OllamaModel[]>
  pullOllamaModels(providerId: string, modelName: string): Promise<boolean>
  getEmbeddings(
    providerId: string,
    modelId: string,
    texts: string[],
    signal?: AbortSignal
  ): Promise<number[][]>
  getDimensions(
    providerId: string,
    modelId: string,
    signal?: AbortSignal
  ): Promise<{ data: LLM_EMBEDDING_ATTRS; errorMsg?: string }>
  updateProviderRateLimit(providerId: string, enabled: boolean, qpsLimit: number): void
  getProviderRateLimitStatus(providerId: string): {
    config: { enabled: boolean; qpsLimit: number }
    currentQps: number
    queueLength: number
    lastRequestTime: number
  }
  getAllProviderRateLimitStatus(): Record<
    string,
    {
      config: { enabled: boolean; qpsLimit: number }
      currentQps: number
      queueLength: number
      lastRequestTime: number
    }
  >
  executeWithRateLimit(
    providerId: string,
    options?: {
      signal?: AbortSignal
      scope?: 'provider' | 'acp-direct'
      onQueued?: (snapshot: {
        providerId: string
        qpsLimit: number
        currentQps: number
        queueLength: number
        estimatedWaitTime: number
      }) => void
    }
  ): Promise<void>
  syncModelScopeMcpServers(
    providerId: string,
    syncOptions?: ModelScopeMcpSyncOptions
  ): Promise<ModelScopeMcpSyncResult>

  generateCompletionStandalone(
    providerId: string,
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    options?: { signal?: AbortSignal; swallowErrors?: boolean }
  ): Promise<string>
  transcribeAudioStandalone(
    providerId: string,
    modelId: string,
    audioBase64: string,
    mimeType: string,
    filename?: string,
    options?: { signal?: AbortSignal }
  ): Promise<string>
  generateImageStandalone(
    providerId: string,
    prompt: string,
    modelId: string,
    imageOptions?: ImageGenerationOptions,
    options?: { signal?: AbortSignal }
  ): Promise<StandaloneImageGenerationResult>
  generateVideoStandalone(
    providerId: string,
    prompt: string,
    modelId: string,
    videoOptions?: VideoGenerationOptions,
    options?: { signal?: AbortSignal }
  ): Promise<StandaloneVideoGenerationResult>
  getProviderInstance(providerId: string): unknown
  getExistingProviderInstance?(providerId: string): unknown
}

export type CONVERSATION_SETTINGS = {
  systemPrompt: string
  temperature: number
  contextLength: number
  maxTokens: number
  providerId: string
  modelId: string
  artifacts: 0 | 1
  enabledMcpTools?: string[]
  thinkingBudget?: number
  reasoningEffort?: ReasoningEffort
  verbosity?: Verbosity
  selectedVariantsMap?: Record<string, string>
  acpWorkdirMap?: Record<string, string | null>
  chatMode?: 'agent' | 'acp agent'
  agentWorkspacePath?: string | null
  activeSkills?: string[] // Activated skills for this conversation
}

export type ParentSelection = {
  selectedText: string
  startOffset: number
  endOffset: number
  contextBefore: string
  contextAfter: string
  contentHash: string
  version?: number
}

export type CONVERSATION = {
  id: string
  title: string
  settings: CONVERSATION_SETTINGS
  createdAt: number
  updatedAt: number
  is_new?: number
  artifacts?: number
  is_pinned?: number
  parentConversationId?: string | null
  parentMessageId?: string | null
  parentSelection?: ParentSelection | null
}

export interface IThreadPresenter {
  // Basic conversation operations
  createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS>,
    tabId: number,
    options?: { forceNewAndActivate?: boolean } // Added options parameter, supports forced creation of new sessions, avoiding singleton detection for empty sessions
  ): Promise<string>
  deleteConversation(conversationId: string): Promise<void>
  getConversation(conversationId: string): Promise<CONVERSATION>
  renameConversation(conversationId: string, title: string): Promise<CONVERSATION>
  updateConversationTitle(conversationId: string, title: string): Promise<void>
  updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void>

  // Conversation branching operations
  forkConversation(
    targetConversationId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<CONVERSATION_SETTINGS>,
    selectedVariantsMap?: Record<string, string>
  ): Promise<string>

  createChildConversationFromSelection(payload: {
    parentConversationId: string
    parentMessageId: string
    parentSelection: ParentSelection | string
    title: string
    settings?: Partial<CONVERSATION_SETTINGS>
    tabId?: number
    openInNewTab?: boolean
  }): Promise<string>

  // Conversation list and activation status
  getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }>
  listChildConversationsByParent(parentConversationId: string): Promise<CONVERSATION[]>
  listChildConversationsByMessageIds(parentMessageIds: string[]): Promise<CONVERSATION[]>
  loadMoreThreads(): Promise<{ hasMore: boolean; total: number }>
  setActiveConversation(conversationId: string, tabId: number): Promise<void>
  openConversationInNewTab(payload: {
    conversationId: string
    tabId?: number
    messageId?: string
    childConversationId?: string
  }): Promise<number | null>
  getActiveConversation(tabId: number): Promise<CONVERSATION | null>
  getActiveConversationId(tabId: number): Promise<string | null>
  clearActiveThread(tabId: number): Promise<void>
  findTabForConversation(conversationId: string): Promise<number | null>

  clearAllMessages(conversationId: string): Promise<void>

  // Message operations
  getMessages(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: MESSAGE[] }>
  getMessageThread(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; messages: MESSAGE[] }>
  editMessage(messageId: string, content: string): Promise<MESSAGE>
  deleteMessage(messageId: string): Promise<void>
  getMessage(messageId: string): Promise<MESSAGE>
  getMessageVariants(messageId: string): Promise<MESSAGE[]>
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>
  getMessageExtraInfo(messageId: string, type: string): Promise<Record<string, unknown>[]>
  getMainMessageByParentId(conversationId: string, parentId: string): Promise<MESSAGE | null>
  getLastUserMessage(conversationId: string): Promise<MESSAGE | null>

  // Context control
  getContextMessages(conversationId: string): Promise<MESSAGE[]>
  clearContext(conversationId: string): Promise<void>
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
  destroy(): void
  toggleConversationPinned(conversationId: string, isPinned: boolean): Promise<void>
}

export type MESSAGE_STATUS = 'sent' | 'pending' | 'error'
export type MESSAGE_ROLE = 'user' | 'assistant' | 'system' | 'function'

export type MESSAGE_METADATA = {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  generationTime: number
  firstTokenTime: number
  tokensPerSecond: number
  contextUsage: number
  model?: string
  provider?: string
  reasoningStartTime?: number
  reasoningEndTime?: number
}

export interface IMessageManager {
  // Basic message operations
  sendMessage(
    conversationId: string,
    content: string,
    role: MESSAGE_ROLE,
    parentId: string,
    isVariant: boolean,
    metadata: MESSAGE_METADATA
  ): Promise<MESSAGE>
  editMessage(messageId: string, content: string): Promise<MESSAGE>
  deleteMessage(messageId: string): Promise<void>
  retryMessage(messageId: string, metadata: MESSAGE_METADATA): Promise<MESSAGE>

  // Message queries
  getMessage(messageId: string): Promise<MESSAGE>
  getMessageVariants(messageId: string): Promise<MESSAGE[]>
  getMessageThread(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{
    total: number
    list: MESSAGE[]
  }>
  getContextMessages(conversationId: string, contextLength: number): Promise<MESSAGE[]>

  // Message status management
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>

  // Context management
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
}

export interface IDevicePresenter {
  getAppVersion(): Promise<string>
  getDeviceInfo(): Promise<DeviceInfo>
  getCPUUsage(): Promise<number>
  getMemoryUsage(): Promise<MemoryInfo>
  getDiskSpace(): Promise<DiskInfo>
  resetData(): Promise<void>
  resetDataByType(resetType: 'chat' | 'knowledge' | 'config' | 'all'): Promise<void>

  // Directory selection and application restart
  selectDirectory(): Promise<{ canceled: boolean; filePaths: string[] }>
  selectFiles(options?: {
    filters?: { name: string; extensions: string[] }[]
    multiple?: boolean
  }): Promise<{ canceled: boolean; filePaths: string[] }>
  restartApp(): Promise<void>

  // Image caching
  cacheImage(imageData: string): Promise<string>

  // SVG content security sanitization
  sanitizeSvgContent(svgContent: string): Promise<string | null>
}

export type DeviceInfo = {
  platform: string
  arch: string
  cpuModel: string
  totalMemory: number
  osVersion: string
  osVersionMetadata: Array<{
    name: string
    build: number
  }>
}

export type MemoryInfo = {
  total: number
  free: number
  used: number
}

export type DiskInfo = {
  total: number
  free: number
  used: number
}

export type LLMResponse = {
  content: string
  reasoning_content?: string
  tool_call_name?: string
  tool_call_params?: string
  tool_call_response?: string
  tool_call_id?: string
  tool_call_server_name?: string
  tool_call_server_icons?: string
  tool_call_server_description?: string
  tool_call_response_raw?: MCPToolResponse
  maximum_tool_calls_reached?: boolean
  totalUsage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
export type LLMResponseStream = {
  content?: string
  reasoning_content?: string
  image_data?: {
    data: string
    mimeType: string
  }
  tool_call?: 'start' | 'end' | 'error'
  tool_call_name?: string
  tool_call_params?: string
  tool_call_response?: string
  tool_call_id?: string
  tool_call_server_name?: string
  tool_call_server_icons?: string
  tool_call_server_description?: string
  tool_call_response_raw?: MCPToolResponse
  maximum_tool_calls_reached?: boolean
  totalUsage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
// Update status types
export type UpdateStatus =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateProgress {
  bytesPerSecond: number
  percent: number
  transferred: number
  total: number
}

// Define model interface based on Ollama SDK
export interface OllamaModel {
  name: string
  model?: string
  modified_at: Date | string // Modified to allow Date or string
  size: number
  digest: string
  details: {
    format: string
    family: string
    families?: string[]
    parameter_size: string
    quantization_level: string
  }
  // Merge some information from show interface
  model_info?: {
    context_length?: number
    embedding_length?: number
    vision?: {
      embedding_length: number
    }
  }
  capabilities?: string[]
}

// Define progress callback interface
export interface ProgressResponse {
  status: string
  digest?: string
  total?: number
  completed?: number
}

// MCP related type definitions
export interface MCPServerConfig {
  command: string
  args: string[]
  env: Record<string, unknown>
  descriptions: string
  icons: string
  autoApprove: string[]
  enabled: boolean
  disable?: boolean
  baseUrl?: string
  customHeaders?: Record<string, string>
  customNpmRegistry?: string
  type: 'sse' | 'stdio' | 'inmemory' | 'http'
  source?: string // Source identifier: "mcprouter" | "modelscope" | undefined(for manual)
  sourceId?: string // Source ID: mcprouter uuid or modelscope mcpServer.id
  ownerPluginId?: string // Plugin owner id for managed plugin MCP servers
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
  state: McpServerAuthState
  authenticated: boolean
  error?: string
  updatedAt?: number
  storage?: 'safeStorage' | 'file' | 'none'
}

export interface MCPToolDefinition {
  type: string
  source?: 'mcp' | 'agent'
  function: {
    name: string
    description: string
    parameters: {
      type: string
      properties: Record<string, any>
      required?: string[]
    }
  }
  server: {
    name: string
    icons: string
    description: string
  }
}

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
  /**
   * Optional conversation context (used for ACP agent MCP access control).
   */
  conversationId?: string
  /** Session provider used for ACP MCP access control. */
  providerId?: string
}

export interface MCPToolResponse {
  /** Unique identifier for tool call */
  toolCallId: string

  /**
   * Tool call response content
   * Can be simple string or structured content array
   */
  content: string | MCPContentItem[]

  /** Optional metadata */
  _meta?: Record<string, any>

  /** Whether an error occurred */
  isError?: boolean

  /** When using compatibility mode, may directly return tool results */
  toolResult?: unknown

  /** Image previews extracted from tool output for renderer display */
  imagePreviews?: import('../core/mcp').ToolCallImagePreview[]

  /** Whether permission is required */
  requiresPermission?: boolean

  /** Permission request information */
  permissionRequest?: {
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
    command?: string
    commandSignature?: string
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
    conversationId?: string
  }
}

export type McpSamplingMessage = import('../../core/mcp').McpSamplingMessage
export type McpSamplingRequestPayload = import('../../core/mcp').McpSamplingRequestPayload
export type McpSamplingDecision = import('../../core/mcp').McpSamplingDecision
export type McpSamplingModelPreferences = import('../../core/mcp').McpSamplingModelPreferences

/** Content item type */
export type MCPContentItem = MCPTextContent | MCPImageContent | MCPResourceContent

/** Text content */
export interface MCPTextContent {
  type: 'text'
  text: string
}

/** Image content */
export interface MCPImageContent {
  type: 'image'
  data: string // Base64 encoded image data
  mimeType: string // E.g., "image/png", "image/jpeg", etc.
}

/** Resource content */
export interface MCPResourceContent {
  type: 'resource'
  resource: {
    uri: string
    mimeType?: string
    /** Resource text content, mutually exclusive with blob */
    text?: string
    /** Resource binary content, mutually exclusive with text */
    blob?: string
  }
}

export interface McpServicePort {
  initialize(): Promise<void>
  shutdown(): Promise<void>
  isReady(): boolean
  getMcpServers(): Promise<Record<string, MCPServerConfig>>
  getMcpClients(): Promise<McpClient[]>
  getEnabledMcpServers(): Promise<string[]>
  setMcpServerEnabled(serverName: string, enabled: boolean): Promise<void>
  addMcpServer(serverName: string, config: MCPServerConfig): Promise<boolean>
  removeMcpServer(serverName: string): Promise<void>
  updateMcpServer(serverName: string, config: Partial<MCPServerConfig>): Promise<void>
  isServerRunning(serverName: string): Promise<boolean>
  isServerActive(serverName: string): Promise<boolean>
  startServer(serverName: string): Promise<void>
  stopServer(serverName: string): Promise<void>
  stopServerDuringShutdownByName(serverName: string): Promise<void>
  getServerLastError(serverName: string): string | undefined
  getMcpServerAuthStatus(serverName: string): Promise<McpServerAuthStatus>
  startMcpServerAuth(serverName: string): Promise<McpServerAuthStatus>
  completeMcpServerAuthFromCallbackUrl(
    serverName: string,
    callbackUrl: string
  ): Promise<McpServerAuthStatus>
  logoutMcpServerAuth(serverName: string): Promise<McpServerAuthStatus>
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
    }
  ): Promise<{ content: string; rawData: MCPToolResponse }>
  preCheckToolPermission(
    request: MCPToolCall,
    options?: {
      signal?: AbortSignal
      agentId?: string
      enabledServerIds?: string[]
    }
  ): Promise<{
    needsPermission: true
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
    command?: string
    commandSignature?: string
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
  } | null>
  handleSamplingRequest(request: McpSamplingRequestPayload): Promise<McpSamplingDecision>
  submitSamplingDecision(decision: McpSamplingDecision): Promise<void>
  cancelSamplingRequest(requestId: string, reason?: string): Promise<void>
  setMcpEnabled(enabled: boolean): Promise<void>
  getMcpEnabled(): Promise<boolean>

  // Permission management
  grantPermission(
    serverName: string,
    permissionType: 'read' | 'write' | 'all',
    remember?: boolean,
    conversationId?: string
  ): Promise<void>
  clearSessionPermissions(conversationId: string): void
  // NPM Registry management methods
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
  // Get npm/uv registry for internal use (ACP, etc.)
  getNpmRegistry(): string | null
  getUvRegistry(): string | null

  // McpRouter marketplace
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
  updateMcpRouterServersAuth(apiKey: string): Promise<void>
}

// Standardized events returned from LLM Provider's coreStream
export type LLMCoreStreamEvent = import('../../core/llm-events').LLMCoreStreamEvent

// Define ChatMessage interface for unified message format
export type ChatMessage = import('../../core/llm-events').ChatMessage

export type ChatMessageContent = import('../../core/llm-events').ChatMessageContent

export type LLMAgentEventData = import('../../core/agent-events').LLMAgentEventData
export type LLMAgentEvent = import('../../core/agent-events').LLMAgentEvent

export interface DefaultModelSetting {
  id: string
  name: string
  temperature?: number
  contextLength: number
  maxTokens: number
  match: string[]
  vision: boolean
  functionCall: boolean
  reasoning?: boolean
  type?: ModelType
  thinkingBudget?: number
  enableSearch?: boolean
  forcedSearch?: boolean
  searchStrategy?: 'turbo' | 'max'
  // New parameters for GPT-5 series
  reasoningEffort?: ReasoningEffort
  verbosity?: Verbosity
  maxCompletionTokens?: number // GPT-5 series uses this parameter to replace maxTokens
}

export interface KeyStatus {
  remainNum?: number
  /** Remaining quota */
  limit_remaining?: string
  /** Used quota */
  usage?: string
}

export interface DialogButton {
  key: string
  label: string
  default?: boolean
}
export interface DialogIcon {
  icon: string
  class: string
}

export interface DialogRequestParams {
  title: string
  description?: string
  i18n?: boolean
  icon?: DialogIcon
  buttons?: DialogButton[]
  timeout?: number
}

export interface DialogRequest {
  id: string
  title: string
  description?: string
  i18n: boolean
  icon?: DialogIcon
  buttons: DialogButton[]
  timeout: number
}

export interface DialogResponse {
  id: string
  button: string
}

export interface IDialogPresenter {
  /**
   * Show dialog
   * @param request DialogRequest object containing the dialog configuration
   * @returns Returns a Promise that resolves to the text of the button selected by the user
   * @throws Returns null if the dialog is cancelled
   */
  showDialog(request: DialogRequestParams): Promise<string>
  /**
   * Handle dialog response
   * @param response DialogResponse object containing the dialog response information
   */
  handleDialogResponse(response: DialogResponse): Promise<void>
  /**
   * Handle dialog error
   * @param response Dialog id
   */
  handleDialogError(response: string): Promise<void>
}
