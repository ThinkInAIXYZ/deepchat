import path from 'path'
import { DialogPresenter } from './dialogPresenter/index'
import { BrowserWindow, ipcMain, IpcMainInvokeEvent, app } from 'electron'
import { WindowPresenter } from './windowPresenter'
import { ShortcutPresenter } from './shortcutPresenter'
import {
  IConfigPresenter,
  IDeeplinkPresenter,
  IDevicePresenter,
  IDialogPresenter,
  IFilePresenter,
  IKnowledgePresenter,
  ILifecycleManager,
  ILlmProviderPresenter,
  IMCPPresenter,
  INotificationPresenter,
  IPresenter,
  IShortcutPresenter,
  ISQLitePresenter,
  ISyncPresenter,
  ITabPresenter,
  IConversationExporter,
  IUpgradePresenter,
  IWindowPresenter,
  IWorkspacePresenter,
  IToolPresenter,
  IYoBrowserPresenter,
  ISkillPresenter,
  ISkillSyncPresenter,
  INewAgentPresenter,
  IProjectPresenter,
  IRemoteControlPresenter
} from '@shared/presenter'
import { eventBus } from '@/eventbus'
import { LLMProviderPresenter } from './llmProviderPresenter'
import { SessionPresenter } from './sessionPresenter'
import { MessageManager } from './sessionPresenter/managers/messageManager'
import { DevicePresenter } from './devicePresenter'
import { UpgradePresenter } from './upgradePresenter'
import { FilePresenter } from './filePresenter/FilePresenter'
import { McpPresenter } from './mcpPresenter'
import { SyncPresenter } from './syncPresenter'
import { DeeplinkPresenter } from './deeplinkPresenter'
import { NotificationPresenter } from './notifactionPresenter'
import { TabPresenter } from './tabPresenter'
import { TrayPresenter } from './trayPresenter'
import { OAuthPresenter } from './oauthPresenter'
import { FloatingButtonPresenter } from './floatingButtonPresenter'
import { YoBrowserPresenter } from './browser/YoBrowserPresenter'
import { CONFIG_EVENTS, WINDOW_EVENTS } from '@/events'
import { KnowledgePresenter } from './knowledgePresenter'
import { WorkspacePresenter } from './workspacePresenter'
import { ToolPresenter } from './toolPresenter'
import {
  CommandPermissionService,
  FilePermissionService,
  SettingsPermissionService
} from './permission'
import type { AgentToolRuntimePort } from './toolPresenter/runtimePorts'

import { ConversationExporterService } from './exporter'
import { SkillPresenter } from './skillPresenter'
import type { SkillSessionStatePort } from './skillPresenter'
import { SkillSyncPresenter } from './skillSyncPresenter'
import { HooksNotificationsService } from './hooksNotifications'
import { NewSessionHooksBridge } from './hooksNotifications/newSessionBridge'
import { NewAgentPresenter } from './newAgentPresenter'
import { DeepChatAgentPresenter } from './deepchatAgentPresenter'
import { ProjectPresenter } from './projectPresenter'
import { RemoteControlPresenter } from './remoteControlPresenter'
import type { RemoteControlPresenterLike } from './remoteControlPresenter/interface'
import { AgentRepository } from './agentRepository'
import type { SQLitePresenter } from './sqlitePresenter'
import { normalizeDeepChatSubagentSlots } from '@shared/lib/deepchatSubagents'
import { subscribeDeepChatInternalSessionUpdates } from './deepchatAgentPresenter/internalSessionEvents'

// IPC调用上下文接口
interface IPCCallContext {
  windowId?: number
  webContentsId: number
  presenterName: string
  methodName: string
  timestamp: number
}

// 注意: 现在大部分事件已在各自的 presenter 中直接发送到渲染进程
// 剩余的自动转发事件已在 EventBus 的 DEFAULT_RENDERER_EVENTS 中定义

