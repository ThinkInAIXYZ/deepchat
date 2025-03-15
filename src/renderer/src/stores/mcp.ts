import { ref, computed, onMounted } from 'vue'
import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import { MCP_EVENTS } from '@/events'
import type { MCPConfig, MCPServerConfig, MCPToolDefinition } from '@shared/presenter'

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
  content: string
}

export const useMcpStore = defineStore('mcp', () => {
  // 获取MCP相关的presenter
  const mcpPresenter = usePresenter('mcpPresenter')

  // ==================== 状态定义 ====================
  // MCP配置
  const config = ref<MCPConfig>({
    mcpServers: {},
    defaultServer: '',
    mcpEnabled: false // 添加MCP启用状态
  })

  // MCP全局启用状态
  const mcpEnabled = computed(() => config.value.mcpEnabled)

  // 服务器状态
  const serverStatuses = ref<Record<string, boolean>>({})
  const serverLoadingStates = ref<Record<string, boolean>>({})
  const configLoading = ref(false)

  // 工具相关状态
  const tools = ref<MCPToolDefinition[]>([])
  const toolsLoading = ref(false)
  const toolsError = ref(false)
  const toolsErrorMessage = ref('')
  const toolLoadingStates = ref<Record<string, boolean>>({})
  const toolInputs = ref<Record<string, Record<string, string>>>({})
  const toolResults = ref<Record<string, string>>({})

  // ==================== 计算属性 ====================
  // 服务器列表
  const serverList = computed(() => {
    return Object.entries(config.value.mcpServers).map(([name, serverConfig]) => ({
      name,
      ...serverConfig,
      isRunning: serverStatuses.value[name] || false,
      isDefault: name === config.value.defaultServer,
      isLoading: serverLoadingStates.value[name] || false
    }))
  })

  // 工具数量
  const toolCount = computed(() => tools.value.length)
  const hasTools = computed(() => toolCount.value > 0)

  // ==================== 方法 ====================
  // 加载MCP配置
  const loadConfig = async () => {
    try {
      configLoading.value = true
      config.value = await mcpPresenter.getMcpConfig()

      // 获取服务器运行状态
      await updateAllServerStatuses()
    } catch (error) {
      console.error('Failed to load MCP config:', error)
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
      } else {
        // 如果禁用MCP，清空工具列表
        tools.value = []
      }

      return true
    } catch (error) {
      console.error('Failed to set MCP enabled state:', error)
      return false
    }
  }

  // 更新所有服务器状态
  const updateAllServerStatuses = async () => {
    for (const serverName of Object.keys(config.value.mcpServers)) {
      await updateServerStatus(serverName)
    }
  }

  // 更新单个服务器状态
  const updateServerStatus = async (serverName: string) => {
    try {
      serverStatuses.value[serverName] = await mcpPresenter.isServerRunning(serverName)
      if (config.value.mcpEnabled) {
        loadTools()
      }
    } catch (error) {
      console.error(`Failed to get server status for ${serverName}:`, error)
      serverStatuses.value[serverName] = false
    }
  }

  // 添加服务器
  const addServer = async (serverName: string, serverConfig: MCPServerConfig) => {
    try {
      await mcpPresenter.addMcpServer(serverName, serverConfig)
      await loadConfig()
      return true
    } catch (error) {
      console.error('Failed to add MCP server:', error)
      return false
    }
  }

  // 更新服务器
  const updateServer = async (serverName: string, serverConfig: Partial<MCPServerConfig>) => {
    try {
      await mcpPresenter.updateMcpServer(serverName, serverConfig)
      await loadConfig()
      return true
    } catch (error) {
      console.error('Failed to update MCP server:', error)
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
      console.error('Failed to remove MCP server:', error)
      return false
    }
  }

  // 设置默认服务器
  const setDefaultServer = async (serverName: string) => {
    try {
      await mcpPresenter.setDefaultServer(serverName)
      await loadConfig()
      return true
    } catch (error) {
      console.error('Failed to set default MCP server:', error)
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
      console.error(`Failed to toggle MCP server ${serverName}:`, error)
      return false
    } finally {
      serverLoadingStates.value[serverName] = false
    }
  }

  // 加载工具列表
  const loadTools = async () => {
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
      console.log('tools.value', tools.value)

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
      console.error('Failed to load MCP tools:', error)
      toolsError.value = true
      toolsErrorMessage.value = error instanceof Error ? error.message : String(error)
      return false
    } finally {
      toolsLoading.value = false
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
      console.error(`Failed to call tool ${toolName}:`, error)
      toolResults.value[toolName] = `错误: ${error}`
      throw error
    } finally {
      toolLoadingStates.value[toolName] = false
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
        console.log(`MCP tool call result:`, result)
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
  }

  // 立即初始化
  onMounted(async () => {
    await init()
  })

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
    mcpEnabled,

    // 计算属性
    serverList,
    toolCount,
    hasTools,

    // 方法
    loadConfig,
    updateAllServerStatuses,
    updateServerStatus,
    addServer,
    updateServer,
    removeServer,
    setDefaultServer,
    toggleServer,
    loadTools,
    updateToolInput,
    callTool,
    setMcpEnabled
  }
})
