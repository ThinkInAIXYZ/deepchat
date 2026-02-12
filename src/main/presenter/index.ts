import path from 'path'
import { DialogPresenter } from './dialogPresenter/index'
import { ipcMain, IpcMainInvokeEvent, app } from 'electron'
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
  ISessionPresenter,
  IConversationExporter,
  IAgentPresenter,
  IUpgradePresenter,
  IWindowPresenter,
  IWorkspacePresenter,
  IToolPresenter,
  IYoBrowserPresenter,
  ISkillPresenter,
  ISkillSyncPresenter
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
import { AgentPresenter } from './agentPresenter'
import { SessionManager } from './agentPresenter/session/sessionManager'

import { ConversationExporterService } from './exporter'
import { SkillPresenter } from './skillPresenter'
import { SkillSyncPresenter } from './skillSyncPresenter'
import { HooksNotificationsService } from './hooksNotifications'

// IPC调用上下文接口
interface IPCCallContext {
  tabId?: number
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

  windowPresenter: IWindowPresenter
  sqlitePresenter: ISQLitePresenter
  llmproviderPresenter: ILlmProviderPresenter
  configPresenter: IConfigPresenter
  sessionPresenter: ISessionPresenter

  exporter: IConversationExporter
  agentPresenter: IAgentPresenter & ISessionPresenter
  sessionManager: SessionManager
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
  hooksNotifications: HooksNotificationsService
  filePermissionService: FilePermissionService
  settingsPermissionService: SettingsPermissionService

