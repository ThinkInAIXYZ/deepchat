/* eslint-disable @typescript-eslint/no-explicit-any */
import { BrowserWindow } from 'electron'
import { MessageFile } from './chat'
import { ShowResponse } from 'ollama'
import { ShortcutKeySetting } from '@/presenter/configPresenter/shortcutKeySettings'
import { ModelType } from '@shared/model'
import { ProviderChange, ProviderBatchUpdate } from './provider-operations'

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

export interface ModelConfig {
  maxTokens: number
  contextLength: number
  temperature?: number
  vision: boolean
  functionCall: boolean
  reasoning: boolean
  type: ModelType
  // Whether this config is user-defined (true) or default config (false)
  isUserDefined?: boolean
  thinkingBudget?: number
  enableSearch?: boolean
  forcedSearch?: boolean
  searchStrategy?: 'turbo' | 'max'
  // New parameters for GPT-5 series
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
  maxCompletionTokens?: number // GPT-5 series uses this parameter to replace maxTokens
}

export interface IModelConfig {
  id: string
  providerId: string
  config: ModelConfig
}
export interface ProviderModelConfigs {
  [modelId: string]: ModelConfig
}

export interface TabData {
  id: number
  title: string
  isActive: boolean
  position: number
  closable: boolean
  url: string
  icon?: string
}

export interface IWindowPresenter {
  createShellWindow(options?: {
    activateTabId?: number
    initialTab?: {
      url: string
      type?: string
      icon?: string
    }
    forMovedTab?: boolean
    x?: number
    y?: number
  }): Promise<number | null>
  mainWindow: BrowserWindow | undefined
  previewFile(filePath: string): void
  minimize(windowId: number): void
  maximize(windowId: number): void
  close(windowId: number): void
  hide(windowId: number): void
  show(windowId?: number): void
  isMaximized(windowId: number): boolean
  isMainWindowFocused(windowId: number): boolean
  sendToAllWindows(channel: string, ...args: unknown[]): void
  sendToWindow(windowId: number, channel: string, ...args: unknown[]): boolean
  sendToDefaultTab(channel: string, switchToTarget?: boolean, ...args: unknown[]): Promise<boolean>
  closeWindow(windowId: number, forceClose?: boolean): Promise<void>
  isApplicationQuitting(): boolean
  setApplicationQuitting(isQuitting: boolean): void
  destroyFloatingChatWindow(): void
  isFloatingChatWindowVisible(): boolean
  getFloatingChatWindow(): FloatingChatWindow | null
  getFocusedWindow(): BrowserWindow | undefined
  sendToActiveTab(windowId: number, channel: string, ...args: unknown[]): Promise<boolean>
  getAllWindows(): BrowserWindow[]
  toggleFloatingChatWindow(floatingButtonPosition?: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<void>
  createFloatingChatWindow(): Promise<void>
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
  // Added renderer process Tab event handling methods
  onRendererTabReady(tabId: number): Promise<void>
  onRendererTabActivated(threadId: string): Promise<void>
  isLastTabInWindow(tabId: number): Promise<boolean>
  registerFloatingWindow(webContentsId: number, webContents: Electron.WebContents): void
  unregisterFloatingWindow(webContentsId: number): void
  resetTabToBlank(tabId: number): Promise<void>
  destroy(): Promise<void>
}

export interface TabCreateOptions {
  active?: boolean
  position?: number
}

export interface ILlamaCppPresenter {
  init(): void
  prompt(text: string): Promise<string>
  startNewChat(): void
  destroy(): Promise<void>
}

export interface IShortcutPresenter {
  registerShortcuts(): void
  unregisterShortcuts(): void
  destroy(): void
}

export interface ISQLitePresenter {
  close(): void
  createConversation(title: string, settings?: Partial<CONVERSATION_SETTINGS>): Promise<string>
  deleteConversation(conversationId: string): Promise<void>
  renameConversation(conversationId: string, title: string): Promise<CONVERSATION>
  getConversation(conversationId: string): Promise<CONVERSATION>
  updateConversation(conversationId: string, data: Partial<CONVERSATION>): Promise<void>
  getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }>
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
  deleteAllMessages(): Promise<void>
  runTransaction(operations: () => void): Promise<void>

  // Added message management methods
  getMessage(messageId: string): Promise<SQLITE_MESSAGE | null>
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
  deleteMessage(messageId: string): Promise<void>
  getMaxOrderSeq(conversationId: string): Promise<number>
  addMessageAttachment(
    messageId: string,
    attachmentType: string,
    attachmentData: string
  ): Promise<void>
  getMessageAttachments(messageId: string, type: string): Promise<{ content: string }[]>
  getLastUserMessage(conversationId: string): Promise<SQLITE_MESSAGE | null>
  getMainMessageByParentId(conversationId: string, parentId: string): Promise<SQLITE_MESSAGE | null>
  deleteAllMessagesInConversation(conversationId: string): Promise<void>
}

