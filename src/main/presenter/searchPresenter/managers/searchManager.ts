import { app, BrowserWindow, screen } from 'electron'
import path from 'path'
import { SearchEngineTemplate } from '@shared/chat'
import { ContentEnricher } from '../../content/contentEnricher'
import type {
  IConfigPresenter,
  ILlmProviderPresenter,
  IWindowPresenter,
  MODEL_META,
  SearchResult
} from '@shared/presenter'
import { is } from '@electron-toolkit/utils'
import { eventBus } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'
import { jsonrepair } from 'jsonrepair'
import { SEARCH_PROMPT_TEMPLATE } from '../../searchPrompts/templates/searchPromptTemplate'

const helperPage = path.join(app.getAppPath(), 'resources', 'blankSearch.html')

// 抽取的脚本模板，使用占位符替代选择器
const EXTRACTOR_SCRIPT_TEMPLATE = `
  const results = [];
  const items = document.querySelectorAll('{{ITEMS_SELECTOR}}');
  items.forEach((item, index) => {
      try {
          const titleSelectorValue = '{{TITLE_SELECTOR}}';
          const titleEl = titleSelectorValue ? item.querySelector(titleSelectorValue) : null;

          const linkSelectorValue = '{{LINK_SELECTOR}}';
          const linkEl = linkSelectorValue ? item.querySelector(linkSelectorValue) : null;

          const descSelectorValue = '{{DESC_SELECTOR}}';
          const descEl = descSelectorValue ? item.querySelector(descSelectorValue) : null;

          const faviconSelectorValue = '{{FAVICON_SELECTOR}}';
          const faviconEl = faviconSelectorValue ? item.querySelector(faviconSelectorValue) : null;

          if (titleEl && linkEl) {
              results.push({
                  title: {{TITLE_EXTRACT}},
                  url: {{URL_EXTRACT}},
                  rank: index + 1,
                  description: descEl ? {{DESC_EXTRACT}} : '',
                  icon: {{ICON_EXTRACT}}
              });
          }
      } catch (e) {
          // 如果修改后仍然出现错误，那么可能是其他未预料到的问题
          console.error('Error processing item (unexpected with conditional selectors):', e);
      }
  });
  return results;
`

// 定义选择器配置的接口
interface SelectorConfig {
  itemsSelector: string
  titleSelector: string
  linkSelector: string
  descSelector: string
  faviconSelector: string
  titleExtract: string
  urlExtract: string
  descExtract: string
  iconExtract: string
}

const searchEngineSelectors: Record<string, SelectorConfig> = {
  sogou: {
    itemsSelector: '.news-list li',
    titleSelector: 'h3 a',
    linkSelector: 'h3 a',
    descSelector: 'p.txt-info',
    faviconSelector: 'a[data-z="art"] img',
    titleExtract: 'titleEl.textContent',
    urlExtract: 'linkEl.href',
    descExtract: 'descEl.textContent',
    iconExtract: "faviconEl ? faviconEl.src : ''"
  },
  google: {
    itemsSelector: '#search .MjjYud',
    titleSelector: 'h3',
    linkSelector: 'a',
    descSelector: '.VwiC3b',
    faviconSelector: 'img.XNo5Ab',
    titleExtract: 'titleEl.textContent',
    urlExtract: 'linkEl.href',
    descExtract: 'descEl.textContent',
    iconExtract: "faviconEl ? faviconEl.src : ''"
  },
  baidu: {
    itemsSelector: '#content_left .result',
    titleSelector: '.t',
    linkSelector: 'a',
    descSelector: '.c-abstract',
    faviconSelector: '.c-img',
    titleExtract: 'titleEl.textContent',
    urlExtract: 'linkEl.href',
    descExtract: 'descEl.textContent',
    iconExtract: "faviconEl ? faviconEl.getAttribute('src') : ''"
  },
  bing: {
    itemsSelector: '#b_results h2',
    titleSelector: 'h2 a',
    linkSelector: 'h2 a',
    descSelector: '.b_caption p',
    faviconSelector: '.wr_fav img',
    titleExtract: 'titleEl.textContent',
    urlExtract: 'linkEl.href',
    descExtract: 'descEl.textContent',
    iconExtract: "faviconEl?.src ? faviconEl.src : ''"
  },
  'google-scholar': {
    itemsSelector: '.gs_r',
    titleSelector: '.gs_rt',
    linkSelector: '.gs_rt a',
    descSelector: '.gs_rs',
    faviconSelector: '.gs_rt img',
    titleExtract: 'titleEl.textContent',
    urlExtract: 'linkEl.href',
    descExtract: 'descEl.textContent',
    iconExtract: "faviconEl ? faviconEl.src : ''"
  },
  'baidu-xueshu': {
    itemsSelector: '#bdxs_result_lists .sc_default_result',
    titleSelector: '.sc_content .t',
    linkSelector: '.sc_content a',
    descSelector: '.c_abstract',
    faviconSelector: '',
    titleExtract: 'titleEl.textContent?.trim()',
    urlExtract: 'linkEl.href',
    descExtract: 'descEl.textContent?.trim()',
    iconExtract: "''"
  },
  duckduckgo: {
    itemsSelector: 'article.yQDlj3B5DI5YO8c8Ulio',
    titleSelector: '.EKtkFWMYpwzMKOYr0GYm.LQVY1Jpkk8nyJ6HBWKAk',
    linkSelector: 'a',
    descSelector: '.E2eLOJr8HctVnDOTM8fs',
    faviconSelector: '.DpVR46dTZaePK29PDkz8 img',
    titleExtract: 'titleEl.textContent',
    urlExtract: 'linkEl.href',
    descExtract: 'descEl.textContent',
    iconExtract: "faviconEl ? faviconEl.src : ''"
  }
}

