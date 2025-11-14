import { ref, computed, onMounted, watch } from 'vue'
import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import { useIpcQuery } from '@/composables/useIpcQuery'
import { useIpcMutation } from '@/composables/useIpcMutation'
import { MCP_EVENTS } from '@/events'
import { useI18n } from 'vue-i18n'
import { useChatStore } from './chat'
import { useQuery, type UseQueryReturn } from '@pinia/colada'
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

  // 工具相关状态
  const toolLoadingStates = ref<Record<string, boolean>>({})
  const toolInputs = ref<Record<string, Record<string, string>>>({})
  const toolResults = ref<Record<string, string | { type: string; text: string }[]>>({})

  type QueryExecuteOptions = { force?: boolean }

  const runQuery = async <T>(queryReturn: UseQueryReturn<T>, options?: QueryExecuteOptions) => {
    const runner = options?.force ? queryReturn.refetch : queryReturn.refresh
    return await runner()
  }

  interface ConfigQueryResult {
    mcpServers: MCPConfig['mcpServers']
    defaultServers: string[]
    mcpEnabled: boolean
  }

  const configQuery = useQuery<ConfigQueryResult>({
    key: () => ['mcp', 'config'],
    staleTime: 30_000,
    gcTime: 300_000,
    query: async () => {
      const [servers, defaultServers, enabled] = await Promise.all([
        mcpPresenter.getMcpServers(),
        mcpPresenter.getMcpDefaultServers(),
        mcpPresenter.getMcpEnabled()
      ])

      return {
        mcpServers: servers ?? {},
        defaultServers: defaultServers ?? [],
        mcpEnabled: Boolean(enabled)
      }
    }
  })

  const toolsQuery = useIpcQuery({
    presenter: 'mcpPresenter',
    method: 'getAllToolDefinitions',
    key: () => ['mcp', 'tools'],
    enabled: () => config.value.ready && config.value.mcpEnabled,
    staleTime: 30_000
  }) as UseQueryReturn<MCPToolDefinition[]>

  const clientsQuery = useIpcQuery({
    presenter: 'mcpPresenter',
    method: 'getMcpClients',
    key: () => ['mcp', 'clients'],
    enabled: () => config.value.ready && config.value.mcpEnabled,
    staleTime: 30_000
  }) as UseQueryReturn<McpClient[]>

  const resourcesQuery = useIpcQuery({
    presenter: 'mcpPresenter',
    method: 'getAllResources',
    key: () => ['mcp', 'resources'],
    enabled: () => config.value.ready && config.value.mcpEnabled,
    staleTime: 30_000
  }) as UseQueryReturn<ResourceListEntry[]>

  const loadMcpPrompts = async (): Promise<PromptListEntry[]> => {
    try {
      return await mcpPresenter.getAllPrompts()
    } catch (error) {
      console.warn('Failed to load MCP prompts:', error)
      return []
    }
  }

  const loadCustomPrompts = async (): Promise<PromptListEntry[]> => {
    try {
      const configPrompts: Prompt[] = await configPresenter.getCustomPrompts()
      return configPrompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.parameters || [],
        files: prompt.files || [],
        client: {
          name: 'deepchat/custom-prompts-server',
          icon: '⚙️'
        }
      }))
    } catch (error) {
      console.warn('Failed to load custom prompts from config:', error)
      return []
    }
  }

  const promptsQuery = useQuery<PromptListEntry[]>({
    key: () => ['mcp', 'prompts', config.value.mcpEnabled],
    staleTime: 60_000,
    gcTime: 300_000,
    query: async () => {
      const customPrompts = await loadCustomPrompts()
      if (!config.value.mcpEnabled) {
        return customPrompts
      }

      const mcpPrompts = await loadMcpPrompts()
      return [...customPrompts, ...mcpPrompts]
    }
  })

  const tools = computed(() => (config.value.mcpEnabled ? (toolsQuery.data.value ?? []) : []))

  const clients = computed(() => (config.value.mcpEnabled ? (clientsQuery.data.value ?? []) : []))

  const resources = computed(() =>
    config.value.mcpEnabled ? (resourcesQuery.data.value ?? []) : []
  )

  const prompts = computed(() => promptsQuery.data.value ?? [])

  const toolsLoading = computed(() =>
    config.value.mcpEnabled ? toolsQuery.isLoading.value : false
  )

  const toolsError = computed(() => Boolean(toolsQuery.error.value))

  const toolsErrorMessage = computed(() => {
    const error = toolsQuery.error.value
    if (!error) {
      return ''
    }

    return error instanceof Error ? error.message : String(error)
  })

  const syncConfigFromQuery = (data?: ConfigQueryResult | null) => {
    if (!data) {
      return
    }

    config.value = {
      mcpServers: data.mcpServers,
      defaultServers: data.defaultServers,
      mcpEnabled: data.mcpEnabled,
      ready: true
    }
  }

  const applyToolsSnapshot = (toolDefs: MCPToolDefinition[] = []) => {
    toolDefs.forEach((tool) => {
      if (!toolInputs.value[tool.function.name]) {
        toolInputs.value[tool.function.name] = {}

        if (tool.function.parameters?.properties) {
          Object.keys(tool.function.parameters.properties).forEach((paramName) => {
            toolInputs.value[tool.function.name][paramName] = ''
          })
        }

        if (tool.function.name === 'search_files') {
          toolInputs.value[tool.function.name] = {
            path: '',
            regex: '\\.md$',
            file_pattern: '*.md'
          }
        }
      }
    })
  }

  watch(
    () => configQuery.data.value,
    (data) => syncConfigFromQuery(data),
    { immediate: true }
  )

  watch(
    () => toolsQuery.data.value,
    (toolDefs) => {
      if (!config.value.mcpEnabled) {
        return
      }

      if (Array.isArray(toolDefs)) {
        applyToolsSnapshot(toolDefs as MCPToolDefinition[])
      }
    },
    { immediate: true }
  )

  watch(
    () => config.value.mcpEnabled,
    (enabled) => {
      if (!enabled) {
        toolInputs.value = {}
        toolResults.value = {}
      }
    }
  )
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

  // ==================== Mutations ====================
  // Mutations for write operations with automatic cache invalidation
  const addServerMutation = useIpcMutation({
    presenter: 'mcpPresenter',
    method: 'addMcpServer',
    invalidateQueries: () => [
      ['mcp', 'config'],
      ['mcp', 'tools'],
      ['mcp', 'clients'],
      ['mcp', 'resources']
    ]
  })

  const updateServerMutation = useIpcMutation({
    presenter: 'mcpPresenter',
    method: 'updateMcpServer',
    invalidateQueries: () => [
      ['mcp', 'config'],
      ['mcp', 'tools'],
      ['mcp', 'clients'],
      ['mcp', 'resources']
    ]
  })

  const removeServerMutation = useIpcMutation({
    presenter: 'mcpPresenter',
    method: 'removeMcpServer',
    invalidateQueries: () => [
      ['mcp', 'config'],
      ['mcp', 'tools'],
      ['mcp', 'clients'],
      ['mcp', 'resources']
    ]
  })

  const addDefaultServerMutation = useIpcMutation({
    presenter: 'mcpPresenter',
    method: 'addMcpDefaultServer',
    invalidateQueries: () => [['mcp', 'config']]
  })

  const removeDefaultServerMutation = useIpcMutation({
    presenter: 'mcpPresenter',
    method: 'removeMcpDefaultServer',
    invalidateQueries: () => [['mcp', 'config']]
  })

  const resetToDefaultServersMutation = useIpcMutation({
    presenter: 'mcpPresenter',
    method: 'resetToDefaultServers',
    invalidateQueries: () => [['mcp', 'config']]
  })

  const setMcpEnabledMutation = useIpcMutation({
    presenter: 'mcpPresenter',
    method: 'setMcpEnabled',
    invalidateQueries: () => [['mcp', 'config']]
  })

  // ==================== 方法 ====================
  // 加载MCP配置
  const loadConfig = async (options?: QueryExecuteOptions) => {
    configLoading.value = true
    try {
      const state = await runQuery(configQuery, options)
      if (state.status === 'success') {
        syncConfigFromQuery(state.data)
        await updateAllServerStatuses()
      }
    } catch (error) {
      console.error(t('mcp.errors.loadConfigFailed'), error)
    } finally {
      configLoading.value = false
    }
  }

  // 设置MCP启用状态
  const setMcpEnabled = async (enabled: boolean) => {
    try {
      await setMcpEnabledMutation.mutateAsync([enabled])
      // Cache invalidation and query refresh will happen automatically
      // Related queries will refresh due to enabled condition changes
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
    await Promise.all([loadTools(), loadClients()])
  }

  // 更新单个服务器状态
  const updateServerStatus = async (serverName: string, noRefresh: boolean = false) => {
    try {
      serverStatuses.value[serverName] = await mcpPresenter.isServerRunning(serverName)
      if (config.value.mcpEnabled && !noRefresh) {
        await Promise.all([loadTools({ force: true }), loadClients({ force: true })])
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
    try {
      const success = await addServerMutation.mutateAsync([serverName, serverConfig])
      if (success) {
        // Cache invalidation happens automatically, trigger config refresh
        await runQuery(configQuery, { force: true })
        return { success: true, message: '' }
      }
      return { success: false, message: t('mcp.errors.addServerFailed') }
    } catch (error) {
      console.error(t('mcp.errors.addServerFailed'), error)
      return { success: false, message: t('mcp.errors.addServerFailed') }
    }
  }

  // 更新服务器
  const updateServer = async (serverName: string, serverConfig: Partial<MCPServerConfig>) => {
    try {
      await updateServerMutation.mutateAsync([serverName, serverConfig])
      // Cache invalidation happens automatically, trigger config refresh
      await runQuery(configQuery, { force: true })
      return true
    } catch (error) {
      console.error(t('mcp.errors.updateServerFailed'), error)
      return false
    }
  }

  // 删除服务器
  const removeServer = async (serverName: string) => {
    try {
      await removeServerMutation.mutateAsync([serverName])
      // Cache invalidation happens automatically, trigger config refresh
      await runQuery(configQuery, { force: true })
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
        await removeDefaultServerMutation.mutateAsync([serverName])
      } else {
        // 检查是否已达到最大默认服务器数量
        if (hasMaxDefaultServers.value) {
          // 如果已达到最大数量，返回错误
          return { success: false, message: t('mcp.errors.maxDefaultServersReached') }
        }
        await addDefaultServerMutation.mutateAsync([serverName])
      }
      // Cache invalidation happens automatically, trigger config refresh
      await runQuery(configQuery, { force: true })
      return { success: true, message: '' }
    } catch (error) {
      console.error(t('mcp.errors.toggleDefaultServerFailed'), error)
      return { success: false, message: String(error) }
    }
  }

  // 恢复默认服务配置
  const resetToDefaultServers = async () => {
    try {
      await resetToDefaultServersMutation.mutateAsync([])
      // Cache invalidation happens automatically, trigger config refresh
      await runQuery(configQuery, { force: true })
      return true
    } catch (error) {
      console.error(t('mcp.errors.resetToDefaultFailed'), error)
      return false
    }
  }

  // 启动/停止服务器
  const toggleServer = async (serverName: string) => {
    // 如果正在加载，避免重复操作
    if (serverLoadingStates.value[serverName]) {
      return false
    }

    // 乐观更新：立即更新状态
    const currentStatus = serverStatuses.value[serverName] || false
    const targetStatus = !currentStatus
    serverStatuses.value[serverName] = targetStatus
    serverLoadingStates.value[serverName] = true

    try {
      // 执行实际操作
      if (currentStatus) {
        await mcpPresenter.stopServer(serverName)
      } else {
        await mcpPresenter.startServer(serverName)
      }

      // 同步实际状态（可能因网络延迟等原因状态不一致）
      await updateServerStatus(serverName)
      return true
    } catch (error) {
      // 失败时回滚状态
      serverStatuses.value[serverName] = currentStatus
      console.error(t('mcp.errors.toggleServerFailed', { serverName }), error)
      return false
    } finally {
      serverLoadingStates.value[serverName] = false
    }
  }

  const loadClients = async (options?: QueryExecuteOptions) => {
    if (!config.value.mcpEnabled) {
      return
    }

    try {
      const state = await runQuery(clientsQuery, options)
      if (state.status === 'success') {
        await Promise.all([loadPrompts(options), loadResources(options)])
      }
    } catch (error) {
      console.error(t('mcp.errors.loadClientsFailed'), error)
    }
  }

  const loadTools = async (options?: QueryExecuteOptions) => {
    if (!config.value.mcpEnabled) {
      return
    }

    try {
      await runQuery(toolsQuery, options)
    } catch (error) {
      console.error(t('mcp.errors.loadToolsFailed'), error)
    }
  }

  // 加载提示模板
  const loadPrompts = async (options?: QueryExecuteOptions) => {
    try {
      await runQuery(promptsQuery, options)
    } catch (error) {
      console.error(t('mcp.errors.loadPromptsFailed'), error)
    }
  }

  // 加载资源列表
  const loadResources = async (options?: QueryExecuteOptions) => {
    if (!config.value.mcpEnabled) {
      return
    }

    try {
      await runQuery(resourcesQuery, options)
    } catch (error) {
      console.error(t('mcp.errors.loadResourcesFailed'), error)
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
    try {
      // 检查是否是自定义 prompt（来自 config）
      const isCustomPrompt = prompt.client?.name === 'deepchat/custom-prompts-server'

      if (isCustomPrompt) {
        // 自定义 prompt 从 config 获取，不需要 MCP 启用
        const customPrompts: Prompt[] = await configPresenter.getCustomPrompts()
        const matchedPrompt = customPrompts.find((p) => p.name === prompt.name)

        if (!matchedPrompt) {
          throw new Error(t('mcp.errors.promptNotFound', { name: prompt.name }))
        }

        // 验证 prompt 内容
        if (!matchedPrompt.content || matchedPrompt.content.trim() === '') {
          throw new Error(t('mcp.errors.emptyPromptContent', { name: prompt.name }))
        }

        let content = matchedPrompt.content

        // 验证参数
        if (args && matchedPrompt.parameters) {
          // 检查必需参数
          const requiredParams = matchedPrompt.parameters
            .filter((param) => param.required)
            .map((param) => param.name)

          const missingParams = requiredParams.filter((paramName) => !(paramName in args))
          if (missingParams.length > 0) {
            throw new Error(t('mcp.errors.missingParameters', { params: missingParams.join(', ') }))
          }

          // 验证提供的参数都是有效的
          const validParamNames = matchedPrompt.parameters.map((param) => param.name)
          const invalidParams = Object.keys(args).filter((key) => !validParamNames.includes(key))
          if (invalidParams.length > 0) {
            throw new Error(t('mcp.errors.invalidParameters', { params: invalidParams.join(', ') }))
          }

          // 安全的参数替换，使用字符串方法而非正则表达式
          for (const [key, value] of Object.entries(args)) {
            if (value !== null && value !== undefined) {
              const placeholder = `{{${key}}}`
              let startPos = 0
              let pos

              while ((pos = content.indexOf(placeholder, startPos)) !== -1) {
                content =
                  content.substring(0, pos) +
                  String(value) +
                  content.substring(pos + placeholder.length)
                startPos = pos + String(value).length
              }
            }
          }
        }

        return { messages: [{ role: 'user', content: { type: 'text', text: content } }] }
      }

      // MCP prompt 需要检查 MCP 是否启用
      if (!config.value.mcpEnabled) {
        throw new Error(t('mcp.errors.mcpDisabled'))
      }

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

    // Listen for custom prompts changes
    window.electron.ipcRenderer.on('config:custom-prompts-changed', () => {
      console.log('Custom prompts changed, reloading prompts list')
      loadPrompts()
    })
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
