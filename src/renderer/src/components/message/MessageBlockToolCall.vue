<template>
  <div class="flex flex-col w-full">
    <div
      data-testid="tool-call-trigger"
      class="tool-call-pill inline-flex w-fit min-h-7 border rounded-lg items-center gap-2 px-2 py-1.5 text-xs leading-4 transition-colors duration-150 select-none cursor-pointer overflow-hidden bg-accent hover:bg-accent/40"
      @click="toggleExpanded"
    >
      <span
        v-if="statusVariant === 'running'"
        data-testid="tool-call-running-indicator"
        class="tool-call-status-ring shrink-0"
        aria-hidden="true"
      />
      <Icon v-else :icon="statusIconName" :class="['w-3.5 h-3.5 shrink-0', statusIconClass]" />
      <div class="tool-call-labels flex items-center gap-2 font-mono font-medium min-w-0">
        <span data-testid="tool-call-name" class="shrink-0 text-xs text-foreground/80 leading-none">
          {{ displayFunctionName }}
        </span>
        <span
          v-if="summaryText"
          data-testid="tool-call-summary"
          ref="summaryElement"
          :class="[
            'tool-call-summary text-[11px]',
            { 'tool-call-summary--overflowing': isSummaryOverflowing }
          ]"
          :title="isSummaryOverflowing ? summaryText : undefined"
        >
          {{ summaryText }}
        </span>
      </div>
      <span
        v-if="showRtkBadge"
        data-testid="tool-call-rtk-badge"
        class="shrink-0 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-700 dark:text-emerald-300"
      >
        {{ t('toolCall.badge.rtk') }}
      </span>
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
        data-testid="tool-call-details"
        class="rounded-lg border bg-muted text-card-foreground px-2 py-3 mt-2 mb-4 w-full"
      >
        <div v-if="isSubagentOrchestrator" class="flex flex-col gap-1.5">
          <button
            v-for="task in subagentTasks"
            :key="task.normalizedId"
            data-testid="subagent-task-trigger"
            type="button"
            :disabled="!task.sessionId"
            :class="[
              'tool-call-pill inline-flex w-full min-h-7 border rounded-lg items-center gap-2 px-2 py-1.5 text-xs leading-4 transition-colors duration-150 overflow-hidden',
              task.sessionId
                ? 'cursor-pointer bg-background hover:bg-accent/60'
                : 'cursor-default bg-background/80 opacity-70'
            ]"
            @click.stop="handleSubagentSessionOpen(task)"
          >
            <span
              :class="getSubagentStatusClass(task.status)"
              class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
            >
              {{ getSubagentStatusLabel(task.status) }}
            </span>
            <span class="shrink-0 font-semibold text-foreground">
              {{ task.targetAgentName }}
            </span>
            <span class="text-muted-foreground">·</span>
            <span class="min-w-0 flex-1 truncate text-muted-foreground">
              {{ task.title || task.label }}
            </span>
            <Icon
              v-if="task.sessionId"
              icon="lucide:chevron-right"
              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            />
          </button>
        </div>

        <div v-else class="flex flex-col gap-4">
          <div
            v-if="expandedToolTitle"
            data-testid="tool-call-expanded-title"
            class="truncate text-xs font-mono font-medium text-foreground/75"
          >
            {{ expandedToolTitle }}
          </div>

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
            <div
              data-testid="tool-call-params"
              class="rounded-md border bg-background text-xs p-2 min-h-0 max-h-20 overflow-auto"
            >
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CodeBlockNode } from 'markstream-vue'
import { useThemeStore } from '@/stores/theme'
import { useSessionStore } from '@/stores/ui/session'
import { getLanguageFromFilename } from '@shared/utils/codeLanguage'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'

const { t } = useI18n()

const themeStore = useThemeStore()
const sessionStore = useSessionStore()

const props = defineProps<{
  block: DisplayAssistantMessageBlock
  messageId?: string
  threadId?: string
}>()

type ExpansionSource = 'auto' | 'manual' | null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const normalizeInlineText = (value: string): string => value.replace(/\s+/g, ' ').trim()

const extractFirstSummaryValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : ''
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
    return entries.length > 0 ? entries[0][1] : ''
  }
  return value
}

const formatSummaryValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return normalizeInlineText(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (value === null) {
    return 'null'
  }
  if (value === undefined) {
    return ''
  }
  try {
    return normalizeInlineText(JSON.stringify(value))
  } catch {
    return normalizeInlineText(String(value))
  }
}

const coerceNumericParam = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const isExpanded = ref(false)
const expansionSource = ref<ExpansionSource>(null)
const autoExpandDismissed = ref(false)
const summaryElement = ref<HTMLElement | null>(null)
const isSummaryOverflowing = ref(false)
let summaryResizeObserver: ResizeObserver | null = null

const statusVariant = computed(() => {
  if (props.block.status === 'error') return 'error'
  if (props.block.status === 'success') return 'success'
  if (props.block.status === 'loading') return 'running'
  return 'neutral'
})

const functionLabel = computed(() => {
  const toolCall = props.block.tool_call
  return toolCall?.name ?? ''
})

const displayFunctionName = computed(() => functionLabel.value || t('toolCall.title'))

const expandedToolTitle = computed(() => {
  if (!isExpanded.value || !props.block.tool_call) {
    return ''
  }

  const toolName = functionLabel.value || t('toolCall.title')
  let serverName = props.block.tool_call.server_name?.trim() ?? ''
  if (serverName.includes('/')) {
    serverName = serverName.split('/').pop() ?? ''
  }

  if (!serverName || serverName === toolName) {
    return toolName
  }

  return `${serverName}.${toolName}`
})

const paramsText = computed(() => props.block.tool_call?.params ?? '')
const responseText = computed(() => props.block.tool_call?.response ?? '')
const hasParams = computed(() => paramsText.value.trim().length > 0)
const hasResponse = computed(() => responseText.value.trim().length > 0)

const parsedParams = computed(() => {
  const raw = paramsText.value.trim()
  if (!raw) {
    return {
      isJson: false,
      value: ''
    }
  }
  try {
    return {
      isJson: true,
      value: JSON.parse(raw) as unknown
    }
  } catch {
    return {
      isJson: false,
      value: raw
    }
  }
})

const parsedParamsRecord = computed(() =>
  isRecord(parsedParams.value.value) ? parsedParams.value.value : null
)

const rawToolName = computed(() => props.block.tool_call?.name?.trim().toLowerCase() ?? '')
const isSubagentOrchestrator = computed(() => rawToolName.value === 'subagent_orchestrator')

type SubagentProgressTask = {
  normalizedId: string
  taskId: string
  title: string
  label: string
  slotId: string
  sessionId?: string | null
  targetAgentId?: string | null
  targetAgentName: string
  status: string
  previewMarkdown?: string
  updatedAt?: number
  resultSummary?: string
}

type RawSubagentProgressTask = Partial<SubagentProgressTask> & {
  displayName?: string
}

type SubagentProgressPayload = {
  runId: string
  mode: 'parallel' | 'chain'
  tasks: RawSubagentProgressTask[]
}

const parseSubagentProgress = (value: unknown): SubagentProgressPayload | null => {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as SubagentProgressPayload
    return Array.isArray(parsed?.tasks) ? parsed : null
  } catch {
    return null
  }
}

const matchesToolContractName = (toolName: string, expectedName: string): boolean =>
  toolName === expectedName || toolName.endsWith(`_${expectedName}`)

const normalizeOptionalText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const summaryText = computed(() => {
  if (isSubagentOrchestrator.value) {
    const progress =
      parseSubagentProgress(props.block.extra?.subagentProgress) ??
      parseSubagentProgress(props.block.extra?.subagentFinal)
    if (progress) {
      return t('chat.toolCall.subagents.summary', {
        mode: getSubagentModeLabel(progress.mode),
        count: progress.tasks.length
      })
    }
  }

  const raw = paramsText.value.trim()
  if (!raw) return ''
  if (!parsedParams.value.isJson) {
    return normalizeInlineText(raw)
  }
  return formatSummaryValue(extractFirstSummaryValue(parsedParams.value.value))
})

