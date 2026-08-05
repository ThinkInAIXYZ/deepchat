<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Textarea } from '@shadcn/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { DcBadge } from '@dc-ui/components/badge'
import { DcInlineError } from '@dc-ui/components/inline-error'
import type {
  MCPServerConfig,
  McpAuthorizationMode,
  McpCredentialBinding,
  McpCredentialInput,
  McpCredentialKind,
  McpCredentialStatus,
  McpEnterpriseIdentityProfile
} from '@shared/types/mcp'
import { EmojiPicker } from '@/components/emoji-picker'
import { Icon } from '@iconify/vue'
import { X } from '@lucide/vue'
import { createDeviceClient } from '@api/DeviceClient'
import { createMcpClient } from '@api/McpClient'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { nanoid } from 'nanoid'

const { t } = useI18n()
const deviceClient = createDeviceClient()
const mcpClient = createMcpClient()
const props = defineProps<{
  serverName?: string
  initialConfig?: MCPServerConfig
  editMode?: boolean
  defaultJsonConfig?: string
  submitting?: boolean
  nameError?: string
  submissionError?: string
}>()

const emit = defineEmits<{
  submit: [serverName: string, config: MCPServerConfig, credential?: McpCredentialInput]
  'input-change': []
  'name-change': []
}>()

// 表单状态
const name = ref(props.serverName || '')
const command = ref(props.initialConfig?.command || 'npx')
const args = ref(props.initialConfig?.args?.join('\n') || '')
const env = ref(JSON.stringify(props.initialConfig?.env || {}, null, 2))
const descriptions = ref(props.initialConfig?.descriptions || '')
type MCPServerTypeOption = 'sse' | 'stdio' | 'inmemory' | 'http'
const VALID_MCP_TYPES: MCPServerTypeOption[] = ['stdio', 'sse', 'http', 'inmemory']
const icons = ref(props.initialConfig?.icons || '📁')
const type = ref<MCPServerTypeOption>(
  (props.initialConfig?.type as MCPServerTypeOption | undefined) || 'stdio'
)
const baseUrl = ref(props.initialConfig?.baseUrl || '')
const customHeaders = ref('')
const customHeadersFocused = ref(false)
const customHeadersDisplayValue = ref('')
const npmRegistry = ref(props.initialConfig?.customNpmRegistry || '')
const authorizationMode = ref<McpAuthorizationMode>(
  props.initialConfig?.authorization?.mode || 'interactive'
)
const protectedResourceUrl = ref(props.initialConfig?.authorization?.protectedResourceUrl || '')
const authorizationServerIssuer = ref(
  props.initialConfig?.authorization?.authorizationServerIssuer || ''
)
const clientMetadataUrl = ref(props.initialConfig?.authorization?.clientMetadataUrl || '')
const authorizationClientId = ref(props.initialConfig?.authorization?.clientId || '')
const authorizationScopes = ref(props.initialConfig?.authorization?.scopes?.join(' ') || '')
const identityProfileId = ref(props.initialConfig?.authorization?.identityProfileId || '')
const keyAlgorithm = ref<'RS256' | 'ES256'>(
  props.initialConfig?.authorization?.keyAlgorithm || 'RS256'
)
const credentialSecret = ref('')
const privateKey = ref('')
const credentialStatuses = ref<McpCredentialStatus[]>([])
const enterpriseProfiles = ref<McpEnterpriseIdentityProfile[]>([])
const isAuthorizationMetadataLoading = ref(false)

watch(name, () => {
  emit('name-change')
})

// 判断是否是inmemory类型
const isInMemoryType = computed(() => type.value === 'inmemory')
// 判断是否是buildInFileSystem
const isBuildInFileSystem = computed(
  () => isInMemoryType.value && name.value === 'buildInFileSystem'
)
const isHttpTransportType = computed(() => type.value === 'http')
const isRemoteType = computed(() => type.value === 'sse' || isHttpTransportType.value)
const isMachineAuthorization = computed(() =>
  ['client_credentials', 'private_key_jwt', 'cross_app_access'].includes(authorizationMode.value)
)
const selectedCredentialKind = computed<McpCredentialKind | null>(() => {
  if (authorizationMode.value === 'client_credentials') return 'client_secret'
  if (authorizationMode.value === 'private_key_jwt') return 'private_key'
  if (authorizationMode.value === 'cross_app_access') {
    return 'enterprise_resource_secret'
  }
  return null
})
const selectedCredentialStatus = computed(() =>
  credentialStatuses.value.find((status) => status.kind === selectedCredentialKind.value)
)
const hasStaticAuthorizationHeader = computed(() =>
  customHeaders.value
    .split(/\r?\n/)
    .some((line) => line.trim().toLowerCase().startsWith('authorization='))
)
// 判断字段是否只读(inmemory类型除了args和env外都是只读的)
const isFieldReadOnly = computed(() => props.editMode && isInMemoryType.value)

