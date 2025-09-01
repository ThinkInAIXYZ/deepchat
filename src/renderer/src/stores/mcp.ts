import { ref, computed, onMounted, watch } from 'vue'
import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import { MCP_EVENTS } from '@/events'
import { useI18n } from 'vue-i18n'
import { useThrottleFn } from '@vueuse/core'
import { useChatStore } from './chat'
import type {
  McpClient,
  MCPConfig,
  MCPServerConfig,
  MCPToolDefinition,
  PromptListEntry,
  Resource,
  ResourceListEntry,
  Prompt
} from '@shared/presenter'
// 自定义类型定义
interface MCPToolCallRequest {
  id: string
  type: string
  function: {
    name: string
    arguments: string
  }
}

interface MCPToolCallResult {
  function_name?: string
  content: string | { type: string; text: string }[]
}

export const useMcpStore = defineStore('mcp', () => {
  const chatStore = useChatStore()
  const { t } = useI18n()
  // 获取MCP相关的presenter
  const mcpPresenter = usePresenter('mcpPresenter')
  // 获取配置相关的presenter
  const configPresenter = usePresenter('configPresenter')

  // ==================== 状态定义 ====================
  // MCP配置
  const config = ref<MCPConfig>({
    mcpServers: {},
    defaultServers: [],
    mcpEnabled: false, // 添加MCP启用状态
    ready: false // if init finished, the ready will be true
  })

  // MCP全局启用状态
  const mcpEnabled = computed(() => config.value.mcpEnabled)

  // 服务器状态
  const serverStatuses = ref<Record<string, boolean>>({})
  const serverLoadingStates = ref<Record<string, boolean>>({})
  const configLoading = ref(false)
  const clients = ref<McpClient[]>([])

  // 工具相关状态
  const tools = ref<MCPToolDefinition[]>([])
  const toolsLoading = ref(false)
  const toolsError = ref(false)
  const toolsErrorMessage = ref('')
  const toolLoadingStates = ref<Record<string, boolean>>({})
  const toolInputs = ref<Record<string, Record<string, string>>>({})
  const toolResults = ref<Record<string, string | { type: string; text: string }[]>>({})
  const prompts = ref<PromptListEntry[]>([])
  const resources = ref<ResourceListEntry[]>([])
  // ==================== 计算属性 ====================
  // 服务器列表
  const serverList = computed(() => {
    const servers = Object.entries(config.value.mcpServers).map(([name, serverConfig]) => ({
      name,
      ...serverConfig,
      isRunning: serverStatuses.value[name] || false,
      isDefault: config.value.defaultServers.includes(name),
      isLoading: serverLoadingStates.value[name] || false
    }))

    // 按照特定顺序排序：
    // 1. 启用的inmemory服务
    // 2. 其他启用的服务
    // 3. 未启用的inmemory服务
    // 4. 其他服务
    return servers.sort((a, b) => {
      const aIsInmemory = a.type === 'inmemory'
      const bIsInmemory = b.type === 'inmemory'

      // inmemory 都优先
      if (aIsInmemory && !bIsInmemory) return -1
      if (!aIsInmemory && bIsInmemory) return 1

      return 0 // 保持原有顺序
    })
  })

  // 计算默认服务器数量
  const defaultServersCount = computed(() => config.value.defaultServers.length)

  // 检查是否达到默认服务器最大数量
  const hasMaxDefaultServers = computed(() => defaultServersCount.value >= 30)

  // 工具数量
  const toolCount = computed(() => tools.value.length)
  const hasTools = computed(() => toolCount.value > 0)

  // ==================== 方法 ====================
  // 加载MCP配置
  const loadConfig = async () => {
    try {
      configLoading.value = true
      const [servers, defaultServers, enabled] = await Promise.all([
        mcpPresenter.getMcpServers(),
        mcpPresenter.getMcpDefaultServers(),
        mcpPresenter.getMcpEnabled()
      ])
      config.value = {
        mcpServers: servers,
        defaultServers: defaultServers,
        mcpEnabled: enabled,
        ready: true // config is loaded
      }

      // 获取服务器运行状态
      await updateAllServerStatuses()
    } catch (error) {
      console.error(t('mcp.errors.loadConfigFailed'), error)
    } finally {
      configLoading.value = false
    }
  }

  // 设置MCP启用状态
  const setMcpEnabled = async (enabled: boolean) => {
    try {
      await mcpPresenter.setMcpEnabled(enabled)
      config.value.mcpEnabled = enabled

      // 如果启用MCP，自动加载工具
      if (enabled) {
        await loadTools()
        await loadClients()
      } else {
        // 如果禁用MCP，清空工具列表和资源，但保留prompts（包含config数据）
        tools.value = []
        resources.value = []
        // 重新加载prompts以确保config数据仍然可用
        await loadPrompts()
      }

      return true
    } catch (error) {
      console.error(t('mcp.errors.setEnabledFailed'), error)
      return false
    }
  }

  // 更新所有服务器状态
  const updateAllServerStatuses = async () => {
    for (const serverName of Object.keys(config.value.mcpServers)) {
      await updateServerStatus(serverName, true)
    }
    loadTools()
    loadClients()
  }

  // 更新单个服务器状态
  const updateServerStatus = async (serverName: string, noRefresh: boolean = false) => {
    try {
      serverStatuses.value[serverName] = await mcpPresenter.isServerRunning(serverName)
      if (config.value.mcpEnabled && !noRefresh) {
        await _loadTools()
        await _loadClients()
      }
      // 根据服务器的状态，关闭或者开启该服务器的所有工具
      const isRunning = serverStatuses.value[serverName] || false
      const currentTools =
        chatStore.chatConfig.enabledMcpTools || [...tools.value].map((tool) => tool.function.name)
      if (isRunning) {
        const serverTools = tools.value
          .filter((tool) => tool.server.name === serverName)
          .map((tool) => tool.function.name)
        const mergedTools = Array.from(new Set([...currentTools, ...serverTools]))
        chatStore.updateChatConfig({ enabledMcpTools: mergedTools })
      } else {
        const allServerToolNames = tools.value.map((tool) => tool.function.name)
        const filteredTools = currentTools.filter((name) => allServerToolNames.includes(name))
        chatStore.updateChatConfig({ enabledMcpTools: filteredTools })
      }
    } catch (error) {
      console.error(t('mcp.errors.getServerStatusFailed', { serverName }), error)
      serverStatuses.value[serverName] = false
    }
  }

  // 添加服务器
  const addServer = async (serverName: string, serverConfig: MCPServerConfig) => {
    const success = await mcpPresenter.addMcpServer(serverName, serverConfig)
    if (success) {
      await loadConfig()
      return { success: true, message: '' }
    }
    return { success: false, message: t('mcp.errors.addServerFailed') }
  }

  // 更新服务器
  const updateServer = async (serverName: string, serverConfig: Partial<MCPServerConfig>) => {
    try {
      await mcpPresenter.updateMcpServer(serverName, serverConfig)
      await loadConfig()
      return true
    } catch (error) {
      console.error(t('mcp.errors.updateServerFailed'), error)
      return false
    }
  }

  // 删除服务器
  const removeServer = async (serverName: string) => {
    try {
      await mcpPresenter.removeMcpServer(serverName)
      await loadConfig()
      return true
    } catch (error) {
      console.error(t('mcp.errors.removeServerFailed'), error)
      return false
    }
  }

  // 切换服务器的默认状态
  const toggleDefaultServer = async (serverName: string) => {
    try {
      // 如果服务器已经是默认服务器，移除
      if (config.value.defaultServers.includes(serverName)) {
        await mcpPresenter.removeMcpDefaultServer(serverName)
      } else {
        // 检查是否已达到最大默认服务器数量
        if (hasMaxDefaultServers.value) {
          // 如果已达到最大数量，返回错误
          return { success: false, message: t('mcp.errors.maxDefaultServersReached') }
        }
        await mcpPresenter.addMcpDefaultServer(serverName)
      }
      await loadConfig()
      return { success: true, message: '' }
    } catch (error) {
      console.error(t('mcp.errors.toggleDefaultServerFailed'), error)
      return { success: false, message: String(error) }
    }
  }

  // 恢复默认服务配置
  const resetToDefaultServers = async () => {
    try {
      await mcpPresenter.resetToDefaultServers()
      await loadConfig()
      return true
    } catch (error) {
      console.error(t('mcp.errors.resetToDefaultFailed'), error)
      return false
    }
  }

  // 启动/停止服务器
  const toggleServer = async (serverName: string) => {
    try {
      serverLoadingStates.value[serverName] = true
      const isRunning = serverStatuses.value[serverName] || false

      if (isRunning) {
        await mcpPresenter.stopServer(serverName)
      } else {
        await mcpPresenter.startServer(serverName)
      }

      await updateServerStatus(serverName)
      return true
    } catch (error) {
      console.error(t('mcp.errors.toggleServerFailed', { serverName }), error)
      return false
    } finally {
      serverLoadingStates.value[serverName] = false
    }
  }

  // 实际加载客户端的函数
  const _loadClients = async () => {
    clients.value = (await mcpPresenter.getMcpClients()) ?? []
    // 加载客户端后，同时加载提示模板和资源
    await Promise.all([loadPrompts(), loadResources()])
  }

  // 使用节流的loadClients函数，保证第一次和最后一次一定执行
  const loadClients = useThrottleFn(_loadClients, 500, true, false)

  // 实际加载工具列表的函数
  const _loadTools = async () => {
    // 如果MCP未启用，则不加载工具
    if (!config.value.mcpEnabled) {
      tools.value = []
      return false
    }

    try {
      toolsLoading.value = true
      toolsError.value = false
      toolsErrorMessage.value = ''

      tools.value = await mcpPresenter.getAllToolDefinitions()
      // console.log('tools.value', tools.value)

      // 初始化工具输入
      tools.value.forEach((tool) => {
        if (!toolInputs.value[tool.function.name]) {
          toolInputs.value[tool.function.name] = {}

          // 为每个参数设置默认值
          if (tool.function.parameters && tool.function.parameters.properties) {
            Object.keys(tool.function.parameters.properties).forEach((paramName) => {
              toolInputs.value[tool.function.name][paramName] = ''
            })
          }

          // 为特定工具设置特殊默认值
          if (tool.function.name === 'search_files') {
            toolInputs.value[tool.function.name] = {
              path: '',
              regex: '\\.md$',
              file_pattern: '*.md'
            }
          }
        }
      })

      return true
    } catch (error) {
      console.error(t('mcp.errors.loadToolsFailed'), error)
      toolsError.value = true
      toolsErrorMessage.value = error instanceof Error ? error.message : String(error)
      return false
    } finally {
      toolsLoading.value = false
    }
  }

  // 使用节流的loadTools函数，保证第一次和最后一次一定执行
  const loadTools = useThrottleFn(_loadTools, 500, true, false)

  // 加载提示模板
  const loadPrompts = async () => {
    try {
      // 如果MCP启用，则加载MCP提示模板
      let mcpPrompts: PromptListEntry[] = []
      if (config.value.mcpEnabled) {
        try {
          mcpPrompts = await mcpPresenter.getAllPrompts()
        } catch (error) {
          console.warn('Failed to load MCP prompts:', error)
          mcpPrompts = []
        }
      }

      // 从config加载自定义提示模板
      let customPrompts: PromptListEntry[] = []
      try {
        const configPrompts: Prompt[] = await configPresenter.getCustomPrompts()
        // 将Prompt格式转换为PromptListEntry格式
        customPrompts = configPrompts.map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          arguments: prompt.parameters || [],
          files: prompt.files || [],
          client: {
            name: 'config',
            icon: '⚙️'
          }
        }))
      } catch (error) {
        console.warn('Failed to load custom prompts from config:', error)
        customPrompts = []
      }

      // 合并两个数据源
      prompts.value = [...customPrompts, ...mcpPrompts]

      return true
    } catch (error) {
      console.error(t('mcp.errors.loadPromptsFailed'), error)
      prompts.value = []
      return false
    }
  }

  // 加载资源列表
  const loadResources = async () => {
    // 如果MCP未启用，则不加载资源
    if (!config.value.mcpEnabled) {
      resources.value = []
      return false
    }

    try {
      const resourcesData = await mcpPresenter.getAllResources()

      // 将主进程返回的数据格式转换为渲染进程所需的格式
      resources.value = resourcesData

      return true
    } catch (error) {
      console.error(t('mcp.errors.loadResourcesFailed'), error)
      return false
    }
  }

  // 更新工具输入
  const updateToolInput = (toolName: string, paramName: string, value: string) => {
    if (!toolInputs.value[toolName]) {
      toolInputs.value[toolName] = {}
    }
    toolInputs.value[toolName][paramName] = value
  }

  // 调用工具
  const callTool = async (toolName: string) => {
    try {
      toolLoadingStates.value[toolName] = true

      // 准备工具参数
      const params = toolInputs.value[toolName] || {}

      // 特殊处理search_files工具
      if (toolName === 'search_files') {
        if (!params.regex) params.regex = '\\.md$'
        if (!params.path) params.path = '.'
        if (!params.file_pattern) {
          const match = params.regex.match(/\.(\w+)\$/)
          if (match) {
            params.file_pattern = `*.${match[1]}`
          }
        }
      }

      // 创建工具调用请求
      const request: MCPToolCallRequest = {
        id: Date.now().toString(),
        type: 'function',
        function: {
          name: toolName,
          arguments: JSON.stringify(params)
        }
      }

      // 调用工具
      const result = await mcpPresenter.callTool(request)
      toolResults.value[toolName] = result.content
      return result
    } catch (error) {
      console.error(t('mcp.errors.callToolFailed', { toolName }), error)
      toolResults.value[toolName] = t('mcp.errors.toolCallError', { error: String(error) })
      throw error
    } finally {
      toolLoadingStates.value[toolName] = false
    }
  }

  // 获取提示模板详情
  const getPrompt = async (
    prompt: PromptListEntry,
    args?: Record<string, unknown>
  ): Promise<unknown> => {
    if (!config.value.mcpEnabled) {
      throw new Error(t('mcp.errors.mcpDisabled'))
    }

    try {
      // 传递完整对象给mcpPresenter
      return await mcpPresenter.getPrompt(prompt, args)
    } catch (error) {
      console.error(t('mcp.errors.getPromptFailed'), error)
      throw error
    }
  }

  // 读取资源内容
  const readResource = async (resource: ResourceListEntry): Promise<Resource> => {
    if (!config.value.mcpEnabled) {
      throw new Error(t('mcp.errors.mcpDisabled'))
    }

    try {
      // 传递完整对象给mcpPresenter
      return await mcpPresenter.readResource(resource)
    } catch (error) {
      console.error(t('mcp.errors.readResourceFailed'), error)
      throw error
    }
  }

  // ==================== 事件监听 ====================
  // 初始化事件监听
  const initEvents = () => {
    window.electron.ipcRenderer.on(MCP_EVENTS.SERVER_STARTED, (_event, serverName: string) => {
      console.log(`MCP server started: ${serverName}`)
      updateServerStatus(serverName)
    })

    window.electron.ipcRenderer.on(MCP_EVENTS.SERVER_STOPPED, (_event, serverName: string) => {
      console.log(`MCP server stopped: ${serverName}`)
      updateServerStatus(serverName)
    })

    window.electron.ipcRenderer.on(MCP_EVENTS.CONFIG_CHANGED, () => {
      console.log('MCP config changed')
      loadConfig()
    })

    window.electron.ipcRenderer.on(
      MCP_EVENTS.SERVER_STATUS_CHANGED,
      (_event, serverName: string, isRunning: boolean) => {
        console.log(`MCP server ${serverName} status changed: ${isRunning}`)
        serverStatuses.value[serverName] = isRunning
      }
    )

    window.electron.ipcRenderer.on(
      MCP_EVENTS.TOOL_CALL_RESULT,
      (_event, result: MCPToolCallResult) => {
        console.log(`MCP tool call result:`, result.function_name)
        if (result && result.function_name) {
          toolResults.value[result.function_name] = result.content
        }
      }
    )
  }

  // 初始化
  const init = async () => {
    initEvents()
    await loadConfig()

    // 总是加载提示模板（包含config数据源）
    await loadPrompts()

    // 如果MCP已启用，加载工具、客户端和资源
    if (config.value.mcpEnabled) {
      await loadTools()
      await loadClients()
    }

    // 如果是新建会话页面，则缓存已激活工具名称
    if (!chatStore.getActiveThreadId()) {
      chatStore.chatConfig.enabledMcpTools = tools.value.map((item) => item.function.name)
    }
  }

  // 监听活动线程变化，处理新会话的默认工具状态
  const handleActiveThreadChange = () => {
    watch(
      () => chatStore.getActiveThreadId(),
      (newThreadId, oldThreadId) => {
        // 从有活动线程切换到无活动线程（新会话页面）
        if (oldThreadId && !newThreadId && config.value.mcpEnabled && tools.value.length > 0) {
          chatStore.chatConfig.enabledMcpTools = tools.value.map((item) => item.function.name)
        }
      }
    )
  }

  // 立即初始化
  onMounted(async () => {
    await init()
    handleActiveThreadChange()
  })

  // 获取NPM Registry状态
  const getNpmRegistryStatus = async () => {
    if (!mcpPresenter.getNpmRegistryStatus) {
      throw new Error('NPM Registry status method not available')
    }
    return await mcpPresenter.getNpmRegistryStatus()
  }

  // 手动刷新NPM Registry
  const refreshNpmRegistry = async (): Promise<string> => {
    if (!mcpPresenter.refreshNpmRegistry) {
      throw new Error('NPM Registry refresh method not available')
    }
    return await mcpPresenter.refreshNpmRegistry()
  }

  // 设置自定义NPM Registry
  const setCustomNpmRegistry = async (registry: string | undefined): Promise<void> => {
    if (!mcpPresenter.setCustomNpmRegistry) {
      throw new Error('Set custom NPM Registry method not available')
    }
    await mcpPresenter.setCustomNpmRegistry(registry)
  }

  // 设置自动检测NPM Registry
  const setAutoDetectNpmRegistry = async (enabled: boolean): Promise<void> => {
    if (!mcpPresenter.setAutoDetectNpmRegistry) {
      throw new Error('Set auto detect NPM Registry method not available')
    }
    await mcpPresenter.setAutoDetectNpmRegistry(enabled)
  }

  // 清除NPM Registry缓存
  const clearNpmRegistryCache = async (): Promise<void> => {
    if (!mcpPresenter.clearNpmRegistryCache) {
      throw new Error('Clear NPM Registry cache method not available')
    }
    await mcpPresenter.clearNpmRegistryCache()
  }

  return {
    // 状态
    config,
    serverStatuses,
    serverLoadingStates,
    configLoading,
    tools,
    toolsLoading,
    toolsError,
    toolsErrorMessage,
    toolLoadingStates,
    toolInputs,
    toolResults,
    prompts,
    resources,
    mcpEnabled,

    // 计算属性
    serverList,
    toolCount,
    hasTools,
    clients,

    // 服务器管理方法
    loadConfig,
    updateAllServerStatuses,
    updateServerStatus,
    addServer,
    updateServer,
    removeServer,
    toggleDefaultServer,
    resetToDefaultServers,
    toggleServer,
    setMcpEnabled,

    // 工具和资源方法
    loadTools,
    loadClients,
    loadPrompts,
    loadResources,
    updateToolInput,
    callTool,
    getPrompt,
    readResource,

    // NPM Registry 管理方法
    getNpmRegistryStatus,
    refreshNpmRegistry,
    setCustomNpmRegistry,
    setAutoDetectNpmRegistry,
    clearNpmRegistryCache
  }
})