const subagentTasks = computed<SubagentProgressTask[]>(() => {
  const progress =
    parseSubagentProgress(props.block.extra?.subagentProgress) ??
    parseSubagentProgress(props.block.extra?.subagentFinal)
  const unnamedAgentLabel = t('settings.deepchatAgents.unnamed')

  return (progress?.tasks ?? []).map((task, index) => {
    const slotId = normalizeOptionalText(task.slotId)
    const displayName = normalizeOptionalText(task.displayName)
    const normalizedId =
      normalizeOptionalText(task.taskId) || slotId || `subagent-task-${index + 1}`
    const label = displayName || slotId || 'Unnamed Task'
    const title = normalizeOptionalText(task.title)

    return {
      ...task,
      normalizedId,
      taskId: normalizedId,
      title,
      label,
      slotId: slotId || normalizedId,
      sessionId: typeof task.sessionId === 'string' ? task.sessionId : (task.sessionId ?? null),
      targetAgentId:
        typeof task.targetAgentId === 'string' ? task.targetAgentId : (task.targetAgentId ?? null),
      targetAgentName:
        normalizeOptionalText(task.targetAgentName) || displayName || unnamedAgentLabel,
      status: normalizeOptionalText(task.status) || 'running'
    }
  })
})

const updateSummaryOverflow = () => {
  const element = summaryElement.value
  if (!element || !summaryText.value) {
    isSummaryOverflowing.value = false
    return
  }

  isSummaryOverflowing.value = element.scrollWidth - element.clientWidth > 1
}

const isExecTool = computed(() => {
  const toolName = rawToolName.value
  return matchesToolContractName(toolName, 'exec') || matchesToolContractName(toolName, 'skill_run')
})

const isProcessTool = computed(() => matchesToolContractName(rawToolName.value, 'process'))

const shouldAutoExpand = computed(() => {
  if (isSubagentOrchestrator.value) {
    return props.block.status === 'loading'
  }
  if (props.block.status !== 'loading') return false
  if (isProcessTool.value) return true
  if (!isExecTool.value || !parsedParamsRecord.value) return false
  if (parsedParamsRecord.value.background === true) return true
  const timeoutMs = coerceNumericParam(parsedParamsRecord.value.timeoutMs)
  return timeoutMs !== null && timeoutMs >= 10000
})

const toolCallIdentity = computed(
  () =>
    props.block.tool_call?.id ?? `${props.block.tool_call?.name ?? 'tool'}:${props.block.timestamp}`
)

const resetExpansionState = () => {
  isExpanded.value = false
  expansionSource.value = null
  autoExpandDismissed.value = false
}

const toggleExpanded = () => {
  if (isExpanded.value) {
    if (props.block.status === 'loading' && shouldAutoExpand.value) {
      autoExpandDismissed.value = true
    }
    isExpanded.value = false
    expansionSource.value = null
    return
  }

  isExpanded.value = true
  expansionSource.value = 'manual'
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
    default:
      return 'text-muted-foreground'
  }
})

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
  const params = paramsText.value
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
  return (
    name.includes('terminal') ||
    name.includes('command') ||
    name.includes('exec') ||
    name.includes('skill_run')
  )
})

const showRtkBadge = computed(
  () => isTerminalTool.value && props.block.tool_call?.rtkApplied === true
)

const syncAutoExpansionState = (
  status: DisplayAssistantMessageBlock['status'],
  autoExpandable: boolean,
  previousStatus?: DisplayAssistantMessageBlock['status']
) => {
  if (status === 'loading' && autoExpandable && !autoExpandDismissed.value && !isExpanded.value) {
    isExpanded.value = true
    expansionSource.value = 'auto'
    return
  }

  if (previousStatus === 'loading' && status !== 'loading' && expansionSource.value === 'auto') {
    isExpanded.value = false
    expansionSource.value = null
    autoExpandDismissed.value = false
    return
  }

  if (status !== 'loading' && expansionSource.value !== 'manual') {
    autoExpandDismissed.value = false
  }
}