// 格式化 JSON 对象为 Key=Value 文本
const formatJsonHeaders = (headers: Record<string, string>): string => {
  return Object.entries(headers)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

// 获取内置服务器的本地化名称和描述
const getLocalizedName = computed(() => {
  const name = props.serverName
  if (isInMemoryType.value && name) {
    return t(`mcp.inmemory.${name}.name`, name)
  }
  return name
})

const getLocalizedDesc = computed(() => {
  if (isInMemoryType.value && name.value) {
    return t(`mcp.inmemory.${name.value}.desc`, descriptions.value)
  }
  return descriptions.value
})

// 简单表单状态
const currentStep = ref(props.editMode ? 'detailed' : 'simple')
const jsonConfig = ref('')
const jsonConfigError = ref<string | null>(null)
const folderSelectionError = ref<string | null>(null)

// 当type变更时处理baseUrl的显示逻辑
const showBaseUrl = computed(() => isRemoteType.value)
// 添加计算属性来控制命令相关字段的显示
const showCommandFields = computed(() => type.value === 'stdio')
// 控制参数输入框的显示 (stdio 或 非buildInFileSystem的inmemory)
const showArgsInput = computed(
  () => showCommandFields.value || (isInMemoryType.value && !isBuildInFileSystem.value)
)

// 控制文件夹选择界面的显示 (仅针对 buildInFileSystem)
const showFolderSelector = computed(() => isBuildInFileSystem.value)

// 当命令是npx或node时，显示npmRegistry输入框
const showNpmRegistryInput = computed(() => {
  return type.value === 'stdio' && ['npx', 'node'].includes(command.value.toLowerCase())
})

// JSON配置解析
const parseJsonConfig = (): void => {
  jsonConfigError.value = null
  try {
    const parsedConfig = JSON.parse(jsonConfig.value)
    if (!parsedConfig.mcpServers || typeof parsedConfig.mcpServers !== 'object') {
      throw new Error('Invalid MCP server configuration format')
    }

    // 获取第一个服务器的配置
    const serverEntries = Object.entries(parsedConfig.mcpServers)
    if (serverEntries.length === 0) {
      throw new Error('No MCP servers found in configuration')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [serverName, serverConfig] = serverEntries[0] as [string, any]

    // 填充表单数据
    name.value = serverName
    command.value = serverConfig.command || 'npx'
    env.value = JSON.stringify(serverConfig.env || {}, null, 2)
    descriptions.value = serverConfig.descriptions || ''
    icons.value = serverConfig.icons || '📁'
    const incomingArgs = Array.isArray(serverConfig.args) ? serverConfig.args : []
    const incomingType = serverConfig.type as MCPServerTypeOption | undefined
    baseUrl.value = serverConfig.url || serverConfig.baseUrl || ''
    const fallbackType: MCPServerTypeOption = baseUrl.value ? 'http' : 'stdio'
    type.value =
      incomingType && VALID_MCP_TYPES.includes(incomingType) ? incomingType : fallbackType
    // 根据类型填充参数
    if (isBuildInFileSystem.value) {
      foldersList.value = incomingArgs
      args.value = incomingArgs.join('\n')
    } else {
      setArgsRowsFromArray(incomingArgs)
    }

    // 填充 customHeaders (如果存在)
    const headersFromConfig =
      (serverConfig.customHeaders as Record<string, string> | undefined) ||
      (serverConfig.headers as Record<string, string> | undefined)
    if (headersFromConfig) {
      customHeaders.value = formatJsonHeaders(headersFromConfig) // 加载时格式化为 Key=Value
    } else {
      customHeaders.value = '' // 默认空字符串
    }

    authorizationMode.value = serverConfig.authorization?.mode || 'interactive'
    protectedResourceUrl.value = serverConfig.authorization?.protectedResourceUrl || ''
    authorizationServerIssuer.value = serverConfig.authorization?.authorizationServerIssuer || ''
    clientMetadataUrl.value = serverConfig.authorization?.clientMetadataUrl || ''
    authorizationClientId.value = serverConfig.authorization?.clientId || ''
    authorizationScopes.value = serverConfig.authorization?.scopes?.join(' ') || ''
    identityProfileId.value = serverConfig.authorization?.identityProfileId || ''
    keyAlgorithm.value = serverConfig.authorization?.keyAlgorithm || 'RS256'

    // 切换到详细表单
    currentStep.value = 'detailed'
  } catch (error) {
    console.error('解析JSON配置失败:', error)
    jsonConfigError.value = t('settings.mcp.serverForm.parseError')
  }
}

// 切换到详细表单
const goToDetailedForm = (): void => {
  currentStep.value = 'detailed'
}

// 验证
const isNameValid = computed(() => name.value.trim().length > 0)
const isCommandValid = computed(() => {
  // 对于SSE类型，命令不是必需的
  if (isRemoteType.value) return true
  // 对于STDIO 或 inmemory 类型，命令是必需的
  if (type.value === 'stdio' || isInMemoryType.value) {
    return command.value.trim().length > 0
  }
  return true
})
const isEnvValid = computed(() => {
  try {
    if (!env.value.trim()) return true // Allow empty env
    JSON.parse(env.value)
    return true
  } catch {
    return false
  }
})
const isBaseUrlValid = computed(() => {
  if (!isRemoteType.value) return true
  return baseUrl.value.trim().length > 0
})

const isSecureOrLoopbackUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
  } catch {
    return false
  }
}

const isAuthorizationValid = computed(() => {
  if (!isHttpTransportType.value) return true
  if (authorizationMode.value === 'none') return true
  if (clientMetadataUrl.value.trim() && !clientMetadataUrl.value.trim().startsWith('https://')) {
    return false
  }
  if (!isMachineAuthorization.value) return true
  if (
    !authorizationClientId.value.trim() ||
    !isSecureOrLoopbackUrl(authorizationServerIssuer.value.trim()) ||
    !isSecureOrLoopbackUrl(protectedResourceUrl.value.trim())
  ) {
    return false
  }
  if (authorizationMode.value === 'cross_app_access' && !identityProfileId.value) {
    return false
  }
  if (selectedCredentialStatus.value?.configured) return true
  if (authorizationMode.value === 'private_key_jwt') return Boolean(privateKey.value)
  return Boolean(credentialSecret.value)
})

