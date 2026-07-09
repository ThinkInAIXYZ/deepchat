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
        <Button variant="ghost" size="icon" class="h-7 w-7 shrink-0" @click="requestClose">
          <Icon icon="lucide:x" class="h-3.5 w-3.5" />
        </Button>
      </header>

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
            @click="restore"
          >
            <Icon icon="lucide:archive-restore" class="mr-1.5 h-3.5 w-3.5" />
            {{ t('settings.deepchatAgents.memoryManager.restore') }}
          </Button>
          <Button v-else variant="outline" size="sm" class="h-8 text-xs" @click="archive">
            <Icon icon="lucide:archive" class="mr-1.5 h-3.5 w-3.5" />
            {{ t('settings.memory.redesign.archive') }}
          </Button>
          <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogTrigger as-child>
              <Button variant="ghost" size="icon" class="h-8 w-8 text-destructive">
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
              <AlertDialogFooter>
                <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
                <AlertDialogAction
                  class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  @click="remove"
                >
                  {{ t('settings.deepchatAgents.memoryManager.deletePermanent') }}
                </AlertDialogAction>
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
            data-testid="memory-inline-edit"
            @click="$emit('edit')"
          >
            <Icon icon="lucide:pencil" class="mr-1.5 h-3.5 w-3.5" />
            {{ t('common.edit') }}
          </Button>
          <Button variant="ghost" size="sm" class="h-8 text-xs" @click="requestClose">
            {{ mode === 'view' ? t('common.close') : t('common.cancel') }}
          </Button>
          <Button
            v-if="mode !== 'view'"
            size="sm"
            class="h-8 text-xs"
            :disabled="!canSave || saving"
            @click="save"
          >
            {{ mode === 'create' ? t('settings.memory.redesign.addMemory') : t('common.save') }}
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
  AlertDialogAction,
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
import { Textarea } from '@shadcn/components/ui/textarea'
import { useToast } from '@/components/use-toast'
import { createMemoryClient } from '@api/MemoryClient'
import { AGENT_MEMORY_CATEGORIES, type AgentMemoryCategory } from '@shared/types/agent-memory'
import type {
  MemoryAddResult,
  MemoryItem,
  MemoryLifecycle,
  MemorySourceSpan,
  MemoryUpdateResult
} from '@shared/contracts/routes'
import MemoryLifecyclePanel from './MemoryLifecyclePanel.vue'
import {
  ADD_CATEGORY_NONE,
  IMPORTANCE_VALUES,
  categoryLabelKey,
  importanceChoice,
  importanceDots,
  notifyMemoryActionFailed,
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
  changed: []
  saved: [memory?: MemoryItem]
  dirty: [value: boolean]
  'discard-pending': []
  'cancel-pending': []
}>()

const { t, locale } = useI18n()
const { toast } = useToast()
const memoryClient = createMemoryClient()

const saving = ref(false)
const sourceOpen = ref(false)
const sourceLoading = ref(false)
const sourceSpan = ref<MemorySourceSpan>(null)
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
const editable = computed(
  () => props.mode === 'create' || (props.mode === 'edit' && canEditMemory.value)
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
  lifecycleOpen.value = false
  lifecycleLoading.value = false
  lifecycle.value = null
  lifecycleError.value = null
  deleteDialogOpen.value = false
}

function notifyFailed(error?: unknown): void {
  notifyMemoryActionFailed(toast, t, error)
}

function setImportance(value: unknown): void {
  if (value !== 'low' && value !== 'medium' && value !== 'high') return
  form.importance = value
  importanceTouched.value = value !== seededImportance
}

function notifyAddOutcome(result: MemoryAddResult): void {
  if (result.action === 'challenged') {
    toast({ title: t('settings.deepchatAgents.memoryManager.addConflict') })
    return
  }
  if (result.action === 'noop') {
    const key =
      result.reason === 'duplicate'
        ? 'settings.deepchatAgents.memoryManager.addDuplicate'
        : 'settings.deepchatAgents.memoryManager.addSkipped'
    toast({ title: t(key) })
  }
}

function notifyUpdateOutcome(result: MemoryUpdateResult): void {
  if (result.action === 'noop') {
    toast({ title: t('settings.memory.redesign.editRejected') })
  }
}

async function selectResultMemory(memoryId: string | undefined): Promise<MemoryItem | undefined> {
  if (!memoryId) return undefined
  const [next] = await memoryClient.getByIds(props.agentId, [memoryId])
  return next
}

async function save(): Promise<void> {
  if (!canSave.value || saving.value) return
  saving.value = true
  try {
    const category = form.category === ADD_CATEGORY_NONE ? null : form.category
    if (props.mode === 'create') {
      const result = await memoryClient.add(props.agentId, {
        content: form.content.trim(),
        category: category ?? undefined,
        importance: IMPORTANCE_VALUES[form.importance]
      })
      notifyAddOutcome(result)
      emit('changed')
      if (result.action !== 'noop') {
        const next = await selectResultMemory(result.memoryId)
        emit('saved', next)
      }
      return
    }
    if (!props.memory) return
    const patch: { content: string; category: AgentMemoryCategory | null; importance?: number } = {
      content: form.content.trim(),
      category
    }
    if (importanceTouched.value) patch.importance = IMPORTANCE_VALUES[form.importance]
    const result = await memoryClient.update(props.agentId, props.memory.id, patch)
    notifyUpdateOutcome(result)
    if (result.action === 'noop') return
    const next =
      result.memoryId && result.memoryId !== props.memory.id
        ? await selectResultMemory(result.memoryId)
        : {
            ...props.memory,
            content: patch.content,
            category: patch.category,
            importance: patch.importance ?? props.memory.importance
          }
    emit('changed')
    emit('saved', next)
  } catch (error) {
    notifyFailed(error)
  } finally {
    saving.value = false
  }
}

async function archive(): Promise<void> {
  if (!props.memory) return
  try {
    const ok = await memoryClient.archive(props.agentId, props.memory.id)
    if (!ok) {
      notifyFailed()
      return
    }
    emit('changed')
    emit('close')
  } catch (error) {
    notifyFailed(error)
  }
}

async function restore(): Promise<void> {
  if (!props.memory) return
  try {
    const ok = await memoryClient.restore(props.agentId, props.memory.id)
    if (!ok) {
      notifyFailed()
      return
    }
    emit('changed')
  } catch (error) {
    notifyFailed(error)
  }
}

async function remove(): Promise<void> {
  if (!props.memory) return
  try {
    const ok = await memoryClient.remove(props.agentId, props.memory.id)
    if (!ok) {
      notifyFailed()
      return
    }
    emit('changed')
    emit('close')
  } catch (error) {
    notifyFailed(error)
  }
}

async function loadSource(): Promise<void> {
  if (!props.memory || !sourceOpen.value || sourceSpan.value || sourceLoading.value) return
  const agentId = props.agentId
  const memoryId = props.memory.id
  const requestId = ++sourceRequestId
  sourceLoading.value = true
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
      notifyFailed(error)
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
      lifecycleError.value = error instanceof Error ? error.message : String(error)
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
  () => [props.memory?.id, props.mode],
  () => seed(),
  { immediate: true }
)
watch(dirty, (value) => emit('dirty', value), { immediate: true })
watch(sourceOpen, () => void loadSource())
watch(lifecycleOpen, () => void loadLifecycle())
</script>
