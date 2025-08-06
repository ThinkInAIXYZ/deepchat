/* eslint-disable @typescript-eslint/no-explicit-any */
import { BrowserWindow } from 'electron'
import { MessageFile } from './chat'
import { ShowResponse } from 'ollama'
import { ShortcutKeySetting } from '@/presenter/configPresenter/shortcutKeySettings'
import { ModelType } from '@shared/model'

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
  files?: FileItem[] // 关联的文件
  messages?: Array<{ role: string; content: { text: string } }> // 根据 getPrompt 示例添加
  enabled?: boolean // 是否启用
  source?: 'local' | 'imported' | 'builtin' // 来源类型
  createdAt?: number // 创建时间
  updatedAt?: number // 更新时间
}
export interface PromptListEntry {
  name: string
  description?: string
  arguments?: {
    name: string
    description?: string
    required: boolean
  }[]
  files?: FileItem[] // 关联的文件
  client: {
    name: string
    icon: string
  }
}
// 定义工具调用结果的接口
export interface ToolCallResult {
  isError?: boolean
  content: Array<{
    type: string
    text: string
  }>
}

// 定义工具列表的接口
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
  temperature: number
  vision: boolean
  functionCall: boolean
  reasoning: boolean
  type: ModelType
  // Whether this config is user-defined (true) or default config (false)
  isUserDefined?: boolean
  thinkingBudget?: number
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
}

export interface ITabPresenter {
  createTab(windowId: number, url: string, options?: TabCreateOptions): Promise<number | null>
  closeTab(tabId: number): Promise<boolean>
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
  // 新增渲染进程Tab事件处理方法
  onRendererTabReady(tabId: number): Promise<void>
  onRendererTabActivated(threadId: string): Promise<void>
  isLastTabInWindow(tabId: number): Promise<boolean>
  resetTabToBlank(tabId: number): Promise<void>
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