// 新增：验证 Key=Value 格式的函数
const validateKeyValueHeaders = (text: string): boolean => {
  if (!text.trim()) return true // 允许为空
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmedLine = line.trim()
    if (trimmedLine === '') {
      // 只允许空行
      continue
    }
    // 简单的检查，确保包含 = 并且 key 不为空
    const parts = trimmedLine.split('=')
    if (parts.length < 2 || !parts[0].trim()) {
      return false
    }
  }
  return true
}

// 新增：计算属性用于验证 Key=Value 格式
const isCustomHeadersFormatValid = computed(() => validateKeyValueHeaders(customHeaders.value))

const isFormValid = computed(() => {
  // 基本验证：名称必须有效
  if (!isNameValid.value) return false

  // 对于SSE类型，只需要名称和baseUrl有效
  if (isRemoteType.value) {
    return (
      isNameValid.value &&
      isBaseUrlValid.value &&
      isCustomHeadersFormatValid.value &&
      isAuthorizationValid.value
    )
  }

  // 对于STDIO类型，需要名称和命令有效，以及环境变量格式正确
  return isNameValid.value && isCommandValid.value && isEnvValid.value
})

// 参数输入相关状态 (列表式输入)
const argsRows = ref<Array<{ id: string; value: string }>>([])
const createArgsRows = (values: string[]): Array<{ id: string; value: string }> =>
  values.map((value) => ({
    id: nanoid(),
    value
  }))
const syncArgsRowsFromString = (value: string): void => {
  const parsedValues = value ? value.split(/\r?\n/) : []
  const currentValues = argsRows.value.map((row) => row.value)
  if (
    parsedValues.length === currentValues.length &&
    parsedValues.every((val, index) => val === currentValues[index])
  ) {
    return
  }
  argsRows.value = createArgsRows(parsedValues)
}
const setArgsRowsFromArray = (values: string[]): void => {
  syncArgsRowsFromString(values.join('\n'))
}
const addArgsRow = (): void => {
  argsRows.value.push({ id: nanoid(), value: '' })
}
const removeArgsRow = (id: string): void => {
  argsRows.value = argsRows.value.filter((row) => row.id !== id)
}

// 文件夹选择相关状态 (用于 buildInFileSystem)
const foldersList = ref<string[]>([])

// 添加文件夹选择方法
const addFolder = async (): Promise<void> => {
  folderSelectionError.value = null
  try {
    const result = await deviceClient.selectDirectory()

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0]
      if (!foldersList.value.includes(selectedPath)) {
        foldersList.value.push(selectedPath)
      }
    }
  } catch (error) {
    console.error('选择文件夹失败:', error)
    folderSelectionError.value = t('settings.mcp.serverForm.selectFolderError')
  }
}

// 移除文件夹
const removeFolder = (index: number): void => {
  foldersList.value.splice(index, 1)
}

// 监听外部 args 变化，更新内部列表
watch(
  args,
  (newArgs) => {
    if (isBuildInFileSystem.value) {
      // 对于 buildInFileSystem，args 是文件夹路径列表
      if (newArgs) {
        foldersList.value = newArgs.split(/\r?\n/).filter((item) => item.trim().length > 0)
      } else {
        foldersList.value = []
      }
    } else {
      syncArgsRowsFromString(newArgs || '')
    }
  },
  { immediate: true }
)

// 监听内部列表变化，更新外部 args 字符串
watch(
  argsRows,
  (newRows) => {
    if (isBuildInFileSystem.value) return
    const joinedArgs = newRows.map((row) => row.value).join('\n')
    if (args.value !== joinedArgs) args.value = joinedArgs
  },
  { deep: true }
)

// 监听文件夹列表变化，更新外部 args 字符串
watch(
  foldersList,
  (newList) => {
    if (isBuildInFileSystem.value) {
      args.value = newList.join('\n')
    }
  },
  { deep: true }
)

const getCredentialBinding = (
  config: MCPServerConfig = props.initialConfig as MCPServerConfig
): McpCredentialBinding | null => {
  if (!config?.serverId || !config.configGeneration || !config.bindingHash || !config.baseUrl) {
    return null
  }
  return {
    serverId: config.serverId,
    configGeneration: config.configGeneration,
    bindingHash: config.bindingHash,
    endpoint: config.baseUrl,
    protectedResourceUrl: config.authorization?.protectedResourceUrl,
    authorizationServerIssuer: config.authorization?.authorizationServerIssuer,
    clientId: config.authorization?.clientId
  }
}

const loadAuthorizationMetadata = async (): Promise<void> => {
  if (isAuthorizationMetadataLoading.value) return
  isAuthorizationMetadataLoading.value = true
  try {
    enterpriseProfiles.value = await mcpClient.listEnterpriseProfiles()
    const serverId = props.initialConfig?.serverId
    credentialStatuses.value = serverId ? await mcpClient.getCredentialStatus(serverId) : []
  } catch (error) {
    console.error('Failed to load MCP authorization metadata:', error)
  } finally {
    isAuthorizationMetadataLoading.value = false
  }
}