export interface IOAuthPresenter {
  startOAuthLogin(providerId: string, config: OAuthConfig): Promise<boolean>
  startGitHubCopilotLogin(providerId: string): Promise<boolean>
  startGitHubCopilotDeviceFlowLogin(providerId: string): Promise<boolean>
  startAnthropicOAuthFlow(): Promise<string>
  completeAnthropicOAuthWithCode(code: string): Promise<boolean>
  cancelAnthropicOAuthFlow(): Promise<void>
  hasAnthropicCredentials(): Promise<boolean>
  getAnthropicAccessToken(): Promise<string | null>
  clearAnthropicCredentials(): Promise<void>
}

export interface OAuthConfig {
  authUrl: string
  redirectUri: string
  clientId: string
  clientSecret?: string
  scope: string
  responseType: string
}

export interface IPresenter {
  windowPresenter: IWindowPresenter
  sqlitePresenter: ISQLitePresenter
  llmproviderPresenter: ILlmProviderPresenter
  configPresenter: IConfigPresenter
  threadPresenter: IThreadPresenter
  devicePresenter: IDevicePresenter
  upgradePresenter: IUpgradePresenter
  shortcutPresenter: IShortcutPresenter
  filePresenter: IFilePresenter
  mcpPresenter: IMCPPresenter
  syncPresenter: ISyncPresenter
  deeplinkPresenter: IDeeplinkPresenter
  notificationPresenter: INotificationPresenter
  tabPresenter: ITabPresenter
  oauthPresenter: IOAuthPresenter
  dialogPresenter: IDialogPresenter
  knowledgePresenter: IKnowledgePresenter
  init(): void
  destroy(): void
}

export interface INotificationPresenter {
  showNotification(options: { id: string; title: string; body: string; silent?: boolean }): void
  clearNotification(id: string): void
  clearAllNotifications(): void
}

export interface IConfigPresenter {
  getSetting<T>(key: string): T | undefined
  setSetting<T>(key: string, value: T): void
  getProviders(): LLM_PROVIDER[]
  setProviders(providers: LLM_PROVIDER[]): void
  getProviderById(id: string): LLM_PROVIDER | undefined
  setProviderById(id: string, provider: LLM_PROVIDER): void
  getProviderModels(providerId: string): MODEL_META[]
  setProviderModels(providerId: string, models: MODEL_META[]): void
  getEnabledProviders(): LLM_PROVIDER[]
  getModelDefaultConfig(modelId: string, providerId?: string): ModelConfig
  getAllEnabledModels(): Promise<{ providerId: string; models: RENDERER_MODEL_META[] }[]>
  // Sound effect settings
  getSoundEnabled(): boolean
  setSoundEnabled(enabled: boolean): void
  // Chain of Thought copy settings
  getCopyWithCotEnabled(): boolean
  setCopyWithCotEnabled(enabled: boolean): void
  // Floating button settings
  getFloatingButtonEnabled(): boolean
  setFloatingButtonEnabled(enabled: boolean): void
  // Update channel settings
  getUpdateChannel(): string
  setUpdateChannel(channel: string): void
  // Logging settings
  getLoggingEnabled(): boolean
  setLoggingEnabled(enabled: boolean): void
  openLoggingFolder(): void
  // Custom model management
  getCustomModels(providerId: string): MODEL_META[]
  setCustomModels(providerId: string, models: MODEL_META[]): void
  addCustomModel(providerId: string, model: MODEL_META): void
  removeCustomModel(providerId: string, modelId: string): void
  updateCustomModel(providerId: string, modelId: string, updates: Partial<MODEL_META>): void
  // Close behavior settings
  getCloseToQuit(): boolean
  setCloseToQuit(value: boolean): void
  getModelStatus(providerId: string, modelId: string): boolean
  setModelStatus(providerId: string, modelId: string, enabled: boolean): void
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
  // Custom search engine
  getCustomSearchEngines(): Promise<SearchEngineTemplate[]>
  setCustomSearchEngines(engines: SearchEngineTemplate[]): Promise<void>
  // Search preview settings
  getSearchPreviewEnabled(): Promise<boolean>
  setSearchPreviewEnabled(enabled: boolean): void
  // Screen sharing protection settings
  getContentProtectionEnabled(): boolean
  setContentProtectionEnabled(enabled: boolean): void
  // Sync settings
  getSyncEnabled(): boolean
  setSyncEnabled(enabled: boolean): void
  getSyncFolderPath(): string
  setSyncFolderPath(folderPath: string): void
  getLastSyncTime(): number
  setLastSyncTime(time: number): void
  // MCP configuration related methods
  getMcpServers(): Promise<Record<string, MCPServerConfig>>
  setMcpServers(servers: Record<string, MCPServerConfig>): Promise<void>
  getMcpDefaultServers(): Promise<string[]>
  addMcpDefaultServer(serverName: string): Promise<void>
  removeMcpDefaultServer(serverName: string): Promise<void>
  toggleMcpDefaultServer(serverName: string): Promise<void>
  getMcpEnabled(): Promise<boolean>
  setMcpEnabled(enabled: boolean): Promise<void>
  addMcpServer(serverName: string, config: MCPServerConfig): Promise<boolean>
  removeMcpServer(serverName: string): Promise<void>
  updateMcpServer(serverName: string, config: Partial<MCPServerConfig>): Promise<void>
  getMcpConfHelper(): any // Used to get MCP configuration helper
  getModelConfig(modelId: string, providerId?: string): ModelConfig
  setModelConfig(modelId: string, providerId: string, config: ModelConfig): void
  resetModelConfig(modelId: string, providerId: string): void
  getAllModelConfigs(): Record<string, IModelConfig>
  getProviderModelConfigs(providerId: string): Array<{ modelId: string; config: ModelConfig }>
  hasUserModelConfig(modelId: string, providerId: string): boolean
  exportModelConfigs(): Record<string, IModelConfig>
  importModelConfigs(configs: Record<string, IModelConfig>, overwrite: boolean): void
  setNotificationsEnabled(enabled: boolean): void
  getNotificationsEnabled(): boolean
  // Theme settings
  initTheme(): void
  setTheme(theme: 'dark' | 'light' | 'system'): Promise<boolean>
  getTheme(): Promise<string>
  getCurrentThemeIsDark(): Promise<boolean>
  getSystemTheme(): Promise<'dark' | 'light'>
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
  getDefaultShortcutKey(): ShortcutKeySetting
  getShortcutKey(): ShortcutKeySetting
  setShortcutKey(customShortcutKey: ShortcutKeySetting): void
  resetShortcutKeys(): void
  // Knowledge base settings
  getKnowledgeConfigs(): BuiltinKnowledgeConfig[]
  setKnowledgeConfigs(configs: BuiltinKnowledgeConfig[]): void
  diffKnowledgeConfigs(configs: BuiltinKnowledgeConfig[]): {
    added: BuiltinKnowledgeConfig[]
    deleted: BuiltinKnowledgeConfig[]
    updated: BuiltinKnowledgeConfig[]
  }
  // NPM Registry related methods
  getNpmRegistryCache?(): any
  setNpmRegistryCache?(cache: any): void
  isNpmRegistryCacheValid?(): boolean
  getEffectiveNpmRegistry?(): string | null
  getCustomNpmRegistry?(): string | undefined
  setCustomNpmRegistry?(registry: string | undefined): void
  getAutoDetectNpmRegistry?(): boolean
  setAutoDetectNpmRegistry?(enabled: boolean): void
  clearNpmRegistryCache?(): void

