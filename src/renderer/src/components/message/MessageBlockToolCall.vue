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
          <!-- 参数 -->
          <div v-if="hasParams" class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <h5
                class="text-xs font-medium text-accent-foreground flex flex-row gap-2 items-center"
              >
                <Icon icon="lucide:arrow-up-from-dot" class="w-4 h-4 text-foreground" />
                {{ t('toolCall.params') }}
              </h5>
              <button
                class="text-xs text-muted-foreground hover:text-foreground transition-colors"
                @click="copyParams"
              >
                <Icon icon="lucide:copy" class="w-3 h-3 inline-block mr-1" />
                {{ paramsCopyText }}
              </button>
            </div>
            <div class="rounded-md border bg-background text-xs overflow-hidden">
              <div ref="paramsEditor" class="min-h-[72px] max-h-64 overflow-auto"></div>
              <pre
                v-if="!paramsEditorReady"
                class="p-2 whitespace-pre-wrap break-words max-h-64 overflow-auto"
                >{{ paramsText }}</pre
              >
            </div>
          </div>

          <hr v-if="hasParams && hasResponse" />

          <!-- 响应 -->
          <div v-if="hasResponse" class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <h5
                class="text-xs font-medium text-accent-foreground flex flex-row gap-2 items-center"
              >
                <Icon
                  :icon="isTerminalTool ? 'lucide:terminal' : 'lucide:arrow-down-to-dot'"
                  class="w-4 h-4 text-foreground"
                />
                {{ isTerminalTool ? t('toolCall.terminalOutput') : t('toolCall.responseData') }}
              </h5>
              <button
                class="text-xs text-muted-foreground hover:text-foreground transition-colors"
                @click="copyResponse"
              >
                <Icon icon="lucide:copy" class="w-3 h-3 inline-block mr-1" />
                {{ responseCopyText }}
              </button>
            </div>
            <div class="rounded-md border bg-background text-xs overflow-hidden">
              <div ref="responseEditor" class="min-h-[72px] max-h-64 overflow-auto"></div>
              <pre
                v-if="!responseEditorReady"
                class="p-2 whitespace-pre-wrap break-words max-h-64 overflow-auto"
                >{{ responseText }}</pre
              >
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
import { useMonaco } from 'stream-monaco'
import { useUpgradeStore } from '@/stores/upgrade'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'

