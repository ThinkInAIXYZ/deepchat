<template>
  <div class="flex min-w-0 flex-col w-full">
    <LiveDelegationToolCallCard
      v-if="liveDelegationSpawn && threadId"
      :parent-session-id="threadId"
      :spawn="liveDelegationSpawn"
      :tool-status="block.status"
      :details-id="detailsId"
      :details-expanded="isExpanded"
      :read-only="readOnly"
      :permission-status="permissionStatus"
      @toggle-details="toggleExpanded"
    />
    <button
      v-else-if="renderMode !== 'app-only'"
      type="button"
      data-testid="tool-call-trigger"
      class="inline-flex w-fit max-w-full min-w-0 min-h-7 items-center gap-2 rounded-sm py-1 text-left text-sm leading-5 text-foreground/60 transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)] select-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
      :aria-expanded="isExpanded"
      :aria-controls="detailsId"
      @click="toggleExpanded"
    >
      <span
        v-if="statusVariant === 'running' || statusVariant === 'reviewing'"
        data-testid="tool-call-running-indicator"
        :data-status-variant="statusVariant"
        :class="[
          'tool-call-status-ring shrink-0',
          statusVariant === 'reviewing' ? 'tool-call-status-ring-reviewing' : ''
        ]"
        aria-hidden="true"
      />
      <Icon
        v-else
        :icon="statusIconName"
        :class="['w-4 h-4 shrink-0', statusIconClass]"
        aria-hidden="true"
      />
      <span class="tool-call-labels flex min-w-0 items-baseline gap-1.5">
        <span
          data-testid="tool-call-name"
          class="tool-call-name truncate"
          :title="displayFunctionName"
        >
          {{ displayFunctionName }}
        </span>
        <span
          v-if="summaryText"
          data-testid="tool-call-summary"
          class="tool-call-summary"
          :title="summaryText"
        >
          {{ summaryText }}
        </span>
      </span>
      <span
        v-if="statusVariant === 'error' && permissionStatus !== 'denied'"
        class="shrink-0 text-xs text-destructive"
      >
        {{ t('toolCall.failed') }}
      </span>
      <span
        v-if="permissionStatus"
        data-testid="tool-call-permission-badge"
        :data-permission-status="permissionStatus"
        :class="[
          'shrink-0 text-xs',
          permissionStatus === 'granted' ? 'text-muted-foreground' : 'text-destructive'
        ]"
      >
        {{
          permissionStatus === 'granted' ? t('toolCall.badge.allowed') : t('toolCall.badge.denied')
        }}
      </span>
      <span
        v-if="showRtkBadge"
        data-testid="tool-call-rtk-badge"
        class="shrink-0 text-[10px] text-muted-foreground"
      >
        {{ t('toolCall.badge.rtk') }}
      </span>
      <span
        v-if="hasImagePreviews"
        data-testid="tool-call-image-badge"
        class="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
        :title="t('toolCall.imagePreviewCount', { count: imagePreviews.length })"
      >
        <Icon icon="lucide:image" class="h-3 w-3" />
        {{ imagePreviews.length }}
      </span>
      <Icon
        icon="lucide:chevron-right"
        class="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)] motion-reduce:transition-none"
        :class="isExpanded ? 'rotate-90' : 'rotate-0'"
        aria-hidden="true"
      />
    </button>

    <div
      v-if="renderMode !== 'app-only'"
      class="grid w-full overflow-hidden transition-[grid-template-rows,opacity,margin-top,margin-bottom] duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)] motion-reduce:transition-none"
      :class="
        isExpanded
          ? 'mt-1 mb-2 grid-rows-[1fr] opacity-100'
          : 'mt-0 mb-0 grid-rows-[0fr] opacity-0 pointer-events-none'
      "
      :aria-hidden="!isExpanded"
      :inert="isExpanded ? undefined : true"
    >
      <div class="min-h-0 overflow-hidden">
        <div
          v-if="shouldRenderDetails"
          :id="detailsId"
          :data-testid="isExpanded ? 'tool-call-details' : undefined"
          class="w-full min-w-0 pl-6 py-1 text-card-foreground overscroll-contain"
        >
          <div v-if="isSubagentOrchestrator" class="flex flex-col gap-1.5">
            <button
              v-for="task in subagentTasks"
              :key="task.normalizedId"
              data-testid="subagent-task-trigger"
              type="button"
              :disabled="!task.sessionId"
              :class="[
                'inline-flex w-full min-w-0 min-h-7 items-center gap-2 rounded-sm py-1 text-left text-xs leading-5 transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)] overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                task.sessionId ? 'hover:bg-accent/40' : 'cursor-default opacity-70'
              ]"
              @click.stop="handleSubagentSessionOpen(task)"
            >
              <Icon
                icon="lucide:git-fork"
                class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span :class="getSubagentStatusClass(task.status)" class="shrink-0 text-xs">
                {{ getSubagentStatusLabel(task.status) }}
              </span>
              <span
                class="min-w-0 max-w-[35%] truncate text-foreground/80"
                :title="task.targetAgentName"
              >
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

          <div v-else-if="planSnapshot" data-testid="tool-call-plan" class="space-y-2">
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              <span class="font-medium">{{ t('chat.workspace.plan.section') }}</span>
              <span>
                {{
                  t('chat.workspace.plan.completedCount', {
                    completed: planSnapshot.plan.filter((entry) => entry.status === 'completed')
                      .length,
                    total: planSnapshot.plan.length
                  })
                }}
              </span>
            </div>
            <p
              v-if="planSnapshot.explanation"
              class="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground"
            >
              {{ planSnapshot.explanation }}
            </p>
            <ul v-if="planSnapshot.plan.length" class="space-y-1">
              <li
                v-for="(entry, index) in planSnapshot.plan"
                :key="index"
                class="flex items-start gap-1.5 py-1 text-[13px] leading-5"
                :class="resolveStepPresentation(entry.status).textClass"
                :aria-label="entryAriaLabel(t, entry)"
              >
                <span
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                  :class="resolveStepPresentation(entry.status).badgeClass"
                >
                  <Icon
                    :icon="resolveStepPresentation(entry.status).icon"
                    class="h-3 w-3 shrink-0"
                    :class="resolveStepPresentation(entry.status).iconClass"
                    aria-hidden="true"
                  />
                </span>
                <span class="min-w-0 flex-1 whitespace-pre-wrap break-words">{{ entry.step }}</span>
              </li>
            </ul>
            <p v-else class="text-xs text-muted-foreground">{{ t('chat.workspace.plan.empty') }}</p>
          </div>

          <div v-else class="flex min-w-0 flex-col gap-3">
            <div
              v-if="expandedToolTitle"
              data-testid="tool-call-expanded-title"
              class="truncate text-xs font-mono text-muted-foreground"
              :title="expandedToolTitle"
            >
              {{ expandedToolTitle }}
            </div>

            <!-- Parameters -->
            <div v-if="hasParams" class="space-y-2 flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <h5 class="text-xs font-medium text-muted-foreground">
                  {{ t('toolCall.params') }}
                </h5>
                <DcCopyButton
                  size="xs"
                  variant="ghost"
                  class="text-muted-foreground transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)] hover:text-foreground"
                  :copy-text="paramsText"
                  :label="t('common.copy')"
                  @click.stop
                />
              </div>
              <div
                data-testid="tool-call-params"
                class="dc-overscroll-contain rounded-md bg-muted/50 font-mono text-xs p-2 whitespace-pre-wrap break-words min-h-0 max-h-20 overflow-auto"
              >
                {{ paramsText }}
              </div>
            </div>

            <!-- Response -->
            <div v-if="hasResponse" :class="responseLayoutClass">
              <div class="flex items-center justify-between gap-2">
                <h5 class="text-xs font-medium text-muted-foreground">
                  {{ isTerminalTool ? t('toolCall.terminalOutput') : t('toolCall.responseData') }}
                </h5>
                <DcCopyButton
                  size="xs"
                  variant="ghost"
                  class="text-muted-foreground transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)] hover:text-foreground"
                  :copy-text="responseText"
                  :label="t('common.copy')"
                  @click.stop
                />
              </div>
              <template v-if="diffData">
                <div class="markstream-vue dc-overscroll-contain min-h-0 overflow-auto">
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
                    :loading="false"
                    :stream="false"
                    :show-header="false"
                    class="rounded-md bg-muted/50 text-xs p-2 h-full min-h-0"
                  />
                </div>
                <div
                  v-if="diffData.replacements !== undefined"
                  class="text-xs text-muted-foreground"
                >
                  {{ t('toolCall.replacementsCount', { count: diffData.replacements }) }}
                </div>
              </template>
              <pre
                v-else
                class="dc-overscroll-contain rounded-md bg-muted/50 text-xs p-2 whitespace-pre-wrap break-words max-h-64 overflow-auto"
                >{{ responseText }}</pre
              >
            </div>

            <MessageBlockToolCallImagePreview v-if="hasImagePreviews" :previews="imagePreviews" />
          </div>
        </div>
      </div>
    </div>

    <McpAppView
      v-if="
        renderMode !== 'tool-only' &&
        mcpAppDescriptor &&
        mcpAppResult &&
        appConversationId &&
        appMessageId &&
        appBlockId
      "
      :descriptor="mcpAppDescriptor"
      :result="mcpAppResult"
      :conversation-id="appConversationId"
      :message-id="appMessageId"
      :block-id="appBlockId"
      :tool-input="appToolInput"
    />
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { computed, defineAsyncComponent, onBeforeUnmount, ref, useId, watch } from 'vue'
import { CodeBlockNode } from 'markstream-vue'
import { summarizeToolCallPreview } from '@shared/lib/toolCallSummary'
import { normalizeAgentPlanEntries, UPDATE_PLAN_TOOL_NAME } from '@shared/types/agent-plan'
import { entryAriaLabel, resolveStepPresentation } from '@/composables/useAgentPlanStatus'
import { useThemeStore } from '@/stores/theme'
import { useSessionStore } from '@/stores/ui/session'
import { getMarkstreamLanguageFromFilename } from '@/lib/markstreamLanguage'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import { parseLiveDelegationSpawnBlock } from '@/lib/liveDelegationToolCall'
import LiveDelegationToolCallCard from './LiveDelegationToolCallCard.vue'
import MessageBlockToolCallImagePreview from './MessageBlockToolCallImagePreview.vue'
import { DcCopyButton } from '@dc-ui/components'