// 主 Presenter 类，负责协调其他 Presenter 并处理 IPC 通信
export class Presenter implements IPresenter {
  // 私有静态实例
  private static instance: Presenter
  static readonly DISPATCHABLE_PRESENTERS = new Set<keyof IPresenter>([
    'windowPresenter',
    'sqlitePresenter',
    'llmproviderPresenter',
    'configPresenter',
    'exporter',
    'devicePresenter',
    'upgradePresenter',
    'shortcutPresenter',
    'filePresenter',
    'mcpPresenter',
    'syncPresenter',
    'deeplinkPresenter',
    'notificationPresenter',
    'tabPresenter',
    'yoBrowserPresenter',
    'oauthPresenter',
    'dialogPresenter',
    'knowledgePresenter',
    'workspacePresenter',
    'toolPresenter',
    'skillPresenter',
    'skillSyncPresenter',
    'newAgentPresenter',
    'projectPresenter'
  ])

  static readonly REMOTE_CONTROL_METHODS = new Set<keyof IRemoteControlPresenter>([
    'getChannelSettings',
    'saveChannelSettings',
    'getChannelStatus',
    'getChannelBindings',
    'removeChannelBinding',
    'getChannelPairingSnapshot',
    'createChannelPairCode',
    'clearChannelPairCode',
    'clearChannelBindings',
    'getTelegramSettings',
    'saveTelegramSettings',
    'getTelegramStatus',
    'getTelegramBindings',
    'removeTelegramBinding',
    'getTelegramPairingSnapshot',
    'createTelegramPairCode',
    'clearTelegramPairCode',
    'clearTelegramBindings',
    'testTelegramHookNotification'
  ])

  windowPresenter: IWindowPresenter
  sqlitePresenter: ISQLitePresenter
  llmproviderPresenter: ILlmProviderPresenter
  configPresenter: IConfigPresenter

  exporter: IConversationExporter
  devicePresenter: IDevicePresenter
  upgradePresenter: IUpgradePresenter
  shortcutPresenter: IShortcutPresenter
  filePresenter: IFilePresenter
  mcpPresenter: IMCPPresenter
  syncPresenter: ISyncPresenter
  deeplinkPresenter: IDeeplinkPresenter
  notificationPresenter: INotificationPresenter
  tabPresenter: ITabPresenter
  trayPresenter: TrayPresenter
  oauthPresenter: OAuthPresenter
  floatingButtonPresenter: FloatingButtonPresenter
  knowledgePresenter: IKnowledgePresenter
  workspacePresenter: IWorkspacePresenter
  toolPresenter: IToolPresenter
  yoBrowserPresenter: IYoBrowserPresenter
  dialogPresenter: IDialogPresenter
  lifecycleManager: ILifecycleManager
  skillPresenter: ISkillPresenter
  skillSyncPresenter: ISkillSyncPresenter
  newAgentPresenter: INewAgentPresenter
  projectPresenter: IProjectPresenter
  hooksNotifications: HooksNotificationsService
  commandPermissionService: CommandPermissionService
  filePermissionService: FilePermissionService
  settingsPermissionService: SettingsPermissionService
  private sessionMessageManager: MessageManager
  private sessionPresenterInternal?: SessionPresenter
  #remoteControlPresenter: RemoteControlPresenterLike
  readonly #remoteControlBridge: IRemoteControlPresenter