  private constructor(lifecycleManager: ILifecycleManager) {
    // Store lifecycle manager reference for component access
    // If the initialization is successful, there should be no null here
    this.lifecycleManager = lifecycleManager
    const context = lifecycleManager.getLifecycleContext()
    this.configPresenter = context.config as IConfigPresenter
    this.sqlitePresenter = context.database as ISQLitePresenter

    // 初始化各个 Presenter 实例及其依赖
    this.windowPresenter = new WindowPresenter(this.configPresenter)
    this.tabPresenter = new TabPresenter(this.windowPresenter)
    this.llmproviderPresenter = new LLMProviderPresenter(this.configPresenter, this.sqlitePresenter)
    const commandPermissionHandler = new CommandPermissionService()
    this.filePermissionService = new FilePermissionService()
    this.settingsPermissionService = new SettingsPermissionService()
    const messageManager = new MessageManager(this.sqlitePresenter)
    this.devicePresenter = new DevicePresenter()
    this.exporter = new ConversationExporterService({
      sqlitePresenter: this.sqlitePresenter,
      configPresenter: this.configPresenter
    })
    this.sessionPresenter = new SessionPresenter({
      messageManager,
      sqlitePresenter: this.sqlitePresenter,
      llmProviderPresenter: this.llmproviderPresenter,
      configPresenter: this.configPresenter,
      exporter: this.exporter,
      commandPermissionService: commandPermissionHandler
    })
    this.sessionManager = new SessionManager({
      configPresenter: this.configPresenter,
      sessionPresenter: this.sessionPresenter
    })
    this.agentPresenter = new AgentPresenter({
      sessionPresenter: this.sessionPresenter,
      sessionManager: this.sessionManager,
      sqlitePresenter: this.sqlitePresenter,
      llmProviderPresenter: this.llmproviderPresenter,
      configPresenter: this.configPresenter,
      commandPermissionService: commandPermissionHandler,
      messageManager
    }) as unknown as IAgentPresenter & ISessionPresenter
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
    this.yoBrowserPresenter = new YoBrowserPresenter(this.windowPresenter, this.tabPresenter)

    // Define dbDir for knowledge presenter
    const dbDir = path.join(app.getPath('userData'), 'app_db')
    this.knowledgePresenter = new KnowledgePresenter(
      this.configPresenter,
      dbDir,
      this.filePresenter
    )

    // Initialize generic Workspace presenter (for all Agent modes)
    this.workspacePresenter = new WorkspacePresenter()

    // Initialize unified Tool presenter (for routing MCP and Agent tools)
    this.toolPresenter = new ToolPresenter({
      mcpPresenter: this.mcpPresenter,
      yoBrowserPresenter: this.yoBrowserPresenter,
      configPresenter: this.configPresenter,
      commandPermissionHandler
    })

    // Initialize Skill presenter
    this.skillPresenter = new SkillPresenter(this.configPresenter)

    // Initialize Skill Sync presenter
    this.skillSyncPresenter = new SkillSyncPresenter(this.skillPresenter, this.configPresenter)

    // Initialize Hooks & Notifications service
    this.hooksNotifications = new HooksNotificationsService(this.configPresenter, {
      sessionPresenter: this.sessionPresenter,
      resolveWorkspaceContext: this.sessionManager.resolveWorkspaceContext.bind(this.sessionManager)
    })

    this.setupEventBus() // 设置事件总线监听
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
  destroy() {
    this.floatingButtonPresenter.destroy() // 销毁悬浮按钮
    this.tabPresenter.destroy()
    this.sqlitePresenter.close() // 关闭数据库连接
    this.shortcutPresenter.destroy() // 销毁快捷键监听
    this.syncPresenter.destroy() // 销毁同步相关资源
    this.notificationPresenter.clearAllNotifications() // 清除所有通知
    this.knowledgePresenter.destroy() // 释放所有数据库连接
    ;(this.skillPresenter as SkillPresenter).destroy() // 销毁 Skills 相关资源
    ;(this.skillSyncPresenter as SkillSyncPresenter).destroy() // 销毁 Skill Sync 相关资源
    // 注意: trayPresenter.destroy() 在 main/index.ts 的 will-quit 事件中处理
    // 此处不销毁 trayPresenter，其生命周期由 main/index.ts 管理
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

// IPC 主进程处理程序：动态调用 Presenter 的方法 (支持Tab上下文)
ipcMain.handle(
  'presenter:call',
  (event: IpcMainInvokeEvent, name: string, method: string, ...payloads: unknown[]) => {
    try {
      // 构建调用上下文
      const webContentsId = event.sender.id
      const tabId = presenter.tabPresenter.getTabIdByWebContentsId(webContentsId)
      const windowId = presenter.tabPresenter.getWindowIdByWebContentsId(webContentsId)

      const context: IPCCallContext = {
        tabId,
        windowId,
        webContentsId,
        presenterName: name,
        methodName: method,
        timestamp: Date.now()
      }

      // 记录调用日志 (包含tab上下文)
      if (import.meta.env.VITE_LOG_IPC_CALL === '1') {
        console.log(
          `[IPC Call] Tab:${context.tabId || 'unknown'} Window:${context.windowId || 'unknown'} -> ${context.presenterName}.${context.methodName}`
        )
      }

      // 通过名称获取对应的 Presenter 实例
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let calledPresenter: any = presenter[name as keyof Presenter]
      let resolvedMethod = method
      let resolvedPayloads = payloads

      if (!calledPresenter) {
        console.warn(`[IPC Warning] Tab:${context.tabId} calling wrong presenter: ${name}`)
        return { error: `Presenter "${name}" not found` }
      }

      // 检查方法是否存在且为函数
      if (isFunction(calledPresenter, resolvedMethod)) {
        // 调用方法并返回结果
        return calledPresenter[resolvedMethod](...resolvedPayloads)
      } else {
        console.warn(
          `[IPC Warning] Tab:${context.tabId} called method is not a function or does not exist: ${name}.${method}`
        )
        return { error: `Method "${method}" not found or not a function on "${name}"` }
      }
    } catch (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      e: any
    ) {
      // 尝试获取调用上下文以改进错误日志
      const webContentsId = event.sender.id
      const tabId = presenter.tabPresenter.getTabIdByWebContentsId(webContentsId)

      console.error(`[IPC Error] Tab:${tabId || 'unknown'} ${name}.${method}:`, e)
      return { error: e.message || String(e) }
    }
  }
)