  // Atomic operation interfaces
  updateProviderAtomic(id: string, updates: Partial<LLM_PROVIDER>): boolean
  addProviderAtomic(provider: LLM_PROVIDER): void
  removeProviderAtomic(providerId: string): void
  reorderProvidersAtomic(providers: LLM_PROVIDER[]): void
  updateProvidersBatch(batchUpdate: ProviderBatchUpdate): void
}
export type RENDERER_MODEL_META = {
  id: string
  name: string
  group: string
  providerId: string
  enabled: boolean
  isCustom: boolean
  contextLength: number
  maxTokens: number
  vision?: boolean
  functionCall?: boolean
  reasoning?: boolean
  enableSearch?: boolean
  type?: ModelType
}
export type MODEL_META = {
  id: string
  name: string
  group: string
  providerId: string
  isCustom: boolean
  contextLength: number
  maxTokens: number
  description?: string
  vision?: boolean
  functionCall?: boolean
  reasoning?: boolean
  enableSearch?: boolean
  type?: ModelType
}
export type LLM_PROVIDER = {
  id: string
  name: string
  apiType: string
  apiKey: string
  baseUrl: string
  enable: boolean
  custom?: boolean
  authMode?: 'apikey' | 'oauth' // Authentication mode
  oauthToken?: string // OAuth token
  rateLimit?: {
    enabled: boolean
    qpsLimit: number
  }
  websites?: {
    official: string
    apiKey: string
    docs: string
    models: string
  }
}

export type LLM_PROVIDER_BASE = {
  websites?: {
    official: string
    apiKey: string
    docs: string
    models: string
    defaultBaseUrl: string
  }
} & LLM_PROVIDER

export type LLM_EMBEDDING_ATTRS = {
  dimensions: number
  normalized: boolean
}

// Simplified ModelScope MCP sync options
export interface ModelScopeMcpSyncOptions {
  page_number?: number
  page_size?: number
}

// ModelScope MCP sync result interface
export interface ModelScopeMcpSyncResult {
  imported: number
  skipped: number
  errors: string[]
}

export type AWS_BEDROCK_PROVIDER = LLM_PROVIDER & {
  credential?: AwsBedrockCredential
}

export interface AwsBedrockCredential {
  accessKeyId: string
  secretAccessKey: string
  region?: string
}