// 根据选择器配置生成提取脚本
function generateExtractorScript(selectorConfig: SelectorConfig): string {
  return EXTRACTOR_SCRIPT_TEMPLATE.replace('{{ITEMS_SELECTOR}}', selectorConfig.itemsSelector)
    .replace('{{TITLE_SELECTOR}}', selectorConfig.titleSelector)
    .replace('{{LINK_SELECTOR}}', selectorConfig.linkSelector)
    .replace('{{DESC_SELECTOR}}', selectorConfig.descSelector)
    .replace('{{FAVICON_SELECTOR}}', selectorConfig.faviconSelector)
    .replace('{{TITLE_EXTRACT}}', selectorConfig.titleExtract)
    .replace('{{URL_EXTRACT}}', selectorConfig.urlExtract)
    .replace('{{DESC_EXTRACT}}', selectorConfig.descExtract)
    .replace('{{ICON_EXTRACT}}', selectorConfig.iconExtract)
}

// 生成完整的搜索引擎配置
function generateDefaultEngines() {
  return [
    {
      id: 'sogou',
      name: 'sogou',
      selector: '.news-list',
      searchUrl:
        'https://weixin.sogou.com/weixin?ie=utf8&s_from=input&_sug_=y&_sug_type_=&type=2&query={query}',
      extractorScript: generateExtractorScript(searchEngineSelectors['sogou'])
    },
    {
      id: 'google',
      name: 'google',
      selector: '#search',
      searchUrl: 'https://www.google.com/search?q={query}',
      extractorScript: generateExtractorScript(searchEngineSelectors['google'])
    },
    {
      id: 'baidu',
      name: 'baidu',
      selector: '#content_left',
      searchUrl: 'https://www.baidu.com/s?wd={query}',
      extractorScript: generateExtractorScript(searchEngineSelectors['baidu'])
    },
    {
      id: 'bing',
      name: 'bing',
      selector: '',
      searchUrl: 'https://www.bing.com/search?q={query}',
      extractorScript: generateExtractorScript(searchEngineSelectors['bing'])
    },
    {
      id: 'google-scholar',
      name: 'google-scholar',
      selector: '#gs_res_ccl',
      searchUrl: 'https://scholar.google.com/scholar?q={query}',
      extractorScript: generateExtractorScript(searchEngineSelectors['google-scholar'])
    },
    {
      id: 'baidu-xueshu',
      name: 'baidu-xueshu',
      selector: '#bdxs_result_lists',
      searchUrl: 'https://xueshu.baidu.com/s?wd={query}',
      extractorScript: generateExtractorScript(searchEngineSelectors['baidu-xueshu'])
    },
    {
      id: 'duckduckgo',
      name: 'duckduckgo',
      selector: 'button.cxQwADb9kt3UnKwcXKat',
      searchUrl: 'https://duckduckgo.com/?q={query}',
      extractorScript: generateExtractorScript(searchEngineSelectors['duckduckgo'])
    }
  ]
}

// 初始化默认搜索引擎
const defaultEngines = generateDefaultEngines()

// 格式化搜索结果的函数
export function formatSearchResults(results: SearchResult[]): string {
  const formattedResults = results
    .map(
      (result, index) => `[webpage ${index + 1} begin]
title: ${result.title}
URL: ${result.url}
content：${result.content || ''}
[webpage ${index + 1} end]`
    )
    .join('\n\n')
  // 记录格式化后的搜索结果
  // console.log('formattedResults:', formattedResults)
  return formattedResults
}
// 生成带搜索结果的提示词
export function generateSearchPrompt(query: string, results: SearchResult[]): string {
  if (results.length > 0) {
    const searchPrompt = SEARCH_PROMPT_TEMPLATE.replace(
      '{{SEARCH_RESULTS}}',
      formatSearchResults(results)
    )
      .replace('{{USER_QUERY}}', query)
      .replace('{{CUR_DATE}}', new Date().toLocaleDateString())

    // 记录最终生成的提示词
    console.log('generateSearchPrompt', searchPrompt)

    return searchPrompt
  } else {
    return query
  }
}

export class SearchManager {
  private readonly configPresenter: IConfigPresenter
  private readonly windowPresenter: IWindowPresenter
  private readonly llmProviderPresenter: ILlmProviderPresenter
  private readonly getSearchAssistantModel: () => MODEL_META | null
  private readonly getSearchAssistantProviderId: () => string | null
  private searchWindows: Map<string, BrowserWindow> = new Map()
  private maxConcurrentSearches = 3
  private engines: SearchEngineTemplate[] = defaultEngines
  private activeEngine: SearchEngineTemplate = this.engines[0]
  private originalWindowSizes: Map<string, { width: number; height: number }> = new Map()
  private originalWindowPositions: Map<string, { x: number; y: number }> = new Map()
  private wasFullScreen: Map<string, boolean> = new Map()
  private searchWindowWidth = 800
  private abortControllers: Map<string, AbortController> = new Map()
  private lastEnginesUpdateTime = 0
  // 保存当前正在使用的选择器配置
  private currentSelectors = { ...searchEngineSelectors }

  constructor(options: {
    configPresenter: IConfigPresenter
    windowPresenter: IWindowPresenter
    llmProviderPresenter: ILlmProviderPresenter
    getSearchAssistantModel?: () => MODEL_META | null
    getSearchAssistantProviderId?: () => string | null
  }) {
    this.configPresenter = options.configPresenter
    this.windowPresenter = options.windowPresenter
    this.llmProviderPresenter = options.llmProviderPresenter
    this.getSearchAssistantModel = options.getSearchAssistantModel ?? (() => null)
    this.getSearchAssistantProviderId = options.getSearchAssistantProviderId ?? (() => null)
    // 初始化搜索管理器
    this.setupEventListeners()
  }

  /**
   * 设置事件监听器，监听搜索引擎更新事件
   */
  private setupEventListeners(): void {
    // 监听搜索引擎更新事件
    eventBus.on(CONFIG_EVENTS.SEARCH_ENGINES_UPDATED, () => {
      // 标记需要刷新引擎列表
      this.lastEnginesUpdateTime = 0
    })
  }

