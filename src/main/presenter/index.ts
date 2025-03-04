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
import {
  CONFIG_EVENTS,
  CONVERSATION_EVENTS,
  STREAM_EVENTS,
  WINDOW_EVENTS,
  UPDATE_EVENTS,
  OLLAMA_EVENTS
} from '@/events'

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
  // llamaCppPresenter: LlamaCppPresenter

  constructor() {
    this.configPresenter = new ConfigPresenter()
    this.windowPresenter = new WindowPresenter(this.configPresenter)
    this.llmproviderPresenter = new LLMProviderPresenter(this.configPresenter)
    this.devicePresenter = new DevicePresenter()
    // 初始化 SQLite 数据库
    const dbDir = path.join(app.getPath('userData'), 'app_db')
    const dbPath = path.join(dbDir, 'chat.db')
    this.sqlitePresenter = new SQLitePresenter(dbPath)
    this.threadPresenter = new ThreadPresenter(this.sqlitePresenter, this.llmproviderPresenter)
    this.upgradePresenter = new UpgradePresenter()
    this.shortcutPresenter = new ShortcutPresenter(this.windowPresenter, this.configPresenter)
    this.filePresenter = new FilePresenter()
    // this.llamaCppPresenter = new LlamaCppPresenter()
    this.setupEventBus()
  }
  setupEventBus() {
    // 窗口事件
    eventBus.on(WINDOW_EVENTS.READY_TO_SHOW, () => {
      this.init()
    })

    // 配置相关事件
    eventBus.on(CONFIG_EVENTS.PROVIDER_CHANGED, () => {
      const providers = this.configPresenter.getProviders()
      this.llmproviderPresenter.setProviders(providers)
      this.windowPresenter.mainWindow?.webContents.send(CONFIG_EVENTS.PROVIDER_CHANGED)
    })

    // 流式响应事件
    eventBus.on(STREAM_EVENTS.RESPONSE, (msg) => {
      this.windowPresenter.mainWindow?.webContents.send(STREAM_EVENTS.RESPONSE, msg)
    })

    eventBus.on(STREAM_EVENTS.END, (msg) => {
      console.log('stream-end', msg.eventId)
      this.windowPresenter.mainWindow?.webContents.send(STREAM_EVENTS.END, msg)
    })

    eventBus.on(STREAM_EVENTS.ERROR, (msg) => {
      this.windowPresenter.mainWindow?.webContents.send(STREAM_EVENTS.ERROR, msg)
    })

    // 会话相关事件
    eventBus.on(CONVERSATION_EVENTS.ACTIVATED, (msg) => {
      this.windowPresenter.mainWindow?.webContents.send(CONVERSATION_EVENTS.ACTIVATED, msg)
    })

    eventBus.on(CONVERSATION_EVENTS.DEACTIVATED, (msg) => {
      this.windowPresenter.mainWindow?.webContents.send(CONVERSATION_EVENTS.DEACTIVATED, msg)
    })

    // 处理从ConfigPresenter过来的模型列表更新事件
    eventBus.on(CONFIG_EVENTS.MODEL_LIST_CHANGED, (providerId: string) => {
      // 转发事件到渲染进程
      this.windowPresenter.mainWindow?.webContents.send(
        CONFIG_EVENTS.MODEL_LIST_CHANGED,
        providerId
      )
    })

    eventBus.on(
      CONFIG_EVENTS.MODEL_STATUS_CHANGED,
      (providerId: string, modelId: string, enabled: boolean) => {
        this.windowPresenter.mainWindow?.webContents.send(CONFIG_EVENTS.MODEL_STATUS_CHANGED, {
          providerId,
          modelId,
          enabled
        })
      }
    )

    // 更新相关事件
    eventBus.on(UPDATE_EVENTS.STATUS_CHANGED, (msg) => {
      console.log(UPDATE_EVENTS.STATUS_CHANGED, msg)
      this.windowPresenter.mainWindow?.webContents.send(UPDATE_EVENTS.STATUS_CHANGED, msg)
    })

    // 消息编辑事件
    eventBus.on(CONVERSATION_EVENTS.MESSAGE_EDITED, (msgId: string) => {
      this.windowPresenter.mainWindow?.webContents.send(CONVERSATION_EVENTS.MESSAGE_EDITED, msgId)
    })

    eventBus.on(OLLAMA_EVENTS.PULL_MODEL_PROGRESS, (msg) => {
      this.windowPresenter.mainWindow?.webContents.send(OLLAMA_EVENTS.PULL_MODEL_PROGRESS, msg)
    })
  }

  init() {
    if (this.windowPresenter.mainWindow) {
      // this.llamaCppPresenter.setMainwindow(this.windowPresenter.mainWindow)
    }
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
    this.sqlitePresenter.close()
    this.shortcutPresenter.destroy()
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
