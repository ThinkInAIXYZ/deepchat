<template>
  <section class="flex min-h-0 flex-1 flex-col gap-3">
    <DcSectionCard
      :title="t('settings.memory.redesign.directiveCreateTitle')"
      :description="t('settings.memory.redesign.directiveCreateDescription')"
    >
      <template #actions>
        <DcBadge :variant="memoryEnabled ? 'secondary' : 'outline'" class="w-fit text-[10px]">
          {{
            memoryEnabled
              ? t('settings.memory.redesign.directiveRuntimeEnabled')
              : t('settings.memory.redesign.directiveRuntimeDisabled')
          }}
        </DcBadge>
      </template>

      <div class="grid gap-3 lg:grid-cols-[minmax(10rem,0.35fr)_minmax(0,1fr)]">
        <label class="space-y-1.5">
          <span class="text-[11px] font-medium text-muted-foreground">
            {{ t('settings.memory.redesign.directiveKindLabel') }}
          </span>
          <Select v-model="form.kind">
            <SelectTrigger class="h-9 text-xs" data-testid="memory-directive-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="instruction" class="text-xs">
                {{ t('settings.memory.redesign.directiveKind.instruction') }}
              </SelectItem>
              <SelectItem value="suppress_topic" class="text-xs">
                {{ t('settings.memory.redesign.directiveKind.suppress_topic') }}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label v-if="form.kind === 'suppress_topic'" class="space-y-1.5">
          <span class="text-[11px] font-medium text-muted-foreground">
            {{ t('settings.memory.redesign.directiveTopicLabel') }}
          </span>
          <Input
            v-model="form.topic"
            :placeholder="t('settings.memory.redesign.directiveTopicPlaceholder')"
            :aria-invalid="topicLength > AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS || topicTooBroad"
            data-testid="memory-directive-topic"
          />
          <p
            v-if="topicTooBroad"
            class="text-[11px] text-destructive"
            data-testid="memory-directive-topic-specificity"
          >
            {{
              t('settings.memory.redesign.directiveTopicTooBroad', {
                min: AGENT_MEMORY_DIRECTIVE_CJK_TOPIC_MIN_VISIBLE_CHARS
              })
            }}
          </p>
        </label>
      </div>

      <label class="mt-3 block space-y-1.5">
        <span class="text-[11px] font-medium text-muted-foreground">
          {{ t('settings.memory.redesign.directiveContentLabel') }}
        </span>
        <Textarea
          v-model="form.content"
          class="min-h-24 text-sm"
          :placeholder="directiveContentPlaceholder"
          :aria-invalid="contentLength > AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS"
          data-testid="memory-directive-content"
        />
      </label>

      <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="text-[11px] text-muted-foreground">
          <p>
            {{
              form.kind === 'suppress_topic'
                ? t('settings.memory.redesign.directiveSuppressHint')
                : t('settings.memory.redesign.directiveInstructionHint')
            }}
          </p>
          <p
            :class="
              contentLength > AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS ||
              topicLength > AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS
                ? 'text-destructive'
                : ''
            "
          >
            {{
              t('settings.memory.redesign.directiveLength', {
                content: contentLength,
                contentMax: AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS,
                topic: topicLength,
                topicMax: AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS
              })
            }}
          </p>
        </div>
        <DcButton
          size="sm"
          class="h-8 shrink-0 text-xs"
          :disabled="!canCreate"
          data-testid="memory-directive-create"
          @click="create"
        >
          <Icon icon="lucide:plus" class="mr-1.5 h-3.5 w-3.5" />
          {{ t('settings.memory.redesign.directiveCreateAction') }}
        </DcButton>
      </div>
    </DcSectionCard>

    <MemoryInlineFeedback v-if="feedback" :feedback="feedback" @clear="clearFeedback" />

    <div class="flex items-center justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold">
          {{ t('settings.memory.redesign.directiveListTitle') }}
        </h2>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {{
            t('settings.memory.redesign.directiveListDescription', {
              active: activeCount,
              draft: draftCount
            })
          }}
        </p>
      </div>
      <DcButton variant="ghost" size="sm" class="h-8 text-xs" :disabled="loading" @click="refresh">
        <Icon icon="lucide:refresh-cw" class="mr-1.5 h-3.5 w-3.5" />
        {{ t('settings.memory.redesign.refresh') }}
      </DcButton>
    </div>

    <div v-if="loading" class="py-12 text-center text-sm text-muted-foreground">
      {{ t('common.loading') }}
    </div>

    <DcEmpty
      v-else-if="orderedDirectives.length === 0"
      icon="lucide:list-checks"
      :title="t('settings.memory.redesign.directiveEmptyTitle')"
      :description="t('settings.memory.redesign.directiveEmptyDescription')"
      class="min-h-48"
    />

    <ScrollArea v-else class="min-h-0 flex-1 pr-3">
      <ol class="space-y-2">
        <li
          v-for="directive in orderedDirectives"
          :key="directive.id"
          class="rounded-lg border border-border bg-card px-3 py-3"
          :data-testid="`memory-directive-${directive.id}`"
        >
          <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
              <div class="mb-2 flex flex-wrap items-center gap-1.5">
                <DcBadge :variant="statusVariant(directive.status)" class="text-[10px]">
                  {{ t(`settings.memory.redesign.directiveStatus.${directive.status}`) }}
                </DcBadge>
                <DcBadge variant="outline" class="text-[10px]">
                  {{ t(`settings.memory.redesign.directiveKind.${directive.kind}`) }}
                </DcBadge>
                <span class="text-[10px] text-muted-foreground">
                  {{ t(`settings.memory.redesign.directiveSource.${directive.source}`) }}
                </span>
                <span class="text-[10px] text-muted-foreground">
                  {{ shortDate(directive.updatedAt, locale) }}
                </span>
              </div>
              <p
                v-if="directive.topic"
                class="mb-1.5 wrap-break-word text-xs font-medium text-muted-foreground"
              >
                {{
                  t('settings.memory.redesign.directiveTopicValue', {
                    topic: directive.topic
                  })
                }}
              </p>
              <p class="whitespace-pre-wrap wrap-break-word text-sm">{{ directive.content }}</p>
            </div>

            <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
              <template v-if="directive.status === 'draft'">
                <DcButton
                  variant="ghost"
                  size="sm"
                  class="h-8 text-xs"
                  :disabled="pendingIds.has(directive.id)"
                  @click="transition(directive.id, 'rejected')"
                >
                  {{ t('settings.deepchatAgents.memoryManager.reject') }}
                </DcButton>
                <DcButton
                  size="sm"
                  class="h-8 text-xs"
                  :disabled="pendingIds.has(directive.id)"
                  @click="transition(directive.id, 'active')"
                >
                  {{ t('settings.deepchatAgents.memoryManager.approve') }}
                </DcButton>
              </template>

              <DcButton
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-destructive"
                :disabled="pendingIds.has(directive.id)"
                :aria-label="t('common.delete')"
                data-testid="memory-directive-delete-trigger"
                @click="requestDelete(directive)"
                :tooltip="t('common.delete')"
              >
                <Icon icon="lucide:trash-2" class="h-3.5 w-3.5" />
              </DcButton>
            </div>
          </div>
        </li>
      </ol>
    </ScrollArea>

    <DcConfirmDialog
      :open="deleteDialogOpen"
      :title="t('settings.memory.redesign.directiveDeleteTitle')"
      :description="t('settings.memory.redesign.directiveDeleteDescription')"
      :confirm-label="t('common.delete')"
      :busy="deleteRequest.status === 'pending'"
      :confirm-attrs="{ 'data-testid': 'memory-directive-delete-confirm' }"
      :cancel-attrs="{ 'data-testid': 'memory-directive-delete-cancel' }"
      busy-data-testid="memory-directive-delete-spinner"
      @update:open="handleDeleteDialogOpenChange"
      @confirm="confirmDelete"
    >
      <MemoryInlineFeedback
        v-if="deleteFeedback"
        :feedback="deleteFeedback"
        @clear="clearDeleteFeedback"
      />
    </DcConfirmDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import { DcSectionCard } from '@dc-ui/components/section-card'
