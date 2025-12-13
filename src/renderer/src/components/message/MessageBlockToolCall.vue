<template>
  <div class="flex flex-col w-full">
    <div
      class="inline-flex w-fit max-w-full sm:max-w-2xl min-h-7 py-1.5 bg-accent hover:bg-accent/40 border rounded-lg items-center gap-2 px-2 text-xs leading-4 transition-colors duration-150 select-none cursor-pointer overflow-hidden"
      @click="toggleExpanded"
    >
      <Icon :icon="statusIconName" :class="['w-3.5 h-3.5 shrink-0', statusIconClass]" />
      <div
        class="flex items-center gap-2 font-mono font-medium tracking-tight text-foreground/80 truncate leading-none min-w-0"
      >
        <span class="truncate text-xs">{{ primaryLabel }}.{{ functionLabel }}</span>
      </div>
    </div>

    <!-- 详细内容区域 -->
    <transition
      enter-active-class="transition-all duration-200"
      enter-from-class="opacity-0 -translate-y-4 scale-95"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition-all duration-200"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 -translate-y-4 scale-95"
    >
      <div
        v-if="isExpanded"
        class="rounded-lg border bg-muted text-card-foreground px-2 py-3 mt-2 mb-4 max-w-full sm:max-w-2xl"
      >
        <div class="space-y-4">
          <!-- Terminal output (for terminal-related tool calls) -->
          <div v-if="isTerminalTool && block.tool_call?.response" class="space-y-2">
            <h5 class="text-xs font-medium text-accent-foreground flex items-center gap-2">
              <Icon icon="lucide:terminal" class="w-4 h-4" />
              {{ t('toolCall.terminalOutput') }}
            </h5>
            <div
              ref="terminalContainer"
              class="rounded-md bg-black text-white font-mono text-xs p-2 overflow-auto max-h-64"
            />
            <hr v-if="hasParams" />
          </div>

          <!-- 参数 -->
          <div v-if="hasParams" class="space-y-2">
            <h5 class="text-xs font-medium text-accent-foreground flex flex-row gap-2 items-center">
              <Icon icon="lucide:arrow-up-from-dot" class="w-4 h-4 text-foreground" />
              {{ t('toolCall.params') }}
            </h5>
            <div class="text-sm rounded-md p-2">
              <JsonObject :data="parsedParams" />
            </div>
          </div>

          <hr v-if="hasParams && block.tool_call?.response && !isTerminalTool" />

          <!-- 响应 (hide for terminal tools as output is shown above) -->
          <div v-if="block.tool_call?.response && !isTerminalTool" class="space-y-2">
            <h5 class="text-xs font-medium text-accent-foreground flex flex-row gap-2 items-center">
              <Icon icon="lucide:arrow-down-to-dot" class="w-4 h-4 text-foreground" />
              {{ t('toolCall.responseData') }}
            </h5>
            <div class="text-sm rounded-md p-3">
              <JsonObject :data="parseJson(block.tool_call.response)" />
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { AssistantMessageBlock } from '@shared/chat'
import { computed, ref, nextTick, watch, onBeforeUnmount } from 'vue'
import { JsonObject } from '@/components/json-viewer'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

const keyMap = {
  'toolCall.calling': '工具调用中',
  'toolCall.response': '工具响应',
  'toolCall.end': '工具调用完成',
  'toolCall.error': '工具调用错误',
  'toolCall.title': '工具调用',
  'toolCall.clickToView': '点击查看详情',
  'toolCall.functionName': '函数名称',
  'toolCall.params': '参数',
  'toolCall.responseData': '响应数据'
}
// 创建一个安全的翻译函数
const t = (() => {
  try {
    const { t } = useI18n()
    return t
  } catch (e) {
    // 如果 i18n 未初始化，提供默认翻译
    return (key: string) => keyMap[key] || key
  }
})()

const props = defineProps<{
  block: AssistantMessageBlock
  messageId?: string
  threadId?: string
}>()

const isExpanded = ref(false)

const statusVariant = computed(() => {
  if (props.block.status === 'error') return 'error'
  if (props.block.status === 'success') return 'success'
  if (props.block.status === 'loading') return 'running'
  return 'neutral'
})