const removeStoredCredential = async (): Promise<void> => {
  const binding = getCredentialBinding()
  const kind = selectedCredentialKind.value
  if (!binding || !kind) return
  try {
    const status = await mcpClient.removeCredential(binding, kind)
    credentialStatuses.value = [
      ...credentialStatuses.value.filter((item) => item.kind !== kind),
      status
    ]
  } catch (error) {
    notifyRenderer({
      kind: 'error',
      code: 'settings.mcp.serverForm.credentialRemoveError',
      title: t('settings.mcp.serverForm.credentialRemoveError'),
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

onMounted(() => {
  void loadAuthorizationMetadata()
})

watch(
  [
    name,
    command,
    args,
    env,
    descriptions,
    icons,
    type,
    baseUrl,
    customHeaders,
    npmRegistry,
    authorizationMode,
    protectedResourceUrl,
    authorizationServerIssuer,
    clientMetadataUrl,
    authorizationClientId,
    authorizationScopes,
    identityProfileId,
    keyAlgorithm,
    credentialSecret,
    privateKey
  ],
  () => {
    emit('input-change')
  }
)

// 提交表单
const handleSubmit = (): void => {
  if (!isFormValid.value) return

  // 创建基本配置（必需的字段）
  const baseConfig = {
    descriptions: descriptions.value.trim(),
    icons: icons.value.trim(),
    type: type.value,
    enabled: props.initialConfig?.enabled ?? false
  }

  // 创建符合MCPServerConfig接口的配置对象
  let serverConfig: MCPServerConfig

  // 解析 env
  let parsedEnv = {}
  try {
    if ((type.value === 'stdio' || isInMemoryType.value) && env.value.trim()) {
      parsedEnv = JSON.parse(env.value)
    }
  } catch {
    return
  }

  // 解析 customHeaders
  const parsedCustomHeaders =
    isRemoteType.value && customHeaders.value.trim()
      ? parseKeyValueHeaders(customHeaders.value)
      : {}

  if (isRemoteType.value) {
    // SSE 或 HTTP 类型的服务器
    serverConfig = {
      ...baseConfig,
      command: '', // 提供空字符串作为默认值
      args: [], // 提供空数组作为默认值
      env: {}, // 提供空对象作为默认值
      baseUrl: baseUrl.value.trim(),
      customHeaders: parsedCustomHeaders, // 使用解析后的 Key=Value
      authorization:
        type.value === 'http'
          ? {
              mode: authorizationMode.value,
              protectedResourceUrl: protectedResourceUrl.value.trim() || undefined,
              authorizationServerIssuer: authorizationServerIssuer.value.trim() || undefined,
              clientMetadataUrl: clientMetadataUrl.value.trim() || undefined,
              clientId: authorizationClientId.value.trim() || undefined,
              scopes:
                authorizationScopes.value.trim().length > 0
                  ? authorizationScopes.value
                      .split(/[\s,]+/)
                      .map((scope) => scope.trim())
                      .filter(Boolean)
                  : undefined,
              identityProfileId: identityProfileId.value || undefined,
              keyAlgorithm:
                authorizationMode.value === 'private_key_jwt' ? keyAlgorithm.value : undefined
            }
          : props.initialConfig?.authorization
    }
  } else {
    // STDIO 或 inmemory 类型的服务器
    const normalizedArgs = isBuildInFileSystem.value
      ? foldersList.value.filter((folder) => folder.trim().length > 0)
      : argsRows.value.map((row) => row.value.trim()).filter((value) => value.length > 0)
    serverConfig = {
      ...baseConfig,
      command: command.value.trim(),
      args: normalizedArgs,
      env: parsedEnv,
      baseUrl: baseUrl.value.trim()
    }
  }

  // 填充 customHeaders (如果存在)
  if (serverConfig.customHeaders) {
    customHeaders.value = formatJsonHeaders(serverConfig.customHeaders) // 加载时格式化为 Key=Value
  } else {
    customHeaders.value = '' // 默认空字符串
  }

  // 添加 customNpmRegistry 字段（仅当显示npm registry输入框且有值时）
  if (showNpmRegistryInput.value && npmRegistry.value.trim()) {
    serverConfig.customNpmRegistry = npmRegistry.value.trim()
  } else {
    serverConfig.customNpmRegistry = ''
  }

  let credential: McpCredentialInput | undefined
  if (authorizationMode.value === 'client_credentials' && credentialSecret.value) {
    credential = { kind: 'client_secret', secret: credentialSecret.value }
  } else if (authorizationMode.value === 'private_key_jwt' && privateKey.value) {
    credential = {
      kind: 'private_key',
      privateKey: privateKey.value,
      algorithm: keyAlgorithm.value
    }
  } else if (authorizationMode.value === 'cross_app_access' && credentialSecret.value) {
    credential = {
      kind: 'enterprise_resource_secret',
      secret: credentialSecret.value
    }
  }

  emit('submit', name.value.trim(), serverConfig, credential)
}

const placeholder = `mcp配置示例
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        ...
      ]
    },
    "remoteServer":{
      "type": "http",
      "url": "https://your-mcp-server-url"
    }
  },

}`

// 监听 defaultJsonConfig 变化
watch(
  () => props.defaultJsonConfig,
  (newConfig) => {
    if (newConfig) {
      jsonConfig.value = newConfig
      parseJsonConfig()
    }
  },
  { immediate: true }
)

watch(jsonConfig, () => {
  jsonConfigError.value = null
})

// 遮蔽敏感内容的函数
const maskSensitiveValue = (value: string): string => {
  // 只遮蔽等号后面的值，保留键名
  return value.replace(/=(.+)/g, (_, val) => {
    const trimmedVal = val.trim()
    if (trimmedVal.length <= 4) {
      // 很短的值完全遮蔽
      return '=' + '*'.repeat(trimmedVal.length)
    } else if (trimmedVal.length <= 12) {
      // 中等长度：显示前1个字符，其余用固定数量星号
      return '=' + trimmedVal.substring(0, 1) + '*'.repeat(6)
    } else {
      // 长值：显示前2个和后2个字符，中间用固定8个星号
      const start = trimmedVal.substring(0, 2)
      const end = trimmedVal.substring(trimmedVal.length - 2)
      return '=' + start + '*'.repeat(8) + end
    }
  })
}

// 生成用于显示的 customHeaders 值
const updateCustomHeadersDisplay = (): void => {
  if (customHeadersFocused.value || !customHeaders.value.trim()) {
    customHeadersDisplayValue.value = customHeaders.value
  } else {
    // 遮蔽敏感内容
    const lines = customHeaders.value.split('\n')
    const maskedLines = lines.map((line) => {
      const trimmedLine = line.trim()
      if (!trimmedLine || !trimmedLine.includes('=')) {
        return line
      }
      return maskSensitiveValue(line)
    })
    customHeadersDisplayValue.value = maskedLines.join('\n')
  }
}

// 处理 customHeaders 获得焦点
const handleCustomHeadersFocus = (): void => {
  customHeadersFocused.value = true
  updateCustomHeadersDisplay()
}

// 处理 customHeaders 失去焦点
const handleCustomHeadersBlur = (): void => {
  customHeadersFocused.value = false
  updateCustomHeadersDisplay()
}

// 监听 customHeaders 变化以更新显示值
watch(
  customHeaders,
  () => {
    updateCustomHeadersDisplay()
  },
  { immediate: true }
)

// Watch for initial config changes (primarily for edit mode)
watch(
  () => props.initialConfig,
  (newConfig) => {
    // Check if we are in edit mode and have a new valid config, but avoid overwriting if defaultJsonConfig was also provided and parsed
    if (newConfig && props.editMode && !props.defaultJsonConfig) {
      // Reset fields based on initialConfig
      command.value = newConfig.command || 'npx'
      const incomingArgs = Array.isArray(newConfig.args) ? newConfig.args : []
      env.value = JSON.stringify(newConfig.env || {}, null, 2)
      descriptions.value = newConfig.descriptions || ''
      icons.value = newConfig.icons || '📁'
      type.value = newConfig.type || 'stdio'
      baseUrl.value = newConfig.baseUrl || ''
      npmRegistry.value = newConfig.customNpmRegistry || ''
      if (isBuildInFileSystem.value) {
        foldersList.value = incomingArgs
        args.value = incomingArgs.join('\n')
      } else {
        setArgsRowsFromArray(incomingArgs)
      }

      // Format customHeaders from initialConfig
      if (newConfig.customHeaders) {
        customHeaders.value = formatJsonHeaders(newConfig.customHeaders)
      } else {
        customHeaders.value = ''
      }

      authorizationMode.value = newConfig.authorization?.mode || 'interactive'
      protectedResourceUrl.value = newConfig.authorization?.protectedResourceUrl || ''
      authorizationServerIssuer.value = newConfig.authorization?.authorizationServerIssuer || ''
      clientMetadataUrl.value = newConfig.authorization?.clientMetadataUrl || ''
      authorizationClientId.value = newConfig.authorization?.clientId || ''
      authorizationScopes.value = newConfig.authorization?.scopes?.join(' ') || ''
      identityProfileId.value = newConfig.authorization?.identityProfileId || ''
      keyAlgorithm.value = newConfig.authorization?.keyAlgorithm || 'RS256'
      credentialSecret.value = ''
      privateKey.value = ''
      void loadAuthorizationMetadata()

      // Ensure we are in the detailed view for edit mode
      currentStep.value = 'detailed'
    }
  },
  { immediate: true } // Run immediately on component mount
)

// --- 新增辅助函数 ---
// 解析 Key=Value 格式为 JSON 对象
const parseKeyValueHeaders = (text: string): Record<string, string> => {
  const headers: Record<string, string> = {}
  if (!text) return headers
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmedLine = line.trim()
    if (trimmedLine === '') {
      // 跳过空行
      continue
    }
    const separatorIndex = trimmedLine.indexOf('=')
    if (separatorIndex > 0) {
      const key = trimmedLine.substring(0, separatorIndex).trim()
      const value = trimmedLine.substring(separatorIndex + 1).trim()
      if (key) {
        headers[key] = value
      }
    }
  }
  return headers
}

// 定义 customHeaders 的 placeholder
const customHeadersPlaceholder = `Authorization=Bearer your_token
HTTP-Referer=deepchatai.cn`
</script>

<template>
  <!-- 简单表单 -->
  <form v-if="currentStep === 'simple'" class="space-y-4 h-full flex flex-col">
    <ScrollArea class="h-0 grow">
      <div class="space-y-4 px-4 pb-4">
        <div class="text-sm">
          {{ t('settings.mcp.serverForm.jsonConfigIntro') }}
        </div>

        <div class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="json-config">
            {{ t('settings.mcp.serverForm.jsonConfig') }}
          </Label>
          <Textarea
            id="json-config"
            v-model="jsonConfig"
            rows="10"
            :placeholder="placeholder"
            :aria-invalid="Boolean(jsonConfigError)"
            :aria-describedby="jsonConfigError ? 'json-config-error' : undefined"
          />
          <DcInlineError id="json-config-error" :error="jsonConfigError ?? undefined" />
        </div>
      </div>
    </ScrollArea>

    <div class="flex justify-between pt-2 border-t px-4">
      <DcButton type="button" variant="outline" size="sm" @click="goToDetailedForm">
        {{ t('settings.mcp.serverForm.skipToManual') }}
      </DcButton>
      <DcButton type="button" size="sm" @click="parseJsonConfig">
        {{ t('settings.mcp.serverForm.parseAndContinue') }}
      </DcButton>
    </div>
  </form>

  <!-- 详细表单 -->
  <form
    v-else
    class="space-y-2 h-full flex flex-col"
    :inert="submitting || undefined"
    :aria-busy="submitting"
    @submit.prevent="handleSubmit"
  >
    <ScrollArea class="h-0 grow">
      <div class="space-y-2 px-4 pb-4">
        <!-- 服务器名称 -->
        <!-- 本地化名称 (针对inmemory类型) -->
        <div v-if="isInMemoryType && name" class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="localized-name">{{
            t('settings.mcp.serverForm.name')
          }}</Label>

          <div
            class="flex h-9 items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background opacity-50"
          >
            {{ getLocalizedName }}
          </div>
        </div>
        <div v-else class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="server-name">{{
            t('settings.mcp.serverForm.name')
          }}</Label>
          <Input
            id="server-name"
            v-model="name"
            :placeholder="t('settings.mcp.serverForm.namePlaceholder')"
            :disabled="editMode || isFieldReadOnly"
            required
          />
        </div>
        <DcInlineError v-if="nameError" :error="nameError" />

        <!-- 图标 -->
        <div class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="server-icon">{{
            t('settings.mcp.serverForm.icons')
          }}</Label>
          <div class="flex items-center space-x-2">
            <EmojiPicker v-model="icons" :disabled="isFieldReadOnly" />
          </div>
        </div>

        <!-- 服务器类型 -->
        <div class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="server-type">{{
            t('settings.mcp.serverForm.type')
          }}</Label>
          <Select v-model="type" :disabled="isFieldReadOnly">
            <SelectTrigger class="w-full">
              <SelectValue :placeholder="t('settings.mcp.serverForm.typePlaceholder')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">{{ t('settings.mcp.serverForm.typeStdio') }}</SelectItem>
              <SelectItem value="sse">
                <span>{{ t('settings.mcp.serverForm.typeSse') }}</span>
                <DcBadge variant="warning" class="px-1.5 py-0 text-[10px] font-normal">
                  {{ t('settings.mcp.serverForm.sseCompatibilityBadge') }}
                </DcBadge>
              </SelectItem>
              <SelectItem value="http">{{ t('settings.mcp.serverForm.typeHttp') }}</SelectItem>
              <SelectItem
                v-if="props.editMode && props.initialConfig?.type === 'inmemory'"
                value="inmemory"
                >{{ t('settings.mcp.serverForm.typeInMemory') }}</SelectItem
              >
            </SelectContent>
          </Select>
          <p v-if="type === 'sse'" class="text-xs text-amber-600 dark:text-amber-400">
            {{ t('settings.mcp.serverForm.sseMigrationHint') }}
          </p>
        </div>

        <!-- 基础URL，仅在类型为SSE或HTTP时显示 -->
        <div v-if="showBaseUrl" class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="server-base-url">{{
            t('settings.mcp.serverForm.baseUrl')
          }}</Label>
          <Input
            id="server-base-url"
            v-model="baseUrl"
            :placeholder="t('settings.mcp.serverForm.baseUrlPlaceholder')"
            :disabled="isFieldReadOnly"
            required
          />
        </div>

        <div v-if="isHttpTransportType" class="space-y-3 rounded-md border p-3">
          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="authorization-mode">
              {{ t('settings.mcp.serverForm.authorizationMode') }}
            </Label>
            <Select v-model="authorizationMode">
              <SelectTrigger id="authorization-mode" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="interactive">
                  {{ t('settings.mcp.serverForm.authorizationInteractive') }}
                </SelectItem>
                <SelectItem value="none">
                  {{ t('settings.mcp.serverForm.authorizationNone') }}
                </SelectItem>
                <SelectItem value="client_credentials">
                  {{ t('settings.mcp.serverForm.authorizationClientCredentials') }}
                </SelectItem>
                <SelectItem value="private_key_jwt">
                  {{ t('settings.mcp.serverForm.authorizationPrivateKeyJwt') }}
                </SelectItem>
                <SelectItem value="cross_app_access">
                  {{ t('settings.mcp.serverForm.authorizationEnterprise') }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              {{ t(`settings.mcp.serverForm.authorizationHelp.${authorizationMode}`) }}
            </p>
          </div>

          <div
            v-if="hasStaticAuthorizationHeader"
            class="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
          >
            {{ t('settings.mcp.serverForm.authorizationHeaderOverride') }}
          </div>

          <template v-if="authorizationMode !== 'none'">
            <div class="space-y-2">
              <Label class="text-xs text-muted-foreground" for="protected-resource-url">
                {{ t('settings.mcp.serverForm.protectedResourceUrl') }}
              </Label>
              <Input
                id="protected-resource-url"
                v-model="protectedResourceUrl"
                :required="isMachineAuthorization"
                :placeholder="t('settings.mcp.serverForm.protectedResourceUrlPlaceholder')"
              />
            </div>

            <div class="space-y-2">
              <Label class="text-xs text-muted-foreground" for="authorization-server-issuer">
                {{ t('settings.mcp.serverForm.authorizationServerIssuer') }}
              </Label>
              <Input
                id="authorization-server-issuer"
                v-model="authorizationServerIssuer"
                :required="isMachineAuthorization"
                :placeholder="t('settings.mcp.serverForm.authorizationServerIssuerPlaceholder')"
              />
            </div>

            <div v-if="authorizationMode === 'interactive'" class="space-y-2">
              <Label class="text-xs text-muted-foreground" for="client-metadata-url">
                {{ t('settings.mcp.serverForm.clientMetadataUrl') }}
              </Label>
              <Input
                id="client-metadata-url"
                v-model="clientMetadataUrl"
                placeholder="https://client.example/.well-known/oauth-client"
              />
            </div>

            <div v-if="isMachineAuthorization" class="space-y-2">
              <Label class="text-xs text-muted-foreground" for="authorization-client-id">
                {{ t('settings.mcp.serverForm.authorizationClientId') }}
              </Label>
              <Input id="authorization-client-id" v-model="authorizationClientId" required />
            </div>

            <div class="space-y-2">
              <Label class="text-xs text-muted-foreground" for="authorization-scopes">
                {{ t('settings.mcp.serverForm.authorizationScopes') }}
              </Label>
              <Input
                id="authorization-scopes"
                v-model="authorizationScopes"
                :placeholder="t('settings.mcp.serverForm.authorizationScopesPlaceholder')"
              />
            </div>

            <div v-if="authorizationMode === 'private_key_jwt'" class="space-y-2">
              <Label class="text-xs text-muted-foreground" for="key-algorithm">
                {{ t('settings.mcp.serverForm.keyAlgorithm') }}
              </Label>
              <Select v-model="keyAlgorithm">
                <SelectTrigger id="key-algorithm" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RS256">RS256</SelectItem>
                  <SelectItem value="ES256">ES256</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div v-if="authorizationMode === 'cross_app_access'" class="space-y-2">
              <Label class="text-xs text-muted-foreground" for="identity-profile">
                {{ t('settings.mcp.serverForm.identityProfile') }}
              </Label>
              <Select v-model="identityProfileId">
                <SelectTrigger id="identity-profile" class="w-full">
                  <SelectValue
                    :placeholder="t('settings.mcp.serverForm.identityProfilePlaceholder')"
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="profile in enterpriseProfiles"
                    :key="profile.id"
                    :value="profile.id"
                  >
                    {{ profile.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div v-if="isMachineAuthorization" class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <Label class="text-xs text-muted-foreground" for="credential-input">
                  {{
                    authorizationMode === 'private_key_jwt'
                      ? t('settings.mcp.serverForm.privateKey')
                      : t('settings.mcp.serverForm.clientSecret')
                  }}
                </Label>
                <DcButton
                  v-if="selectedCredentialStatus?.configured"
                  type="button"
                  variant="ghost"
                  size="sm"
                  @click="removeStoredCredential"
                >
                  {{ t('settings.mcp.serverForm.removeCredential') }}
                </DcButton>
              </div>
              <Textarea
                v-if="authorizationMode === 'private_key_jwt'"
                id="credential-input"
                v-model="privateKey"
                rows="5"
                :placeholder="
                  selectedCredentialStatus?.configured
                    ? t('settings.mcp.serverForm.credentialConfiguredPlaceholder')
                    : '-----BEGIN PRIVATE KEY-----'
                "
              />
              <Input
                v-else
                id="credential-input"
                v-model="credentialSecret"
                type="password"
                autocomplete="new-password"
                :placeholder="
                  selectedCredentialStatus?.configured
                    ? t('settings.mcp.serverForm.credentialConfiguredPlaceholder')
                    : ''
                "
              />
              <p v-if="selectedCredentialStatus?.configured" class="text-xs text-muted-foreground">
                {{ t('settings.mcp.serverForm.credentialConfigured') }}
                <span v-if="selectedCredentialStatus.fingerprint">
                  · {{ selectedCredentialStatus.fingerprint }}
                </span>
              </p>
              <p
                v-if="selectedCredentialStatus && !selectedCredentialStatus.persistent"
                class="text-xs text-amber-700 dark:text-amber-300"
              >
                {{ t('settings.mcp.serverForm.credentialMemoryOnly') }}
              </p>
            </div>
          </template>
        </div>

        <!-- 命令 -->
        <div v-if="showCommandFields" class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="server-command">{{
            t('settings.mcp.serverForm.command')
          }}</Label>
          <Input
            id="server-command"
            v-model="command"
            :placeholder="t('settings.mcp.serverForm.commandPlaceholder')"
            :disabled="isFieldReadOnly"
            required
          />
        </div>

        <!-- 文件夹选择 (特殊处理 buildInFileSystem) -->
        <div v-if="showFolderSelector" class="space-y-2">
          <Label class="text-xs text-muted-foreground">
            {{ t('settings.mcp.serverForm.folders') }}
          </Label>
          <div class="space-y-2">
            <!-- 文件夹列表 -->
            <div
              v-for="(folder, index) in foldersList"
              :key="index"
              class="flex items-center justify-between p-2 border border-input rounded-md bg-background"
            >
              <span class="text-sm truncate flex-1 mr-2" :title="folder">{{ folder }}</span>
              <DcButton
                type="button"
                variant="ghost"
                size="sm"
                class="h-6 w-6 p-0 hover:bg-destructive hover:text-destructive-foreground"
                @click="removeFolder(index)"
              >
                <X class="h-3 w-3" />
              </DcButton>
            </div>

            <!-- 添加文件夹按钮 -->
            <DcButton
              type="button"
              variant="outline"
              size="sm"
              class="w-full flex items-center gap-2"
              @click="addFolder"
            >
              <Icon icon="lucide:folder-plus" class="h-4 w-4" />
              {{ t('settings.mcp.serverForm.addFolder') }}
            </DcButton>
            <DcInlineError v-if="folderSelectionError" :error="folderSelectionError" />

            <!-- 空状态提示 -->
            <div
              v-if="foldersList.length === 0"
              class="text-xs text-muted-foreground text-center py-4"
            >
              {{ t('settings.mcp.serverForm.noFoldersSelected') }}
            </div>
          </div>
        </div>
        <!-- 参数 (标签式输入 for stdio/inmemory) -->
        <div v-else-if="showArgsInput" class="space-y-2">
          <div class="flex items-center justify-between">
            <Label class="text-xs text-muted-foreground" for="server-args">
              {{ t('settings.mcp.serverForm.args') }}
            </Label>
            <DcButton type="button" variant="ghost" size="sm" @click="addArgsRow">
              {{ t('settings.mcp.serverForm.addArg') }}
            </DcButton>
          </div>
          <div class="space-y-2 max-h-48 overflow-y-auto pr-1">
            <div v-for="row in argsRows" :key="row.id" class="grid grid-cols-12 gap-2 items-center">
              <Input
                v-model="row.value"
                class="col-span-11"
                :placeholder="t('settings.mcp.serverForm.argPlaceholder')"
              />
              <DcButton
                type="button"
                variant="ghost"
                size="icon"
                class="col-span-1"
                @click="removeArgsRow(row.id)"
              >
                <X class="h-4 w-4" />
              </DcButton>
            </div>
          </div>
          <!-- 隐藏原始Input，但保留v-model绑定以利用其验证状态或原有逻辑(如果需要) -->
          <Input id="server-args" v-model="args" class="hidden" />
        </div>

        <!-- 环境变量 -->
        <div v-if="showCommandFields || isInMemoryType" class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="server-env">{{
            t('settings.mcp.serverForm.env')
          }}</Label>
          <Textarea
            id="server-env"
            v-model="env"
            rows="5"
            :placeholder="t('settings.mcp.serverForm.envPlaceholder')"
            :class="{ 'border-red-500': !isEnvValid }"
            :aria-invalid="!isEnvValid"
            :aria-describedby="!isEnvValid ? 'server-env-error' : undefined"
          />
          <DcInlineError
            v-if="!isEnvValid"
            id="server-env-error"
            :error="t('settings.mcp.serverForm.envInvalid')"
          />
        </div>

        <!-- 描述 -->
        <!-- 本地化描述 (针对inmemory类型) -->
        <div v-if="isInMemoryType && name" class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="localized-desc">{{
            t('settings.mcp.serverForm.descriptions')
          }}</Label>
          <div
            class="flex h-9 items-center rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background opacity-50"
            :title="getLocalizedDesc"
          >
            <span class="block truncate min-w-0">
              {{ getLocalizedDesc }}
            </span>
          </div>
        </div>
        <div v-else class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="server-description">{{
            t('settings.mcp.serverForm.descriptions')
          }}</Label>
          <Input
            id="server-description"
            v-model="descriptions"
            :placeholder="t('settings.mcp.serverForm.descriptionsPlaceholder')"
            :disabled="isFieldReadOnly"
          />
        </div>
        <!-- NPM Registry 自定义设置 (仅在命令为 npx 或 node 时显示) -->
        <div v-if="showNpmRegistryInput" class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="npm-registry">
            {{ t('settings.mcp.serverForm.npmRegistry') }}
          </Label>
          <Input
            id="npm-registry"
            v-model="npmRegistry"
            :placeholder="t('settings.mcp.serverForm.npmRegistryPlaceholder')"
          />
        </div>
        <!-- Custom Headers，仅在类型为SSE或HTTP时显示 -->
        <div v-if="showBaseUrl" class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="server-custom-headers">{{
            t('settings.mcp.serverForm.customHeaders')
          }}</Label>
          <div class="relative">
            <Textarea
              id="server-custom-headers"
              v-model="customHeaders"
              rows="5"
              :placeholder="customHeadersPlaceholder"
              :class="{
                'border-red-500': !isCustomHeadersFormatValid,
                'transition-opacity duration-200': true
              }"
              :disabled="isFieldReadOnly"
              @focus="handleCustomHeadersFocus"
              @blur="handleCustomHeadersBlur"
            />
            <!-- 遮罩层，仅在失去焦点且有内容时显示 -->
            <div
              v-if="!customHeadersFocused && customHeaders.trim()"
              class="absolute inset-0 bg-background rounded-md border pointer-events-none"
              :class="{ 'border-red-500': !isCustomHeadersFormatValid }"
            >
              <div
                class="p-3 text-sm font-mono whitespace-pre-wrap text-muted-foreground select-none overflow-hidden break-all"
                style="line-height: 1.4; word-break: break-all"
              >
                {{ customHeadersDisplayValue }}
              </div>
            </div>
          </div>
          <p v-if="!isCustomHeadersFormatValid" class="text-xs text-red-500">
            {{ t('settings.mcp.serverForm.invalidKeyValueFormat') }}
          </p>
          <p
            v-if="!customHeadersFocused && customHeaders.trim()"
            class="text-xs text-muted-foreground"
          >
            {{ t('settings.mcp.serverForm.clickToEdit') }}
          </p>
        </div>
      </div>
    </ScrollArea>

    <!-- 提交按钮 -->
    <div class="flex items-center justify-between gap-3 pt-2 border-t px-4">
      <DcInlineError class="min-w-0" :error="submissionError" />
      <DcButton type="submit" size="sm" class="ml-auto" :disabled="!isFormValid || submitting">
        <Icon
          v-if="submitting"
          icon="lucide:loader-circle"
          class="mr-1.5 size-3.5 animate-spin"
          aria-hidden="true"
        />
        {{ t('settings.mcp.serverForm.submit') }}
      </DcButton>
    </div>
  </form>
</template>