import { DcBadge } from '@dc-ui/components/badge'
import { DcEmpty } from '@dc-ui/components/empty'
import { DcButton } from '@dc-ui/components/button'
import { Input } from '@shadcn/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Textarea } from '@shadcn/components/ui/textarea'
import { createMemoryClient } from '@api/MemoryClient'
import {
  AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT,
  AGENT_MEMORY_DIRECTIVE_CJK_TOPIC_MIN_VISIBLE_CHARS,
  AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS,
  AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS,
  type AgentMemoryDirectiveKind,
  type AgentMemoryDirectiveStatus
} from '@shared/types/agent-memory'
import type { MemoryDirectiveCreateInput, MemoryDirectiveItem } from '@shared/contracts/routes'
import { isMemoryDirectiveTopicSpecificEnough } from '@shared/lib/memoryDirectiveTopic'
import { unicodeCodePointLength } from '@shared/lib/unicodeText'
import { shortDate } from './memoryRedesignUtils'
import MemoryInlineFeedback from './MemoryInlineFeedback.vue'
import {
  shouldReconcileMemoryCommandRejection,
  useMemoryInlineFeedback
} from '../lib/useMemoryInlineFeedback'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

const props = defineProps<{
  agentId: string
  memoryEnabled: boolean
  refreshToken: number
}>()

