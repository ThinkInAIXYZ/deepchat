import { ipcMain, IpcMainInvokeEvent, app } from 'electron'
// import { LlamaCppPresenter } from './llamaCppPresenter'
import { WindowPresenter } from './windowPresenter'
import { SQLitePresenter } from './sqlitePresenter'
import { ShortcutPresenter } from './shortcutPresenter'
import { IPresenter } from '@shared/presenter'
import { eventBus } from '@/eventbus'
import path from 'path'
import { LLMProviderPresenter } from './llmProviderPresenter'
import { ConfigPresenter } from './configPresenter'
import { ThreadPresenter } from './threadPresenter'
import { DevicePresenter } from './devicePresenter'
import { UpgradePresenter } from './upgradePresenter'
import { FilePresenter } from './filePresenter/FilePresenter'
import { McpPresenter } from './mcpPresenter'
import { SyncPresenter } from './syncPresenter'
import { DeeplinkPresenter } from './deeplinkPresenter'
import { NotificationPresenter } from './notifactionPresenter'
import { TabPresenter } from './tabPresenter'
import { OAuthPresenter } from './oauthPresenter'
import {
  CONFIG_EVENTS,
  CONVERSATION_EVENTS,
  STREAM_EVENTS,
  WINDOW_EVENTS,
  UPDATE_EVENTS,
  OLLAMA_EVENTS,
  MCP_EVENTS,
  SYNC_EVENTS,
  DEEPLINK_EVENTS,
  NOTIFICATION_EVENTS,
  SHORTCUT_EVENTS
} from '@/events'

// --- 所有需要通过 forward 函数处理的事件列表 ---
const eventsToForward: string[] = [
  CONFIG_EVENTS.PROVIDER_CHANGED,
  STREAM_EVENTS.RESPONSE,
  STREAM_EVENTS.END,
  STREAM_EVENTS.ERROR,
  CONVERSATION_EVENTS.ACTIVATED,
  CONVERSATION_EVENTS.DEACTIVATED,
  CONFIG_EVENTS.MODEL_LIST_CHANGED,
  CONFIG_EVENTS.MODEL_STATUS_CHANGED,
  UPDATE_EVENTS.STATUS_CHANGED,
  UPDATE_EVENTS.PROGRESS,
  UPDATE_EVENTS.WILL_RESTART,
  UPDATE_EVENTS.ERROR,
  CONVERSATION_EVENTS.MESSAGE_EDITED,
  MCP_EVENTS.SERVER_STARTED,
  MCP_EVENTS.SERVER_STOPPED,
  MCP_EVENTS.CONFIG_CHANGED,
  MCP_EVENTS.TOOL_CALL_RESULT,
  OLLAMA_EVENTS.PULL_MODEL_PROGRESS,
  SYNC_EVENTS.BACKUP_STARTED,
  SYNC_EVENTS.BACKUP_COMPLETED,
  SYNC_EVENTS.BACKUP_ERROR,
  SYNC_EVENTS.IMPORT_STARTED,
  SYNC_EVENTS.IMPORT_COMPLETED,
  SYNC_EVENTS.IMPORT_ERROR,
  DEEPLINK_EVENTS.START,
  DEEPLINK_EVENTS.MCP_INSTALL,
  NOTIFICATION_EVENTS.SHOW_ERROR,
  NOTIFICATION_EVENTS.SYS_NOTIFY_CLICKED,
  SHORTCUT_EVENTS.GO_SETTINGS,
  SHORTCUT_EVENTS.CLEAN_CHAT_HISTORY,
  SHORTCUT_EVENTS.ZOOM_IN,
  SHORTCUT_EVENTS.ZOOM_OUT,
  SHORTCUT_EVENTS.ZOOM_RESUME,
  CONFIG_EVENTS.LANGUAGE_CHANGED,
  CONFIG_EVENTS.OAUTH_LOGIN_START,
  CONFIG_EVENTS.OAUTH_LOGIN_SUCCESS,
  CONFIG_EVENTS.OAUTH_LOGIN_ERROR
]
export class Presenter implements IPresenter {
  windowPresenter: WindowPresenter
  sqlitePresenter: SQLitePresenter
  llmproviderPresenter: LLMProviderPresenter
  configPresenter: ConfigPresenter
  threadPresenter: ThreadPresenter
  devicePresenter: DevicePresenter
  upgradePresenter: UpgradePresenter
  shortcutPresenter: ShortcutPresenter
  filePresenter: FilePresenter
  mcpPresenter: McpPresenter
  syncPresenter: SyncPresenter
  deeplinkPresenter: DeeplinkPresenter
  notificationPresenter: NotificationPresenter
  tabPresenter: TabPresenter
  oauthPresenter: OAuthPresenter
  // llamaCppPresenter: LlamaCppPresenter