export interface ILlmProviderPresenter {
  setProviders(provider: LLM_PROVIDER[]): void
  getProviders(): LLM_PROVIDER[]
  getProviderById(id: string): LLM_PROVIDER
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
  startStreamCompletion(
    providerId: string,
    messages: ChatMessage[],
    modelId: string,
    eventId: string,
    temperature?: number,
    maxTokens?: number,
    enabledMcpTools?: string[],
    thinkingBudget?: number,
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high',
    verbosity?: 'low' | 'medium' | 'high',
    enableSearch?: boolean,
    forcedSearch?: boolean,
    searchStrategy?: 'turbo' | 'max'
  ): AsyncGenerator<LLMAgentEvent, void, unknown>
  generateCompletion(
    providerId: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string>
  stopStream(eventId: string): Promise<void>
  check(providerId: string, modelId?: string): Promise<{ isOk: boolean; errorMsg: string | null }>
  getKeyStatus(providerId: string): Promise<KeyStatus | null>
  refreshModels(providerId: string): Promise<void>
  summaryTitles(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    providerId: string,
    modelId: string
  ): Promise<string>
  listOllamaModels(): Promise<OllamaModel[]>
  showOllamaModelInfo(modelName: string): Promise<ShowResponse>
  listOllamaRunningModels(): Promise<OllamaModel[]>
  pullOllamaModels(modelName: string): Promise<boolean>
  deleteOllamaModel(modelName: string): Promise<boolean>
  getEmbeddings(providerId: string, modelId: string, texts: string[]): Promise<number[][]>
  getDimensions(
    providerId: string,
    modelId: string
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
  syncModelScopeMcpServers(
    providerId: string,
    syncOptions?: ModelScopeMcpSyncOptions
  ): Promise<ModelScopeMcpSyncResult>

  generateCompletionStandalone(
    providerId: string,
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string>
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
  enableSearch?: boolean
  forcedSearch?: boolean
  searchStrategy?: 'turbo' | 'max'
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
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
}

export interface IThreadPresenter {
  searchAssistantModel: MODEL_META | null
  searchAssistantProviderId: string | null
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
    settings?: Partial<CONVERSATION_SETTINGS>
  ): Promise<string>

  // Conversation list and activation status
  getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }>
  loadMoreThreads(): Promise<{ hasMore: boolean; total: number }>
  setActiveConversation(conversationId: string, tabId: number): Promise<void>
  getActiveConversation(tabId: number): Promise<CONVERSATION | null>
  getActiveConversationId(tabId: number): Promise<string | null>
  clearActiveThread(tabId: number): Promise<void>

  getSearchResults(messageId: string): Promise<SearchResult[]>
  clearAllMessages(conversationId: string): Promise<void>

  // Message operations
  getMessages(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: MESSAGE[] }>
  sendMessage(conversationId: string, content: string, role: MESSAGE_ROLE): Promise<MESSAGE | null>
  startStreamCompletion(conversationId: string, queryMsgId?: string): Promise<void>
  editMessage(messageId: string, content: string): Promise<MESSAGE>
  deleteMessage(messageId: string): Promise<void>
  retryMessage(messageId: string, modelId?: string): Promise<MESSAGE>
  getMessage(messageId: string): Promise<MESSAGE>
  getMessageVariants(messageId: string): Promise<MESSAGE[]>
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>
  getMessageExtraInfo(messageId: string, type: string): Promise<Record<string, unknown>[]>

  // Popup operations
  translateText(text: string, tabId: number): Promise<string>
  askAI(text: string, tabId: number): Promise<string>

  // Context control
  getContextMessages(conversationId: string): Promise<MESSAGE[]>
  clearContext(conversationId: string): Promise<void>
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
  summaryTitles(tabId?: number): Promise<string>
  stopMessageGeneration(messageId: string): Promise<void>
  getSearchEngines(): Promise<SearchEngineTemplate[]>
  getActiveSearchEngine(): Promise<SearchEngineTemplate>
  setActiveSearchEngine(engineId: string): Promise<void>
  setSearchEngine(engineId: string): Promise<boolean>
  // Search engine testing
  testSearchEngine(query?: string): Promise<boolean>
  // Search assistant model settings
  setSearchAssistantModel(model: MODEL_META, providerId: string): void
  getMainMessageByParentId(conversationId: string, parentId: string): Promise<Message | null>
  destroy(): void
  continueStreamCompletion(conversationId: string, queryMsgId: string): Promise<AssistantMessage>
  toggleConversationPinned(conversationId: string, isPinned: boolean): Promise<void>
  findTabForConversation(conversationId: string): Promise<number | null>

  // Permission handling
  handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all',
    remember?: boolean
  ): Promise<void>
  exportConversation(
    conversationId: string,
    format: 'markdown' | 'html' | 'txt'
  ): Promise<{ filename: string; content: string }>
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
export interface IUpgradePresenter {
  checkUpdate(): Promise<void>
  getUpdateStatus(): {
    status: UpdateStatus | null
    progress: UpdateProgress | null
    error: string | null
    updateInfo: {
      version: string
      releaseDate: string
      releaseNotes: any
      githubUrl: string | undefined
      downloadUrl: string | undefined
    } | null
  }
  goDownloadUpgrade(type: 'github' | 'netdisk'): Promise<void>
  startDownloadUpdate(): boolean
  restartToUpdate(): boolean
  restartApp(): void
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

export interface SearchResult {
  title: string
  url: string
  rank: number
  content?: string
  icon?: string
  description?: string
}

export interface ISearchPresenter {
  init(): void
  search(query: string, engine: 'google' | 'baidu'): Promise<SearchResult[]>
}

export type FileOperation = {
  path: string
  content?: string
}

export interface IFilePresenter {
  readFile(relativePath: string): Promise<string>
  writeFile(operation: FileOperation): Promise<void>
  deleteFile(relativePath: string): Promise<void>
  createFileAdapter(filePath: string, typeInfo?: string): Promise<any> // Return type might need refinement
  prepareFile(absPath: string, typeInfo?: string): Promise<MessageFile>
  prepareFileCompletely(
    absPath: string,
    typeInfo?: string,
    contentType?: null | 'origin' | 'llm-friendly'
  ): Promise<MessageFile>
  prepareDirectory(absPath: string): Promise<MessageFile>
  writeTemp(file: { name: string; content: string | Buffer | ArrayBuffer }): Promise<string>
  isDirectory(absPath: string): Promise<boolean>
  getMimeType(filePath: string): Promise<string>
  writeImageBase64(file: { name: string; content: string }): Promise<string>
  validateFileForKnowledgeBase(filePath: string): Promise<FileValidationResult>
  getSupportedExtensions(): string[]
}

export interface FileMetaData {
  fileName: string
  fileSize: number
  // fileHash: string
  fileDescription?: string
  fileCreated: Date
  fileModified: Date
}
// Define model interface based on Ollama SDK
export interface OllamaModel {
  name: string
  model: string
  modified_at: Date | string // Modified to allow Date or string
  size: number
  digest: string
  details: {
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
  // Merge some information from show interface
  model_info: {
    context_length: number
    embedding_length: number
    vision?: {
      embedding_length: number
    }
  }
  capabilities: string[]
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
  env: Record<string, unknow>
  descriptions: string
  icons: string
  autoApprove: string[]
  disable?: boolean
  baseUrl?: string
  customHeaders?: Record<string, string>
  customNpmRegistry?: string
  type: 'sse' | 'stdio' | 'inmemory' | 'http'
  source?: string // Source identifier: "mcprouter" | "modelscope" | undefined(for manual)
  sourceId?: string // Source ID: mcprouter uuid or modelscope mcpServer.id
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
  defaultServers: string[]
  mcpEnabled: boolean
  ready: boolean
}

export interface MCPToolDefinition {
  type: string
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