const McpAppView = defineAsyncComponent(() => import('@/components/mcp/McpAppView.vue'))

const { t } = useI18n()

const themeStore = useThemeStore()
const sessionStore = useSessionStore()

const props = defineProps<{
  block: DisplayAssistantMessageBlock
  messageId?: string
  threadId?: string
  readOnly?: boolean
  renderMode?: 'full' | 'tool-only' | 'app-only'
  permissionStatus?: 'granted' | 'denied'
  initiallyExpanded?: boolean
}>()

const emit = defineEmits<{
  'manual-toggle': [expanded: boolean]
}>()

type ExpansionSource = 'auto' | 'manual' | null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

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

const isExpanded = ref(Boolean(props.initiallyExpanded))
const shouldRenderDetails = ref(false)
const expansionSource = ref<ExpansionSource>(props.initiallyExpanded ? 'manual' : null)
const autoExpandDismissed = ref(false)
const detailsId = `tool-call-details-${useId()}`
// Slightly past --dc-motion-default (220ms) so the collapse transition finishes first.
const DETAILS_UNMOUNT_DELAY_MS = 240
let detailsUnmountTimer: number | null = null

const liveDelegationSpawn = computed(() => {
  const parsed = parseLiveDelegationSpawnBlock(props.block)
  if (!parsed || !props.threadId) return null
  if (parsed.delegation && parsed.delegation.parentSessionId !== props.threadId) return null
  return parsed
})