  private constructor(lifecycleManager: ILifecycleManager) {
    // Store lifecycle manager reference for component access
    // If the initialization is successful, there should be no null here
    this.lifecycleManager = lifecycleManager
    const context = lifecycleManager.getLifecycleContext()
    this.configPresenter = context.config as IConfigPresenter
    this.sqlitePresenter = context.database as ISQLitePresenter
    const agentRepository = new AgentRepository(this.sqlitePresenter as unknown as SQLitePresenter)
    ;(
      this.configPresenter as IConfigPresenter & {
        setAgentRepository?: (repository: AgentRepository) => void
      }
    ).setAgentRepository?.(agentRepository)

    // 初始化各个 Presenter 实例及其依赖
    this.windowPresenter = new WindowPresenter(this.configPresenter)
    this.tabPresenter = new TabPresenter(this.windowPresenter)
    this.llmproviderPresenter = new LLMProviderPresenter(
      this.configPresenter,
      this.sqlitePresenter,
      {
        mcpToolsToAnthropicTools: (mcpTools, serverName) =>
          this.mcpPresenter.mcpToolsToAnthropicTools(mcpTools, serverName),
        mcpToolsToGeminiTools: (mcpTools, serverName) =>
          this.mcpPresenter.mcpToolsToGeminiTools(mcpTools, serverName),
        mcpToolsToOpenAITools: (mcpTools, serverName) =>
          this.mcpPresenter.mcpToolsToOpenAITools(mcpTools, serverName),
        mcpToolsToOpenAIResponsesTools: (mcpTools, serverName) =>
          this.mcpPresenter.mcpToolsToOpenAIResponsesTools(mcpTools, serverName),
        getNpmRegistry: () => this.mcpPresenter.getNpmRegistry?.() ?? null,
        getUvRegistry: () => this.mcpPresenter.getUvRegistry?.() ?? null
      }
    )
    const commandPermissionHandler = new CommandPermissionService()
    this.commandPermissionService = commandPermissionHandler
    this.filePermissionService = new FilePermissionService()
    this.settingsPermissionService = new SettingsPermissionService()
    const messageManager = new MessageManager(this.sqlitePresenter)
    this.sessionMessageManager = messageManager
    this.devicePresenter = new DevicePresenter()
    this.exporter = new ConversationExporterService({
      sqlitePresenter: this.sqlitePresenter,
      configPresenter: this.configPresenter
    })
    this.mcpPresenter = new McpPresenter(this.configPresenter)
    this.upgradePresenter = new UpgradePresenter(this.configPresenter)
    this.shortcutPresenter = new ShortcutPresenter(this.configPresenter)
    this.filePresenter = new FilePresenter(this.configPresenter)
    this.syncPresenter = new SyncPresenter(this.configPresenter, this.sqlitePresenter)
    this.deeplinkPresenter = new DeeplinkPresenter()
    this.notificationPresenter = new NotificationPresenter()
    this.oauthPresenter = new OAuthPresenter()
    this.trayPresenter = new TrayPresenter()
    this.floatingButtonPresenter = new FloatingButtonPresenter(this.configPresenter)
    this.dialogPresenter = new DialogPresenter()
    this.yoBrowserPresenter = new YoBrowserPresenter(this.windowPresenter)

    // Define dbDir for knowledge presenter
    const dbDir = path.join(app.getPath('userData'), 'app_db')
    this.knowledgePresenter = new KnowledgePresenter(
      this.configPresenter,
      dbDir,
      this.filePresenter
    )

    // Initialize generic Workspace presenter (for all Agent modes)
    this.workspacePresenter = new WorkspacePresenter(this.filePresenter)

    const agentToolRuntime: AgentToolRuntimePort = {
      resolveConversationWorkdir: async (conversationId) => {
        try {
          const session = await this.newAgentPresenter?.getSession(conversationId)
          const normalized = session?.projectDir?.trim()
          if (normalized) {
            return normalized
          }
        } catch (error) {
          console.warn('[Presenter] Failed to resolve new session workdir:', {
            conversationId,
            error
          })
        }

        return null
      },
      resolveConversationSessionInfo: async (conversationId) => {
        const session = await this.newAgentPresenter?.getSession(conversationId)
        if (!session) {
          return null
        }

        const agent = await this.configPresenter.getAgent(session.agentId)
        const agentType = await this.configPresenter.getAgentType(session.agentId)
        const permissionMode =
          typeof this.newAgentPresenter?.getPermissionMode === 'function'
            ? await this.newAgentPresenter.getPermissionMode(session.id)
            : 'full_access'
        const generationSettings =
          typeof this.newAgentPresenter?.getSessionGenerationSettings === 'function'
            ? await this.newAgentPresenter.getSessionGenerationSettings(session.id)
            : null
        const disabledAgentTools =
          typeof this.newAgentPresenter?.getSessionDisabledAgentTools === 'function'
            ? await this.newAgentPresenter.getSessionDisabledAgentTools(session.id)
            : []
        const activeSkills = await this.skillPresenter.getActiveSkills(session.id)
        const availableSubagentSlots =
          agentType === 'deepchat' && session.sessionKind === 'regular'
            ? normalizeDeepChatSubagentSlots(
                (await this.configPresenter.resolveDeepChatAgentConfig(session.agentId)).subagents
              )
            : []

        return {
          sessionId: session.id,
          agentId: session.agentId,
          agentName: agent?.name?.trim() || session.agentId,
          agentType,
          providerId: session.providerId,
          modelId: session.modelId,
          projectDir: session.projectDir ?? null,
          permissionMode,
          generationSettings,
          disabledAgentTools,
          activeSkills,
          sessionKind: session.sessionKind,
          parentSessionId: session.parentSessionId ?? null,
          subagentEnabled: session.subagentEnabled,
          subagentMeta: session.subagentMeta ?? null,
          availableSubagentSlots
        }
      },
      createSubagentSession: async (input) => {
        const newAgentPresenter = this.newAgentPresenter as INewAgentPresenter & {
          createSubagentSession?: (createInput: typeof input) => Promise<{
            id: string
          } | null>
        }
        const created = await newAgentPresenter.createSubagentSession?.(input)
        if (!created?.id) {
          return null
        }

        return await agentToolRuntime.resolveConversationSessionInfo(created.id)
      },
      sendConversationMessage: async (conversationId, content) => {
        await this.newAgentPresenter.sendMessage(conversationId, content)
      },
      cancelConversation: async (conversationId) => {
        await this.newAgentPresenter.cancelGeneration(conversationId)
      },
      subscribeDeepChatSessionUpdates: (listener) =>
        subscribeDeepChatInternalSessionUpdates(listener),
      getSkillPresenter: () => this.skillPresenter,
      getYoBrowserToolHandler: () => this.yoBrowserPresenter.toolHandler,
      getFilePresenter: () => ({
        getMimeType: (filePath) => this.filePresenter.getMimeType(filePath),
        prepareFileCompletely: (absPath, typeInfo, contentType) =>
          this.filePresenter.prepareFileCompletely(absPath, typeInfo, contentType)
      }),
      getLlmProviderPresenter: () => ({
        executeWithRateLimit: (providerId, options) =>
          this.llmproviderPresenter.executeWithRateLimit(providerId, options),
        generateCompletionStandalone: (providerId, messages, modelId, temperature, maxTokens) =>
          this.llmproviderPresenter.generateCompletionStandalone(
            providerId,
            messages,
            modelId,
            temperature,
            maxTokens
          )
      }),
      createSettingsWindow: () => this.windowPresenter.createSettingsWindow(),
      sendToWindow: (windowId, channel, ...args) =>
        this.windowPresenter.sendToWindow(windowId, channel, ...args),
      getApprovedFilePaths: (conversationId) =>
        this.filePermissionService.getApprovedPaths(conversationId),
      consumeSettingsApproval: (conversationId, toolName) =>
        this.settingsPermissionService.consumeApproval(conversationId, toolName)
    }

    // Initialize unified Tool presenter (for routing MCP and Agent tools)
    this.toolPresenter = new ToolPresenter({
      mcpPresenter: this.mcpPresenter,
      configPresenter: this.configPresenter,
      commandPermissionHandler,
      agentToolRuntime
    })

    const skillSessionStatePort: SkillSessionStatePort = {
      hasNewSession: async (conversationId) => {
        try {
          return Boolean(await this.newAgentPresenter?.getSession(conversationId))
        } catch {
          return false
        }
      },
      getPersistedNewSessionSkills: (conversationId) =>
        (
          this.sqlitePresenter as unknown as import('./sqlitePresenter').SQLitePresenter
        ).newSessionsTable?.getActiveSkills(conversationId) ?? [],
      setPersistedNewSessionSkills: (conversationId, skills) => {
        const sqlitePresenter = this
          .sqlitePresenter as unknown as import('./sqlitePresenter').SQLitePresenter
        sqlitePresenter.newSessionsTable?.updateActiveSkills(conversationId, skills)
        sqlitePresenter.newEnvironmentsTable?.syncForSession(conversationId)
      },
      repairImportedLegacySessionSkills: async (conversationId) => {
        const newAgentPresenter = this.newAgentPresenter as INewAgentPresenter & {
          repairImportedLegacySessionSkills?: (sessionId: string) => Promise<string[]>
        }
        return (await newAgentPresenter.repairImportedLegacySessionSkills?.(conversationId)) ?? []
      }
    }

    // Initialize Skill presenter
    this.skillPresenter = new SkillPresenter(this.configPresenter, skillSessionStatePort)

    // Initialize Skill Sync presenter
    this.skillSyncPresenter = new SkillSyncPresenter(this.skillPresenter, this.configPresenter)

    // Initialize new agent architecture presenters first (needed by hooksNotifications)
    this.hooksNotifications = new HooksNotificationsService(this.configPresenter, {
      getSession: async () => null,
      getMessage: async () => null
    })
    const newSessionHooksBridge = new NewSessionHooksBridge(this.hooksNotifications)

    // Initialize new agent architecture presenters
    const deepchatAgentPresenter = new DeepChatAgentPresenter(
      this.llmproviderPresenter as unknown as ILlmProviderPresenter,
      this.configPresenter,
      this.sqlitePresenter as unknown as import('./sqlitePresenter').SQLitePresenter,
      this.toolPresenter,
      newSessionHooksBridge
    )
    this.newAgentPresenter = new NewAgentPresenter(
      deepchatAgentPresenter,
      this.llmproviderPresenter as unknown as ILlmProviderPresenter,
      this.configPresenter,
      this.sqlitePresenter as unknown as import('./sqlitePresenter').SQLitePresenter,
      this.skillPresenter
    )
    this.projectPresenter = new ProjectPresenter(
      this.sqlitePresenter as unknown as import('./sqlitePresenter').SQLitePresenter,
      this.devicePresenter
    )
    this.#remoteControlPresenter = new RemoteControlPresenter({
      configPresenter: this.configPresenter,
      newAgentPresenter: this.newAgentPresenter,
      deepchatAgentPresenter,
      windowPresenter: this.windowPresenter,
      tabPresenter: this.tabPresenter,
      getHooksNotificationsConfig: () => this.configPresenter.getHooksNotificationsConfig(),
      setHooksNotificationsConfig: (config) =>
        this.configPresenter.setHooksNotificationsConfig(config),
      testTelegramHookNotification: () => this.configPresenter.testTelegramNotification()
    })
    this.#remoteControlBridge = this.#remoteControlPresenter

    // Update hooksNotifications with actual dependencies now that newAgentPresenter is ready
    this.hooksNotifications = new HooksNotificationsService(this.configPresenter, {
      getSession: this.newAgentPresenter.getSession.bind(this.newAgentPresenter),
      getMessage: this.newAgentPresenter.getMessage.bind(this.newAgentPresenter)
    })

    this.setupEventBus() // 设置事件总线监听
  }

  getActiveConversationIdSync(webContentsId: number): string | null {
    return this.sessionPresenterInternal?.getActiveConversationIdSync(webContentsId) ?? null
  }

  async broadcastConversationThreadListUpdate(): Promise<void> {
    await this.getSessionPresenter().broadcastThreadListUpdate()
  }

  async cleanupConversationRuntimeArtifacts(conversationId: string): Promise<void> {
    try {
      await this.llmproviderPresenter.clearAcpSession(conversationId)
    } catch (error) {
      console.warn('[Presenter] Failed to clear ACP session:', error)
    }
  }

  private getSessionPresenter(): SessionPresenter {
    if (!this.sessionPresenterInternal) {
      this.sessionPresenterInternal = new SessionPresenter({
        messageManager: this.sessionMessageManager,
        sqlitePresenter: this.sqlitePresenter,
        llmProviderPresenter: this.llmproviderPresenter,
        configPresenter: this.configPresenter,
        exporter: this.exporter,
        commandPermissionService: this.commandPermissionService
      })
    }

    this.sessionPresenterInternal.initializeLegacyRuntime()
    return this.sessionPresenterInternal
  }

  public static getInstance(lifecycleManager: ILifecycleManager): Presenter {
    if (!Presenter.instance) {
      // 只能在类内部调用私有构造函数
      Presenter.instance = new Presenter(lifecycleManager)
    }
    return Presenter.instance
  }

  // 设置事件总线监听和转发
  setupEventBus() {
    // 设置 WindowPresenter 和 TabPresenter 到 EventBus
    eventBus.setWindowPresenter(this.windowPresenter)
    eventBus.setTabPresenter(this.tabPresenter)

    // 设置特殊事件的处理逻辑
    this.setupSpecialEventHandlers()

    // 应用主窗口准备就绪时触发初始化（只执行一次）
    let initCalled = false
    eventBus.on(WINDOW_EVENTS.READY_TO_SHOW, () => {
      if (!initCalled) {
        initCalled = true
        this.init()
      }
    })
  }

  // 设置需要特殊处理的事件
  private setupSpecialEventHandlers() {
    // CONFIG_EVENTS.PROVIDER_CHANGED 需要更新 providers（已在 configPresenter 中处理发送到渲染进程）
    eventBus.on(CONFIG_EVENTS.PROVIDER_CHANGED, () => {
      const providers = this.configPresenter.getProviders()
      this.llmproviderPresenter.setProviders(providers)
    })
  }
  setupTray() {
    console.info('setupTray', !!this.trayPresenter)
    if (!this.trayPresenter) {
      this.trayPresenter = new TrayPresenter()
    }
    this.trayPresenter.init()
  }

  // 应用初始化逻辑 (主窗口准备就绪后调用)
  init() {
    // 持久化 LLMProviderPresenter 的 Providers 数据
    const providers = this.configPresenter.getProviders()
    this.llmproviderPresenter.setProviders(providers)

    // 同步所有 provider 的自定义模型
    this.syncCustomModels()

    // 初始化悬浮按钮
    this.initializeFloatingButton()

    // 初始化 Yo Browser
    this.initializeYoBrowser()

    // 初始化 Skills 系统
    this.initializeSkills()

    // Initialize remote control runtime
    void this.initializeRemoteControl()
  }

  // 初始化悬浮按钮
  private async initializeFloatingButton() {
    try {
      await this.floatingButtonPresenter.initialize()
      console.log('FloatingButtonPresenter initialized successfully')
    } catch (error) {
      console.error('Failed to initialize FloatingButtonPresenter:', error)
    }
  }

  private async initializeYoBrowser() {
    try {
      await this.yoBrowserPresenter.initialize()
      console.log('YoBrowserPresenter initialized')
    } catch (error) {
      console.error('Failed to initialize YoBrowserPresenter:', error)
    }
  }

  private async initializeSkills() {
    try {
      const { enableSkills } = this.configPresenter.getSkillSettings()
      if (!enableSkills) {
        console.log('SkillPresenter disabled by config')
        return
      }
      await (this.skillPresenter as SkillPresenter).initialize()
      console.log('SkillPresenter initialized')

      // Initialize SkillSyncPresenter for background scanning
      await this.skillSyncPresenter.initialize()
      console.log('SkillSyncPresenter initialized')
    } catch (error) {
      console.error('Failed to initialize SkillPresenter:', error)
    }
  }

  private async initializeRemoteControl() {
    try {
      await this.#remoteControlPresenter.initialize()
    } catch (error) {
      console.error('RemoteControlPresenter.initialize failed:', error)
    }
  }

  async callRemoteControl(
    method: keyof IRemoteControlPresenter,
    ...payloads: unknown[]
  ): Promise<unknown> {
    if (!Presenter.REMOTE_CONTROL_METHODS.has(method)) {
      throw new Error(`Method "${String(method)}" is not allowed on "remoteControlPresenter"`)
    }

    const handler = this.#remoteControlBridge[method] as (...args: unknown[]) => unknown
    return await Reflect.apply(handler, this.#remoteControlBridge, payloads)
  }

  // 从配置中同步自定义模型到 LLMProviderPresenter
  private async syncCustomModels() {
    const providers = this.configPresenter.getProviders()
    for (const provider of providers) {
      if (provider.enable) {
        const customModels = this.configPresenter.getCustomModels(provider.id)
        console.log('syncCustomModels', provider.id, customModels)
        for (const model of customModels) {
          await this.llmproviderPresenter.addCustomModel(provider.id, {
            id: model.id,
            name: model.name,
            contextLength: model.contextLength,
            maxTokens: model.maxTokens,
            type: model.type
          })
        }
      }
    }
  }

  // 在应用退出时进行清理，关闭数据库连接
  async destroy(): Promise<void> {
    await this.destroyRemoteControl()
    this.floatingButtonPresenter.destroy() // 销毁悬浮按钮
    this.tabPresenter.destroy()
    this.sqlitePresenter.close() // 关闭数据库连接
    this.shortcutPresenter.destroy() // 销毁快捷键监听
    this.syncPresenter.destroy() // 销毁同步相关资源
    this.notificationPresenter.clearAllNotifications() // 清除所有通知
    this.knowledgePresenter.destroy() // 释放所有数据库连接
    ;(this.workspacePresenter as WorkspacePresenter).destroy() // 销毁 Workspace watchers
    ;(this.skillPresenter as SkillPresenter).destroy() // 销毁 Skills 相关资源
    ;(this.skillSyncPresenter as SkillSyncPresenter).destroy() // 销毁 Skill Sync 相关资源
    // 注意: trayPresenter.destroy() 在 main/index.ts 的 will-quit 事件中处理
    // 此处不销毁 trayPresenter，其生命周期由 main/index.ts 管理
  }

  private async destroyRemoteControl() {
    try {
      await this.#remoteControlPresenter.destroy()
    } catch (error) {
      console.error('RemoteControlPresenter.destroy failed:', error)
    }
  }
}