const primaryLabel = computed(() => {
  if (!props.block.tool_call) return t('toolCall.title')
  let serverName = props.block.tool_call.server_name
  if (props.block.tool_call.server_name?.includes('/')) {
    serverName = props.block.tool_call.server_name.split('/').pop()
  }
  return serverName || props.block.tool_call.name || t('toolCall.title')
})

const functionLabel = computed(() => {
  const toolCall = props.block.tool_call
  return toolCall?.name ?? ''
})

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value
}

const statusIconName = computed(() => {
  if (!props.block.tool_call) return 'lucide:circle-small'
  switch (statusVariant.value) {
    case 'error':
      return 'lucide:x'
    case 'success':
    case 'neutral':
      return 'lucide:circle-small'
    default:
      return 'lucide:circle-small'
  }
})

const statusIconClass = computed(() => {
  switch (statusVariant.value) {
    case 'error':
      return 'text-destructive'
    case 'success':
      return 'text-emerald-500'
    case 'running':
      return 'text-muted-foreground animate-pulse'
    default:
      return 'text-muted-foreground'
  }
})

// 解析JSON为对象；解析失败时回退原文
const parseJson = (jsonStr: string) => {
  if (!jsonStr) return {}
  try {
    const parsed = JSON.parse(jsonStr)
    if (parsed && (typeof parsed === 'object' || Array.isArray(parsed))) {
      return parsed
    }
    return { raw: parsed ?? jsonStr }
  } catch (e) {
    return { raw: jsonStr }
  }
}

// Terminal detection
const isTerminalTool = computed(() => {
  const name = props.block.tool_call?.name?.toLowerCase() || ''
  const serverName = props.block.tool_call?.server_name?.toLowerCase() || ''
  if (name == 'run_shell_command' && serverName === 'powerpack') {
    return false
  }
  return name.includes('terminal') || name.includes('command') || name.includes('exec')
})

// Terminal rendering
const terminalContainer = ref<HTMLElement | null>(null)
let terminal: Terminal | null = null

const parsedParams = computed(() => parseJson(props.block.tool_call?.params ?? ''))
const hasParams = computed(() => {
  const data = parsedParams.value as unknown
  if (Array.isArray(data)) return data.length > 0
  if (data && typeof data === 'object') return Object.keys(data).length > 0
  if (typeof data === 'string') return data.trim().length > 0
  return false
})

const initTerminal = () => {
  if (!terminalContainer.value || !isTerminalTool.value) return

  // Clean up any existing terminal before creating a new one
  if (terminal) {
    try {
      terminal.dispose()
    } catch (error) {
      console.warn('[MessageBlockToolCall] Failed to dispose existing terminal:', error)
    }
    terminal = null
  }
  // Clear previous terminal DOM content
  terminalContainer.value.innerHTML = ''

  terminal = new Terminal({
    convertEol: true,
    fontSize: 12,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
      background: '#000000',
      foreground: '#ffffff'
    },
    cursorStyle: 'bar',
    scrollback: 1000,
    disableStdin: true // Read-only
  })

  terminal.open(terminalContainer.value)

  // Write terminal output from response
  const response = props.block.tool_call?.response
  if (response) {
    try {
      const data = parseJson(response)
      const output = data.output || data.stdout || ''
      if (output) {
        terminal.write(output.replace(/\n/g, '\r\n'))
      }
    } catch {
      // Fallback: treat response as plain text
      terminal.write(response.replace(/\n/g, '\r\n'))
    }
  }
}

// Watch for expanded state and initialize terminal
watch(
  [isExpanded, () => props.block.tool_call?.response],
  () => {
    if (isExpanded.value && isTerminalTool.value) {
      nextTick(() => {
        initTerminal()
      })
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (terminal) {
    terminal.dispose()
    terminal = null
  }
})
</script>

<style scoped>
.message-tool-call {
  min-height: 28px;
  padding-top: 6px;
  padding-bottom: 6px;
}

pre {
  font-family: var(--dc-code-font-family);
  font-size: 0.85em;
}
</style>
