<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { MCPServerConfig } from '@shared/presenter'
import { EmojiPicker } from '@/components/uikit/emoji-picker'
import { useToast } from '@/components/ui/toast'
import { Icon } from '@iconify/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { ChevronDown, X } from 'lucide-vue-next'
import { Badge } from '@shadcn/components/ui/badge'
import ModelSelect from '@/components/ModelSelect.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { useSettingsStore } from '@/stores/settings'
import type { RENDERER_MODEL_META } from '@shared/presenter'
import { MCP_MARKETPLACE_URL, HIGRESS_MCP_MARKETPLACE_URL } from './const'
import { usePresenter } from '@/composables/usePresenter'
import { useThemeStore } from '@/stores/theme'
import { ModelType } from '@shared/model'

const { t } = useI18n()
const { toast } = useToast()
const settingsStore = useSettingsStore()
const devicePresenter = usePresenter('devicePresenter')
const themeStore = useThemeStore()
const props = defineProps<{
  serverName?: string
  initialConfig?: MCPServerConfig
  editMode?: boolean
  defaultJsonConfig?: string
}>()

const emit = defineEmits<{
  submit: [serverName: string, config: MCPServerConfig]
}>()

// 表单状态
const name = ref(props.serverName || '')
const command = ref(props.initialConfig?.command || 'npx')
const args = ref(props.initialConfig?.args?.join(' ') || '')
const env = ref(JSON.stringify(props.initialConfig?.env || {}, null, 2))
const descriptions = ref(props.initialConfig?.descriptions || '')
const icons = ref(props.initialConfig?.icons || '📁')
const type = ref<'sse' | 'stdio' | 'inmemory' | 'http'>(props.initialConfig?.type || 'stdio')
const baseUrl = ref(props.initialConfig?.baseUrl || '')
const customHeaders = ref('')
const customHeadersFocused = ref(false)
const customHeadersDisplayValue = ref('')
const npmRegistry = ref(props.initialConfig?.customNpmRegistry || '')

// 模型选择相关
const modelSelectOpen = ref(false)
const selectedImageModel = ref<RENDERER_MODEL_META | null>(null)
const selectedImageModelProvider = ref('')

// E2B 配置相关
const useE2B = ref(false)
const e2bApiKey = ref('')

// 判断是否是inmemory类型
const isInMemoryType = computed(() => type.value === 'inmemory')
// 判断是否是imageServer
const isImageServer = computed(() => isInMemoryType.value && name.value === 'imageServer')
// 判断是否是buildInFileSystem
const isBuildInFileSystem = computed(
  () => isInMemoryType.value && name.value === 'buildInFileSystem'
)
// 判断是否是powerpack服务器
const isPowerpackServer = computed(() => isInMemoryType.value && name.value === 'powerpack')
// 判断字段是否只读(inmemory类型除了args和env外都是只读的)
const isFieldReadOnly = computed(() => props.editMode && isInMemoryType.value)

// 格式化 JSON 对象为 Key=Value 文本
const formatJsonHeaders = (headers: Record<string, string>): string => {
  return Object.entries(headers)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}