const statusVariant = computed(() => {
  if (props.block.status === 'error') return 'error'
  if (props.block.status === 'success') return 'success'
  if (props.block.extra?.autoApproveReviewStatus === 'reviewing') return 'reviewing'
  if (props.block.status === 'loading') return 'running'
  return 'neutral'
})

const functionLabel = computed(() => {
  const toolCall = props.block.tool_call
  return toolCall?.name ?? ''
})

const displayFunctionName = computed(() => functionLabel.value || t('toolCall.title'))

const expandedToolTitle = computed(() => {
  if (!shouldRenderDetails.value || !props.block.tool_call) {
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
const imagePreviews = computed(() =>
  (props.block.tool_call?.imagePreviews ?? []).filter(
    (preview) =>
      typeof preview.data === 'string' &&
      preview.data.trim().length > 0 &&
      typeof preview.mimeType === 'string' &&
      preview.mimeType.trim().length > 0
  )
)
const hasImagePreviews = computed(() => imagePreviews.value.length > 0)

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
const mcpAppResult = computed(() => props.block.tool_call?.mcpResult)
const mcpAppDescriptor = computed(() => mcpAppResult.value?.app)
const appConversationId = computed(() => props.threadId?.trim() ?? '')
const appMessageId = computed(() => props.messageId?.trim() ?? '')
const appBlockId = computed(() => props.block.id?.trim() || props.block.tool_call?.id?.trim() || '')
const appToolInput = computed<Record<string, unknown>>(() => parsedParamsRecord.value ?? {})

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

const isUpdatePlan = computed(
  () => rawToolName.value === UPDATE_PLAN_TOOL_NAME && props.block.extra?.toolSource !== 'mcp'
)

const planSnapshot = computed(() => {
  if (
    !isUpdatePlan.value ||
    props.block.status !== 'success' ||
    props.block.extra?.needsUserAction
  ) {
    return null
  }
  const args = parsedParamsRecord.value
  if (!Array.isArray(args?.plan)) return null
  const plan = normalizeAgentPlanEntries(args.plan)
  if (plan.length !== args.plan.length) return null

  // Each call stores its own full plan; the dock's latest snapshot would rewrite history.
  return { plan, explanation: normalizeOptionalText(args.explanation) }
})

const summaryText = computed(() => {
  if (isUpdatePlan.value) return ''
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
  return summarizeToolCallPreview(raw, { toolName: functionLabel.value })
})

const subagentTasks = computed<SubagentProgressTask[]>(() => {
  const progress =
    parseSubagentProgress(props.block.extra?.subagentProgress) ??
    parseSubagentProgress(props.block.extra?.subagentFinal)
  const unnamedAgentLabel = t('settings.deepchatAgents.unnamed')
  const unnamedTaskLabel = t('chat.toolCall.subagents.unnamedTask')

  return (progress?.tasks ?? []).map((task, index) => {
    const slotId = normalizeOptionalText(task.slotId)
    const displayName = normalizeOptionalText(task.displayName)
    const normalizedId =
      normalizeOptionalText(task.taskId) || slotId || `subagent-task-${index + 1}`
    const label = displayName || slotId || unnamedTaskLabel
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
    emit('manual-toggle', false)
    return
  }

  isExpanded.value = true
  expansionSource.value = 'manual'
  emit('manual-toggle', true)
}

const statusIconName = computed(() => {
  if (statusVariant.value === 'error') return 'lucide:circle-alert'
  if (isUpdatePlan.value) return 'lucide:list-checks'
  if (isTerminalTool.value || isProcessTool.value) return 'lucide:terminal'
  if (matchesToolContractName(rawToolName.value, 'read')) return 'lucide:book-open'
  if (
    matchesToolContractName(rawToolName.value, 'write') ||
    matchesToolContractName(rawToolName.value, 'edit_text')
  )
    return 'lucide:pencil'
  if (matchesToolContractName(rawToolName.value, 'search')) return 'lucide:search'
  return 'lucide:wrench'
})

const statusIconClass = computed(() =>
  statusVariant.value === 'error' ? 'text-destructive' : 'text-muted-foreground'
)

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

const diffLanguage = computed(() => getMarkstreamLanguageFromFilename(paramsPath.value))

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
  autoExpandable: boolean
) => {
  if (status === 'loading' && autoExpandable && !autoExpandDismissed.value && !isExpanded.value) {
    isExpanded.value = true
    expansionSource.value = 'auto'
    return
  }

  if (
    status === 'success' &&
    !props.block.extra?.needsUserAction &&
    expansionSource.value === 'auto'
  ) {
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

watch(
  [() => props.block.status, shouldAutoExpand, () => props.block.extra?.needsUserAction],
  ([status, autoExpandable]) => {
    syncAutoExpansionState(status, autoExpandable)
  },
  { immediate: true }
)

watch(
  isExpanded,
  (expanded) => {
    if (detailsUnmountTimer !== null) {
      window.clearTimeout(detailsUnmountTimer)
      detailsUnmountTimer = null
    }

    if (expanded) {
      shouldRenderDetails.value = true
      return
    }

    if (!shouldRenderDetails.value) return

    detailsUnmountTimer = window.setTimeout(() => {
      detailsUnmountTimer = null
      if (!isExpanded.value) {
        shouldRenderDetails.value = false
      }
    }, DETAILS_UNMOUNT_DELAY_MS)
  },
  { immediate: true }
)

const getSubagentStatusClass = (status: string): string => {
  if (status === 'completed') {
    return 'text-muted-foreground'
  }
  if (status === 'error' || status === 'cancelled') {
    return 'text-destructive'
  }
  if (status.startsWith('waiting')) {
    return 'text-amber-700 dark:text-amber-400'
  }
  return 'text-muted-foreground'
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

onBeforeUnmount(() => {
  if (detailsUnmountTimer !== null) {
    window.clearTimeout(detailsUnmountTimer)
    detailsUnmountTimer = null
  }
})

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
.tool-call-name {
  max-width: min(28ch, 100%);
  flex-shrink: 0;
}

.tool-call-summary {
  flex: 1 1 auto;
  min-width: 0;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-call-status-ring {
  width: 1rem;
  height: 1rem;
  border-radius: 9999px;
  box-sizing: border-box;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  animation: tool-call-spin 1s linear infinite;
}

.tool-call-status-ring-reviewing {
  color: var(--muted-foreground);
}

@keyframes tool-call-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tool-call-status-ring {
    animation: none;
  }
}

pre {
  font-family: var(--dc-code-font-family);
  font-size: 0.85em;
}
</style>