  constructor() {
    this.configPresenter = new ConfigPresenter()
    this.windowPresenter = new WindowPresenter(this.configPresenter)
    this.tabPresenter = new TabPresenter(this.windowPresenter)
    this.llmproviderPresenter = new LLMProviderPresenter(this.configPresenter)
    this.devicePresenter = new DevicePresenter()
    // 初始化 SQLite 数据库
    const dbDir = path.join(app.getPath('userData'), 'app_db')
    const dbPath = path.join(dbDir, 'chat.db')
    this.sqlitePresenter = new SQLitePresenter(dbPath)
    this.threadPresenter = new ThreadPresenter(
      this.sqlitePresenter,
      this.llmproviderPresenter,
      this.configPresenter
    )
    this.mcpPresenter = new McpPresenter(this.configPresenter)
    this.upgradePresenter = new UpgradePresenter()
    this.shortcutPresenter = new ShortcutPresenter()
    this.filePresenter = new FilePresenter()
    this.syncPresenter = new SyncPresenter(this.configPresenter, this.sqlitePresenter)
    this.deeplinkPresenter = new DeeplinkPresenter()
    this.notificationPresenter = new NotificationPresenter()
    this.oauthPresenter = new OAuthPresenter()

    // this.llamaCppPresenter = new LlamaCppPresenter()
    this.setupEventBus()
  }

  setupEventBus() {
    // --- 事件转发辅助函数（包含特定逻辑处理） ---
    const forward = (eventName: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.on(eventName, (...payload: any[]) => {
        if (eventName === STREAM_EVENTS.RESPONSE) {
          // 根据事件名称处理特定逻辑
          const [msg] = payload
          const dataToRender = { ...msg }
          delete dataToRender.tool_call_response_raw // 删除原始数据
          this.windowPresenter.sendToAllWindows(eventName, dataToRender)
        } else if (eventName === STREAM_EVENTS.END) {
          const [msg] = payload
          console.log('stream-end', msg.eventId)
          this.windowPresenter.sendToAllWindows(eventName, msg)
        } else if (eventName === CONFIG_EVENTS.PROVIDER_CHANGED) {
          const providers = this.configPresenter.getProviders()
          this.llmproviderPresenter.setProviders(providers)
          this.windowPresenter.sendToAllWindows(eventName) // 此事件转发无需 payload
        } else if (
          eventName === UPDATE_EVENTS.STATUS_CHANGED ||
          eventName === UPDATE_EVENTS.PROGRESS ||
          eventName === UPDATE_EVENTS.WILL_RESTART ||
          eventName === UPDATE_EVENTS.ERROR ||
          eventName === DEEPLINK_EVENTS.START
        ) {
          const [msg] = payload
          console.log(eventName, msg) // 记录日志
          this.windowPresenter.sendToAllWindows(eventName, msg)
        } else if (
          eventName === DEEPLINK_EVENTS.MCP_INSTALL ||
          eventName === DEEPLINK_EVENTS.START
        ) {
          // 特殊处理：向默认标签页发送消息，并切换到目标标签页
          const [msg] = payload
          console.log(eventName, msg) // 记录日志
          this.windowPresenter.sendTodefaultTab(eventName, true, msg)
        } else {
          // 默认处理：直接转发所有 payload
          this.windowPresenter.sendToAllWindows(eventName, ...payload)
        }
      })
    }

    // --- 真正需要特殊处理的事件 ---
    eventBus.on(WINDOW_EVENTS.READY_TO_SHOW, () => {
      this.init()
    })

    // 统一注册事件
    eventsToForward.forEach(forward)
  }

  init() {
    // 持久化 LLMProviderPresenter 的 Providers 数据
    const providers = this.configPresenter.getProviders()
    this.llmproviderPresenter.setProviders(providers)

    // 同步所有 provider 的自定义模型
    this.syncCustomModels()
  }

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
            maxTokens: model.maxTokens
          })
        }
      }
    }
  }

  // 在应用退出时关闭数据库连接
  destroy() {
    this.tabPresenter.destroy()
    this.sqlitePresenter.close()
    this.shortcutPresenter.destroy()
    this.syncPresenter.destroy()
    this.notificationPresenter.clearAllNotifications()
  }
}

export const presenter = new Presenter()
ipcMain.handle(
  'presenter:call',
  (_event: IpcMainInvokeEvent, name: string, method: string, ...payloads: unknown[]) => {
    try {
      const calledPresenter = presenter[name]
      if (!calledPresenter) {
        console.warn('calling wrong presenter', name)
        return
      }
      if (!calledPresenter[method]) {
        console.warn('calling wrong presenter method', name, method)
        return
      }
      return calledPresenter[method](...payloads)
    } catch (e) {
      console.warn('error on presenter handle', e)
      return null
    }
  }
)