const { t, locale } = useI18n()
const memoryClient = createMemoryClient()
const panelFeedback = useMemoryInlineFeedback('MemoryDirectivesPanel')
const feedback = panelFeedback.feedback
const clearFeedback = panelFeedback.clear
const deleteOperationFeedback = useMemoryInlineFeedback('MemoryDirectivesPanel.delete')
const deleteFeedback = deleteOperationFeedback.feedback
const clearDeleteFeedback = deleteOperationFeedback.clear

const loading = ref(false)
const creating = ref(false)
const directives = ref<MemoryDirectiveItem[]>([])
const pendingIds = ref<ReadonlySet<string>>(new Set())
type DirectiveDeleteRequest =
  | { status: 'idle' }
  | { status: 'confirming'; target: MemoryDirectiveItem }
  | { status: 'pending'; target: MemoryDirectiveItem; agentId: string }
const deleteRequest = shallowRef<DirectiveDeleteRequest>({ status: 'idle' })
const form = reactive<{
  kind: AgentMemoryDirectiveKind
  content: string
  topic: string
}>({
  kind: 'instruction',
  content: '',
  topic: ''
})
let requestId = 0
let directiveRevision = 0

const directiveContentPlaceholder = computed(() =>
  form.kind === 'suppress_topic'
    ? t('settings.memory.redesign.directiveSuppressPlaceholder')
    : t('settings.memory.redesign.directiveInstructionPlaceholder')
)

const contentLength = computed(() => unicodeCodePointLength(form.content.trim()))
const topicLength = computed(() => unicodeCodePointLength(form.topic.trim()))
const topicTooBroad = computed(
  () =>
    form.kind === 'suppress_topic' &&
    Boolean(form.topic.trim()) &&
    !isMemoryDirectiveTopicSpecificEnough(form.topic)
)

const canCreate = computed(
  () =>
    Boolean(props.agentId) &&
    !creating.value &&
    Boolean(form.content.trim()) &&
    contentLength.value <= AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS &&
    (form.kind !== 'suppress_topic' ||
      (Boolean(form.topic.trim()) &&
        topicLength.value <= AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS &&
        !topicTooBroad.value))
)
const formDirty = computed(() => Boolean(form.content.trim() || form.topic.trim()))