  /**
   * 获取搜索引擎列表，包括默认引擎和自定义引擎
   */
  async getEngines(): Promise<SearchEngineTemplate[]> {
    await this.ensureEnginesUpdated()
    return this.engines
  }

  /**
   * 获取当前活跃的搜索引擎
   */
  getActiveEngine(): SearchEngineTemplate {
    return this.activeEngine
  }

  /**
   * 设置活跃搜索引擎
   * @param engineId 搜索引擎ID
   */
  async setActiveEngine(engineId: string): Promise<boolean> {
    console.log('setActiveEngine', engineId)
    const engine = this.engines.find((e) => e.id === engineId)
    if (engine) {
      this.activeEngine = engine
      // 保存搜索引擎选择到配置中
      await this.configPresenter.setSetting('searchEngine', engineId)
      return true
    }
    return false
  }

  /**
   * 更新搜索引擎列表
   * @param newEngines 新的搜索引擎列表
   */
  async updateEngines(newEngines: SearchEngineTemplate[]): Promise<void> {
    // 保存当前活跃引擎ID
    const activeEngineId = this.activeEngine.id

    // 更新引擎列表
    this.engines = newEngines

    // 尝试保持当前活跃引擎
    const engine = this.engines.find((e) => e.id === activeEngineId)
    if (engine) {
      this.activeEngine = engine
    } else {
      // 如果当前活跃引擎不在新列表中，选择第一个引擎
      this.activeEngine = this.engines[0]
    }

    // 更新自定义引擎到配置
    await this.updateCustomEnginesToConfig()

    // 更新时间戳
    this.lastEnginesUpdateTime = Date.now()
  }

  async addCustomEngine(engine: SearchEngineTemplate): Promise<void> {
    await this.ensureEnginesUpdated()
    const updated = this.engines.filter((item) => item.id !== engine.id)
    updated.push({ ...engine, isCustom: true })
    await this.updateEngines(updated)
  }

  async removeCustomEngine(engineId: string): Promise<void> {
    await this.ensureEnginesUpdated()
    const updated = this.engines.filter((engine) => engine.id !== engineId)
    await this.updateEngines(updated)
  }

  /**
   * 确保引擎列表是最新的，如果需要就更新
   */
  private async ensureEnginesUpdated(): Promise<void> {
    console.log('ensureEnginesUpdated', this.lastEnginesUpdateTime)
    // 如果上次更新时间是0或者距离现在超过24小时，则更新引擎列表
    const currentTime = Date.now()
    if (
      this.lastEnginesUpdateTime === 0 ||
      currentTime - this.lastEnginesUpdateTime > 24 * 60 * 60 * 1000
    ) {
      await this.refreshEngines()
    }
  }

  /**
   * 刷新引擎列表，合并默认引擎和自定义引擎
   */
  private async refreshEngines(): Promise<void> {
    try {
      const configPresenter = this.configPresenter

      // 获取自定义搜索引擎
      const customEngines = await configPresenter.getCustomSearchEngines()

      // 尝试获取云端选择器配置，预留接口，方便二次开发的时候下发配置
      this.refreshSelectorsFromCloud()

      // 重新生成默认引擎
      const updatedDefaultEngines = this.regenerateDefaultEngines()

      if (customEngines && customEngines.length > 0) {
        // 记住当前活跃引擎ID
        const activeEngineId = this.activeEngine.id

        // 合并更新后的默认引擎和自定义引擎
        this.engines = [...updatedDefaultEngines, ...customEngines]

        // 尝试保持当前活跃引擎
        const engine = this.engines.find((e) => e.id === activeEngineId)
        if (engine) {
          this.activeEngine = engine
        }
      } else {
        // 没有自定义引擎，使用更新后的默认引擎
        this.engines = updatedDefaultEngines
      }

      // 更新时间戳
      this.lastEnginesUpdateTime = Date.now()
    } catch (error) {
      console.error('刷新搜索引擎列表失败:', error)
    }
  }

  /**
   * 从云端获取最新的选择器配置
   */
  private async refreshSelectorsFromCloud(): Promise<void> {
    try {
      // 这里添加从云端获取选择器配置的逻辑
      // 例如通过API调用或配置服务获取
      const cloudSelectors = await this.fetchSelectorsFromCloud()

      if (cloudSelectors) {
        // 安全地合并云端选择器和本地默认选择器
        this.updateSelectorsConfig(cloudSelectors)
      }
    } catch (error) {
      console.error('从云端获取选择器配置失败:', error)
      // 出错时继续使用当前选择器配置
    }
  }

  /**
   * 模拟从云端获取选择器配置的方法
   * 实际实现时，这里应该是一个真正的API调用
   */
  private async fetchSelectorsFromCloud(): Promise<Record<string, Partial<SelectorConfig>> | null> {
    try {
      // 这里只是一个示例，方便二次开发的用户需要下发配置的情况
      // 例如:
      // const response = await fetch('https://your-api.com/search-selectors')
      // if (response.ok) {
      //   return await response.json()
      // }

      // 目前返回null，表示没有云端配置
      return null
    } catch (error) {
      console.error('获取云端选择器配置失败:', error)
      return null
    }
  }