  /** Whether permission is required */
  requiresPermission?: boolean

  /** Permission request information */
  permissionRequest?: {
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all'
    description: string
  }
}

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

export interface IMCPPresenter {
  isReady(): boolean
  getMcpServers(): Promise<Record<string, MCPServerConfig>>
  getMcpClients(): Promise<McpClient[]>
  getMcpDefaultServers(): Promise<string[]>
  addMcpDefaultServer(serverName: string): Promise<void>
  removeMcpDefaultServer(serverName: string): Promise<void>
  toggleMcpDefaultServer(serverName: string): Promise<void>
  addMcpServer(serverName: string, config: MCPServerConfig): Promise<boolean>
  removeMcpServer(serverName: string): Promise<void>
  updateMcpServer(serverName: string, config: Partial<MCPServerConfig>): Promise<void>
  isServerRunning(serverName: string): Promise<boolean>
  startServer(serverName: string): Promise<void>
  stopServer(serverName: string): Promise<void>
  getAllToolDefinitions(enabledMcpTools?: string[]): Promise<MCPToolDefinition[]>
  getAllPrompts(): Promise<Array<PromptListEntry & { client: { name: string; icon: string } }>>
  getAllResources(): Promise<Array<ResourceListEntry & { client: { name: string; icon: string } }>>
  getPrompt(prompt: PromptListEntry, args?: Record<string, unknown>): Promise<unknown>
  readResource(resource: ResourceListEntry): Promise<Resource>
  callTool(request: MCPToolCall): Promise<{ content: string; rawData: MCPToolResponse }>
  setMcpEnabled(enabled: boolean): Promise<void>
  getMcpEnabled(): Promise<boolean>
  resetToDefaultServers(): Promise<void>

  // Permission management
  grantPermission(
    serverName: string,
    permissionType: 'read' | 'write' | 'all',
    remember?: boolean
  ): Promise<void>
  // NPM Registry management methods
  getNpmRegistryStatus?(): Promise<{
    currentRegistry: string | null
    isFromCache: boolean
    lastChecked?: number
    autoDetectEnabled: boolean
    customRegistry?: string
  }>
  refreshNpmRegistry?(): Promise<string>
  setCustomNpmRegistry?(registry: string | undefined): Promise<void>
  setAutoDetectNpmRegistry?(enabled: boolean): Promise<void>
  clearNpmRegistryCache?(): Promise<void>