const activeCount = computed(
  () => directives.value.filter((directive) => directive.status === 'active').length
)
const draftCount = computed(
  () => directives.value.filter((directive) => directive.status === 'draft').length
)
const deleteDialogOpen = computed(() => deleteRequest.value.status !== 'idle')

const statusPriority: Record<AgentMemoryDirectiveStatus, number> = {
  active: 0,
  draft: 1,
  rejected: 2
}

const orderedDirectives = computed(() =>
  [...directives.value].sort((left, right) => {
    const statusOrder = statusPriority[left.status] - statusPriority[right.status]
    if (statusOrder !== 0) return statusOrder
    if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
)

function statusVariant(status: AgentMemoryDirectiveStatus): 'default' | 'secondary' | 'outline' {
  if (status === 'active') return 'default'
  if (status === 'draft') return 'secondary'
  return 'outline'
}

function resetForm(): void {
  form.kind = 'instruction'
  form.content = ''
  form.topic = ''
}

function setPending(directiveId: string, pending: boolean): void {
  const next = new Set(pendingIds.value)
  if (pending) next.add(directiveId)
  else next.delete(directiveId)
  pendingIds.value = next
}

function upsertDirective(directive: MemoryDirectiveItem): void {
  directives.value = [
    directive,
    ...directives.value.filter((candidate) => candidate.id !== directive.id)
  ]
}

async function load(): Promise<void> {
  const agentId = props.agentId
  if (!agentId) {
    directives.value = []
    return
  }
  const current = ++requestId
  const revision = directiveRevision
  loading.value = true
  try {
    const [recent, active] = await Promise.all([
      memoryClient.listDirectives(agentId, { limit: 200 }),
      memoryClient.listDirectives(agentId, {
        statuses: ['active'],
        limit: AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT
      })
    ])
    if (current !== requestId || props.agentId !== agentId || revision !== directiveRevision) {
      return
    }
    directives.value = [
      ...new Map(
        [...recent, ...active].map((directive) => [directive.id, directive] as const)
      ).values()
    ]
  } catch (error) {
    if (current !== requestId || props.agentId !== agentId) return
    panelFeedback.fail(error)
  } finally {
    if (current === requestId && props.agentId === agentId) loading.value = false
  }
}

function refresh(): void {
  clearFeedback()
  void load()
}

async function create(): Promise<void> {
  if (!canCreate.value) return
  const agentId = props.agentId
  const content = form.content.trim()
  const topic = form.topic.trim()
  const input: MemoryDirectiveCreateInput =
    form.kind === 'suppress_topic'
      ? { kind: 'suppress_topic', content, topic }
      : { kind: 'instruction', content }
  directiveRevision += 1
  clearFeedback()
  creating.value = true
  let shouldReload = false
  try {
    const result = await memoryClient.createDirective(agentId, input)
    if (props.agentId !== agentId) return
    if (result.action === 'rejected') {
      panelFeedback.rejectDirective(result.reason)
      return
    }
    upsertDirective(result.directive)
    resetForm()
  } catch (error) {
    if (props.agentId === agentId) {
      shouldReload = true
      panelFeedback.fail(error)
    }
  } finally {
    if (props.agentId === agentId) {
      directiveRevision += 1
      creating.value = false
      if (shouldReload) void load()
    }
  }
}

async function transition(
  directiveId: string,
  status: Extract<AgentMemoryDirectiveStatus, 'active' | 'rejected'>
): Promise<void> {
  if (pendingIds.value.has(directiveId)) return
  const agentId = props.agentId
  directiveRevision += 1
  clearFeedback()
  setPending(directiveId, true)
  let shouldReload = false
  try {
    let updated: MemoryDirectiveItem | null
    if (status === 'active') {
      const result = await memoryClient.approveDirective(agentId, directiveId)
      if (props.agentId !== agentId) return
      if (result.action === 'rejected') {
        panelFeedback.rejectDirective(result.reason)
        shouldReload =
          result.reason !== 'capacity' && shouldReconcileMemoryCommandRejection(result.reason)
        return
      }
      updated = result.directive
    } else {
      const result = await memoryClient.rejectDirective(agentId, directiveId)
      if (props.agentId !== agentId) return
      if (result.action === 'rejected') {
        panelFeedback.rejectDirective(result.reason)
        shouldReload =
          result.reason !== 'capacity' && shouldReconcileMemoryCommandRejection(result.reason)
        return
      }
      updated = result.directive
    }
    upsertDirective(updated)
  } catch (error) {
    if (props.agentId === agentId) {
      shouldReload = true
      panelFeedback.fail(error)
    }
  } finally {
    if (props.agentId === agentId) {
      directiveRevision += 1
      setPending(directiveId, false)
      if (shouldReload) void load()
    }
  }
}

function requestDelete(directive: MemoryDirectiveItem): void {
  if (deleteRequest.value.status !== 'idle' || pendingIds.value.has(directive.id)) return
  clearDeleteFeedback()
  deleteRequest.value = { status: 'confirming', target: directive }
}

function handleDeleteDialogOpenChange(open: boolean): void {
  if (open || deleteRequest.value.status !== 'confirming') return
  deleteRequest.value = { status: 'idle' }
  clearDeleteFeedback()
}

async function confirmDelete(): Promise<void> {
  const request = deleteRequest.value
  if (request.status !== 'confirming' || pendingIds.value.has(request.target.id)) return
  const pendingRequest = {
    status: 'pending' as const,
    target: request.target,
    agentId: props.agentId
  }
  deleteRequest.value = pendingRequest
  directiveRevision += 1
  clearDeleteFeedback()
  setPending(request.target.id, true)
  let shouldReload = false
  try {
    const result = await memoryClient.deleteDirective(
      pendingRequest.agentId,
      pendingRequest.target.id
    )
    if (props.agentId !== pendingRequest.agentId || deleteRequest.value !== pendingRequest) {
      return
    }
    if (result.action === 'rejected') {
      if (shouldReconcileMemoryCommandRejection(result.reason)) {
        deleteRequest.value = { status: 'idle' }
        panelFeedback.rejectCommand(result.reason)
        shouldReload = true
      } else {
        deleteRequest.value = { status: 'confirming', target: pendingRequest.target }
        deleteOperationFeedback.rejectCommand(result.reason)
      }
      return
    }
    deleteRequest.value = { status: 'idle' }
    directives.value = directives.value.filter(
      (directive) => directive.id !== pendingRequest.target.id
    )
  } catch (error) {
    if (props.agentId === pendingRequest.agentId && deleteRequest.value === pendingRequest) {
      deleteRequest.value = { status: 'confirming', target: pendingRequest.target }
      deleteOperationFeedback.fail(error)
    }
  } finally {
    if (props.agentId === pendingRequest.agentId) {
      directiveRevision += 1
      setPending(pendingRequest.target.id, false)
      if (shouldReload) void load()
    }
  }
}

watch(
  () => props.agentId,
  () => {
    clearFeedback()
    requestId += 1
    directiveRevision += 1
    loading.value = false
    creating.value = false
    directives.value = []
    pendingIds.value = new Set()
    deleteRequest.value = { status: 'idle' }
    clearDeleteFeedback()
    resetForm()
    void load()
  },
  { immediate: true }
)

watch(
  () => props.refreshToken,
  () => void load()
)

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'memory-directive-draft',
  onDiscard: resetForm
})
const stopLeaveRiskSync = watch(
  [creating, formDirty],
  ([busy, dirty]) => {
    leaveGuardLease.setRisk(busy ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

onBeforeUnmount(() => {
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>
