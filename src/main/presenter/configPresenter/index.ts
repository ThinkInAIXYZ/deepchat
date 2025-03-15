import { eventBus } from '@/eventbus'
import {
  IConfigPresenter,
  LLM_PROVIDER,
  MODEL_META,
  ModelConfig,
  RENDERER_MODEL_META,
  MCPServerConfig
} from '@shared/presenter'
import { SearchEngineTemplate } from '@shared/chat'
import ElectronStore from 'electron-store'
import { DEFAULT_PROVIDERS } from './providers'
import { getModelConfig } from '../llmProviderPresenter/modelConfigs'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import { CONFIG_EVENTS } from '@/events'
import { McpConfHelper } from './mcpConfHelper'

// 定义应用设置的接口
interface IAppSettings {
  // 在这里定义你的配置项，例如：
  language: string
  providers: LLM_PROVIDER[]
  closeToQuit: boolean // 是否点击关闭按钮时退出程序
  appVersion?: string // 用于版本检查和数据迁移
  proxyMode?: string // 代理模式：system, none, custom
  customProxyUrl?: string // 自定义代理地址
  artifactsEffectEnabled?: boolean // artifacts动画效果是否启用
  searchPreviewEnabled?: boolean // 搜索预览是否启用
  contentProtectionEnabled?: boolean // 投屏保护是否启用
  syncEnabled?: boolean // 是否启用同步功能
  syncFolderPath?: string // 同步文件夹路径
  lastSyncTime?: number // 上次同步时间
  customSearchEngines?: string // 自定义搜索引擎JSON字符串
  [key: string]: unknown // 允许任意键，使用unknown类型替代any
}

// 为模型存储创建接口
interface IModelStore {
  models: MODEL_META[]
  custom_models: MODEL_META[]
}

const defaultProviders = DEFAULT_PROVIDERS.map((provider) => ({
  id: provider.id,
  name: provider.name,
  apiType: provider.apiType,
  apiKey: provider.apiKey,
  baseUrl: provider.baseUrl,
  enable: provider.enable
}))

// 定义 storeKey 常量
const PROVIDERS_STORE_KEY = 'providers'

const PROVIDER_MODELS_DIR = 'provider_models'
// 模型状态键前缀
const MODEL_STATUS_KEY_PREFIX = 'model_status_'

export class ConfigPresenter implements IConfigPresenter {
  private store: ElectronStore<IAppSettings>
  private providersModelStores: Map<string, ElectronStore<IModelStore>> = new Map()
  private userDataPath: string
  private currentAppVersion: string
  private mcpConfHelper: McpConfHelper // 使用MCP配置助手

  constructor() {
    this.userDataPath = app.getPath('userData')
    this.currentAppVersion = app.getVersion()
    // 初始化应用设置存储
    this.store = new ElectronStore<IAppSettings>({
      name: 'app-settings',
      defaults: {
        language: 'en-US',
        providers: defaultProviders,
        closeToQuit: false,
        proxyMode: 'system',
        customProxyUrl: '',
        artifactsEffectEnabled: true,
        searchPreviewEnabled: true,
        contentProtectionEnabled: false,
        syncEnabled: false,
        syncFolderPath: path.join(this.userDataPath, 'sync'),
        lastSyncTime: 0,
        appVersion: this.currentAppVersion
      }
    })

    // 初始化MCP配置助手
    this.mcpConfHelper = new McpConfHelper()

    // 迁移数据
    this.migrateModelData()
    // 初始化provider models目录
    this.initProviderModelsDir()

    // 如果应用版本更新了，更新appVersion
    if (this.store.get('appVersion') !== this.currentAppVersion) {
      this.store.set('appVersion', this.currentAppVersion)
    }

    const existingProviders = this.getSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY) || []
    const newProviders = defaultProviders.filter(
      (defaultProvider) =>
        !existingProviders.some((existingProvider) => existingProvider.id === defaultProvider.id)
    )