  // 新增的消息管理方法
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
  // 音效设置
  getSoundEnabled(): boolean
  setSoundEnabled(enabled: boolean): void
  // COT拷贝设置
  getCopyWithCotEnabled(): boolean
  setCopyWithCotEnabled(enabled: boolean): void
  // 悬浮按钮设置
  getFloatingButtonEnabled(): boolean
  setFloatingButtonEnabled(enabled: boolean): void
  // 日志设置
  getLoggingEnabled(): boolean
  setLoggingEnabled(enabled: boolean): void
  openLoggingFolder(): void
  // 自定义模型管理
  getCustomModels(providerId: string): MODEL_META[]
  setCustomModels(providerId: string, models: MODEL_META[]): void
  addCustomModel(providerId: string, model: MODEL_META): void
  removeCustomModel(providerId: string, modelId: string): void
  updateCustomModel(providerId: string, modelId: string, updates: Partial<MODEL_META>): void
  // 关闭行为设置
  getCloseToQuit(): boolean
  setCloseToQuit(value: boolean): void
  getModelStatus(providerId: string, modelId: string): boolean
  setModelStatus(providerId: string, modelId: string, enabled: boolean): void
  // 批量获取模型状态
  getBatchModelStatus(providerId: string, modelIds: string[]): Record<string, boolean>
  // 语言设置
  getLanguage(): string
  setLanguage(language: string): void
  getDefaultProviders(): LLM_PROVIDER[]
  // 代理设置
  getProxyMode(): string
  setProxyMode(mode: string): void
  getCustomProxyUrl(): string
  setCustomProxyUrl(url: string): void
  // 自定义搜索引擎
  getCustomSearchEngines(): Promise<SearchEngineTemplate[]>
  setCustomSearchEngines(engines: SearchEngineTemplate[]): Promise<void>
  // 搜索预览设置
  getSearchPreviewEnabled(): Promise<boolean>
  setSearchPreviewEnabled(enabled: boolean): void
  // 投屏保护设置
  getContentProtectionEnabled(): boolean
  setContentProtectionEnabled(enabled: boolean): void
  // 同步设置
  getSyncEnabled(): boolean
  setSyncEnabled(enabled: boolean): void
  getSyncFolderPath(): string
  setSyncFolderPath(folderPath: string): void
  getLastSyncTime(): number
  setLastSyncTime(time: number): void
  // MCP配置相关方法
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
  getMcpConfHelper(): any // 用于获取MCP配置助手
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
  // 主题设置
  initTheme(): void
  toggleTheme(theme: 'dark' | 'light' | 'system'): Promise<boolean>
  getTheme(): Promise<string>
  getSystemTheme(): Promise<'dark' | 'light'>
  getCustomPrompts(): Promise<Prompt[]>
  setCustomPrompts(prompts: Prompt[]): Promise<void>
  addCustomPrompt(prompt: Prompt): Promise<void>
  updateCustomPrompt(promptId: string, updates: Partial<Prompt>): Promise<void>
  deleteCustomPrompt(promptId: string): Promise<void>
  // 默认系统提示词设置
  getDefaultSystemPrompt(): Promise<string>
  setDefaultSystemPrompt(prompt: string): Promise<void>
  // 快捷键设置
  getDefaultShortcutKey(): ShortcutKeySetting
  getShortcutKey(): ShortcutKeySetting
  setShortcutKey(customShortcutKey: ShortcutKeySetting): void
  resetShortcutKeys(): void
  // 知识库设置
  getKnowledgeConfigs(): BuiltinKnowledgeConfig[]
  setKnowledgeConfigs(configs: BuiltinKnowledgeConfig[]): void
  diffKnowledgeConfigs(configs: BuiltinKnowledgeConfig[]): {
    added: BuiltinKnowledgeConfig[]
    deleted: BuiltinKnowledgeConfig[]
    updated: BuiltinKnowledgeConfig[]
  }
  // NPM Registry 相关方法
  getNpmRegistryCache?(): any
  setNpmRegistryCache?(cache: any): void
  isNpmRegistryCacheValid?(): boolean
  getEffectiveNpmRegistry?(): string | null
  getCustomNpmRegistry?(): string | undefined
  setCustomNpmRegistry?(registry: string | undefined): void
  getAutoDetectNpmRegistry?(): boolean
  setAutoDetectNpmRegistry?(enabled: boolean): void
  clearNpmRegistryCache?(): void
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
  authMode?: 'apikey' | 'oauth' // 认证模式
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
    thinkingBudget?: number
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
  // 基本对话操作
  createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS>,
    tabId: number,
    options?: { forceNewAndActivate?: boolean } // 新增 options 参数, 支持强制新建会话，避免空会话的单例检测
  ): Promise<string>
  deleteConversation(conversationId: string): Promise<void>
  getConversation(conversationId: string): Promise<CONVERSATION>
  renameConversation(conversationId: string, title: string): Promise<CONVERSATION>
  updateConversationTitle(conversationId: string, title: string): Promise<void>
  updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void>

  // 会话分支操作
  forkConversation(
    targetConversationId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<CONVERSATION_SETTINGS>
  ): Promise<string>

  // 对话列表和激活状态
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

  // 消息操作
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

  // popup 操作
  translateText(text: string, tabId: number): Promise<string>
  askAI(text: string, tabId: number): Promise<string>

  // 上下文控制
  getContextMessages(conversationId: string): Promise<MESSAGE[]>
  clearContext(conversationId: string): Promise<void>
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
  summaryTitles(tabId?: number): Promise<string>
  stopMessageGeneration(messageId: string): Promise<void>
  getSearchEngines(): Promise<SearchEngineTemplate[]>
  getActiveSearchEngine(): Promise<SearchEngineTemplate>
  setActiveSearchEngine(engineId: string): Promise<void>
  setSearchEngine(engineId: string): Promise<boolean>
  // 搜索引擎测试
  testSearchEngine(query?: string): Promise<boolean>
  // 搜索助手模型设置
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
  // 基本消息操作
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

  // 消息查询
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

  // 消息状态管理
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>

  // 上下文管理
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

  // 目录选择和应用重启
  selectDirectory(): Promise<{ canceled: boolean; filePaths: string[] }>
  restartApp(): Promise<void>

  // 图片缓存
  cacheImage(imageData: string): Promise<string>
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
// 更新状态类型
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
}