watch(toolCallIdentity, (nextIdentity, previousIdentity) => {
  if (previousIdentity !== undefined && nextIdentity !== previousIdentity) {
    resetExpansionState()
    syncAutoExpansionState(props.block.status, shouldAutoExpand.value)
  }
})

watch(summaryElement, (nextElement, previousElement) => {
  if (summaryResizeObserver && previousElement) {
    summaryResizeObserver.unobserve(previousElement)
  }
  if (summaryResizeObserver && nextElement) {
    summaryResizeObserver.observe(nextElement)
  }
  void nextTick(updateSummaryOverflow)
})

watch(summaryText, () => {
  void nextTick(updateSummaryOverflow)
})

watch(
  [() => props.block.status, shouldAutoExpand],
  ([status, autoExpandable], previousValue) => {
    syncAutoExpansionState(status, autoExpandable, previousValue?.[0])
  },
  { immediate: true }
)

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    summaryResizeObserver = new ResizeObserver(() => {
      updateSummaryOverflow()
    })

    if (summaryElement.value) {
      summaryResizeObserver.observe(summaryElement.value)
    }
  }

  void nextTick(updateSummaryOverflow)
})

onBeforeUnmount(() => {
  summaryResizeObserver?.disconnect()
  summaryResizeObserver = null
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

const getSubagentStatusClass = (status: string): string => {
  if (status === 'completed') {
    return 'bg-emerald-500/10 text-emerald-600'
  }
  if (status === 'error' || status === 'cancelled') {
    return 'bg-destructive/10 text-destructive'
  }
  if (status.startsWith('waiting')) {
    return 'bg-amber-500/10 text-amber-600'
  }
  return 'bg-muted text-muted-foreground'
}

const handleSubagentSessionOpen = (task: SubagentProgressTask) => {
  if (!task.sessionId) {
    return
  }

  void sessionStore.selectSession(task.sessionId)
}

function getSubagentModeLabel(mode: string): string {
  switch (mode) {
    case 'parallel':
      return t('chat.toolCall.subagents.mode.parallel')
    case 'chain':
      return t('chat.toolCall.subagents.mode.chain')
    default:
      return mode
  }
}

function getSubagentStatusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return t('chat.toolCall.subagents.status.completed')
    case 'error':
      return t('chat.toolCall.subagents.status.error')
    case 'cancelled':
      return t('chat.toolCall.subagents.status.cancelled')
    case 'waiting_permission':
      return t('chat.toolCall.subagents.status.waiting_permission')
    case 'waiting_question':
      return t('chat.toolCall.subagents.status.waiting_question')
    case 'running':
      return t('chat.toolCall.subagents.status.running')
    case 'queued':
      return t('chat.toolCall.subagents.status.queued')
    default:
      return status
  }
}
</script>

<style scoped>
.tool-call-pill {
  max-width: min(48rem, calc(100% - 0.75rem));
}

.tool-call-labels {
  min-width: 0;
}

.tool-call-summary {
  flex: 1 1 auto;
  min-width: 0;
  display: block;
  overflow: hidden;
  white-space: nowrap;
  line-height: 1.2;
  padding-block: 1px;
  color: hsl(var(--muted-foreground) / 0.9);
  font-weight: 400;
}

.tool-call-summary--overflowing {
  mask-image: linear-gradient(to right, #000 calc(100% - 1.5rem), transparent);
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 1.5rem), transparent);
}

.tool-call-status-ring {
  position: relative;
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 9999px;
  box-sizing: border-box;
  border: 1px solid hsl(var(--muted-foreground) / 0.32);
}

.tool-call-status-ring::after {
  content: '';
  position: absolute;
  inset: 1px;
  border-radius: inherit;
  border: 1px solid hsl(45 96% 62% / 0.88);
  opacity: 0.9;
}

pre {
  font-family: var(--dc-code-font-family);
  font-size: 0.85em;
}
</style>