    if (newProviders.length > 0) {
      this.setProviders([...existingProviders, ...newProviders])
    }
  }

  private initProviderModelsDir(): void {
    const modelsDir = path.join(this.userDataPath, PROVIDER_MODELS_DIR)
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true })
    }
  }

  private getProviderModelStore(providerId: string): ElectronStore<IModelStore> {
    if (!this.providersModelStores.has(providerId)) {
      const store = new ElectronStore<IModelStore>({
        name: `models_${providerId}`,
        cwd: path.join(this.userDataPath, PROVIDER_MODELS_DIR),
        defaults: {
          models: [],
          custom_models: []
        }
      })
      this.providersModelStores.set(providerId, store)
    }
    return this.providersModelStores.get(providerId)!
  }

  private migrateModelData(): void {
    // 迁移旧的模型数据
    const providers = this.getProviders()

    for (const provider of providers) {
      // 检查并修正 ollama 的 baseUrl
      if (provider.id === 'ollama' && provider.baseUrl) {
        if (provider.baseUrl.endsWith('/v1')) {
          provider.baseUrl = provider.baseUrl.replace(/\/v1$/, '')
          // 保存修改后的提供者
          this.setProviderById('ollama', provider)
        }
      }

      // 迁移provider模型
      const oldProviderModelsKey = `${provider.id}_models`
      const oldModels = this.getSetting<(MODEL_META & { enabled: boolean })[]>(oldProviderModelsKey)

      if (oldModels && oldModels.length > 0) {
        const store = this.getProviderModelStore(provider.id)
        // 遍历旧模型，保存启用状态
        oldModels.forEach((model) => {
          if (model.enabled) {
            this.setModelStatus(provider.id, model.id, true)
          }
          // @ts-ignore - 需要删除enabled属性以便独立存储状态
          delete model.enabled
        })
        // 保存模型列表到新存储
        store.set('models', oldModels)
        // 清除旧存储
        this.store.delete(oldProviderModelsKey)
      }

      // 迁移custom模型
      const oldCustomModelsKey = `custom_models_${provider.id}`
      const oldCustomModels =
        this.getSetting<(MODEL_META & { enabled: boolean })[]>(oldCustomModelsKey)

      if (oldCustomModels && oldCustomModels.length > 0) {
        const store = this.getProviderModelStore(provider.id)
        // 遍历旧的自定义模型，保存启用状态
        oldCustomModels.forEach((model) => {
          if (model.enabled) {
            this.setModelStatus(provider.id, model.id, true)
          }
          // @ts-ignore - 需要删除enabled属性以便独立存储状态
          delete model.enabled
        })
        // 保存自定义模型列表到新存储
        store.set('custom_models', oldCustomModels)
        // 清除旧存储
        this.store.delete(oldCustomModelsKey)
      }
    }
  }

  getSetting<T>(key: string): T | undefined {
    try {
      return this.store.get(key) as T
    } catch (error) {
      console.error(`[Config] Failed to get setting ${key}:`, error)
      return undefined
    }
  }

  setSetting<T>(key: string, value: T): void {
    try {
      this.store.set(key, value)
      // 触发设置变更事件
      eventBus.emit(CONFIG_EVENTS.SETTING_CHANGED, key, value)
    } catch (error) {
      console.error(`[Config] Failed to set setting ${key}:`, error)
    }
  }

  getProviders(): LLM_PROVIDER[] {
    const providers = this.getSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY)
    if (Array.isArray(providers) && providers.length > 0) {
      return providers
    } else {
      this.setSetting(PROVIDERS_STORE_KEY, defaultProviders)
      return defaultProviders
    }
  }

  setProviders(providers: LLM_PROVIDER[]): void {
    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, providers)
    // 触发新事件
    eventBus.emit(CONFIG_EVENTS.PROVIDER_CHANGED)
  }

  getProviderById(id: string): LLM_PROVIDER | undefined {
    const providers = this.getProviders()
    return providers.find((provider) => provider.id === id)
  }

  setProviderById(id: string, provider: LLM_PROVIDER): void {
    const providers = this.getProviders()
    const index = providers.findIndex((p) => p.id === id)
    if (index !== -1) {
      providers[index] = provider
      this.setProviders(providers)
    } else {
      console.error(`[Config] Provider ${id} not found`)
    }
  }

  // 构造模型状态的存储键
  private getModelStatusKey(providerId: string, modelId: string): string {
    return `${MODEL_STATUS_KEY_PREFIX}${providerId}_${modelId}`
  }

  // 获取模型启用状态
  getModelStatus(providerId: string, modelId: string): boolean {
    const statusKey = this.getModelStatusKey(providerId, modelId)
    return this.getSetting<boolean>(statusKey) ?? false
  }

  // 设置模型启用状态
  setModelStatus(providerId: string, modelId: string, enabled: boolean): void {
    const statusKey = this.getModelStatusKey(providerId, modelId)
    this.setSetting(statusKey, enabled)
    // 触发模型状态变更事件
    eventBus.emit(CONFIG_EVENTS.MODEL_STATUS_CHANGED, providerId, modelId, enabled)
  }

  // 启用模型
  enableModel(providerId: string, modelId: string): void {
    this.setModelStatus(providerId, modelId, true)
  }

  // 禁用模型
  disableModel(providerId: string, modelId: string): void {
    this.setModelStatus(providerId, modelId, false)
  }

  // 批量设置模型状态
  batchSetModelStatus(providerId: string, modelStatusMap: Record<string, boolean>): void {
    for (const [modelId, enabled] of Object.entries(modelStatusMap)) {
      this.setModelStatus(providerId, modelId, enabled)
    }
  }

  getProviderModels(providerId: string): MODEL_META[] {
    const store = this.getProviderModelStore(providerId)
    let models = store.get('models') || []

    models = models.map((model) => {
      const config = getModelConfig(model.id)
      if (config) {
        model.maxTokens = config.maxTokens
        model.contextLength = config.contextLength
      }
      return model
    })
    return models
  }

  getModelDefaultConfig(modelId: string): ModelConfig {
    const model = getModelConfig(modelId)
    if (model) {
      return model
    }
    return {
      maxTokens: 4096,
      contextLength: 4096,
      temperature: 0.7,
      vision: false
    }
  }

  setProviderModels(providerId: string, models: MODEL_META[]): void {
    const store = this.getProviderModelStore(providerId)
    store.set('models', models)
  }

  getEnabledProviders(): LLM_PROVIDER[] {
    const providers = this.getProviders()
    return providers.filter((provider) => provider.enable)
  }

  getAllEnabledModels(): Promise<{ providerId: string; models: RENDERER_MODEL_META[] }[]> {
    const enabledProviders = this.getEnabledProviders()
    return Promise.all(
      enabledProviders.map(async (provider) => {
        const providerId = provider.id
        const allModels = [
          ...this.getProviderModels(providerId),
          ...this.getCustomModels(providerId)
        ]

        // 根据单独存储的状态过滤启用的模型
        const enabledModels = allModels
          .filter((model) => this.getModelStatus(providerId, model.id))
          .map((model) => ({
            ...model,
            enabled: true
          }))

        return {
          providerId,
          models: enabledModels
        }
      })
    )
  }

  getCustomModels(providerId: string): MODEL_META[] {
    const store = this.getProviderModelStore(providerId)
    return store.get('custom_models') || []
  }

  setCustomModels(providerId: string, models: MODEL_META[]): void {
    const store = this.getProviderModelStore(providerId)
    store.set('custom_models', models)
  }

  addCustomModel(providerId: string, model: MODEL_META): void {
    const models = this.getCustomModels(providerId)
    const existingIndex = models.findIndex((m) => m.id === model.id)

    // 创建不包含enabled属性的模型副本
    const modelWithoutStatus: MODEL_META = { ...model }
    // @ts-ignore - 需要删除enabled属性以便独立存储状态
    delete modelWithoutStatus.enabled

    if (existingIndex !== -1) {
      models[existingIndex] = modelWithoutStatus as MODEL_META
    } else {
      models.push(modelWithoutStatus as MODEL_META)
    }

    this.setCustomModels(providerId, models)
    // 单独设置模型状态
    this.setModelStatus(providerId, model.id, true)
    // 触发模型列表变更事件
    eventBus.emit(CONFIG_EVENTS.MODEL_LIST_CHANGED, providerId)
  }

  removeCustomModel(providerId: string, modelId: string): void {
    const models = this.getCustomModels(providerId)
    const filteredModels = models.filter((model) => model.id !== modelId)
    this.setCustomModels(providerId, filteredModels)

    // 删除模型状态
    const statusKey = this.getModelStatusKey(providerId, modelId)
    this.store.delete(statusKey)

    // 触发模型列表变更事件
    eventBus.emit(CONFIG_EVENTS.MODEL_LIST_CHANGED, providerId)
  }

  updateCustomModel(providerId: string, modelId: string, updates: Partial<MODEL_META>): void {
    const models = this.getCustomModels(providerId)
    const index = models.findIndex((model) => model.id === modelId)

    if (index !== -1) {
      Object.assign(models[index], updates)
      this.setCustomModels(providerId, models)
      eventBus.emit(CONFIG_EVENTS.MODEL_LIST_CHANGED, providerId)
    }
  }

  getCloseToQuit(): boolean {
    return this.getSetting<boolean>('closeToQuit') ?? false
  }

  setCloseToQuit(value: boolean): void {
    this.setSetting('closeToQuit', value)
  }

  // 获取应用当前语言，考虑系统语言设置
  getLanguage(): string {
    const language = this.getSetting<string>('language') || 'system'

    if (language !== 'system') {
      return language
    }

    return this.getSystemLanguage()
  }

  // 获取系统语言并匹配支持的语言列表
  private getSystemLanguage(): string {
    const systemLang = app.getLocale()
    const supportedLanguages = ['zh-CN', 'en-US', 'zh-HK', 'ko-KR', 'ru-RU', 'ja-JP']

    // 完全匹配
    if (supportedLanguages.includes(systemLang)) {
      return systemLang
    }

    // 部分匹配（只匹配语言代码）
    const langCode = systemLang.split('-')[0]
    const matchedLang = supportedLanguages.find((lang) => lang.startsWith(langCode))
    if (matchedLang) {
      return matchedLang
    }

    // 默认返回英文
    return 'en-US'
  }

  public getDefaultProviders(): LLM_PROVIDER[] {
    return DEFAULT_PROVIDERS
  }

  // 获取代理模式
  getProxyMode(): string {
    return this.getSetting<string>('proxyMode') || 'system'
  }

  // 设置代理模式
  setProxyMode(mode: string): void {
    this.setSetting('proxyMode', mode)
    eventBus.emit(CONFIG_EVENTS.PROXY_MODE_CHANGED, mode)
  }

  // 获取自定义代理地址
  getCustomProxyUrl(): string {
    return this.getSetting<string>('customProxyUrl') || ''
  }

  // 设置自定义代理地址
  setCustomProxyUrl(url: string): void {
    this.setSetting('customProxyUrl', url)
    eventBus.emit(CONFIG_EVENTS.CUSTOM_PROXY_URL_CHANGED, url)
  }

  getArtifactsEffectEnabled(): boolean {
    const value = this.getSetting<boolean>('artifactsEffectEnabled')
    console.log('getArtifactsEffectEnabled 原始值:', value, '类型:', typeof value)
    // 只有当值是undefined或null时才使用默认值true
    // 注意：false是一个有效的boolean值，应该被保留而不是替换为默认值
    return value === undefined || value === null ? true : value
  }

  setArtifactsEffectEnabled(enabled: boolean): void {
    console.log('ConfigPresenter.setArtifactsEffectEnabled:', enabled, typeof enabled)

    // 确保传入的是布尔值
    const boolValue = Boolean(enabled)

    this.setSetting('artifactsEffectEnabled', boolValue)
    eventBus.emit(CONFIG_EVENTS.ARTIFACTS_EFFECT_CHANGED, boolValue)
  }

  // 获取同步功能状态
  getSyncEnabled(): boolean {
    return this.getSetting<boolean>('syncEnabled') || false
  }

  // 设置同步功能状态
  setSyncEnabled(enabled: boolean): void {
    console.log('setSyncEnabled', enabled)
    this.setSetting('syncEnabled', enabled)
    eventBus.emit(CONFIG_EVENTS.SYNC_SETTINGS_CHANGED, { enabled })
  }

  // 获取同步文件夹路径
  getSyncFolderPath(): string {
    return (
      this.getSetting<string>('syncFolderPath') || path.join(app.getPath('home'), 'DeepchatSync')
    )
  }

  // 设置同步文件夹路径
  setSyncFolderPath(folderPath: string): void {
    this.setSetting('syncFolderPath', folderPath)
    eventBus.emit(CONFIG_EVENTS.SYNC_SETTINGS_CHANGED, { folderPath })
  }

  // 获取上次同步时间
  getLastSyncTime(): number {
    return this.getSetting<number>('lastSyncTime') || 0
  }

  // 设置上次同步时间
  setLastSyncTime(time: number): void {
    this.setSetting('lastSyncTime', time)
  }

  // 获取自定义搜索引擎
  async getCustomSearchEngines(): Promise<SearchEngineTemplate[]> {
    try {
      const customEnginesJson = this.store.get('customSearchEngines')
      if (customEnginesJson) {
        return JSON.parse(customEnginesJson as string)
      }
      return []
    } catch (error) {
      console.error('获取自定义搜索引擎失败:', error)
      return []
    }
  }

  // 设置自定义搜索引擎
  async setCustomSearchEngines(engines: SearchEngineTemplate[]): Promise<void> {
    try {
      this.store.set('customSearchEngines', JSON.stringify(engines))
      // 发送事件通知搜索引擎更新
      eventBus.emit(CONFIG_EVENTS.SEARCH_ENGINES_UPDATED, engines)
    } catch (error) {
      console.error('设置自定义搜索引擎失败:', error)
      throw error
    }
  }

  // 获取搜索预览设置状态
  getSearchPreviewEnabled(): Promise<boolean> {
    const value = this.getSetting<boolean>('searchPreviewEnabled')
    // 默认关闭搜索预览
    return Promise.resolve(value === undefined || value === null ? false : value)
  }

  // 设置搜索预览状态
  setSearchPreviewEnabled(enabled: boolean): void {
    console.log('ConfigPresenter.setSearchPreviewEnabled:', enabled, typeof enabled)

    // 确保传入的是布尔值
    const boolValue = Boolean(enabled)

    this.setSetting('searchPreviewEnabled', boolValue)
  }

  // 获取投屏保护设置状态
  getContentProtectionEnabled(): boolean {
    const value = this.getSetting<boolean>('contentProtectionEnabled')
    // 默认投屏保护关闭
    return value === undefined || value === null ? false : value
  }

  // 设置投屏保护状态
  setContentProtectionEnabled(enabled: boolean): void {
    this.setSetting('contentProtectionEnabled', enabled)
    eventBus.emit(CONFIG_EVENTS.CONTENT_PROTECTION_CHANGED, enabled)
  }

  // ===================== MCP配置相关方法 =====================

  // 获取MCP配置
  getMcpConfig(): Promise<{ mcpServers: Record<string, MCPServerConfig>; defaultServer: string }> {
    return this.mcpConfHelper.getMcpConfig()
  }

  // 设置MCP配置
  async setMcpConfig(config: {
    mcpServers: Record<string, MCPServerConfig>
    defaultServer: string
  }): Promise<void> {
    return this.mcpConfHelper.setMcpConfig(config)
  }

  // 添加MCP服务器
  async addMcpServer(name: string, config: MCPServerConfig): Promise<void> {
    return this.mcpConfHelper.addMcpServer(name, config)
  }

  // 移除MCP服务器
  async removeMcpServer(name: string): Promise<void> {
    return this.mcpConfHelper.removeMcpServer(name)
  }

  // 更新MCP服务器配置
  async updateMcpServer(name: string, config: Partial<MCPServerConfig>): Promise<void> {
    return this.mcpConfHelper.updateMcpServer(name, config)
  }

  // 设置默认MCP服务器
  async setDefaultServer(name: string): Promise<void> {
    return this.mcpConfHelper.setDefaultServer(name)
  }
}