  // McpRouter marketplace
  listMcpRouterServers?(
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
  installMcpRouterServer?(serverKey: string): Promise<boolean>
  getMcpRouterApiKey?(): Promise<string | ''>
  setMcpRouterApiKey?(key: string): Promise<void>
  isServerInstalled?(source: string, sourceId: string): Promise<boolean>
  updateMcpRouterServersAuth?(apiKey: string): Promise<void>

  mcpToolsToAnthropicTools(
    mcpTools: MCPToolDefinition[],
    serverName: string
  ): Promise<AnthropicTool[]>
  mcpToolsToGeminiTools(
    mcpTools: MCPToolDefinition[] | undefined,
    serverName: string
  ): Promise<ToolListUnion>
  mcpToolsToOpenAITools(mcpTools: MCPToolDefinition[], serverName: string): Promise<OpenAITool[]>
  mcpToolsToOpenAIResponsesTools(
    mcpTools: MCPToolDefinition[],
    serverName: string
  ): Promise<OpenAI.Responses.Tool[]>
}

export interface IDeeplinkPresenter {
  /**
   * Initialize DeepLink protocol
   */
  init(): void

  /**
   * Handle DeepLink protocol
   * @param url DeepLink URL
   */
  handleDeepLink(url: string): Promise<void>

  /**
   * Handle start command
   * @param params URL parameters
   */
  handleStart(params: URLSearchParams): Promise<void>

  /**
   * Handle mcp/install command
   * @param params URL parameters
   */
  handleMcpInstall(params: URLSearchParams): Promise<void>
}

export interface ISyncPresenter {
  // Backup related operations
  startBackup(): Promise<void>
  cancelBackup(): Promise<void>
  getBackupStatus(): Promise<{ isBackingUp: boolean; lastBackupTime: number }>

  // Import related operations
  importFromSync(importMode?: ImportMode): Promise<{ success: boolean; message: string }>
  checkSyncFolder(): Promise<{ exists: boolean; path: string }>
  openSyncFolder(): Promise<void>

  // Initialization and destruction
  init(): void
  destroy(): void
}

// Standardized events returned from LLM Provider's coreStream
export type LLMCoreStreamEvent = import('../../core/llm-events').LLMCoreStreamEvent

// Define ChatMessage interface for unified message format
export type ChatMessage = import('../../core/llm-events').ChatMessage

export type ChatMessageContent = import('../../core/llm-events').ChatMessageContent

export type LLMAgentEventData = import('../../core/agent-events').LLMAgentEventData
export type LLMAgentEvent = import('../../core/agent-events').LLMAgentEvent

export { ShortcutKey, ShortcutKeySetting } from '@/presenter/configPresenter/shortcutKeySettings'

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
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
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

// built-in knowledgebase
export type KnowledgeFileMetadata = {
  size: number
  totalChunks: number
  errorReason?: string
}

export type KnowledgeTaskStatus = 'processing' | 'completed' | 'error' | 'paused'

export type KnowledgeFileMessage = {
  id: string
  name: string
  path: string
  mimeType: string
  status: KnowledgeTaskStatus
  uploadedAt: number
  metadata: KnowledgeFileMetadata
}

export type KnowledgeChunkMessage = {
  id: string
  fileId: string
  chunkIndex: number
  content: string
  status: KnowledgeTaskStatus
  error?: string
}

// task management
export interface KnowledgeChunkTask {
  id: string // chunkId
  payload: {
    knowledgeBaseId: string
    fileId: string
    [key: string]: any
  }
  run: (context: { signal: AbortSignal }) => Promise<void> // Task executor, supports abort signal
  onSuccess?: () => void
  onError?: (error: Error) => void
  onTerminate?: () => void // task termination callback
}

// task status summary
export interface TaskStatusSummary {
  pending: number
  processing: number
  byKnowledgeBase: Map<string, { pending: number; processing: number }>
}

// task general status
export interface TaskQueueStatus {
  totalTasks: number
  runningTasks: number
  queuedTasks: number
}

export interface IKnowledgeTaskPresenter {
  /**
   * Add a task to the queue
   * @param task Task object
   */
  addTask(task: KnowledgeChunkTask): void

  /**
   * Remove/terminate tasks based on a filter
   * @param filter Filter function, operates on the entire Task object
   */
  removeTasks(filter: (task: KnowledgeChunkTask) => boolean): void

  /**
   * Get the current status of the task queue
   * @returns Queue status information
   */
  getStatus(): TaskQueueStatus

  /**
   * Destroy the instance, clean up all tasks and resources
   */
  destroy(): void

  // New convenience methods (implemented internally via removeTasks + filter)
  /**
   * Cancel tasks by knowledge base ID
   * @param knowledgeBaseId Knowledge base ID
   */
  cancelTasksByKnowledgeBase(knowledgeBaseId: string): void

  /**
   * Cancel tasks by file ID
   * @param fileId File ID
   */
  cancelTasksByFile(fileId: string): void

  /**
   * Get detailed task status statistics
   * @returns Task status summary information
   */
  getTaskStatus(): TaskStatusSummary

  /**
   * Check if there are any active tasks
   * @returns Whether there are active tasks
   */
  hasActiveTasks(): boolean