// 处理模型选择
const handleImageModelSelect = (model: RENDERER_MODEL_META, providerId: string): void => {
  selectedImageModel.value = model
  selectedImageModelProvider.value = providerId
  // 将provider和modelId以空格分隔拼接成args的值
  args.value = `${providerId} ${model.id}`
  modelSelectOpen.value = false
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

// 权限设置
const autoApproveAll = ref(props.initialConfig?.autoApprove?.includes('all') || false)
const autoApproveRead = ref(
  props.initialConfig?.autoApprove?.includes('read') ||
    props.initialConfig?.autoApprove?.includes('all') ||
    false
)
const autoApproveWrite = ref(
  props.initialConfig?.autoApprove?.includes('write') ||
    props.initialConfig?.autoApprove?.includes('all') ||
    false
)

// 简单表单状态
const currentStep = ref(props.editMode ? 'detailed' : 'simple')
const jsonConfig = ref('')

// 当type变更时处理baseUrl的显示逻辑
const showBaseUrl = computed(() => type.value === 'sse' || type.value === 'http')
// 添加计算属性来控制命令相关字段的显示
const showCommandFields = computed(() => type.value === 'stdio')
// 控制参数输入框的显示 (stdio 或 非imageServer且非buildInFileSystem且非powerpack的inmemory)
const showArgsInput = computed(
  () =>
    showCommandFields.value ||
    (isInMemoryType.value &&
      !isImageServer.value &&
      !isBuildInFileSystem.value &&
      !isPowerpackServer.value)
)

// 控制文件夹选择界面的显示 (仅针对 buildInFileSystem)
const showFolderSelector = computed(() => isBuildInFileSystem.value)

// 当命令是npx或node时，显示npmRegistry输入框
const showNpmRegistryInput = computed(() => {
  return type.value === 'stdio' && ['npx', 'node'].includes(command.value.toLowerCase())
})

// 当选择 all 时，自动选中其他权限
const handleAutoApproveAllChange = (checked: boolean): void => {
  if (checked) {
    autoApproveRead.value = true
    autoApproveWrite.value = true
  }
}

// JSON配置解析
const parseJsonConfig = (): void => {
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
    args.value = serverConfig.args?.join(' ') || ''
    env.value = JSON.stringify(serverConfig.env || {}, null, 2)
    descriptions.value = serverConfig.descriptions || ''
    icons.value = serverConfig.icons || '📁'
    type.value = serverConfig.type || ''
    baseUrl.value = serverConfig.url || serverConfig.baseUrl || ''
    console.log('type', type.value, baseUrl.value)
    if (type.value !== 'stdio' && type.value !== 'sse' && type.value !== 'http') {
      if (baseUrl.value) {
        type.value = 'http'
      } else {
        type.value = 'stdio'
      }
    }

    // 填充 customHeaders (如果存在)
    if (serverConfig.customHeaders) {
      customHeaders.value = formatJsonHeaders(serverConfig.customHeaders) // 加载时格式化为 Key=Value
    } else {
      customHeaders.value = '' // 默认空字符串
    }

    // 权限设置
    autoApproveAll.value = serverConfig.autoApprove?.includes('all') || false
    autoApproveRead.value =
      serverConfig.autoApprove?.includes('read') ||
      serverConfig.autoApprove?.includes('all') ||
      false
    autoApproveWrite.value =
      serverConfig.autoApprove?.includes('write') ||
      serverConfig.autoApprove?.includes('all') ||
      false

    // 切换到详细表单
    currentStep.value = 'detailed'

    toast({
      title: t('settings.mcp.serverForm.parseSuccess'),
      description: t('settings.mcp.serverForm.configImported')
    })
  } catch (error) {
    console.error('解析JSON配置失败:', error)
    toast({
      title: t('settings.mcp.serverForm.parseError'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
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
  if (type.value === 'sse' || type.value === 'http') return true
  // 对于STDIO 或 inmemory 类型，命令是必需的 (排除内置 server)
  if (type.value === 'stdio' || (isInMemoryType.value && !isImageServer.value)) {
    return command.value.trim().length > 0
  }
  return true // 其他情况（如 imageServer）默认有效
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
  if (type.value !== 'sse' && type.value !== 'http') return true
  return baseUrl.value.trim().length > 0
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

// E2B 配置验证
const isE2BConfigValid = computed(() => {
  if (!isPowerpackServer.value) return true
  if (!useE2B.value) return true
  return e2bApiKey.value.trim().length > 0
})

const isFormValid = computed(() => {
  // 基本验证：名称必须有效
  if (!isNameValid.value) return false

  // E2B 配置验证
  if (!isE2BConfigValid.value) return false

  // 对于SSE类型，只需要名称和baseUrl有效
  if (type.value === 'sse' || type.value === 'http') {
    return isNameValid.value && isBaseUrlValid.value && isCustomHeadersFormatValid.value
  }

  // 对于STDIO类型，需要名称和命令有效，以及环境变量格式正确
  return isNameValid.value && isCommandValid.value && isEnvValid.value
})

// 参数输入相关状态 (用于标签式输入)
const argumentsList = ref<string[]>([])
const currentArgumentInput = ref('')
const argsInputRef = ref<HTMLInputElement | null>(null) // 用于聚焦输入框

// 文件夹选择相关状态 (用于 buildInFileSystem)
const foldersList = ref<string[]>([])

// 添加文件夹选择方法
const addFolder = async (): Promise<void> => {
  try {
    const result = await devicePresenter.selectDirectory()

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0]
      if (!foldersList.value.includes(selectedPath)) {
        foldersList.value.push(selectedPath)
      }
    }
  } catch (error) {
    console.error('选择文件夹失败:', error)
    toast({
      title: t('settings.mcp.serverForm.selectFolderError'),
      description: String(error),
      variant: 'destructive'
    })
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
        foldersList.value = newArgs.split(/\s+/).filter(Boolean)
      } else {
        foldersList.value = []
      }
    } else {
      // 对于其他类型，使用标签式输入
      if (newArgs) {
        argumentsList.value = newArgs.split(/\s+/).filter(Boolean)
      } else {
        argumentsList.value = []
      }
    }
  },
  { immediate: true }
)

// 监听内部列表变化，更新外部 args 字符串
watch(
  argumentsList,
  (newList) => {
    if (!isBuildInFileSystem.value) {
      args.value = newList.join(' ')
    }
  },
  { deep: true }
)

// 监听文件夹列表变化，更新外部 args 字符串
watch(
  foldersList,
  (newList) => {
    if (isBuildInFileSystem.value) {
      args.value = newList.join(' ')
    }
  },
  { deep: true }
)

// 添加参数到列表
const addArgument = (): void => {
  const value = currentArgumentInput.value.trim()
  if (value) {
    argumentsList.value.push(value)
  }
  currentArgumentInput.value = '' // 清空输入框
}

// 移除指定索引的参数
const removeArgument = (index: number): void => {
  argumentsList.value.splice(index, 1)
}

// 处理输入框键盘事件
const handleArgumentInputKeydown = (event: KeyboardEvent): void => {
  switch (event.key) {
    case 'Enter':
    case ' ': // 按下空格也添加
      event.preventDefault() // 阻止默认行为 (如换行或输入空格)
      addArgument()
      break
    case 'Backspace':
      // 如果输入框为空，且参数列表不为空，则将最后一个tag的内容移回输入框，并从列表中移除
      if (currentArgumentInput.value === '' && argumentsList.value.length > 0) {
        event.preventDefault() // 阻止默认的退格行为
        currentArgumentInput.value = argumentsList.value.pop() || ''
      }
      break
  }
}

// 点击容器时聚焦输入框
const focusArgsInput = (): void => {
  argsInputRef.value?.focus()
}

// 提交表单
const handleSubmit = (): void => {
  if (!isFormValid.value) return

  // 处理自动授权设置
  const autoApprove: string[] = []
  if (autoApproveAll.value) {
    autoApprove.push('all')
  } else {
    if (autoApproveRead.value) autoApprove.push('read')
    if (autoApproveWrite.value) autoApprove.push('write')
  }

  // 创建基本配置（必需的字段）
  const baseConfig = {
    descriptions: descriptions.value.trim(),
    icons: icons.value.trim(),
    autoApprove,
    type: type.value
  }

  // 创建符合MCPServerConfig接口的配置对象
  let serverConfig: MCPServerConfig

  // 解析 env
  let parsedEnv = {}
  try {
    if ((type.value === 'stdio' || isInMemoryType.value) && env.value.trim()) {
      parsedEnv = JSON.parse(env.value)
    }
  } catch (error) {
    toast({
      title: t('settings.mcp.serverForm.jsonParseError'),
      description: String(error),
      variant: 'destructive'
    })
    // 阻止提交或根据需要处理错误
    return
  }

  // 如果是 powerpack 服务器，添加 E2B 配置到环境变量
  if (isPowerpackServer.value) {
    parsedEnv = {
      ...parsedEnv,
      USE_E2B: useE2B.value,
      E2B_API_KEY: useE2B.value ? e2bApiKey.value.trim() : ''
    }
  }

  // 解析 customHeaders
  let parsedCustomHeaders = {}
  try {
    if ((type.value === 'sse' || type.value === 'http') && customHeaders.value.trim()) {
      parsedCustomHeaders = parseKeyValueHeaders(customHeaders.value)
    }
  } catch (error) {
    toast({
      title: t('settings.mcp.serverForm.parseError'),
      description: t('settings.mcp.serverForm.customHeadersParseError') + ': ' + String(error),
      variant: 'destructive'
    })
    return
  }

  if (type.value === 'sse' || type.value === 'http') {
    // SSE 或 HTTP 类型的服务器
    serverConfig = {
      ...baseConfig,
      command: '', // 提供空字符串作为默认值
      args: [], // 提供空数组作为默认值
      env: {}, // 提供空对象作为默认值
      baseUrl: baseUrl.value.trim(),
      customHeaders: parsedCustomHeaders // 使用解析后的 Key=Value
    }
  } else {
    // STDIO 或 inmemory 类型的服务器
    serverConfig = {
      ...baseConfig,
      command: command.value.trim(),
      // args 从 argumentsList 更新，所以直接使用 split 即可，或者直接使用 argumentsList.value
      args: args.value.split(/\s+/).filter(Boolean),
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

  emit('submit', name.value.trim(), serverConfig)
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
    "sseServer":{
      "url": "https://your-sse-server-url"
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

// 初始化时解析args中的provider和modelId（针对imageServer）
watch(
  [() => name.value, () => args.value, () => type.value],
  ([newName, newArgs, newType]) => {
    if (newType === 'inmemory' && newName === 'imageServer' && newArgs) {
      // 从args中解析出provider和modelId
      const argsParts = newArgs.split(/\s+/)
      if (argsParts.length >= 2) {
        const providerId = argsParts[0]
        const modelId = argsParts[1]
        // 查找对应的模型
        const foundModel = settingsStore.findModelByIdOrName(modelId)
        if (foundModel && foundModel.providerId === providerId) {
          selectedImageModel.value = foundModel.model
          selectedImageModelProvider.value = providerId
        } else {
          console.warn(`未找到匹配的模型: ${providerId} ${modelId}`)
        }
      }
    }
  },
  { immediate: true }
)

// Watch for initial config changes (primarily for edit mode)
watch(
  () => props.initialConfig,
  (newConfig) => {
    // Check if we are in edit mode and have a new valid config, but avoid overwriting if defaultJsonConfig was also provided and parsed
    if (newConfig && props.editMode && !props.defaultJsonConfig) {
      console.log('Applying initialConfig in edit mode:', newConfig)
      // Reset fields based on initialConfig
      // name.value = props.serverName || ''; // Name is usually passed separately and kept disabled
      command.value = newConfig.command || 'npx'
      args.value = newConfig.args?.join(' ') || ''
      env.value = JSON.stringify(newConfig.env || {}, null, 2)
      descriptions.value = newConfig.descriptions || ''
      icons.value = newConfig.icons || '📁'
      type.value = newConfig.type || 'stdio'
      baseUrl.value = newConfig.baseUrl || ''
      npmRegistry.value = newConfig.customNpmRegistry || ''

      // 解析 E2B 配置（仅针对 powerpack 服务器）
      if (props.serverName === 'powerpack' && newConfig.env) {
        const envConfig = newConfig.env as Record<string, any>
        useE2B.value = envConfig.USE_E2B === true || envConfig.USE_E2B === 'true'
        e2bApiKey.value = envConfig.E2B_API_KEY || ''
      }

      // Format customHeaders from initialConfig
      if (newConfig.customHeaders) {
        customHeaders.value = formatJsonHeaders(newConfig.customHeaders)
      } else {
        customHeaders.value = ''
      }

      // Set autoApprove based on initialConfig
      autoApproveAll.value = newConfig.autoApprove?.includes('all') || false
      autoApproveRead.value =
        newConfig.autoApprove?.includes('read') || newConfig.autoApprove?.includes('all') || false
      autoApproveWrite.value =
        newConfig.autoApprove?.includes('write') || newConfig.autoApprove?.includes('all') || false

      // Ensure we are in the detailed view for edit mode
      currentStep.value = 'detailed'
    }
  },
  { immediate: true } // Run immediately on component mount
)

// 打开MCP Marketplace
const openMcpMarketplace = (): void => {
  window.open(MCP_MARKETPLACE_URL, '_blank')
}

// 打开Higress MCP Marketplace
const openHigressMcpMarketplace = (): void => {
  window.open(HIGRESS_MCP_MARKETPLACE_URL, '_blank')
}

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
    <ScrollArea class="h-0 flex-grow">
      <div class="space-y-4 px-4 pb-4">
        <div class="text-sm">
          {{ t('settings.mcp.serverForm.jsonConfigIntro') }}
        </div>

        <!-- MCP Marketplace 入口 -->
        <div class="my-4">
          <div class="flex gap-2">
            <Button
              v-if="false"
              variant="outline"
              class="flex-1 flex items-center justify-center gap-2"
              @click="openMcpMarketplace"
            >
              <Icon icon="lucide:shopping-bag" class="w-4 h-4" />
              <span>{{ t('settings.mcp.serverForm.browseMarketplace') }}</span>
              <Icon icon="lucide:external-link" class="w-3.5 h-3.5 text-muted-foreground" />
            </Button>

            <!-- Higress MCP Marketplace 入口 -->
            <Button
              variant="outline"
              class="flex-1 flex items-center justify-center gap-2"
              @click="openHigressMcpMarketplace"
            >
              <img src="@/assets/mcp-icons/higress.avif" class="w-4 h-4" />
              <span>{{ $t('settings.mcp.serverForm.browseHigress') }}</span>
              <Icon icon="lucide:external-link" class="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </div>
        </div>

        <div class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="json-config">
            {{ t('settings.mcp.serverForm.jsonConfig') }}
          </Label>
          <Textarea id="json-config" v-model="jsonConfig" rows="10" :placeholder="placeholder" />
        </div>
      </div>
    </ScrollArea>

    <div class="flex justify-between pt-2 border-t px-4">
      <Button type="button" variant="outline" size="sm" @click="goToDetailedForm">
        {{ t('settings.mcp.serverForm.skipToManual') }}
      </Button>
      <Button type="button" size="sm" @click="parseJsonConfig">
        {{ t('settings.mcp.serverForm.parseAndContinue') }}
      </Button>
    </div>
  </form>

  <!-- 详细表单 -->
  <form v-else class="space-y-2 h-full flex flex-col" @submit.prevent="handleSubmit">
    <ScrollArea class="h-0 flex-grow">
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
              <SelectItem value="sse">{{ t('settings.mcp.serverForm.typeSse') }}</SelectItem>
              <SelectItem value="http">{{ t('settings.mcp.serverForm.typeHttp') }}</SelectItem>
              <SelectItem
                v-if="props.editMode && props.initialConfig?.type === 'inmemory'"
                value="inmemory"
                >{{ t('settings.mcp.serverForm.typeInMemory') }}</SelectItem
              >
            </SelectContent>
          </Select>
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

        <!-- 参数 (特殊处理 imageServer) -->
        <div v-if="isImageServer" class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="server-model">
            {{ t('settings.mcp.serverForm.imageModel') || '模型选择' }}
          </Label>
          <Popover v-model:open="modelSelectOpen">
            <PopoverTrigger as-child>
              <Button variant="outline" class="w-full justify-between">
                <div class="flex items-center gap-2">
                  <ModelIcon
                    :model-id="selectedImageModel?.id || ''"
                    class="h-4 w-4"
                    :is-dark="themeStore.isDark"
                  />
                  <span class="truncate">{{
                    selectedImageModel?.name || t('settings.common.selectModel')
                  }}</span>
                </div>
                <ChevronDown class="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-80 p-0">
              <ModelSelect
                :type="[ModelType.Chat, ModelType.ImageGeneration]"
                @update:model="handleImageModelSelect"
              />
            </PopoverContent>
          </Popover>
        </div>

        <!-- 文件夹选择 (特殊处理 buildInFileSystem) -->
        <div v-if="showFolderSelector" class="space-y-2">
          <Label class="text-xs text-muted-foreground">
            {{ t('settings.mcp.serverForm.folders') || '可访问的文件夹' }}
          </Label>
          <div class="space-y-2">
            <!-- 文件夹列表 -->
            <div
              v-for="(folder, index) in foldersList"
              :key="index"
              class="flex items-center justify-between p-2 border border-input rounded-md bg-background"
            >
              <span class="text-sm truncate flex-1 mr-2" :title="folder">{{ folder }}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="h-6 w-6 p-0 hover:bg-destructive hover:text-destructive-foreground"
                @click="removeFolder(index)"
              >
                <X class="h-3 w-3" />
              </Button>
            </div>

            <!-- 添加文件夹按钮 -->
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="w-full flex items-center gap-2"
              @click="addFolder"
            >
              <Icon icon="lucide:folder-plus" class="h-4 w-4" />
              {{ t('settings.mcp.serverForm.addFolder') || '添加文件夹' }}
            </Button>

            <!-- 空状态提示 -->
            <div
              v-if="foldersList.length === 0"
              class="text-xs text-muted-foreground text-center py-4"
            >
              {{ t('settings.mcp.serverForm.noFoldersSelected') || '未选择任何文件夹' }}
            </div>
          </div>
        </div>
        <!-- 参数 (标签式输入 for stdio/inmemory) -->
        <div v-else-if="showArgsInput" class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="server-args">{{
            t('settings.mcp.serverForm.args')
          }}</Label>
          <div
            class="flex flex-wrap items-center gap-1 p-2 border border-input rounded-md min-h-[40px] cursor-text"
            @click="focusArgsInput"
          >
            <Badge
              v-for="(arg, index) in argumentsList"
              :key="index"
              variant="outline"
              class="flex items-center gap-1 whitespace-nowrap"
            >
              <span>{{ arg }}</span>
              <button
                type="button"
                class="rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
                :aria-label="`Remove ${arg}`"
                @click.stop="removeArgument(index)"
              >
                <X class="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            </Badge>
            <input
              id="server-args-input"
              ref="argsInputRef"
              v-model="currentArgumentInput"
              :placeholder="
                argumentsList.length === 0 ? t('settings.mcp.serverForm.argsPlaceholder') : ''
              "
              class="flex-1 bg-transparent outline-none text-sm min-w-[60px]"
              @keydown="handleArgumentInputKeydown"
            />
          </div>
          <!-- 隐藏原始Input，但保留v-model绑定以利用其验证状态或原有逻辑(如果需要) -->
          <Input id="server-args" v-model="args" class="hidden" />
        </div>

        <!-- 环境变量 -->
        <div v-if="(showCommandFields || isInMemoryType) && !isPowerpackServer" class="space-y-2">
          <Label class="text-xs text-muted-foreground" for="server-env">{{
            t('settings.mcp.serverForm.env')
          }}</Label>
          <Textarea
            id="server-env"
            v-model="env"
            rows="5"
            :placeholder="t('settings.mcp.serverForm.envPlaceholder')"
            :class="{ 'border-red-500': !isEnvValid }"
          />
        </div>

        <!-- E2B 配置 (仅针对 powerpack 服务器) -->
        <div
          v-if="isPowerpackServer"
          class="space-y-4 p-4 border border-border rounded-lg bg-background/50"
        >
          <div class="flex items-center justify-between">
            <div class="space-y-1">
              <Label class="text-sm font-medium">{{
                t('settings.mcp.serverForm.useE2B') || '使用 E2B 代码执行'
              }}</Label>
              <div class="text-xs text-muted-foreground">
                {{
                  t('settings.mcp.serverForm.e2bDescription') ||
                  '启用 E2B 云端沙盒环境执行代码，更安全且支持完整的 Python 生态系统'
                }}
              </div>
            </div>
            <div class="flex items-center space-x-2">
              <Checkbox id="use-e2b" v-model:checked="useE2B" />
            </div>
          </div>

          <!-- E2B API Key 输入框 -->
          <div v-if="useE2B" class="space-y-2">
            <Label class="text-xs text-muted-foreground" for="e2b-api-key">
              {{ t('settings.mcp.serverForm.e2bApiKey') || 'E2B API Key' }}
              <span class="text-red-500">*</span>
            </Label>
            <Input
              id="e2b-api-key"
              v-model="e2bApiKey"
              type="password"
              :placeholder="
                t('settings.mcp.serverForm.e2bApiKeyPlaceholder') || '输入您的 E2B API Key'
              "
              required
              :class="{ 'border-red-500': useE2B && !e2bApiKey.trim() }"
            />
            <div class="text-xs text-muted-foreground">
              {{
                t('settings.mcp.serverForm.e2bApiKeyHelp') || '您可以在 E2B 控制台获取 API Key：'
              }}
              <a href="https://e2b.dev/docs" target="_blank" class="text-primary hover:underline">
                https://e2b.dev/docs
              </a>
            </div>
            <div v-if="useE2B && !e2bApiKey.trim()" class="text-xs text-red-500">
              {{ t('settings.mcp.serverForm.e2bApiKeyRequired') || 'E2B API Key 是必需的' }}
            </div>
          </div>
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
            {{ t('settings.mcp.serverForm.npmRegistry') || '自定义npm Registry' }}
          </Label>
          <Input
            id="npm-registry"
            v-model="npmRegistry"
            :placeholder="
              t('settings.mcp.serverForm.npmRegistryPlaceholder') ||
              '设置自定义 npm registry，留空系统会自动选择最快的'
            "
          />
        </div>
        <!-- 自动授权选项 -->
        <div class="space-y-3">
          <Label class="text-xs text-muted-foreground">{{
            t('settings.mcp.serverForm.autoApprove')
          }}</Label>
          <div class="flex flex-col space-y-2">
            <div class="flex items-center space-x-2">
              <Checkbox
                id="auto-approve-all"
                v-model:checked="autoApproveAll"
                @update:checked="handleAutoApproveAllChange"
              />
              <label
                for="auto-approve-all"
                class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {{ t('settings.mcp.serverForm.autoApproveAll') }}
              </label>
            </div>

            <div class="flex items-center space-x-2">
              <Checkbox
                id="auto-approve-read"
                v-model:checked="autoApproveRead"
                :disabled="autoApproveAll"
              />
              <label
                for="auto-approve-read"
                class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {{ t('settings.mcp.serverForm.autoApproveRead') }}
              </label>
            </div>

            <div class="flex items-center space-x-2">
              <Checkbox
                id="auto-approve-write"
                v-model:checked="autoApproveWrite"
                :disabled="autoApproveAll"
              />
              <label
                for="auto-approve-write"
                class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {{ t('settings.mcp.serverForm.autoApproveWrite') }}
              </label>
            </div>
          </div>
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
            {{ t('settings.mcp.serverForm.clickToEdit') || '点击编辑以查看完整内容' }}
          </p>
        </div>
      </div>
    </ScrollArea>

    <!-- 提交按钮 -->
    <div class="flex justify-end pt-2 border-t px-4">
      <Button type="submit" size="sm" :disabled="!isFormValid">
        {{ t('settings.mcp.serverForm.submit') }}
      </Button>
    </div>
  </form>
</template>