// Export presenter instance - will be initialized with database during lifecycle
export let presenter: Presenter

// Initialize presenter with database instance and optional lifecycle manager
export function getInstance(lifecycleManager: ILifecycleManager): Presenter {
  // only allow initialize once
  if (presenter == null) presenter = Presenter.getInstance(lifecycleManager)
  return presenter
}

// 检查对象属性是否为函数 (用于动态调用)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isFunction(obj: any, prop: string): obj is { [key: string]: (...args: any[]) => any } {
  return typeof obj[prop] === 'function'
}

// IPC 主进程处理程序：动态调用 Presenter 的方法 (支持 window/webContents 上下文)
ipcMain.handle(
  'presenter:call',
  (event: IpcMainInvokeEvent, name: string, method: string, ...payloads: unknown[]) => {
    try {
      // 构建调用上下文
      const webContentsId = event.sender.id
      const windowId = BrowserWindow.fromWebContents(event.sender)?.id

      const context: IPCCallContext = {
        windowId,
        webContentsId,
        presenterName: name,
        methodName: method,
        timestamp: Date.now()
      }

      // 记录调用日志
      if (import.meta.env.VITE_LOG_IPC_CALL === '1') {
        console.log(
          `[IPC Call] WebContents:${context.webContentsId} Window:${context.windowId || 'unknown'} -> ${context.presenterName}.${context.methodName}`
        )
      }

      if (!Presenter.DISPATCHABLE_PRESENTERS.has(name as keyof IPresenter)) {
        console.warn(
          `[IPC Warning] WebContents:${context.webContentsId} blocked presenter access: ${name}`
        )
        return { error: `Presenter "${name}" is not accessible via generic dispatcher` }
      }

      // 通过名称获取对应的 Presenter 实例
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let calledPresenter: any = presenter[name as keyof Presenter]
      let resolvedMethod = method
      let resolvedPayloads = payloads

      if (!calledPresenter) {
        console.warn(
          `[IPC Warning] WebContents:${context.webContentsId} calling wrong presenter: ${name}`
        )
        return { error: `Presenter "${name}" not found` }
      }

      // 检查方法是否存在且为函数
      if (isFunction(calledPresenter, resolvedMethod)) {
        // 调用方法并返回结果
        return calledPresenter[resolvedMethod](...resolvedPayloads)
      } else {
        console.warn(
          `[IPC Warning] WebContents:${context.webContentsId} called method is not a function or does not exist: ${name}.${method}`
        )
        return { error: `Method "${method}" not found or not a function on "${name}"` }
      }
    } catch (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      e: any
    ) {
      // 尝试获取调用上下文以改进错误日志
      const webContentsId = event.sender.id

      console.error(`[IPC Error] WebContents:${webContentsId} ${name}.${method}:`, e)
      return { error: e.message || String(e) }
    }
  }
)

ipcMain.handle(
  'remoteControlPresenter:call',
  async (event: IpcMainInvokeEvent, method: string, ...payloads: unknown[]) => {
    try {
      const webContentsId = event.sender.id
      const windowId = BrowserWindow.fromWebContents(event.sender)?.id

      if (import.meta.env.VITE_LOG_IPC_CALL === '1') {
        console.log(
          `[IPC Call] WebContents:${webContentsId} Window:${windowId || 'unknown'} -> remoteControlPresenter.${method}`
        )
      }

      if (!Presenter.REMOTE_CONTROL_METHODS.has(method as keyof IRemoteControlPresenter)) {
        console.warn(
          `[IPC Warning] WebContents:${webContentsId} blocked remote control method: ${method}`
        )
        return { error: `Method "${method}" is not allowed on "remoteControlPresenter"` }
      }

      return await presenter.callRemoteControl(method as keyof IRemoteControlPresenter, ...payloads)
    } catch (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      e: any
    ) {
      const webContentsId = event.sender.id
      console.error(`[IPC Error] WebContents:${webContentsId} remoteControlPresenter.${method}:`, e)
      return { error: e.message || String(e) }
    }
  }
)