  /**
   * Check if the specified knowledge base has active tasks
   * @param knowledgeBaseId Knowledge base ID
   * @returns Whether there are active tasks
   */
  hasActiveTasksForKnowledgeBase(knowledgeBaseId: string): boolean

  /**
   * Check if the specified file has active tasks
   * @param fileId File ID
   * @returns Whether there are active tasks
   */
  hasActiveTasksForFile(fileId: string): boolean
}
export type KnowledgeFileResult = {
  data?: KnowledgeFileMessage
  error?: string
}

export interface FileValidationResult {
  isSupported: boolean
  mimeType?: string
  adapterType?: string
  error?: string
  suggestedExtensions?: string[]
}

/**
 * Knowledge base interface, provides functions for creating, deleting, file management, and similarity search.
 */
export interface IKnowledgePresenter {
  /**
   * Check if the knowledge presenter is supported in current environment
   */
  isSupported(): Promise<boolean>

  /**
   * Add a file to the knowledge base
   * @param id Knowledge base ID
   * @param path File path
   * @returns File addition result
   */
  addFile(id: string, path: string): Promise<KnowledgeFileResult>

  /**
   * Delete a file from the knowledge base
   * @param id Knowledge base ID
   * @param fileId File ID
   */
  deleteFile(id: string, fileId: string): Promise<void>

  /**
   * Re-add (rebuild vector) a file in the knowledge base
   * @param id Knowledge base ID
   * @param fileId File ID
   * @returns File addition result
   */
  reAddFile(id: string, fileId: string): Promise<KnowledgeFileResult>

  /**
   * List all files in the knowledge base
   * @param id Knowledge base ID
   * @returns Array of file metadata
   */
  listFiles(id: string): Promise<KnowledgeFileMessage[]>

  /**
   * Similarity search
   * @param id Knowledge base ID
   * @param key Query text
   * @returns Array of similar fragment results
   */
  similarityQuery(id: string, key: string): Promise<QueryResult[]>

  /**
   * Get the status of the task queue
   * @returns Task queue status information
   */
  getTaskQueueStatus(): Promise<TaskQueueStatus>
  /**
   * Pause all running tasks
   */
  pauseAllRunningTasks(id: string): Promise<void>
  /**
   * Resume all paused tasks
   */
  resumeAllPausedTasks(id: string): Promise<void>

  /**
   * Ask user before destroy
   * @return return true to confirm destroy, false to cancel
   */
  beforeDestroy(): Promise<boolean>

  /**
   * Destroy the instance and release resources
   */
  destroy(): Promise<void>
  /**
   * Get the list of supported programming languages
   */
  getSupportedLanguages(): Promise<string[]>
  /**
   * Get the list of separators for a specific programming language
   * @param language The programming language to get separators for
   */
  getSeparatorsForLanguage(language: string): Promise<string[]>

  /**
   * Validates if a file is supported for knowledge base processing
   * @param filePath Path to the file to validate
   * @returns FileValidationResult with validation details
   */
  validateFile(filePath: string): Promise<FileValidationResult>

