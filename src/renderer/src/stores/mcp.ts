import { ref, computed, onMounted, watch, onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import { useIpcQuery } from '@/composables/useIpcQuery'
import { useIpcMutation } from '@/composables/useIpcMutation'
import {
  useMcpToolingAdapter,
  resolveToolResultKey,
  type ToolCallResultPayload
} from '@/composables/mcp/useMcpToolingAdapter'
import { useMcpEventsAdapter } from '@/composables/mcp/useMcpEventsAdapter'
import { computeMcpConfigUpdate } from '@/composables/mcp/mcpConfigSync'
import { useI18n } from 'vue-i18n'
import { useChatStore } from './chat'
import { useQuery, type UseMutationReturn, type UseQueryReturn } from '@pinia/colada'
import type {
  McpClient,
  MCPConfig,
  MCPServerConfig,
  MCPToolDefinition,
  PromptListEntry,
  Resource,
  ResourceListEntry,
  Prompt,
  MCPContentItem
} from '@shared/presenter'

export const useMcpStore = defineStore('mcp', () => {
  const chatStore = useChatStore()
  const { t } = useI18n()
  // 获取MCP相关的presenter
  const mcpPresenter = usePresenter('mcpPresenter')
  // 获取配置相关的presenter
  const configPresenter = usePresenter('configPresenter')
  const toolingAdapter = useMcpToolingAdapter()
  const mcpEventsAdapter = useMcpEventsAdapter()
  let unsubscribeToolResults: (() => void) | null = null
  let unsubscribeMcpEvents: Array<() => void> = []

  // ==================== 状态定义 ====================
  // MCP配置
  const config = ref<MCPConfig>({
    mcpServers: {},
    defaultServers: [],
    mcpEnabled: true, // 添加MCP启用状态
    ready: false // if init finished, the ready will be true
  })

  // 深链安装缓存
  const mcpInstallCache = ref<string | null>(null)

  // MCP全局启用状态
  const mcpEnabled = computed(() => config.value.mcpEnabled)

  // 服务器状态
  const serverStatuses = ref<Record<string, boolean>>({})
  const serverLoadingStates = ref<Record<string, boolean>>({})
  const configLoading = ref(false)

  // 工具相关状态
  const toolLoadingStates = ref<Record<string, boolean>>({})
  const toolInputs = ref<Record<string, Record<string, string>>>({})
  const toolResults = ref<Record<string, string | MCPContentItem[]>>({})

  const formatToolResultContent = (content: string | MCPContentItem[]): string => {
    if (typeof content === 'string') {
      return content
    }

    const parts = content
      .map((item) => {
        if (item.type === 'text') return item.text
        if (item.type === 'resource') {
          return item.resource.text || item.resource.uri || ''
        }
        if (item.type === 'image') {
          return `[image:${item.mimeType ?? 'unknown'}]`
        }
        return ''
      })
      .filter(Boolean)

    const merged = parts.join('\n')
    return merged || JSON.stringify(content)
  }

  const cacheToolResult = (
    toolCallId: string | null | undefined,
    toolName: string | null | undefined,
    content: string | MCPContentItem[]
  ) => {
    const keys = new Set<string>()
    if (toolCallId) keys.add(toolCallId)
    if (toolName) keys.add(toolName)

    keys.forEach((key) => {
      toolResults.value[key] = content
    })
  }

  const getToolResult = (toolCallId?: string | null, toolName?: string | null): string | null => {
    if (toolCallId && toolResults.value[toolCallId]) {
      return formatToolResultContent(toolResults.value[toolCallId])
    }
    if (toolName && toolResults.value[toolName]) {
      return formatToolResultContent(toolResults.value[toolName])
    }
    return null
  }

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

  type CallToolRequest = Parameters<(typeof mcpPresenter)['callTool']>[0]
  type CallToolResult = Awaited<ReturnType<(typeof mcpPresenter)['callTool']>>
  type CallToolMutationVars = Parameters<(typeof mcpPresenter)['callTool']>

  const callToolMutation = useIpcMutation({
    presenter: 'mcpPresenter',
    method: 'callTool',
    onSuccess(result, variables) {
      const request = variables?.[0]
      const toolName = request?.function?.name
      const toolCallId = request?.id
      cacheToolResult(toolCallId, toolName, result.content)
    },
    onError(error, variables) {
      const request = variables?.[0]
      const toolName = request?.function?.name
      console.error(t('mcp.errors.callToolFailed', { toolName }), error)
      const toolCallId = request?.id
      cacheToolResult(toolCallId, toolName, t('mcp.errors.toolCallError', { error: String(error) }))
    }
  }) as UseMutationReturn<CallToolResult, CallToolMutationVars, Error>

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

    const previousMcpEnabled = config.value.mcpEnabled
    const previousReady = config.value.ready

    // Avoid overriding an already-enabled state with a transient disabled value while queries refresh
    const maybeQuery = configQuery as unknown as {
      isFetching?: { value: boolean }
      isLoading?: { value: boolean }
      isRefreshing?: { value: boolean }
    }
    const queryInFlight = Boolean(
      maybeQuery.isFetching?.value || maybeQuery.isLoading?.value || maybeQuery.isRefreshing?.value
    )

    const { nextConfig, shouldApply, mcpEnabledChanged } = computeMcpConfigUpdate(
      config.value,
      data,
      queryInFlight
    )

    if (!shouldApply) {
      return
    }

    if (mcpEnabledChanged) {
      console.log(
        `MCP enabled state changing from ${previousMcpEnabled} to ${nextConfig.mcpEnabled}`
      )
    }

    config.value = nextConfig

    // If mcpEnabled state changed, trigger query refreshes
    if (previousReady && mcpEnabledChanged) {
      if (nextConfig.mcpEnabled) {
        // MCP enabled: refresh tools, clients, resources
        Promise.all([
          loadTools({ force: true }),
          loadClients({ force: true }),
          loadPrompts({ force: true })
        ]).catch((error) => {
          console.error('Failed to refresh MCP queries after enabling:', error)
        })
      } else {
        // MCP disabled: clear state and refresh queries to get empty results
        serverStatuses.value = {}
        toolInputs.value = {}
        toolResults.value = {}
        Promise.all([
          toolsQuery.refetch(),
          clientsQuery.refetch(),
          resourcesQuery.refetch(),
          promptsQuery.refetch()
        ]).catch((error) => {
          console.error('Failed to refresh MCP queries after disabling:', error)
        })
      }
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

        if (tool.function.name === 'glob_search') {
          toolInputs.value[tool.function.name] = {
            pattern: '**/*.md',
            root: '',
            excludePatterns: '',
            maxResults: '1000',
            sortBy: 'name'
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
      ensureToolResultsSubscription()
    }
  )
  // ==================== 计算属性 ====================
  // 服务器列表
  const serverList = computed(() => {
    const servers = Object.entries(config.value.mcpServers ?? {}).map(([name, serverConfig]) => ({
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
  const startDefaultServers = async () => {
    const defaultServers = config.value.defaultServers
    for (const serverName of defaultServers) {
      try {
        const running = await mcpPresenter.isServerRunning(serverName)
        if (!running) {
          await mcpPresenter.startServer(serverName)
        }
      } catch (error) {
        console.error('Failed to auto-start MCP server', serverName, error)
      }
    }
  }

  const setMcpEnabled = async (enabled: boolean) => {
    try {
      // Optimistically set local state so toggle updates immediately
      config.value.mcpEnabled = enabled
      // Ensure config is ready so queries can execute
      if (!config.value.ready) {
        config.value.ready = true
      }

      await setMcpEnabledMutation.mutateAsync([enabled])
      // Force refresh config to keep presenter query state in sync
      await runQuery(configQuery, { force: true })

      // Wait a bit for config to sync, then refresh queries
      if (enabled) {
        await startDefaultServers()
        // Update server statuses first, then refresh tools
        await updateAllServerStatuses()
        // Wait a bit for servers to fully start and register tools
        await new Promise((resolve) => setTimeout(resolve, 300))
        // Ensure queries are refreshed after enabling - force refresh multiple times to ensure tools are loaded
        await Promise.all([
          loadTools({ force: true }),
          loadClients({ force: true }),
          loadPrompts({ force: true })
        ])
        // Refresh again after a short delay to ensure all tools are loaded
        setTimeout(async () => {
          if (config.value.mcpEnabled) {
            await Promise.all([loadTools({ force: true }), loadClients({ force: true })])
          }
        }, 1000)
      } else {
        // clearing server/tool state when disabling
        serverStatuses.value = {}
        toolInputs.value = {}
        toolResults.value = {}
        // Force refresh queries to get empty results
        await Promise.all([
          toolsQuery.refetch(),
          clientsQuery.refetch(),
          resourcesQuery.refetch(),
          promptsQuery.refetch()
        ])
      }

      return true
    } catch (error) {
      console.error(t('mcp.errors.setEnabledFailed'), error)
      // Rollback on error
      config.value.mcpEnabled = !enabled
      return false
    }
  }

  // 更新所有服务器状态
  const updateAllServerStatuses = async () => {
    if (!config.value.mcpEnabled) {
      return
    }

    for (const serverName of Object.keys(config.value.mcpServers)) {
      await updateServerStatus(serverName, true)
    }
    // Wait a bit for servers to register their tools
    await new Promise((resolve) => setTimeout(resolve, 100))
    // Force refresh tools and clients after updating all server statuses
    await Promise.all([loadTools({ force: true }), loadClients({ force: true })])
  }

  // 更新单个服务器状态
  const updateServerStatus = async (serverName: string, noRefresh: boolean = false) => {
    try {
      if (!config.value.mcpEnabled) {
        serverStatuses.value[serverName] = false
        return
      }

      serverStatuses.value[serverName] = await mcpPresenter.isServerRunning(serverName)
      if (!noRefresh) {
        // Refresh tools and clients when server status changes
        await Promise.all([loadTools({ force: true }), loadClients({ force: true })])
      }
      // 根据服务器的状态，关闭或者开启该服务器的所有工具
      const isRunning = serverStatuses.value[serverName] || false
      const currentTools =
        chatStore.chatConfig.enabledMcpTools || [...tools.value].map((tool) => tool.function.name)
      if (isRunning) {
        // Get server tools after refresh
        const serverTools = tools.value
          .filter((tool) => tool.server.name === serverName)
          .map((tool) => tool.function.name)
        if (serverTools.length > 0) {
          const mergedTools = Array.from(new Set([...currentTools, ...serverTools]))
          chatStore.updateChatConfig({ enabledMcpTools: mergedTools })
        }
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
      const state = await runQuery(toolsQuery, options)
      // 当用户没有显式选择启用的工具时，默认启用全部可用工具，避免重启后出现0个工具的情况
      if (
        state.status === 'success' &&
        (!chatStore.chatConfig.enabledMcpTools || chatStore.chatConfig.enabledMcpTools.length === 0)
      ) {
        const allToolNames = (state.data ?? []).map((tool) => tool.function.name)
        if (allToolNames.length > 0) {
          await chatStore.updateChatConfig({ enabledMcpTools: allToolNames })
        }
      }
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

  const buildToolRequest = (
    toolName: string,
    params: Record<string, unknown>,
    toolCallId?: string
  ): CallToolRequest => {
    return {
      id: toolCallId ?? Date.now().toString(),
      type: 'function',
      function: {
        name: toolName,
        arguments: JSON.stringify(params)
      }
    }
  }

  const callToolWithParams = async (
    toolName: string,
    params: Record<string, unknown>,
    toolCallId?: string
  ): Promise<CallToolResult> => {
    const request = buildToolRequest(toolName, params, toolCallId)
    return await callToolMutation.mutateAsync([request])
  }

  // 调用工具
  const callTool = async (toolName: string): Promise<CallToolResult> => {
    toolLoadingStates.value[toolName] = true
    try {
      // 准备工具参数
      const rawParams = toolInputs.value[toolName] || {}
      const params = { ...rawParams } as Record<string, unknown>

      // 特殊处理 glob_search 工具
      if (toolName === 'glob_search') {
        const pattern = typeof params.pattern === 'string' ? params.pattern.trim() : ''
        if (!pattern) {
          params.pattern = '**/*.md'
        }

        if (typeof params.root === 'string' && params.root.trim() === '') {
          delete params.root
        }

        if (typeof params.excludePatterns === 'string') {
          const parsed = params.excludePatterns
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
          if (parsed.length > 0) {
            params.excludePatterns = parsed
          } else {
            delete params.excludePatterns
          }
        }

        if (typeof params.maxResults === 'string') {
          const parsed = Number(params.maxResults)
          if (!Number.isNaN(parsed)) {
            params.maxResults = parsed
          } else {
            delete params.maxResults
          }
        }

        if (typeof params.sortBy === 'string' && params.sortBy.trim() === '') {
          delete params.sortBy
        }
      }

      return await callToolWithParams(toolName, params)
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
  const cleanupMcpEvents = () => {
    unsubscribeMcpEvents.forEach((unsubscribe) => unsubscribe())
    unsubscribeMcpEvents = []
  }

  const handleToolResultEvent = (result: ToolCallResultPayload) => {
    if (!config.value.mcpEnabled) {
      return
    }

    const toolKey = resolveToolResultKey(result)
    if (!toolKey) {
      console.warn('MCP tool result missing toolCallId and function_name', result)
      return
    }

    cacheToolResult(result.toolCallId, result.function_name, result.content)
  }

  const ensureToolResultsSubscription = () => {
    if (!config.value.mcpEnabled) {
      unsubscribeToolResults?.()
      unsubscribeToolResults = null
      return
    }

    if (!unsubscribeToolResults) {
      unsubscribeToolResults = toolingAdapter.subscribeToolResults(handleToolResultEvent)
    }
  }

  // 初始化事件监听
  const initEvents = () => {
    cleanupMcpEvents()

    unsubscribeMcpEvents = [
      mcpEventsAdapter.subscribeServerStarted((serverName) => {
        console.log(`MCP server started: ${serverName}`)
        updateServerStatus(serverName).then(() => {
          // Force refresh tools after server starts to ensure tool count is updated
          if (config.value.mcpEnabled) {
            loadTools({ force: true }).catch((error) => {
              console.error('Failed to refresh tools after server started:', error)
            })
          }
        })
      }),
      mcpEventsAdapter.subscribeServerStopped((serverName) => {
        console.log(`MCP server stopped: ${serverName}`)
        updateServerStatus(serverName).then(() => {
          // Force refresh tools after server stops to ensure tool count is updated
          if (config.value.mcpEnabled) {
            loadTools({ force: true }).catch((error) => {
              console.error('Failed to refresh tools after server stopped:', error)
            })
          }
        })
      }),
      mcpEventsAdapter.subscribeConfigChanged((payload?: ConfigQueryResult) => {
        console.log('MCP config changed', payload)
        if (payload) {
          // Directly sync from event payload to avoid unnecessary query
          syncConfigFromQuery(payload)
          // Update server statuses after config sync
          updateAllServerStatuses().catch((error) => {
            console.error('Failed to update server statuses after config change:', error)
          })
        } else {
          // Fallback to query if payload is missing
          loadConfig()
        }
      }),
      mcpEventsAdapter.subscribeServerStatusChanged(({ serverName, isRunning }) => {
        console.log(`MCP server ${serverName} status changed: ${isRunning}`)
        serverStatuses.value[serverName] = isRunning
      }),
      mcpEventsAdapter.subscribeCustomPromptsChanged(() => {
        console.log('Custom prompts changed, reloading prompts list')
        loadPrompts()
      })
    ]

    ensureToolResultsSubscription()
  }

  onScopeDispose(() => {
    cleanupMcpEvents()
    unsubscribeToolResults?.()
    unsubscribeToolResults = null
  })

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

  // MCP 安装缓存管理（用于 deeplink）
  const setMcpInstallCache = (value: string | null) => {
    mcpInstallCache.value = value
  }

  const clearMcpInstallCache = () => {
    mcpInstallCache.value = null
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
    mcpInstallCache,

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
    callToolWithParams,
    getPrompt,
    readResource,
    getToolResult,

    // NPM Registry 管理方法
    getNpmRegistryStatus,
    refreshNpmRegistry,
    setCustomNpmRegistry,
    setAutoDetectNpmRegistry,
    clearNpmRegistryCache,
    setMcpInstallCache,
    clearMcpInstallCache
  }
})