const keyMap = {
  'toolCall.calling': '工具调用中',
  'toolCall.response': '工具响应',
  'toolCall.end': '工具调用完成',
  'toolCall.error': '工具调用错误',
  'toolCall.title': '工具调用',
  'toolCall.clickToView': '点击查看详情',
  'toolCall.functionName': '函数名称',
  'toolCall.params': '参数',
  'toolCall.responseData': '响应数据',
  'toolCall.terminalOutput': 'Terminal output'
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
const upgradeStore = useUpgradeStore()
const uiSettingsStore = useUiSettingsStore()

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

// Terminal detection
const isTerminalTool = computed(() => {
  const name = props.block.tool_call?.name?.toLowerCase() || ''
  const serverName = props.block.tool_call?.server_name?.toLowerCase() || ''
  if (name === 'run_shell_command' && serverName === 'powerpack') {
    return false
  }
  return name.includes('terminal') || name.includes('command') || name.includes('exec')
})

const paramsText = computed(() => props.block.tool_call?.params ?? '')
const responseText = computed(() => props.block.tool_call?.response ?? '')
const hasParams = computed(() => paramsText.value.trim().length > 0)
const hasResponse = computed(() => responseText.value.trim().length > 0)

const isValidJson = (value: string) => {
  if (!value) return false
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

const paramsLanguage = computed(() => 'json')
const responseLanguage = computed(() => {
  if (isTerminalTool.value) {
    return upgradeStore.isWindows ? 'powershell' : 'shell'
  }
  return isValidJson(responseText.value) ? 'json' : 'plaintext'
})

const paramsEditor = ref<HTMLElement | null>(null)
const responseEditor = ref<HTMLElement | null>(null)
const paramsEditorReady = ref(false)
const responseEditorReady = ref(false)
const paramsCopyText = ref(t('common.copy'))
const responseCopyText = ref(t('common.copy'))

const {
  createEditor: createParamsEditor,
  updateCode: updateParamsCode,
  cleanupEditor: cleanupParamsEditor,
  getEditorView: getParamsEditorView
} = useMonaco({
  readOnly: true,
  wordWrap: 'on',
  wrappingIndent: 'same',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontFamily: uiSettingsStore.formattedCodeFontFamily,
  fontSize: 12,
  lineNumbers: 'off',
  folding: false,
  automaticLayout: true
})

const {
  createEditor: createResponseEditor,
  updateCode: updateResponseCode,
  cleanupEditor: cleanupResponseEditor,
  getEditorView: getResponseEditorView
} = useMonaco({
  readOnly: true,
  wordWrap: 'on',
  wrappingIndent: 'same',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontFamily: uiSettingsStore.formattedCodeFontFamily,
  fontSize: 12,
  lineNumbers: 'off',
  folding: false,
  automaticLayout: true
})

const applyEditorFont = (fontFamily: string) => {
  const paramsView = getParamsEditorView()
  if (paramsView) {
    paramsView.updateOptions({ fontFamily })
  }
  const responseView = getResponseEditorView()
  if (responseView) {
    responseView.updateOptions({ fontFamily })
  }
}

const ensureParamsEditor = async () => {
  if (!isExpanded.value || !hasParams.value || paramsEditorReady.value || !paramsEditor.value) {
    return
  }
  await nextTick()
  if (!paramsEditor.value || paramsEditorReady.value) return
  try {
    createParamsEditor(paramsEditor.value, paramsText.value, paramsLanguage.value)
    paramsEditorReady.value = true
    applyEditorFont(uiSettingsStore.formattedCodeFontFamily)
  } catch (error) {
    console.error('[MessageBlockToolCall] Failed to create params editor:', error)
  }
}

const ensureResponseEditor = async () => {
  if (
    !isExpanded.value ||
    !hasResponse.value ||
    responseEditorReady.value ||
    !responseEditor.value
  ) {
    return
  }
  await nextTick()
  if (!responseEditor.value || responseEditorReady.value) return
  try {
    createResponseEditor(responseEditor.value, responseText.value, responseLanguage.value)
    responseEditorReady.value = true
    applyEditorFont(uiSettingsStore.formattedCodeFontFamily)
  } catch (error) {
    console.error('[MessageBlockToolCall] Failed to create response editor:', error)
  }
}

const cleanupEditors = () => {
  if (paramsEditorReady.value) {
    cleanupParamsEditor()
    paramsEditorReady.value = false
  }
  if (responseEditorReady.value) {
    cleanupResponseEditor()
    responseEditorReady.value = false
  }
}

const copyContent = async (content: string, type: 'params' | 'response') => {
  try {
    if (window.api?.copyText) {
      window.api.copyText(content)
    } else {
      await navigator.clipboard.writeText(content)
    }
    if (type === 'params') {
      paramsCopyText.value = t('common.copySuccess')
      setTimeout(() => {
        paramsCopyText.value = t('common.copy')
      }, 2000)
    } else {
      responseCopyText.value = t('common.copySuccess')
      setTimeout(() => {
        responseCopyText.value = t('common.copy')
      }, 2000)
    }
  } catch (error) {
    console.error('[MessageBlockToolCall] Failed to copy text:', error)
  }
}

const copyParams = () => {
  void copyContent(paramsText.value, 'params')
}

const copyResponse = () => {
  void copyContent(responseText.value, 'response')
}

watch(
  isExpanded,
  (expanded) => {
    if (expanded) {
      void ensureParamsEditor()
      void ensureResponseEditor()
    } else {
      cleanupEditors()
    }
  },
  { immediate: true }
)

watch([hasParams, paramsText, paramsLanguage], () => {
  if (!hasParams.value) {
    if (paramsEditorReady.value) {
      cleanupParamsEditor()
      paramsEditorReady.value = false
    }
    return
  }
  if (paramsEditorReady.value) {
    updateParamsCode(paramsText.value, paramsLanguage.value)
  } else if (isExpanded.value) {
    void ensureParamsEditor()
  }
})

watch([hasResponse, responseText, responseLanguage], () => {
  if (!hasResponse.value) {
    if (responseEditorReady.value) {
      cleanupResponseEditor()
      responseEditorReady.value = false
    }
    return
  }
  if (responseEditorReady.value) {
    updateResponseCode(responseText.value, responseLanguage.value)
  } else if (isExpanded.value) {
    void ensureResponseEditor()
  }
})

watch(
  () => uiSettingsStore.formattedCodeFontFamily,
  (font) => {
    applyEditorFont(font)
  }
)

onBeforeUnmount(() => {
  cleanupEditors()
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