  /**
   * Gets all supported file extensions for knowledge base processing
   * @returns Array of supported file extensions (without dots)
   */
  getSupportedFileExtensions(): Promise<string[]>
}

type ModelProvider = {
  modelId: string
  providerId: string
}

export type BuiltinKnowledgeConfig = {
  id: string
  description: string
  embedding: ModelProvider
  rerank?: ModelProvider
  dimensions: number
  normalized: boolean
  chunkSize?: number
  chunkOverlap?: number
  fragmentsNumber: number
  separators?: string[]
  enabled: boolean
}
export type MetricType = 'l2' | 'cosine' | 'ip'

export interface IndexOptions {
  /** Distance metric: 'l2' | 'cosine' | 'ip' */
  metric?: MetricType
  /** HNSW parameter M */
  M?: number
  /** HNSW ef parameter during construction */
  efConstruction?: number
}
export interface VectorInsertOptions {
  /** Numeric array, length equals dimension */
  vector: number[]
  /** File ID */
  fileId: string
  /** Chunk ID */
  chunkId: string
}
export interface QueryOptions {
  /** Number of nearest neighbors to query */
  topK: number
  /** ef parameter during search */
  efSearch?: number
  /** Minimum distance threshold. Due to different metrics, distance calculation results vary greatly. This option does not take effect in database queries and should be considered at the application layer. */
  threshold?: number
  /** Metric for the query vector's dimension */
  metric: MetricType
}
export interface QueryResult {
  id: string
  metadata: {
    from: string
    filePath: string
    content: string
  }
  distance: number
}

/**
 * Vector database operation interface, supports automatic table creation, indexing, insertion, batch insertion, vector search, deletion, and closing.
 */
export interface IVectorDatabasePresenter {
  /**
   * Initialize the vector database for the first time
   * @param dimensions Vector dimensions
   * @param opts
   */
  initialize(dimensions: number, opts?: IndexOptions): Promise<void>
  /**
   * Open the database
   */
  open(): Promise<void>
  /**
   * Close the database
   */
  close(): Promise<void>
  /**
   * Destroy the database instance and release all resources.
   */
  destroy(): Promise<void>
  /**
   * Insert a single vector record. If id is not provided, it will be generated automatically.
   * @param opts Insert parameters, including vector data and optional metadata
   */
  insertVector(opts: VectorInsertOptions): Promise<void>
  /**
   * Batch insert multiple vector records. If id is not provided for an item, it will be generated automatically.
   * @param records Array of insert parameters
   */
  insertVectors(records: Array<VectorInsertOptions>): Promise<void>
  /**
   * Query the nearest neighbors of a vector (TopK search).
   * @param vector Query vector
   * @param options Query parameters
   *   - topK: Number of nearest neighbors to return
   *   - efSearch: HNSW ef parameter during search (optional)
   *   - threshold: Minimum distance threshold (optional)
   * @returns Promise<QueryResult[]> Array of search results, including id, metadata, and distance
   */
  similarityQuery(vector: number[], options: QueryOptions): Promise<QueryResult[]>
  /**
   * Delete vector records by file_id
   * @param id File ID
   */
  deleteVectorsByFile(id: string): Promise<void>
  /**
   * Insert a file
   * @param file File metadata object
   */
  insertFile(file: KnowledgeFileMessage): Promise<void>
  /**
   * Update a file
   * @param file File metadata object
   */
  updateFile(file: KnowledgeFileMessage): Promise<void>
  /**
   * Query a file
   * @param id File ID
   * @returns File data object or null
   */
  queryFile(id: string): Promise<KnowledgeFileMessage | null>
  /**
   * Query files by condition
   * @param where Query condition
   * @returns Array of file data
   */
  queryFiles(where: Partial<KnowledgeFileMessage>): Promise<KnowledgeFileMessage[]>
  /**
   * List all files in the knowledge base
   * @returns Array of file data
   */
  listFiles(): Promise<KnowledgeFileMessage[]>
  /**
   * Delete a file
   * @param id File ID
   */
  deleteFile(id: string): Promise<void>
  /**
   * Batch insert chunks
   * @param chunks Array of chunk data
   */
  insertChunks(chunks: KnowledgeChunkMessage[]): Promise<void>
  /**
   * Update chunk status. Completed chunks will be automatically deleted.
   * @param chunkId Chunk ID
   * @param status New status
   * @param error Error message
   */
  updateChunkStatus(chunkId: string, status: KnowledgeTaskStatus, error?: string): Promise<void>
  /**
   * Query chunks by condition
   * @param where Query condition
   * @returns Array of chunk data
   */
  queryChunks(where: Partial<KnowledgeChunkMessage>): Promise<KnowledgeChunkMessage[]>
  /**
   * Delete all chunks associated with file id
   * @param fileId File ID
   */
  deleteChunksByFile(fileId: string): Promise<void>
  /**
   * Pause all running tasks
   */
  pauseAllRunningTasks(): Promise<void>
  /**
   * Resume all paused tasks
   */
  resumeAllPausedTasks(): Promise<void>
}

/**
 * Context object passed to lifecycle hooks during execution
 */
export interface LifecycleContext {
  phase: LifecyclePhase
  manager: ILifecycleManager
  [key: string]: any
}

/**
 * Lifecycle hook interface for components to register phase-specific logic
 */
export interface LifecycleHook {
  name: string // Descriptive name for logging and debugging
  phase: LifecyclePhase // register phase
  priority: number // Lower numbers execute first (default: 100)
  critical: boolean // If true, failure halts the current flow; if false, failure can be skipped
  execute: (context: LifecycleContext) => Promise<void | boolean>
}

/**
 * Internal lifecycle state tracking
 */
export interface LifecycleState {
  currentPhase: LifecyclePhase
  completedPhases: Set<LifecyclePhase>
  startTime: number
  phaseStartTimes: Map<LifecyclePhase, number>
  hooks: Map<LifecyclePhase, Array<{ id: string; hook: LifecycleHook }>>
  isShuttingDown: boolean
}

/**
 * LifecycleManager interface defining the core lifecycle management API
 */
export interface ILifecycleManager {
  // Phase management
  start(): Promise<void>

  // Hook registration - for components that need to execute logic during specific phases
  registerHook(hook: LifecycleHook): string // Returns generated hook ID

  // Shutdown control
  requestShutdown(): Promise<boolean>

  // Context management
  getLifecycleContext(): LifecycleContext
}

export interface ISplashWindowManager {
  create(): Promise<void>
  updateProgress(phase: LifecyclePhase, progress: number): void
  close(): Promise<void>
  isVisible(): boolean
}

export interface LifecycleEventStats {
  totalPhases: number
  completedPhases: number
  totalHooks: number
  successfulHooks: number
  failedHooks: number
  totalDuration: number
  phaseStats: Map<
    string,
    {
      duration: number
      hookCount: number
      successfulHooks: number
      failedHooks: number
      startTime: number
      endTime: number
    }
  >
}

/**
 * Interface for tracking hook execution results within priority groups
 */
export interface HookExecutionResult {
  hookId: string
  hook: LifecycleHook
  success: boolean
  result?: void | boolean
  error?: Error
}
