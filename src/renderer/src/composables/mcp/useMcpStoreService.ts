import { ref, computed, onMounted, watch, onScopeDispose } from 'vue'
import { useIpcQuery } from '@/composables/useIpcQuery'
import { useIpcMutation } from '@/composables/useIpcMutation'
import {
  useMcpToolingAdapter,
  resolveToolResultKey,
  type ToolCallResultPayload
} from '@/composables/mcp/useMcpToolingAdapter'
import { useMcpEventsAdapter } from '@/composables/mcp/useMcpEventsAdapter'
import { useMcpAdapter } from '@/composables/mcp/useMcpAdapter'
import { computeMcpConfigUpdate } from '@/composables/mcp/mcpConfigSync'
import { useI18n } from 'vue-i18n'
// import { useChatStore } from '@/stores/chat' // Removed in Phase 6
import { useQuery, type UseMutationReturn, type UseQueryReturn } from '@pinia/colada'
import type {
  IPresenter,
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

export const useMcpStoreService = () => {
  // const chatStore = useChatStore() // Removed in Phase 6
  const { t } = useI18n()
  const mcpAdapter = useMcpAdapter()

  const toolingAdapter = useMcpToolingAdapter()
  const mcpEventsAdapter = useMcpEventsAdapter()
  let unsubscribeToolResults: (() => void) | null = null
  let unsubscribeMcpEvents: Array<() => void> = []

  const config = ref<MCPConfig>({
    mcpServers: {},
    defaultServers: [],
    mcpEnabled: true,
    ready: false
  })

  const mcpInstallCache = ref<string | null>(null)

  const mcpEnabled = computed(() => config.value.mcpEnabled)

  const serverStatuses = ref<Record<string, boolean>>({})
  const serverLoadingStates = ref<Record<string, boolean>>({})
  const configLoading = ref(false)

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
        mcpAdapter.getMcpServers(),
        mcpAdapter.getMcpDefaultServers(),
        mcpAdapter.getMcpEnabled()
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
      return await mcpAdapter.getAllPrompts()
    } catch (error) {
      console.warn('Failed to load MCP prompts:', error)
      return []
    }
  }

  const loadCustomPrompts = async (): Promise<PromptListEntry[]> => {
    try {
      const configPrompts: Prompt[] = await mcpAdapter.getCustomPrompts()
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

  type CallToolRequest = Parameters<IPresenter['mcpPresenter']['callTool']>[0]
  type CallToolResult = Awaited<ReturnType<IPresenter['mcpPresenter']['callTool']>>
  type CallToolMutationVars = Parameters<IPresenter['mcpPresenter']['callTool']>

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

    if (previousReady && mcpEnabledChanged) {
      if (nextConfig.mcpEnabled) {
        Promise.all([
          loadTools({ force: true }),
          loadClients({ force: true }),
          loadPrompts({ force: true })
        ]).catch((error) => {
          console.error('Failed to refresh MCP queries after enabling:', error)
        })
      } else {
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
  const serverList = computed(() => {
    const servers = Object.entries(config.value.mcpServers ?? {}).map(([name, serverConfig]) => ({
      name,
      ...serverConfig,
      isRunning: serverStatuses.value[name] || false,
      isDefault: config.value.defaultServers.includes(name),
      isLoading: serverLoadingStates.value[name] || false
    }))

    return servers.sort((a, b) => {
      const aIsInmemory = a.type === 'inmemory'
      const bIsInmemory = b.type === 'inmemory'

      if (aIsInmemory && !bIsInmemory) return -1
      if (!aIsInmemory && bIsInmemory) return 1

      return 0
    })
  })

  const defaultServersCount = computed(() => config.value.defaultServers.length)

  const hasMaxDefaultServers = computed(() => defaultServersCount.value >= 30)

  const toolCount = computed(() => tools.value.length)
  const hasTools = computed(() => toolCount.value > 0)

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

  const startDefaultServers = async () => {
    const defaultServers = config.value.defaultServers
    for (const serverName of defaultServers) {
      try {
        const running = await mcpAdapter.isServerRunning(serverName)
        if (!running) {
          await mcpAdapter.startServer(serverName)
        }
      } catch (error) {
        console.error('Failed to auto-start MCP server', serverName, error)
      }
    }
  }

  const setMcpEnabled = async (enabled: boolean) => {
    try {
      config.value.mcpEnabled = enabled
      if (!config.value.ready) {
        config.value.ready = true
      }

      await setMcpEnabledMutation.mutateAsync([enabled])
      await runQuery(configQuery, { force: true })

      if (enabled) {
        await startDefaultServers()
        await updateAllServerStatuses()
        await new Promise((resolve) => setTimeout(resolve, 300))
        await Promise.all([
          loadTools({ force: true }),
          loadClients({ force: true }),
          loadPrompts({ force: true })
        ])
        setTimeout(async () => {
          if (config.value.mcpEnabled) {
            await Promise.all([loadTools({ force: true }), loadClients({ force: true })])
          }
        }, 1000)
      } else {
        serverStatuses.value = {}
        toolInputs.value = {}
        toolResults.value = {}
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
      config.value.mcpEnabled = !enabled
      return false
    }
  }

  const updateAllServerStatuses = async () => {
    if (!config.value.mcpEnabled) {
      return
    }

    for (const serverName of Object.keys(config.value.mcpServers)) {
      await updateServerStatus(serverName, true)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    await Promise.all([loadTools({ force: true }), loadClients({ force: true })])
  }

  const updateServerStatus = async (serverName: string, noRefresh: boolean = false) => {
    try {
      if (!config.value.mcpEnabled) {
        serverStatuses.value[serverName] = false
        return
      }

      serverStatuses.value[serverName] = await mcpAdapter.isServerRunning(serverName)
      if (!noRefresh) {
        await Promise.all([loadTools({ force: true }), loadClients({ force: true })])
      }
      // All MCP tools are now available by default (Phase 6: chatConfig removed)
      // No need to update enabledMcpTools since tool selection has been removed
    } catch (error) {
      console.error(t('mcp.errors.getServerStatusFailed', { serverName }), error)
      serverStatuses.value[serverName] = false
    }
  }

  const addServer = async (serverName: string, serverConfig: MCPServerConfig) => {
    try {
      const success = await addServerMutation.mutateAsync([serverName, serverConfig])
      if (success) {
        await runQuery(configQuery, { force: true })
        return { success: true, message: '' }
      }
      return { success: false, message: t('mcp.errors.addServerFailed') }
    } catch (error) {
      console.error(t('mcp.errors.addServerFailed'), error)
      return { success: false, message: t('mcp.errors.addServerFailed') }
    }
  }

  const updateServer = async (serverName: string, serverConfig: Partial<MCPServerConfig>) => {
    try {
      await updateServerMutation.mutateAsync([serverName, serverConfig])
      await runQuery(configQuery, { force: true })
      return true
    } catch (error) {
      console.error(t('mcp.errors.updateServerFailed'), error)
      return false
    }
  }

  const removeServer = async (serverName: string) => {
    try {
      await removeServerMutation.mutateAsync([serverName])
      await runQuery(configQuery, { force: true })
      return true
    } catch (error) {
      console.error(t('mcp.errors.removeServerFailed'), error)
      return false
    }
  }

  const toggleDefaultServer = async (serverName: string) => {
    try {
      if (config.value.defaultServers.includes(serverName)) {
        await removeDefaultServerMutation.mutateAsync([serverName])
      } else {
        if (hasMaxDefaultServers.value) {
          return { success: false, message: t('mcp.errors.maxDefaultServersReached') }
        }
        await addDefaultServerMutation.mutateAsync([serverName])
      }
      await runQuery(configQuery, { force: true })
      return { success: true, message: '' }
    } catch (error) {
      console.error(t('mcp.errors.toggleDefaultServerFailed'), error)
      return { success: false, message: String(error) }
    }
  }

  const resetToDefaultServers = async () => {
    try {
      await resetToDefaultServersMutation.mutateAsync([])
      await runQuery(configQuery, { force: true })
      return true
    } catch (error) {
      console.error(t('mcp.errors.resetToDefaultFailed'), error)
      return false
    }
  }

  const toggleServer = async (serverName: string) => {
    if (serverLoadingStates.value[serverName]) {
      return false
    }

    const currentStatus = serverStatuses.value[serverName] || false
    const targetStatus = !currentStatus
    serverStatuses.value[serverName] = targetStatus
    serverLoadingStates.value[serverName] = true

    try {
      if (currentStatus) {
        await mcpAdapter.stopServer(serverName)
      } else {
        await mcpAdapter.startServer(serverName)
      }

      await updateServerStatus(serverName)
      return true
    } catch (error) {
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
      // All MCP tools are now available by default (Phase 6: chatConfig removed)
    } catch (error) {
      console.error(t('mcp.errors.loadToolsFailed'), error)
    }
  }

  const loadPrompts = async (options?: QueryExecuteOptions) => {
    try {
      await runQuery(promptsQuery, options)
    } catch (error) {
      console.error(t('mcp.errors.loadPromptsFailed'), error)
    }
  }

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

  const callTool = async (toolName: string): Promise<CallToolResult> => {
    toolLoadingStates.value[toolName] = true
    try {
      const rawParams = toolInputs.value[toolName] || {}
      const params = { ...rawParams } as Record<string, unknown>

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

  const getPrompt = async (
    prompt: PromptListEntry,
    args?: Record<string, unknown>
  ): Promise<unknown> => {
    try {
      const isCustomPrompt = prompt.client?.name === 'deepchat/custom-prompts-server'

      if (isCustomPrompt) {
        const customPrompts: Prompt[] = await mcpAdapter.getCustomPrompts()
        const matchedPrompt = customPrompts.find((p) => p.name === prompt.name)

        if (!matchedPrompt) {
          throw new Error(t('mcp.errors.promptNotFound', { name: prompt.name }))
        }

        if (!matchedPrompt.content || matchedPrompt.content.trim() === '') {
          throw new Error(t('mcp.errors.emptyPromptContent', { name: prompt.name }))
        }

        let content = matchedPrompt.content

        if (args && matchedPrompt.parameters) {
          const requiredParams = matchedPrompt.parameters
            .filter((param) => param.required)
            .map((param) => param.name)

          const missingParams = requiredParams.filter((paramName) => !(paramName in args))
          if (missingParams.length > 0) {
            throw new Error(t('mcp.errors.missingParameters', { params: missingParams.join(', ') }))
          }

          const validParamNames = matchedPrompt.parameters.map((param) => param.name)
          const invalidParams = Object.keys(args).filter((key) => !validParamNames.includes(key))
          if (invalidParams.length > 0) {
            throw new Error(t('mcp.errors.invalidParameters', { params: invalidParams.join(', ') }))
          }

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

      if (!config.value.mcpEnabled) {
        throw new Error(t('mcp.errors.mcpDisabled'))
      }

      return await mcpAdapter.getPrompt(prompt, args)
    } catch (error) {
      console.error(t('mcp.errors.getPromptFailed'), error)
      throw error
    }
  }

  const readResource = async (resource: ResourceListEntry): Promise<Resource> => {
    if (!config.value.mcpEnabled) {
      throw new Error(t('mcp.errors.mcpDisabled'))
    }

    try {
      return await mcpAdapter.readResource(resource)
    } catch (error) {
      console.error(t('mcp.errors.readResourceFailed'), error)
      throw error
    }
  }

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

  const initEvents = () => {
    cleanupMcpEvents()

    unsubscribeMcpEvents = [
      mcpEventsAdapter.subscribeServerStarted((serverName) => {
        console.log(`MCP server started: ${serverName}`)
        updateServerStatus(serverName).then(() => {
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
          syncConfigFromQuery(payload)
          updateAllServerStatuses().catch((error) => {
            console.error('Failed to update server statuses after config change:', error)
          })
        } else {
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

  const init = async () => {
    initEvents()
    await loadConfig()

    await loadPrompts()

    if (config.value.mcpEnabled) {
      await loadTools()
      await loadClients()
    }

    // All MCP tools are now available by default (Phase 6: chatConfig removed)
  }

  const handleActiveThreadChange = () => {
    // All MCP tools are now available by default (Phase 6: chatConfig removed)
    // No longer need to watch for active thread changes to update enabledMcpTools
  }

  onMounted(async () => {
    await init()
    handleActiveThreadChange()
  })

  const getNpmRegistryStatus = async () => {
    return await mcpAdapter.getNpmRegistryStatus()
  }

  const refreshNpmRegistry = async (): Promise<string> => {
    return await mcpAdapter.refreshNpmRegistry()
  }

  const setCustomNpmRegistry = async (registry: string | undefined): Promise<void> => {
    await mcpAdapter.setCustomNpmRegistry(registry)
  }

  const setAutoDetectNpmRegistry = async (enabled: boolean): Promise<void> => {
    await mcpAdapter.setAutoDetectNpmRegistry(enabled)
  }

  const clearNpmRegistryCache = async (): Promise<void> => {
    await mcpAdapter.clearNpmRegistryCache()
  }

  const setMcpInstallCache = (value: string | null) => {
    mcpInstallCache.value = value
  }

  const clearMcpInstallCache = () => {
    mcpInstallCache.value = null
  }

  return {
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

    serverList,
    toolCount,
    hasTools,
    clients,

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

    getNpmRegistryStatus,
    refreshNpmRegistry,
    setCustomNpmRegistry,
    setAutoDetectNpmRegistry,
    clearNpmRegistryCache,
    setMcpInstallCache,
    clearMcpInstallCache
  }
}
