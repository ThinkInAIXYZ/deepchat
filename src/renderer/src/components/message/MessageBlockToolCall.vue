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
        <span class="truncate text-xs">
          <template v-if="primaryLabel !== functionLabel">
            {{ primaryLabel }}.{{ functionLabel }}
          </template>
          <template v-else>{{ functionLabel }}</template>
        </span>
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
        class="rounded-lg border bg-muted text-card-foreground px-2 py-3 mt-2 mb-4 w-full"
      >
        <div class="flex flex-col gap-4">
          <!-- 参数 -->
          <div v-if="hasParams" class="space-y-2 flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <h5
                class="text-xs font-medium text-accent-foreground flex flex-row gap-2 items-center"
              >
                <Icon icon="lucide:arrow-up-from-dot" class="w-4 h-4 text-foreground" />
                {{ t('toolCall.params') }}
              </h5>
              <button
                class="text-xs text-muted-foreground hover:text-foreground transition-colors"
                @click.stop="copyParams"
              >
                <Icon icon="lucide:copy" class="w-3 h-3 inline-block mr-1" />
                {{ paramsCopyText }}
              </button>
            </div>
            <div class="rounded-md border bg-background text-xs p-2 min-h-0 max-h-20 overflow-auto">
              {{ paramsText }}
            </div>
          </div>

          <hr v-if="hasParams && hasResponse" class="sm:hidden" />

          <!-- 响应 -->
          <div v-if="hasResponse" :class="responseLayoutClass">
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
                @click.stop="copyResponse"
              >
                <Icon icon="lucide:copy" class="w-3 h-3 inline-block mr-1" />
                {{ responseCopyText }}
              </button>
            </div>
            <template v-if="diffData">
              <div class="min-h-0 overflow-auto">
                <CodeBlockNode
                  :node="{
                    type: 'code_block',
                    language: diffLanguage,
                    code: diffData.updatedCode,
                    raw: diffData.updatedCode,
                    diff: true,
                    originalCode: diffData.originalCode,
                    updatedCode: diffData.updatedCode
                  }"
                  :is-dark="themeStore.isDark"
                  :show-header="false"
                  class="rounded-md border bg-background text-xs p-2 h-full min-h-0"
                />
              </div>
              <div v-if="diffData.replacements !== undefined" class="text-xs text-muted-foreground">
                {{ t('toolCall.replacementsCount', { count: diffData.replacements }) }}
              </div>
            </template>
            <pre
              v-else
              class="rounded-md border bg-background text-xs p-2 whitespace-pre-wrap break-words max-h-64 overflow-auto"
              >{{ responseText }}</pre
            >
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
import { computed, ref } from 'vue'
import { CodeBlockNode } from 'markstream-vue'
import { useThemeStore } from '@/stores/theme'
import { useMcpStore } from '@/stores/mcp'
import { getLanguageFromFilename } from '@shared/utils/codeLanguage'

const { t } = useI18n()

const themeStore = useThemeStore()
const mcpStore = useMcpStore()

const props = defineProps<{
  block: AssistantMessageBlock
  messageId?: string
  sessionId?: string
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
  const toolName = props.block.tool_call.name || t('toolCall.title')
  let serverName = props.block.tool_call.server_name
  if (props.block.tool_call.server_name?.includes('/')) {
    serverName = props.block.tool_call.server_name.split('/').pop()
  }
  if (serverName && serverName !== toolName) {
    return serverName
  }
  return toolName
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
      return 'text-cyan-500 animate-pulse'
    default:
      return 'text-muted-foreground'
  }
})

const paramsText = computed(() => props.block.tool_call?.params ?? '')
const responseText = computed(() => {
  const inlineResponse = props.block.tool_call?.response
  if (inlineResponse && inlineResponse.trim().length > 0) {
    return inlineResponse
  }

  const toolCallId = props.block.tool_call?.id ?? null
  const toolName = props.block.tool_call?.name ?? null
  return mcpStore.getToolResult(toolCallId, toolName) ?? ''
})
const hasParams = computed(() => paramsText.value.trim().length > 0)
const hasResponse = computed(() => responseText.value.trim().length > 0)

const isDiffTool = computed(() => {
  const name = props.block.tool_call?.name ?? ''
  const normalized = name.replace(/[_-]/g, '').toLowerCase()
  if (props.block.status !== 'success') return false
  return normalized === 'edittext' || normalized === 'textreplace'
})

const diffData = computed(() => {
  if (!isDiffTool.value || !hasResponse.value) return null
  try {
    const parsed = JSON.parse(responseText.value) as {
      success?: boolean
      originalCode?: unknown
      updatedCode?: unknown
      language?: unknown
      replacements?: unknown
    }
    if (
      parsed.success === true &&
      typeof parsed.originalCode === 'string' &&
      typeof parsed.updatedCode === 'string'
    ) {
      return {
        originalCode: parsed.originalCode,
        updatedCode: parsed.updatedCode,
        language: typeof parsed.language === 'string' ? parsed.language : undefined,
        replacements: typeof parsed.replacements === 'number' ? parsed.replacements : undefined
      }
    }
  } catch (error) {
    console.warn('[MessageBlockToolCall] Failed to parse diff response:', error)
  }
  return null
})

const paramsPath = computed(() => {
  const params = props.block.tool_call?.params
  if (!params) return ''
  try {
    const parsed = JSON.parse(params) as { path?: unknown }
    if (parsed && typeof parsed.path === 'string') {
      return parsed.path
    }
  } catch {
    return ''
  }
  return ''
})

const diffLanguage = computed(() => {
  if (diffData.value?.language) return diffData.value.language
  return getLanguageFromFilename(paramsPath.value)
})

const hasDiff = computed(() => Boolean(diffData.value))

const responseLayoutClass = computed(() => {
  if (hasDiff.value) {
    return 'flex-1 min-w-0 grid grid-rows-[auto_minmax(0,1fr)_auto] gap-2 min-h-72 max-h-72'
  }
  return 'space-y-2 flex-1 min-w-0'
})

const isTerminalTool = computed(() => {
  const name = props.block.tool_call?.name?.toLowerCase() || ''
  const serverName = props.block.tool_call?.server_name?.toLowerCase() || ''
  if (name === 'run_shell_command' && serverName === 'powerpack') {
    return false
  }
  return name.includes('terminal') || name.includes('command') || name.includes('exec')
})

const paramsCopyText = ref(t('common.copy'))
const responseCopyText = ref(t('common.copy'))

const copyParams = async () => {
  if (!hasParams.value) return
  try {
    if (window.api?.copyText) {
      window.api.copyText(paramsText.value)
    } else {
      await navigator.clipboard.writeText(paramsText.value)
    }
    paramsCopyText.value = t('common.copySuccess')
    setTimeout(() => {
      paramsCopyText.value = t('common.copy')
    }, 2000)
  } catch (error) {
    console.error('[MessageBlockToolCall] Failed to copy params:', error)
  }
}

const copyResponse = async () => {
  if (!hasResponse.value) return
  try {
    if (window.api?.copyText) {
      window.api.copyText(responseText.value)
    } else {
      await navigator.clipboard.writeText(responseText.value)
    }
    responseCopyText.value = t('common.copySuccess')
    setTimeout(() => {
      responseCopyText.value = t('common.copy')
    }, 2000)
  } catch (error) {
    console.error('[MessageBlockToolCall] Failed to copy response:', error)
  }
}
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