export interface FileMetaData {
  fileName: string
  fileSize: number
  // fileHash: string
  fileDescription?: string
  fileCreated: Date
  fileModified: Date
}
// 根据 Ollama SDK 定义模型接口
export interface OllamaModel {
  name: string
  model: string
  modified_at: Date | string // 修改为可以是 Date 或 string
  size: number
  digest: string
  details: {
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
  // 合并show接口一些信息
  model_info: {
    context_length: number
    embedding_length: number
    vision?: {
      embedding_length: number
    }
  }
  capabilities: string[]
}

// 定义进度回调的接口
export interface ProgressResponse {
  status: string
  digest?: string
  total?: number
  completed?: number
}

// MCP相关类型定义
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
  server: {
    name: string
    icons: string
    description: string
  }
}

export interface MCPToolResponse {
  /** 工具调用的唯一标识符 */
  toolCallId: string

  /**
   * 工具调用的响应内容
   * 可以是简单字符串或结构化内容数组
   */
  content: string | MCPContentItem[]

  /** 可选的元数据 */
  _meta?: Record<string, any>

  /** 是否发生错误 */
  isError?: boolean

  /** 当使用兼容模式时，可能直接返回工具结果 */
  toolResult?: unknown

  /** 是否需要权限 */
  requiresPermission?: boolean

  /** 权限请求信息 */
  permissionRequest?: {
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all'
    description: string
  }
}

/** 内容项类型 */
export type MCPContentItem = MCPTextContent | MCPImageContent | MCPResourceContent

/** 文本内容 */
export interface MCPTextContent {
  type: 'text'
  text: string
}

/** 图像内容 */
export interface MCPImageContent {
  type: 'image'
  data: string // Base64编码的图像数据
  mimeType: string // 例如 "image/png", "image/jpeg" 等
}

/** 资源内容 */
export interface MCPResourceContent {
  type: 'resource'
  resource: {
    uri: string
    mimeType?: string
    /** 资源文本内容，与blob互斥 */
    text?: string
    /** 资源二进制内容，与text互斥 */
    blob?: string
  }
}

export interface IMCPPresenter {
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
  getAllToolDefinitions(): Promise<MCPToolDefinition[]>
  getAllPrompts(): Promise<Array<PromptListEntry & { client: { name: string; icon: string } }>>
  getAllResources(): Promise<Array<ResourceListEntry & { client: { name: string; icon: string } }>>
  getPrompt(prompt: PromptListEntry, args?: Record<string, unknown>): Promise<unknown>
  readResource(resource: ResourceListEntry): Promise<Resource>
  callTool(request: {
    id: string
    type: string
    function: {
      name: string
      arguments: string
    }
  }): Promise<{ content: string; rawData: MCPToolResponse }>
  setMcpEnabled(enabled: boolean): Promise<void>
  getMcpEnabled(): Promise<boolean>
  resetToDefaultServers(): Promise<void>

  // Permission management
  grantPermission(
    serverName: string,
    permissionType: 'read' | 'write' | 'all',
    remember?: boolean
  ): Promise<void>
  // NPM Registry 管理方法
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
}

export interface IDeeplinkPresenter {
  /**
   * 初始化 DeepLink 协议
   */
  init(): void

  /**
   * 处理 DeepLink 协议
   * @param url DeepLink URL
   */
  handleDeepLink(url: string): Promise<void>

  /**
   * 处理 start 命令
   * @param params URL 参数
   */
  handleStart(params: URLSearchParams): Promise<void>

  /**
   * 处理 mcp/install 命令
   * @param params URL 参数
   */
  handleMcpInstall(params: URLSearchParams): Promise<void>
}