  /**
   * 安全地更新选择器配置
   * 确保云端下发的选择器不会包含恶意代码
   */
  private updateSelectorsConfig(cloudSelectors: Record<string, Partial<SelectorConfig>>): void {
    // 创建一个新的选择器配置对象
    const updatedSelectors = { ...this.currentSelectors }

    // 遍历云端选择器
    for (const [engineId, cloudSelector] of Object.entries(cloudSelectors)) {
      // 检查是否已有此引擎的本地配置
      if (updatedSelectors[engineId]) {
        // 安全地更新字段，只允许特定字段
        const safeFields = [
          'itemsSelector',
          'titleSelector',
          'linkSelector',
          'descSelector',
          'faviconSelector'
        ] as const

        // 只更新安全字段，忽略其他字段
        for (const field of safeFields) {
          if (typeof cloudSelector[field] === 'string') {
            // 进行必要的安全检查，例如检查是否包含脚本标签或危险属性
            const sanitizedValue = this.sanitizeSelector(cloudSelector[field] as string)
            updatedSelectors[engineId][field] = sanitizedValue
          }
        }

        // 对于提取逻辑的字段，采用更严格的安全措施
        const extractFields = ['titleExtract', 'urlExtract', 'descExtract', 'iconExtract'] as const

        for (const field of extractFields) {
          if (typeof cloudSelector[field] === 'string') {
            // 验证提取表达式是否安全
            const safeExtract = this.validateExtractExpression(cloudSelector[field] as string)
            if (safeExtract) {
              updatedSelectors[engineId][field] = safeExtract
            }
          }
        }
      } else if (this.isValidSelectorConfig(cloudSelector)) {
        // 如果是新的引擎配置，验证完整性和安全性后添加
        updatedSelectors[engineId] = this.sanitizeSelectorConfig(cloudSelector)
      }
    }

    // 更新当前选择器配置
    this.currentSelectors = updatedSelectors
  }

  /**
   * 验证一个完整的选择器配置是否有效
   */
  private isValidSelectorConfig(config: Partial<SelectorConfig>): boolean {
    // 检查所有必需字段是否存在且类型正确
    const requiredFields = [
      'itemsSelector',
      'titleSelector',
      'linkSelector',
      'titleExtract',
      'urlExtract'
    ] as const

    for (const field of requiredFields) {
      if (typeof config[field] !== 'string' || !config[field]) {
        return false
      }
    }

    // 验证提取表达式是否安全
    return (
      this.validateExtractExpression(config.titleExtract as string) !== null &&
      this.validateExtractExpression(config.urlExtract as string) !== null
    )
  }

  /**
   * 对一个完整的选择器配置进行安全处理
   */
  private sanitizeSelectorConfig(config: Partial<SelectorConfig>): SelectorConfig {
    const safeConfig: SelectorConfig = {
      itemsSelector: '',
      titleSelector: '',
      linkSelector: '',
      descSelector: '',
      faviconSelector: '',
      titleExtract: 'null',
      urlExtract: 'null',
      descExtract: 'null',
      iconExtract: 'null'
    }

    // 安全处理选择器字段
    const selectorFields = [
      'itemsSelector',
      'titleSelector',
      'linkSelector',
      'descSelector',
      'faviconSelector'
    ] as const

    for (const field of selectorFields) {
      safeConfig[field] =
        typeof config[field] === 'string' ? this.sanitizeSelector(config[field] as string) : ''
    }

    // 安全处理提取表达式字段
    const extractFields = ['titleExtract', 'urlExtract', 'descExtract', 'iconExtract'] as const

    for (const field of extractFields) {
      const safeExtract =
        typeof config[field] === 'string'
          ? this.validateExtractExpression(config[field] as string)
          : null

      safeConfig[field] = safeExtract || 'null'
    }

    return safeConfig
  }

