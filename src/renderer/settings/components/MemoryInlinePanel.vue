<template>
  <section
    class="relative overflow-hidden rounded-b-lg border border-t-0 border-border bg-muted/20 px-3 py-3 shadow-sm"
    data-testid="memory-inline-panel"
    :data-mode="mode"
    tabindex="-1"
    @keydown="handleKeydown"
  >
    <Transition
      enter-active-class="transition duration-[175ms] ease-out"
      enter-from-class="translate-y-2 scale-[0.98] opacity-0"
      enter-to-class="translate-y-0 scale-100 opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="translate-y-0 scale-100 opacity-100"
      leave-to-class="translate-y-1 scale-[0.98] opacity-0"
    >
      <div
        v-if="discardPrompt"
        class="absolute inset-x-3 top-3 z-10 rounded-lg border border-amber-500/40 bg-background/95 p-3 text-xs shadow-lg shadow-black/10 backdrop-blur"
        data-testid="memory-discard-prompt"
      >
        <div class="font-medium">{{ t('settings.memory.redesign.unsavedTitle') }}</div>
        <p class="mt-1 text-muted-foreground">
          {{ t('settings.memory.redesign.unsavedDescription') }}
        </p>
        <div class="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" class="h-7 text-xs" @click="$emit('cancel-pending')">
            {{ t('common.cancel') }}
          </Button>
          <Button size="sm" class="h-7 text-xs" @click="$emit('discard-pending')">
            {{ t('settings.memory.redesign.discardChanges') }}
          </Button>
        </div>
      </div>
    </Transition>

    <div class="space-y-4">
      <header class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-sm font-semibold">
            {{
              mode === 'create'
                ? t('settings.memory.redesign.addMemory')
                : t('settings.memory.redesign.detailTitle')
            }}
          </h3>
          <p v-if="memory && mode !== 'create'" class="mt-0.5 text-xs text-muted-foreground">
            {{
              t('settings.memory.redesign.createdAt', { date: shortDate(memory.createdAt, locale) })
            }}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7 shrink-0"
          :disabled="busy"
          :aria-label="t('common.close')"
          @click="requestClose"
        >
          <Icon icon="lucide:x" class="h-3.5 w-3.5" />
        </Button>
      </header>

      <MemoryInlineFeedback v-if="feedback" :feedback="feedback" @clear="clearFeedback" />

      <template v-if="mode === 'view'">
        <div class="space-y-1.5">
          <div class="text-[11px] font-medium text-muted-foreground">
            {{ t('settings.memory.redesign.contentLabel') }}
          </div>
          <p
            class="min-h-16 whitespace-pre-wrap wrap-break-word rounded-md border border-border bg-background px-3 py-2 text-sm"
            data-testid="memory-inline-content"
          >
            {{ memory?.content }}
          </p>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <div class="text-[11px] font-medium text-muted-foreground">
              {{ t('settings.memory.redesign.categoryLabel') }}
            </div>
            <div class="rounded-md border border-border bg-background px-3 py-2 text-xs">
              {{ categoryLabel(memory?.category) }}
            </div>
          </div>

          <div class="space-y-1.5">
            <div class="text-[11px] font-medium text-muted-foreground">
              {{ t('settings.memory.redesign.importanceLabel') }}
            </div>
            <div class="rounded-md border border-border bg-background px-3 py-2 text-xs">
              {{ memory ? importanceDots(memory.importance) : '' }}
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <label class="block space-y-1.5">
          <span class="text-[11px] font-medium text-muted-foreground">
            {{ t('settings.memory.redesign.contentLabel') }}
          </span>
          <Textarea
            v-model="form.content"
            class="min-h-28 text-sm"
            :disabled="!editable"
            :placeholder="t('settings.memory.redesign.contentPlaceholder')"
          />
        </label>

        <div class="grid gap-3 sm:grid-cols-2">
          <label class="space-y-1.5">
            <span class="text-[11px] font-medium text-muted-foreground">
              {{ t('settings.memory.redesign.categoryLabel') }}
            </span>
            <Select v-model="form.category" :disabled="!editable">
              <SelectTrigger class="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="ADD_CATEGORY_NONE" class="text-xs">
                  {{ t('settings.deepchatAgents.memoryManager.categoryUncategorized') }}
                </SelectItem>
                <SelectItem
                  v-for="category in AGENT_MEMORY_CATEGORIES"
                  :key="category"
                  :value="category"
                  class="text-xs"
                >
                  {{ categoryLabel(category) }}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label class="space-y-1.5">
            <span class="text-[11px] font-medium text-muted-foreground">
              {{ t('settings.memory.redesign.importanceLabel') }}
            </span>
            <Select
              :model-value="form.importance"
              :disabled="!editable"
              @update:model-value="setImportance"
            >
              <SelectTrigger class="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low" class="text-xs">
                  {{ t('settings.deepchatAgents.memoryManager.importanceLow') }}
                </SelectItem>
                <SelectItem value="medium" class="text-xs">
                  {{ t('settings.deepchatAgents.memoryManager.importanceMedium') }}
                </SelectItem>
                <SelectItem value="high" class="text-xs">
                  {{ t('settings.deepchatAgents.memoryManager.importanceHigh') }}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
      </template>

      <div v-if="memory" class="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        <div class="flex flex-wrap gap-x-3 gap-y-1">
          <span>{{ t('settings.memory.redesign.kindLine', { kind: memory.kind }) }}</span>
          <span>{{ t('settings.memory.redesign.statusLine', { status: memory.status }) }}</span>
          <span>{{ t(sourceLabelKey(memory)) }}</span>
        </div>
        <p v-if="memory.status === 'archived'" class="mt-2 text-amber-700 dark:text-amber-300">
          {{ t('settings.memory.redesign.archivedEditHint') }}
        </p>
      </div>

      <Collapsible v-if="memory?.sourceSession" v-model:open="sourceOpen" class="rounded-lg border">
        <CollapsibleTrigger
          class="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
        >
          {{ t('settings.memory.redesign.sourceConversation') }}
          <Icon :icon="sourceOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent class="border-t">
          <div class="max-h-64 overflow-y-auto px-3 py-2" data-testid="memory-source-scroll">
            <div v-if="sourceLoading" class="py-4 text-center text-xs text-muted-foreground">
              {{ t('common.loading') }}
            </div>
            <div
              v-else-if="sourceError"
              role="alert"
              class="flex items-center justify-between gap-3 py-3 text-xs text-destructive"
            >
              <span>{{ sourceError }}</span>
              <Button variant="outline" size="sm" class="h-7 text-xs" @click="retrySource">
                {{ t('settings.memory.redesign.refresh') }}
              </Button>
            </div>
            <div v-else-if="!sourceSpan" class="py-4 text-center text-xs text-muted-foreground">
              {{ t('settings.deepchatAgents.memoryManager.sourceDialogEmpty') }}
            </div>
            <ol v-else class="space-y-2">
              <li
                v-for="entry in sourceSpan.entries"
                :key="entry.entryId"
                class="rounded-md border bg-background px-2 py-1.5"
              >
                <div class="mb-1 text-[10px] uppercase text-muted-foreground">
                  {{ entry.role }} · #{{ entry.orderSeq }}
                </div>
                <p class="whitespace-pre-wrap wrap-break-word text-xs">{{ entry.content }}</p>
              </li>
            </ol>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible v-if="memory" v-model:open="lifecycleOpen" class="rounded-lg border">
        <CollapsibleTrigger
          class="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
        >
          {{ t('settings.memory.redesign.lifecycleDetails') }}
          <Icon
            :icon="lifecycleOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
            class="h-4 w-4"
          />
        </CollapsibleTrigger>
        <CollapsibleContent class="border-t">
          <div class="max-h-64 overflow-y-auto p-3" data-testid="memory-lifecycle-scroll">
            <MemoryLifecyclePanel
              :lifecycle="lifecycle"
              :loading="lifecycleLoading"
              :error="lifecycleError"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <footer class="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center">
        <div v-if="memory" class="flex items-center gap-1">
          <Button
            v-if="memory.status === 'archived'"
            variant="outline"
            size="sm"
            class="h-8 text-xs"
            :disabled="busy"
            @click="restore"
          >
            <Spinner v-if="pendingMutation === 'restore'" class="mr-1.5 size-3.5" />
            <Icon v-else icon="lucide:archive-restore" class="mr-1.5 h-3.5 w-3.5" />
            {{ t('settings.deepchatAgents.memoryManager.restore') }}
          </Button>
          <Button
            v-else
            variant="outline"
            size="sm"
            class="h-8 text-xs"
            :disabled="busy"
            @click="archive"
          >
            <Spinner v-if="pendingMutation === 'archive'" class="mr-1.5 size-3.5" />
            <Icon v-else icon="lucide:archive" class="mr-1.5 h-3.5 w-3.5" />
            {{ t('settings.memory.redesign.archive') }}
          </Button>
          <AlertDialog :open="deleteDialogOpen" @update:open="handleDeleteDialogOpenChange">
            <AlertDialogTrigger as-child>
              <Button
                data-testid="memory-inline-delete-trigger"
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-destructive"
                :disabled="busy"
              >
                <Icon icon="lucide:trash-2" class="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {{ t('settings.deepchatAgents.memoryManager.deleteConfirmTitle') }}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {{ t('settings.deepchatAgents.memoryManager.deleteConfirmBody') }}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <MemoryInlineFeedback
                v-if="deleteFeedback"
                :feedback="deleteFeedback"
                @clear="clearDeleteFeedback"
              />
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="memory-inline-delete-cancel" :disabled="busy">
                  {{ t('common.cancel') }}
                </AlertDialogCancel>
                <AlertDialogAsyncAction
                  data-testid="memory-inline-delete-confirm"
                  class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  :disabled="busy"
                  @click="remove"
                >
                  <Spinner
                    v-if="pendingMutation === 'remove'"
                    data-testid="memory-inline-delete-spinner"
                    class="mr-1.5 size-3.5"
                  />
                  {{ t('settings.deepchatAgents.memoryManager.deletePermanent') }}
                </AlertDialogAsyncAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div class="ml-auto flex items-center gap-2">
          <Button
            v-if="mode === 'view' && canEditMemory"
            variant="outline"
            size="sm"
            class="h-8 text-xs"
            :disabled="busy"
            data-testid="memory-inline-edit"
            @click="$emit('edit')"
          >
            <Icon icon="lucide:pencil" class="mr-1.5 h-3.5 w-3.5" />
            {{ t('common.edit') }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-8 text-xs"
            :disabled="busy"
            @click="requestClose"
          >
            {{ mode === 'view' ? t('common.close') : t('common.cancel') }}
          </Button>
          <Button
            v-if="mode !== 'view'"
            size="sm"
            class="h-8 text-xs"
            :disabled="!canSave || busy"
            @click="save"
          >
            <Spinner v-if="saving" class="mr-1.5 size-3.5" />
            {{
              saving
                ? t('common.saving')
                : mode === 'create'
                  ? t('settings.memory.redesign.addMemory')
                  : t('common.save')
            }}
          </Button>
        </div>
      </footer>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import {
  AlertDialog,
  AlertDialogAsyncAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@shadcn/components/ui/alert-dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@shadcn/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Textarea } from '@shadcn/components/ui/textarea'
import { createMemoryClient } from '@api/MemoryClient'
import { AGENT_MEMORY_CATEGORIES, type AgentMemoryCategory } from '@shared/types/agent-memory'
import type {
  MemoryAddResult,
  MemoryCommandRejectionReason,
  MemoryItem,
  MemoryLifecycle,
  MemorySourceSpan,
  MemoryUpdateResult
} from '@shared/contracts/routes'
import {
  shouldReconcileMemoryCommandRejection,
  useMemoryInlineFeedback,
  type MemoryInlineFeedbackState
} from '../lib/useMemoryInlineFeedback'
import MemoryLifecyclePanel from './MemoryLifecyclePanel.vue'
import MemoryInlineFeedback from './MemoryInlineFeedback.vue'
import {
  ADD_CATEGORY_NONE,
  IMPORTANCE_VALUES,
  categoryLabelKey,
  importanceChoice,
  importanceDots,
  sourceLabelKey,
  type MemoryImportanceChoice,
  shortDate
} from './memoryRedesignUtils'

const props = defineProps<{
  agentId: string
  memory: MemoryItem | null
  mode: 'view' | 'edit' | 'create'
  discardPrompt?: boolean
}>()

const emit = defineEmits<{
  close: []
  edit: []
  saved: [memory?: MemoryItem]
  reconcile: []
  feedback: [feedback: MemoryInlineFeedbackState]
  busy: [value: boolean]
  dirty: [value: boolean]
  'discard-pending': []
  'cancel-pending': []
}>()

const { t, locale } = useI18n()
const memoryClient = createMemoryClient()
const panelFeedback = useMemoryInlineFeedback('MemoryInlinePanel')
const feedback = panelFeedback.feedback
const clearFeedback = panelFeedback.clear
const deleteOperationFeedback = useMemoryInlineFeedback('MemoryInlinePanel.delete')
const deleteFeedback = deleteOperationFeedback.feedback
const clearDeleteFeedback = deleteOperationFeedback.clear

const saving = ref(false)
const pendingMutation = ref<'archive' | 'restore' | 'remove' | null>(null)
const sourceOpen = ref(false)
const sourceLoading = ref(false)
const sourceSpan = ref<MemorySourceSpan>(null)
const sourceError = ref<string | null>(null)
const lifecycleOpen = ref(false)
const lifecycleLoading = ref(false)
const lifecycleError = ref<string | null>(null)
const lifecycle = ref<MemoryLifecycle | null>(null)
const deleteDialogOpen = ref(false)
const importanceTouched = ref(false)
let sourceRequestId = 0
let lifecycleRequestId = 0
let seededImportance: MemoryImportanceChoice = 'medium'

const form = reactive({
  content: '',
  category: ADD_CATEGORY_NONE as AgentMemoryCategory | typeof ADD_CATEGORY_NONE,
  importance: 'medium' as MemoryImportanceChoice
})

const canEditMemory = computed(
  () =>
    props.memory?.status !== 'archived' &&
    props.memory?.status !== 'conflicted' &&
    props.memory?.conflictState !== 'challenged' &&
    (props.memory?.kind === 'episodic' || props.memory?.kind === 'semantic')
)
const busy = computed(() => saving.value || pendingMutation.value !== null)
const editable = computed(
  () => !busy.value && (props.mode === 'create' || (props.mode === 'edit' && canEditMemory.value))
)
const dirty = computed(() => {
  if (props.mode === 'view') return false
  if (props.mode === 'create') return form.content.trim().length > 0
  if (!props.memory) return false
  const category = form.category === ADD_CATEGORY_NONE ? null : form.category
  return (
    form.content.trim() !== props.memory.content.trim() ||
    category !== props.memory.category ||
    (importanceTouched.value && IMPORTANCE_VALUES[form.importance] !== props.memory.importance)
  )
})
const canSave = computed(
  () => editable.value && form.content.trim().length > 0 && (props.mode === 'create' || dirty.value)
)

function categoryLabel(category: AgentMemoryCategory | null | undefined): string {
  return t(categoryLabelKey(category))
}

function seed(): void {
  sourceRequestId += 1
  lifecycleRequestId += 1
  const memory = props.memory
  form.content = memory?.content ?? ''
  form.category = memory?.category ?? ADD_CATEGORY_NONE
  form.importance = memory ? importanceChoice(memory.importance) : 'medium'
  seededImportance = form.importance
  importanceTouched.value = false
  sourceOpen.value = false
  sourceLoading.value = false
  sourceSpan.value = null
  sourceError.value = null
  lifecycleOpen.value = false
  lifecycleLoading.value = false
  lifecycle.value = null
  lifecycleError.value = null
  deleteDialogOpen.value = false
  clearFeedback()
  clearDeleteFeedback()
}

function reportReconciledCommandRejection(reason: MemoryCommandRejectionReason): void {
  panelFeedback.rejectCommand(reason)
  const nextFeedback = feedback.value
  if (nextFeedback) emit('feedback', nextFeedback)
  clearFeedback()
  emit('reconcile')
}

function setImportance(value: unknown): void {
  if (value !== 'low' && value !== 'medium' && value !== 'high') return
  form.importance = value
  importanceTouched.value = value !== seededImportance
}

function notifyAddOutcome(result: MemoryAddResult): void {
  if (result.action === 'challenged') {
    emit('feedback', {
      tone: 'warning',
      title: t('settings.deepchatAgents.memoryManager.addConflict')
    })
    return
  }
  if (result.action === 'noop') {
    const key =
      result.reason === 'duplicate'
        ? 'settings.deepchatAgents.memoryManager.addDuplicate'
        : 'settings.deepchatAgents.memoryManager.addSkipped'
    panelFeedback.show('info', t(key))
  }
}

function notifyUpdateOutcome(result: MemoryUpdateResult): void {
  if (result.action === 'noop') {
    panelFeedback.show('warning', t('settings.memory.redesign.editRejected'))
  }
}

async function selectResultMemory(
  agentId: string,
  memoryId: string | undefined
): Promise<MemoryItem | undefined> {
  if (!memoryId) return undefined
  try {
    const [next] = await memoryClient.getByIds(agentId, [memoryId])
    return next
  } catch (error) {
    console.error('[MemoryInlinePanel] Failed to refresh saved memory', error)
    return undefined
  }
}

function isCurrentOperation(agentId: string, memoryId: string | null, mode: typeof props.mode) {
  return props.agentId === agentId && (props.memory?.id ?? null) === memoryId && props.mode === mode
}

async function save(): Promise<void> {
  if (!canSave.value || saving.value) return
  const agentId = props.agentId
  const memoryId = props.memory?.id ?? null
  const mode = props.mode
  clearFeedback()
  saving.value = true
  try {
    const category = form.category === ADD_CATEGORY_NONE ? null : form.category
    if (mode === 'create') {
      const result = await memoryClient.add(agentId, {
        content: form.content.trim(),
        category: category ?? undefined,
        importance: IMPORTANCE_VALUES[form.importance]
      })
      if (!isCurrentOperation(agentId, memoryId, mode)) return
      notifyAddOutcome(result)
      if (result.action === 'noop') return
      const next = await selectResultMemory(agentId, result.memoryId)
      if (!isCurrentOperation(agentId, memoryId, mode)) return
      emit('saved', next)
      return
    }
    const memory = props.memory
    if (!memory) return
    const patch: { content: string; category: AgentMemoryCategory | null; importance?: number } = {
      content: form.content.trim(),
      category
    }
    if (importanceTouched.value) patch.importance = IMPORTANCE_VALUES[form.importance]
    const result = await memoryClient.update(agentId, memory.id, patch)
    if (!isCurrentOperation(agentId, memoryId, mode)) return
    notifyUpdateOutcome(result)
    if (result.action === 'noop') return
    const next =
      result.memoryId && result.memoryId !== memory.id
        ? await selectResultMemory(agentId, result.memoryId)
        : {
            ...memory,
            content: patch.content,
            category: patch.category,
            importance: patch.importance ?? memory.importance
          }
    if (!isCurrentOperation(agentId, memoryId, mode)) return
    emit('saved', next)
  } catch (error) {
    if (isCurrentOperation(agentId, memoryId, mode)) panelFeedback.fail(error)
  } finally {
    saving.value = false
  }
}

async function archive(): Promise<void> {
  const memory = props.memory
  if (!memory || busy.value) return
  const agentId = props.agentId
  clearFeedback()
  pendingMutation.value = 'archive'
  try {
    const result = await memoryClient.archive(agentId, memory.id)
    if (props.agentId !== agentId || props.memory?.id !== memory.id) return
    if (result.action === 'rejected') {
      if (shouldReconcileMemoryCommandRejection(result.reason)) {
        reportReconciledCommandRejection(result.reason)
      } else {
        panelFeedback.rejectCommand(result.reason)
      }
      return
    }
    emit('close')
  } catch (error) {
    if (props.agentId === agentId && props.memory?.id === memory.id) panelFeedback.fail(error)
  } finally {
    pendingMutation.value = null
  }
}

async function restore(): Promise<void> {
  const memory = props.memory
  if (!memory || busy.value) return
  const agentId = props.agentId
  clearFeedback()
  pendingMutation.value = 'restore'
  try {
    const result = await memoryClient.restore(agentId, memory.id)
    if (props.agentId !== agentId || props.memory?.id !== memory.id) return
    if (result.action === 'rejected') {
      if (shouldReconcileMemoryCommandRejection(result.reason)) {
        reportReconciledCommandRejection(result.reason)
      } else {
        panelFeedback.rejectCommand(result.reason)
      }
      return
    }
  } catch (error) {
    if (props.agentId === agentId && props.memory?.id === memory.id) panelFeedback.fail(error)
  } finally {
    pendingMutation.value = null
  }
}

async function remove(): Promise<void> {
  const memory = props.memory
  if (!memory || busy.value) return
  const agentId = props.agentId
  clearDeleteFeedback()
  pendingMutation.value = 'remove'
  try {
    const result = await memoryClient.remove(agentId, memory.id)
    if (props.agentId !== agentId || props.memory?.id !== memory.id) return
    if (result.action === 'rejected') {
      if (shouldReconcileMemoryCommandRejection(result.reason)) {
        deleteDialogOpen.value = false
        reportReconciledCommandRejection(result.reason)
      } else {
        deleteOperationFeedback.rejectCommand(result.reason)
      }
      return
    }
    deleteDialogOpen.value = false
    emit('close')
  } catch (error) {
    if (props.agentId === agentId && props.memory?.id === memory.id) {
      deleteOperationFeedback.fail(error)
    }
  } finally {
    pendingMutation.value = null
  }
}

function handleDeleteDialogOpenChange(open: boolean): void {
  if (pendingMutation.value === 'remove') return
  if (open !== deleteDialogOpen.value) clearDeleteFeedback()
  deleteDialogOpen.value = open
}

async function loadSource(): Promise<void> {
  if (!props.memory || !sourceOpen.value || sourceSpan.value || sourceLoading.value) return
  const agentId = props.agentId
  const memoryId = props.memory.id
  const requestId = ++sourceRequestId
  sourceLoading.value = true
  sourceError.value = null
  try {
    const next = await memoryClient.getSourceSpan(agentId, memoryId)
    if (
      requestId === sourceRequestId &&
      props.agentId === agentId &&
      props.memory?.id === memoryId
    ) {
      sourceSpan.value = next
    }
  } catch (error) {
    if (
      requestId === sourceRequestId &&
      props.agentId === agentId &&
      props.memory?.id === memoryId
    ) {
      console.error('[MemoryInlinePanel] Failed to load source span', error)
      sourceError.value = t('settings.deepchatAgents.memoryManager.actionFailed')
    }
  } finally {
    if (
      requestId === sourceRequestId &&
      props.agentId === agentId &&
      props.memory?.id === memoryId
    ) {
      sourceLoading.value = false
    }
  }
}

function retrySource(): void {
  sourceError.value = null
  void loadSource()
}

async function loadLifecycle(): Promise<void> {
  if (!props.memory || !lifecycleOpen.value || lifecycle.value || lifecycleLoading.value) return
  const agentId = props.agentId
  const memoryId = props.memory.id
  const requestId = ++lifecycleRequestId
  lifecycleLoading.value = true
  lifecycleError.value = null
  try {
    const next = await memoryClient.getLifecycle(agentId, memoryId)
    if (
      requestId === lifecycleRequestId &&
      props.agentId === agentId &&
      props.memory?.id === memoryId
    ) {
      lifecycle.value = next
    }
  } catch (error) {
    if (
      requestId === lifecycleRequestId &&
      props.agentId === agentId &&
      props.memory?.id === memoryId
    ) {
      console.error('[MemoryInlinePanel] Failed to load lifecycle', error)
      lifecycleError.value = t('settings.deepchatAgents.memoryManager.actionFailed')
    }
  } finally {
    if (
      requestId === lifecycleRequestId &&
      props.agentId === agentId &&
      props.memory?.id === memoryId
    ) {
      lifecycleLoading.value = false
    }
  }
}

function requestClose(): void {
  emit('close')
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  if (props.discardPrompt) {
    event.preventDefault()
    emit('cancel-pending')
  }
}

watch(
  () => [props.agentId, props.memory?.id, props.mode],
  () => seed(),
  { immediate: true }
)
watch(busy, (value) => emit('busy', value), { immediate: true, flush: 'sync' })
watch(dirty, (value) => emit('dirty', value), { immediate: true, flush: 'sync' })
watch(sourceOpen, () => void loadSource())
watch(lifecycleOpen, () => void loadLifecycle())
</script>