export interface ISyncPresenter {
  // 备份相关操作
  startBackup(): Promise<void>
  cancelBackup(): Promise<void>
  getBackupStatus(): Promise<{ isBackingUp: boolean; lastBackupTime: number }>

  // 导入相关操作
  importFromSync(importMode?: ImportMode): Promise<{ success: boolean; message: string }>
  checkSyncFolder(): Promise<{ exists: boolean; path: string }>
  openSyncFolder(): Promise<void>

  // 初始化和销毁
  init(): void
  destroy(): void
}

// 从 LLM Provider 的 coreStream 返回的标准化事件
export interface LLMCoreStreamEvent {
  type:
    | 'text'
    | 'reasoning'
    | 'tool_call_start'
    | 'tool_call_chunk'
    | 'tool_call_end'
    | 'error'
    | 'usage'
    | 'stop'
    | 'image_data'
    | 'rate_limit'
  content?: string // 用于 type 'text'
  reasoning_content?: string // 用于 type 'reasoning'
  tool_call_id?: string // 用于 tool_call_* 类型
  tool_call_name?: string // 用于 tool_call_start
  tool_call_arguments_chunk?: string // 用于 tool_call_chunk (流式参数)
  tool_call_arguments_complete?: string // 用于 tool_call_end (可选，如果一次性可用)
  error_message?: string // 用于 type 'error'
  usage?: {
    // 用于 type 'usage'
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  rate_limit?: {
    providerId: string
    qpsLimit: number
    currentQps: number
    queueLength: number
    estimatedWaitTime?: number
  }
  stop_reason?: 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error' | 'complete' // 用于 type 'stop'
  image_data?: {
    // 用于 type 'image_data'
    data: string // Base64 编码的图像数据
    mimeType: string
  }
}

// 定义ChatMessage接口用于统一消息格式
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | ChatMessageContent[]
  tool_calls?: Array<{
    function: {
      arguments: string
      name: string
    }
    id: string
    type: 'function'
  }>
  tool_call_id?: string
}

export interface ChatMessageContent {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
    detail?: 'auto' | 'low' | 'high'
  }
}

export interface LLMAgentEventData {
  eventId: string
  content?: string
  reasoning_content?: string
  tool_call_id?: string
  tool_call_name?: string
  tool_call_params?: string
  tool_call_response?: string | MCPToolResponse['content'] // Allow complex tool response content
  maximum_tool_calls_reached?: boolean
  tool_call_server_name?: string
  tool_call_server_icons?: string
  tool_call_server_description?: string

  tool_call_response_raw?: any
  tool_call?: 'start' | 'running' | 'end' | 'error' | 'update' | 'permission-required'

  // Permission request related fields
  permission_request?: {
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all'
    description: string
  }

  totalUsage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    context_length: number
  }
  image_data?: { data: string; mimeType: string }
  rate_limit?: {
    providerId: string
    qpsLimit: number
    currentQps: number
    queueLength: number
    estimatedWaitTime?: number
  }
  error?: string // For error event
  userStop?: boolean // For end event
}
export type LLMAgentEvent =
  | { type: 'response'; data: LLMAgentEventData }
  | { type: 'error'; data: { eventId: string; error: string } }
  | { type: 'end'; data: { eventId: string; userStop: boolean } }

export { ShortcutKey, ShortcutKeySetting } from '@/presenter/configPresenter/shortcutKeySettings'

export interface DefaultModelSetting {
  id: string
  name: string
  temperature: number
  contextLength: number
  maxTokens: number
  match: string[]
  vision: boolean
  functionCall: boolean
  reasoning?: boolean
  type?: ModelType
  thinkingBudget?: number
}

export interface KeyStatus {
  remainNum?: number
  /** 剩余额度 */
  limit_remaining?: string
  /** 已使用额度 */
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
  run: (context: { signal: AbortSignal }) => Promise<void> // 任务执行体，支持终止信号
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