  /**
   * 清理选择器字符串，防止XSS攻击
   */
  private sanitizeSelector(selector: string): string {
    // 移除可能的JavaScript代码或事件处理器
    const sanitized = selector
      .replace(/javascript:|data:|<script|onerror=|onload=/gi, '')
      // 只允许合法的CSS选择器字符
      .replace(/[^\w\s#.[\]()='":_,>+~-]/g, '')

    return sanitized
  }

  /**
   * 验证并清理提取表达式
   * 只允许简单的属性访问表达式，如：
   * - titleEl.textContent
   * - linkEl.href
   * - element ? element.src : ''
   */
  private validateExtractExpression(expression: string): string | null {
    // 极其严格的验证，只允许访问以下安全属性
    const safePattern =
      /^(titleEl|linkEl|descEl|faviconEl)(\?|\.)?((textContent|innerText|href|src)|getAttribute\(['"]src['"]\))( \? (titleEl|linkEl|descEl|faviconEl)(\?|\.)?(textContent|innerText|href|src) : ['"].*['"])?$/

    if (safePattern.test(expression)) {
      return expression
    }

    // 简单的三元表达式
    const ternaryPattern = /^[a-zA-Z]+\s*\?\s*[a-zA-Z]+\.[a-zA-Z]+\s*:\s*['"][^'"]*['"]$/
    if (ternaryPattern.test(expression)) {
      return expression
    }

    // 字符串字面量也是安全的
    if (/^['"][^'"]*['"]$/.test(expression)) {
      return expression
    }

    // 以上模式都不匹配，返回null表示表达式不安全
    return null
  }

  /**
   * 使用当前的选择器配置重新生成默认引擎
   */
  private regenerateDefaultEngines(): SearchEngineTemplate[] {
    return [
      {
        id: 'sogou',
        name: 'sogou',
        selector: '.news-list',
        searchUrl:
          'https://weixin.sogou.com/weixin?ie=utf8&s_from=input&_sug_=y&_sug_type_=&type=2&query={query}',
        extractorScript: generateExtractorScript(this.currentSelectors['sogou'])
      },
      {
        id: 'google',
        name: 'google',
        selector: '#search',
        searchUrl: 'https://www.google.com/search?q={query}',
        extractorScript: generateExtractorScript(this.currentSelectors['google'])
      },
      {
        id: 'baidu',
        name: 'baidu',
        selector: '#content_left',
        searchUrl: 'https://www.baidu.com/s?wd={query}',
        extractorScript: generateExtractorScript(this.currentSelectors['baidu'])
      },
      {
        id: 'bing',
        name: 'bing',
        selector: '',
        searchUrl: 'https://www.bing.com/search?q={query}',
        extractorScript: generateExtractorScript(this.currentSelectors['bing'])
      },
      {
        id: 'google-scholar',
        name: 'google-scholar',
        selector: '#gs_res_ccl',
        searchUrl: 'https://scholar.google.com/scholar?q={query}',
        extractorScript: generateExtractorScript(this.currentSelectors['google-scholar'])
      },
      {
        id: 'baidu-xueshu',
        name: 'baidu-xueshu',
        selector: '#bdxs_result_lists',
        searchUrl: 'https://xueshu.baidu.com/s?wd={query}',
        extractorScript: generateExtractorScript(this.currentSelectors['baidu-xueshu'])
      },
      {
        id: 'duckduckgo',
        name: 'duckduckgo',
        selector: 'button.cxQwADb9kt3UnKwcXKat',
        searchUrl: 'https://duckduckgo.com/?q={query}',
        extractorScript: generateExtractorScript(this.currentSelectors['duckduckgo'])
      }
    ]
  }

  /**
   * 将当前的自定义搜索引擎更新到配置中
   */
  private async updateCustomEnginesToConfig(): Promise<void> {
    try {
      // 提取所有标记为自定义的引擎
      const customEngines = this.engines.filter((engine) => engine.isCustom)

      // 更新到配置
      if (customEngines.length > 0) {
        const configPresenter = this.configPresenter
        await configPresenter.setCustomSearchEngines(customEngines)
      }
    } catch (error) {
      console.error('更新自定义搜索引擎到配置失败:', error)
    }
  }

  private async initSearchWindow(conversationId: string): Promise<BrowserWindow> {
    // 直接从 ConfigPresenter 获取搜索预览设置状态
    const searchPreviewEnabled = await this.configPresenter.getSearchPreviewEnabled()

    // 如果搜索预览关闭，创建一个隐藏的窗口
    if (!searchPreviewEnabled) {
      const searchWindow = new BrowserWindow({
        width: this.searchWindowWidth,
        height: 800,
        show: false, // 窗口不显示
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          devTools: is.dev
        }
      })

      searchWindow.webContents.session.webRequest.onBeforeSendHeaders(
        { urls: ['*://*/*'] },
        (details, callback) => {
          const headers = {
            ...details.requestHeaders,
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
          callback({ requestHeaders: headers })
        }
      )

      this.searchWindows.set(conversationId, searchWindow)
      return searchWindow
    }

    // 下面是原始代码，当预览启用时执行
    if (this.searchWindows.size >= this.maxConcurrentSearches) {
      // 找到最早创建的窗口并销毁
      const [oldestConversationId] = this.searchWindows.keys()
      this.destroySearchWindow(oldestConversationId)
    }
    const mainWindow = this.windowPresenter.mainWindow

    // 确保mainWindow存在
    if (!mainWindow) {
      console.error('主窗口不存在，无法创建搜索窗口')
      throw new Error('主窗口不存在')
    }

    // 检查是否处于全屏状态
    const isFullScreen = mainWindow.isFullScreen()
    this.wasFullScreen.set(conversationId, isFullScreen)

    // 如果是全屏，先退出全屏
    if (isFullScreen) {
      // 保存全屏前的位置和大小（如果可能的话）
      this.originalWindowSizes.set(conversationId, {
        width: mainWindow.getBounds().width,
        height: mainWindow.getBounds().height
      })
      this.originalWindowPositions.set(conversationId, {
        x: mainWindow.getBounds().x,
        y: mainWindow.getBounds().y
      })

      // 退出全屏并等待完成
      mainWindow.setFullScreen(false)

      // 等待退出全屏完成
      await new Promise<void>((resolve) => {
        const checkFullScreenState = () => {
          if (!mainWindow.isFullScreen()) {
            resolve()
          } else {
            setTimeout(checkFullScreenState, 100)
          }
        }
        checkFullScreenState()
      })

      // 给界面一些时间来重新布局
      await new Promise((resolve) => setTimeout(resolve, 200))
    } else {
      // 不是全屏模式，正常保存当前主窗口位置和大小信息
      this.originalWindowPositions.set(conversationId, {
        x: mainWindow.getBounds().x,
        y: mainWindow.getBounds().y
      })
      this.originalWindowSizes.set(conversationId, {
        width: mainWindow.getBounds().width,
        height: mainWindow.getBounds().height
      })
    }

    // 获取当前屏幕可用空间
    const mainWindowBounds = mainWindow.getBounds()
    const displayBounds = screen.getDisplayMatching(mainWindowBounds).workArea

    // 检查是否右侧有足够空间
    const rightSpace =
      displayBounds.x + displayBounds.width - (mainWindowBounds.x + mainWindowBounds.width)
    const needsAdjustment = rightSpace < this.searchWindowWidth + 20 // 加20px作为间隔

    // 如果需要调整窗口
    if (needsAdjustment) {
      // 在全屏模式下退出全屏后，优先采用两个窗口铺满屏幕的方式
      if (isFullScreen) {
        const totalWidth = displayBounds.width
        const mainWindowWidth = Math.floor(totalWidth * 0.6) // 主窗口占60%
        const searchWindowWidth = Math.floor(totalWidth * 0.4) // 搜索窗口占40%
        this.searchWindowWidth = searchWindowWidth

        // 设置主窗口尺寸和位置（使用Electron内置动画）
        mainWindow.setBounds(
          {
            x: displayBounds.x,
            y: displayBounds.y,
            width: mainWindowWidth,
            height: displayBounds.height
          },
          true
        ) // 添加true启用动画
      } else {
        // 非全屏模式下的调整逻辑
        // 计算左移窗口所需的空间
        const neededSpace = this.searchWindowWidth + 20 - rightSpace

        // 检查左侧是否有足够空间移动窗口
        const availableLeftSpace = mainWindowBounds.x - displayBounds.x

        // 优先移动窗口位置
        if (availableLeftSpace >= neededSpace) {
          // 有足够空间移动窗口位置
          const newX = Math.max(displayBounds.x, mainWindowBounds.x - neededSpace)
          // 使用Electron内置动画
          mainWindow.setPosition(newX, mainWindowBounds.y, true) // 添加true启用动画
        } else {
          // 左侧空间不足，结合移动和缩放
          // 先尽可能地移动窗口
          if (availableLeftSpace > 0) {
            mainWindow.setPosition(displayBounds.x, mainWindowBounds.y, true) // 添加true启用动画
          }

          // 计算需要缩放的大小
          const remainingNeededSpace = neededSpace - availableLeftSpace
          if (remainingNeededSpace > 0) {
            // 还需要缩放窗口
            const newWidth = Math.max(
              400, // 最小主窗口宽度
              mainWindowBounds.width - remainingNeededSpace
            )
            // 使用Electron内置动画
            mainWindow.setSize(newWidth, mainWindowBounds.height, true) // 添加true启用动画
          }
        }
      }

      // 给窗口一些时间来完成动画
      await new Promise((resolve) => setTimeout(resolve, 300))
    }

    console.log('creating search window')
    // 创建搜索窗口
    const searchWindow = new BrowserWindow({
      width: this.searchWindowWidth,
      height: isFullScreen ? displayBounds.height : mainWindowBounds.height,
      parent: mainWindow,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        devTools: is.dev
      }
    })

    // 获取调整后的主窗口位置
    const updatedMainBounds = mainWindow.getBounds()

    // 设置搜索窗口位置在主窗口右侧
    searchWindow.setPosition(updatedMainBounds.x + updatedMainBounds.width, updatedMainBounds.y)

    searchWindow.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: ['*://*/*'] },
      (details, callback) => {
        const headers = {
          ...details.requestHeaders,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        callback({ requestHeaders: headers })
      }
    )
    if (is.dev) {
      searchWindow.webContents.openDevTools({ mode: 'detach' })
    }
    this.searchWindows.set(conversationId, searchWindow)
    return searchWindow
  }

  private async destroySearchWindow(conversationId: string) {
    const window = this.searchWindows.get(conversationId)
    if (window) {
      window.destroy()
      this.searchWindows.delete(conversationId)

      // 直接从 ConfigPresenter 获取搜索预览设置状态
      const searchPreviewEnabled = await this.configPresenter.getSearchPreviewEnabled()

      // 如果搜索预览未启用，不需要恢复主窗口状态
      if (!searchPreviewEnabled) {
        return
      }

      // 恢复主窗口原始位置和大小
      const originalSize = this.originalWindowSizes.get(conversationId)
      const originalPosition = this.originalWindowPositions.get(conversationId)
      const wasFullScreen = this.wasFullScreen.get(conversationId)

      if (originalSize && originalPosition) {
        const mainWindow = this.windowPresenter.mainWindow
        if (mainWindow) {
          if (wasFullScreen) {
            // 如果原来是全屏，先恢复原始尺寸和位置，再进入全屏
            mainWindow.setBounds(
              {
                x: originalPosition.x,
                y: originalPosition.y,
                width: originalSize.width,
                height: originalSize.height
              },
              true
            ) // 添加true启用动画

            // 给UI一些时间来适应新尺寸
            await new Promise((resolve) => setTimeout(resolve, 300))

            // 重新进入全屏
            mainWindow.setFullScreen(true)
          } else {
            // 非全屏模式下平滑恢复
            mainWindow.setBounds(
              {
                x: originalPosition.x,
                y: originalPosition.y,
                width: originalSize.width,
                height: originalSize.height
              },
              true
            ) // 添加true启用动画
          }
        }

        this.originalWindowSizes.delete(conversationId)
        this.originalWindowPositions.delete(conversationId)
        this.wasFullScreen.delete(conversationId)
      }
    }
  }

  async search(conversationId: string, query: string): Promise<SearchResult[]> {
    // 确保引擎列表是最新的
    // await this.ensureEnginesUpdated()

    // 创建用于可能中断搜索的 AbortController
    const abortController = new AbortController()
    this.abortControllers.set(conversationId, abortController)

    let searchWindow = this.searchWindows.get(conversationId)
    if (!searchWindow) {
      searchWindow = await this.initSearchWindow(conversationId)
    }

    const searchUrl = this.activeEngine.searchUrl.replace('{query}', encodeURIComponent(query))
    console.log('开始加载搜索URL:', searchUrl)

    const loadTimeout = setTimeout(() => {
      searchWindow?.webContents.stop()
    }, 8000)

    try {
      // 检查是否已经被中止
      if (abortController.signal.aborted) {
        throw new Error('搜索已被用户取消')
      }

      await searchWindow.loadURL(searchUrl)
      console.log('搜索URL加载成功')
    } catch (error) {
      console.error('加载URL失败:', error)
      if (abortController.signal.aborted) {
        // 如果是用户取消导致的错误，直接返回空结果
        this.destroySearchWindow(conversationId)
        this.abortControllers.delete(conversationId)
        return []
      }
    } finally {
      clearTimeout(loadTimeout)
    }

    // 检查是否已经被中止
    if (abortController.signal.aborted) {
      this.destroySearchWindow(conversationId)
      this.abortControllers.delete(conversationId)
      return []
    }
    if (this.activeEngine.selector) {
      await this.waitForSelector(searchWindow, this.activeEngine.selector)
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    console.log('搜索结果加载完成')

    // 检查是否已经被中止
    if (abortController.signal.aborted) {
      this.destroySearchWindow(conversationId)
      this.abortControllers.delete(conversationId)
      return []
    }

    const results = await this.extractSearchResults(searchWindow)
    console.log('搜索结果提取完成:', results?.length)

    // 检查是否已经被中止
    if (abortController.signal.aborted) {
      this.destroySearchWindow(conversationId)
      this.abortControllers.delete(conversationId)
      return []
    }

    const enrichedResults = await this.enrichResults(results.slice(0, 5))
    console.log('详细内容获取完成')

    // 清理资源
    this.abortControllers.delete(conversationId)

    searchWindow
      .loadFile(helperPage)
      .then(() => {
        this.destroySearchWindow(conversationId)
      })
      .catch((error) => {
        console.error('加载空白页失败:', error)
        this.destroySearchWindow(conversationId)
      })
    const remainingResults = results.slice(5) // 获取剩余的结果
    const combinedResults = [...enrichedResults, ...remainingResults] // 合并enrichedResults和剩余的results
    return combinedResults
  }

  private async waitForSelector(window: BrowserWindow, selector: string): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve() // 12秒后自动返回
      }, 12000)
      // 如果selector不为空，就等待selector出现
      if (selector) {
        window.webContents
          .executeJavaScript(
            `
        new Promise((innerResolve) => {
          if (document.querySelector('${selector}')) {
            innerResolve();
          } else {
            const observer = new MutationObserver(() => {
              if (document.querySelector('${selector}')) {
                observer.disconnect();
                innerResolve();
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });
          }
        })
      `
          )
          .then(() => {
            resolve()
          })
          .catch(() => {
            resolve()
          })

        clearTimeout(timeout)
        resolve()
      }
    })
  }

  private async extractSearchResults(window: BrowserWindow): Promise<SearchResult[]> {
    try {
      // 0. 模拟页面滚动，模拟真实阅读体验
      this.simulatePageScrolling(window)
      console.log('extraing', this.activeEngine.id)
      const results = await window.webContents.executeJavaScript(`
        (function() {
          ${this.activeEngine.extractorScript}
        })()
      `)
      // 如果结果为空或长度为0，尝试使用备用方法
      if (!results || results.length === 0) {
        console.log('常规提取方法未返回结果，尝试使用备用方法')
        return await this.fallbackExtractSearchResults(window)
      }

      return results
    } catch (error) {
      console.error('提取搜索结果失败:', error)
      // 出错时也使用备用方法
      return []
    }
  }

  /**
   * 备用的搜索结果提取方法，当标准提取方法失败时使用
   * 使用AI模型分析页面内容提取搜索结果
   */
  private async fallbackExtractSearchResults(window: BrowserWindow): Promise<SearchResult[]> {
    try {
      // 1. 执行JS提取当前页面的body内容并清理不相关元素
      const cleanedHtml = await window.webContents.executeJavaScript(`
        (function() {
          // 克隆body以避免直接修改页面
          const tempDiv = document.createElement('div')
          tempDiv.innerHTML = document.body.innerHTML

          // 移除不需要的元素
          const elementsToRemove = tempDiv.querySelectorAll('script, style, svg, iframe, nav, footer, header')
          elementsToRemove.forEach(el => el.parentNode.removeChild(el))

          // 移除广告相关元素
          const adElements = tempDiv.querySelectorAll('[class*="ad"], [id*="ad"], [class*="banner"], [class*="popup"]')
          adElements.forEach(el => el.parentNode.removeChild(el))

          // 移除隐藏元素
          const hiddenElements = tempDiv.querySelectorAll('[style*="display: none"], [style*="display:none"], [style*="visibility: hidden"]')
          hiddenElements.forEach(el => el.parentNode.removeChild(el))
          // 移除footer元素
          const footerElements = tempDiv.querySelectorAll('footer')
          footerElements.forEach(el => el.parentNode.removeChild(el))
          // 移除header元素
          const headerElements = tempDiv.querySelectorAll('header')
          headerElements.forEach(el => el.parentNode.removeChild(el))
          // 移除footer的class
          const footerClassElements = tempDiv.querySelectorAll('.footer')
          footerClassElements.forEach(el => el.parentNode.removeChild(el))
          // 移除可能是sidebar的元素
          const sidebarElements = tempDiv.querySelectorAll('.side-bar, .sidebar, [class*="sidebar"]')
          sidebarElements.forEach(el => el.parentNode.removeChild(el))
          // 返回清理后的HTML
          return tempDiv.innerHTML
        })()
      `)

      // 获取页面URL（用于转换相对链接为绝对链接）
      const pageUrl = await window.webContents.getURL()
      const pageTitle = await window.webContents.executeJavaScript(`document.title`)

      console.log('转换前的HTML长度:', cleanedHtml.length)
      // 2. 使用ContentEnricher将HTML转换为Markdown
      let markdownContent = ContentEnricher.convertHtmlToMarkdown(cleanedHtml, pageUrl)
      console.log('转换后的Markdown长度:', markdownContent.length)

      // 限制markdown长度，避免过大
      const maxMarkdownLength = 10000
      if (markdownContent.length > maxMarkdownLength) {
        markdownContent = markdownContent.substring(0, maxMarkdownLength)
      }

      // 3. 构建提示词，使用AI模型提取搜索结果
      const prompt = `
        请分析<search_result>标签中的搜索引擎返回的markdown内容，并提取出所有搜索结果。每个搜索结果应包含以下字段：
        - title: 结果标题
        - url: 结果链接URL
        - rank: 结果的序号(从1开始)
        - description: 结果描述或摘要
        - icon: 结果的图标URL(如果存在)

        搜索页面URL: ${pageUrl}
        搜索页面标题: ${pageTitle}

        请使用以下JSON数组格式返回结果：
        [
          {
            "title": "结果标题",
            "url": "结果链接",
            "rank": 1,
            "description": "结果描述",
            "icon": "图标URL"
          },
          {
            "title": "结果标题2",
            "url": "结果链接2",
            "rank": 2,
            "description": "结果描述2",
            "icon": "图标URL2"
          },
          ...
        ]

        重要提示：
        1. 仅返回有效的搜索结果，忽略广告、推荐内容等。
        2. 确保返回的是有效的JSON格式。
        3. 请尽可能提取出完整的URL，如果链接是相对路径，请基于搜索页面URL构建完整URL。
        4. 如果无法找到某个字段，请使用空字符串代替。
        5. 请只返回JSON数组，不要返回其他说明文字。
        6. 如果提取不到结果，请返回空数组[]。

        <search_result>
        ${markdownContent}
        </search_result>
      `

      // 4. 使用AI模型进行分析
      const searchAssistantModel = this.getSearchAssistantModel()
      const searchAssistantProviderId = this.getSearchAssistantProviderId()
      if (!searchAssistantModel || !searchAssistantProviderId) {
        throw new Error('搜索助手模型或提供商ID未设置')
      }
      const modelResponse = await this.llmProviderPresenter.generateCompletion(
        searchAssistantProviderId,
        [
          {
            role: 'user',
            content: prompt
          }
        ],
        searchAssistantModel.id || '',
        0.4
      )
      console.log('模型返回的内容:', modelResponse?.length)

      // 5. 解析模型返回的内容
      try {
        // 尝试解析JSON
        const jsonStart = modelResponse.indexOf('[')
        const jsonEnd = modelResponse.lastIndexOf(']') + 1

        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          const jsonStr = modelResponse.substring(jsonStart, jsonEnd)
          const results = JSON.parse(jsonStr)

          // 验证结果格式
          if (Array.isArray(results) && results.length > 0) {
            console.log('AI模型成功提取到搜索结果:', results.length)
            return results
          }
        } else if (jsonStart >= 0) {
          // 找到了开始的 '[' 但没有找到匹配的结束 ']'
          // 这种情况下尝试逐个解析JSON对象

          // 从jsonStart开始的子字符串
          const incompleteJsonStr = modelResponse.substring(jsonStart)

          // 结果数组
          let results: SearchResult[] = []
          try {
            console.log('try to repair json')
            results = JSON.parse(jsonrepair(incompleteJsonStr))
          } catch (e: unknown) {
            console.error('Error parsing AI model response:', e)
            results = []
          }

          if (results.length > 0) {
            console.log('成功从不完整JSON中提取到搜索结果:', results.length)
            return results
          }
        }

        // 如果无法解析为JSON或格式不正确
        console.warn('AI模型返回的内容无法解析为有效的搜索结果')
        return []
      } catch (error) {
        console.error('解析AI模型返回内容失败:', error)
        return []
      }
    } catch (error) {
      console.error('备用提取方法失败:', error)
      return []
    }
  }

  /**
   * 模拟页面滚动，增强用户体验
   * @param window 浏览器窗口
   */
  private async simulatePageScrolling(window: BrowserWindow): Promise<void> {
    try {
      // 获取页面高度
      const pageHeight = await window.webContents.executeJavaScript(`
        document.body.scrollHeight
      `)

      // 获取视窗高度
      const viewportHeight = await window.webContents.executeJavaScript(`
        window.innerHeight
      `)

      // 页面总高度
      const totalHeight = Math.max(pageHeight, 1000)

      // 计算滚动次数和每次滚动的距离
      const scrollIterations = 3 // 滚动3次
      const scrollDistance = Math.min(totalHeight / scrollIterations, viewportHeight * 0.8)

      // 平滑滚动
      for (let i = 0; i < scrollIterations; i++) {
        await window.webContents.executeJavaScript(`
          new Promise((resolve) => {
            // 获取当前滚动位置
            const currentScroll = window.scrollY || document.documentElement.scrollTop;
            // 计算目标位置
            const targetScroll = currentScroll + ${scrollDistance};

            // 使用平滑滚动
            window.scrollTo({
              top: targetScroll,
              behavior: 'smooth'
            });

            // 等待滚动完成
            setTimeout(resolve, 300);
          })
        `)

        // 给浏览器一点时间来加载潜在的懒加载内容
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      // 等待一下，让页面完全加载
      await new Promise((resolve) => setTimeout(resolve, 500))

      console.log('页面滚动完成')
    } catch (error) {
      console.error('模拟页面滚动失败:', error)
      // 失败也继续处理
    }
  }

  private async enrichResults(results: SearchResult[]): Promise<SearchResult[]> {
    return await ContentEnricher.enrichResults(results)
  }

  /**
   * 测试搜索引擎功能
   * 打开一个窗口进行测试搜索，窗口将保持在前台直到用户关闭
   * @param query 搜索关键词，默认为"天气"
   * @returns 是否成功打开测试窗口
   */
  async testSearch(query: string = '天气'): Promise<boolean> {
    try {
      // 确保引擎列表是最新的
      // await this.ensureEnginesUpdated()

      // 创建一个独立的测试窗口
      const testWindow = new BrowserWindow({
        width: 800,
        height: 600,
        title: `测试搜索 - ${this.activeEngine.name}`,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          devTools: is.dev
        }
      })

      // 配置User-Agent
      testWindow.webContents.session.webRequest.onBeforeSendHeaders(
        { urls: ['*://*/*'] },
        (details, callback) => {
          const headers = {
            ...details.requestHeaders,
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
          callback({ requestHeaders: headers })
        }
      )

      // 生成搜索URL
      const searchUrl = this.activeEngine.searchUrl.replace('{query}', encodeURIComponent(query))
      console.log('测试搜索URL:', searchUrl)

      // 加载URL
      await testWindow.loadURL(searchUrl)

      // 保持窗口在前台
      testWindow.focus()

      // 在窗口关闭时清理资源
      testWindow.on('closed', () => {
        console.log('测试搜索窗口已关闭')
      })

      return true
    } catch (error) {
      console.error('测试搜索失败:', error)
      return false
    }
  }

  /**
   * 停止特定会话的搜索操作
   * @param conversationId 会话ID
   */
  async stopSearch(conversationId: string): Promise<void> {
    console.log('停止搜索, conversationId:', conversationId)

    // 中止搜索操作
    const abortController = this.abortControllers.get(conversationId)
    if (abortController) {
      abortController.abort()
      this.abortControllers.delete(conversationId)
    }

    // 关闭搜索窗口
    await this.destroySearchWindow(conversationId)
  }

  destroy() {
    // 中止所有搜索操作
    for (const controller of this.abortControllers.values()) {
      controller.abort()
    }
    this.abortControllers.clear()

    for (const [conversationId] of this.searchWindows) {
      this.destroySearchWindow(conversationId)
    }
    this.originalWindowSizes.clear()
    this.originalWindowPositions.clear()
    this.wasFullScreen.clear()
  }
}
