<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <div class="flex flex-col gap-2 lg:flex-row lg:items-center">
      <Input
        v-model="searchQuery"
        type="search"
        class="h-9 text-sm lg:flex-1"
        :placeholder="t('settings.deepchatAgents.memoryManager.searchPlaceholder')"
      />
      <div class="flex flex-wrap items-center gap-2">
        <Select v-model="categoryFilter">
          <SelectTrigger class="h-9 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" class="text-xs">
              {{ t('settings.deepchatAgents.memoryManager.categoryFilterAll') }}
            </SelectItem>
            <SelectItem
              v-for="category in AGENT_MEMORY_CATEGORIES"
              :key="category"
              :value="category"
              class="text-xs"
            >
              {{ categoryLabel(category) }}
            </SelectItem>
            <SelectItem value="uncategorized" class="text-xs">
              {{ t('settings.deepchatAgents.memoryManager.categoryUncategorized') }}
            </SelectItem>
          </SelectContent>
        </Select>
        <label class="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs">
          <Checkbox v-model:checked="includeArchived" />
          {{ t('settings.memory.redesign.includeArchived') }}
        </label>
        <Button size="sm" class="h-9" :disabled="memoryDisabled" @click="openCreate">
          <Icon icon="lucide:plus" class="mr-1.5 h-3.5 w-3.5" />
          {{ t('settings.memory.redesign.addMemory') }}
        </Button>
      </div>
    </div>

    <div
      v-if="expandedMode === 'create'"
      :ref="setExpandedPanelEl"
      data-memory-expanded-panel="true"
    >
      <MemoryInlinePanel
        :agent-id="agentId"
        :memory="null"
        mode="create"
        :discard-prompt="panelDiscardPrompt"
        @close="requestClosePanel"
        @saved="handlePanelSaved"
        @dirty="panelDirty = $event"
        @discard-pending="discardAndSwitch"
        @cancel-pending="cancelPendingAction"
      />
    </div>

    <p v-if="searchError" class="text-xs text-destructive">{{ searchError }}</p>

    <div v-if="initialLoading" class="py-12 text-center text-sm text-muted-foreground">
      {{ t('common.loading') }}
    </div>
    <MemoryEmptyState
      v-else-if="memories.length === 0 && !searchActive && expandedMode !== 'create'"
      :enabled="memoryEnabled"
      @add="openCreate"
      @enable="$emit('enable')"
    />
    <div
      v-else-if="visibleMemories.length === 0 && archivedSearchMatches.length === 0"
      class="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground"
    >
      {{ emptyMessage }}
    </div>
    <ScrollArea v-else class="min-h-0 flex-1 pr-3">
      <div class="space-y-4">
        <ul v-if="visibleMemories.length > 0" class="space-y-2">
          <li v-for="memory in visibleMemories" :key="memory.id">
            <MemoryListRow
              :memory="memory"
              :selected="memory.id === expandedMemory?.id"
              @select="selectMemory(memory)"
              @edit="editMemory(memory)"
              @archive="archive(memory)"
              @restore="restore(memory)"
              @remove="remove(memory)"
            />
            <div
              v-if="isExpanded(memory)"
              :ref="setExpandedPanelEl"
              data-memory-expanded-panel="true"
            >
              <MemoryInlinePanel
                :agent-id="agentId"
                :memory="panelMemoryFor(memory)"
                :mode="expandedMode ?? 'view'"
                :discard-prompt="panelDiscardPrompt"
                @close="requestClosePanel"
                @edit="editMemory(memory)"
                @saved="handlePanelSaved"
                @dirty="panelDirty = $event"
                @discard-pending="discardAndSwitch"
                @cancel-pending="cancelPendingAction"
              />
            </div>
          </li>
        </ul>

        <section v-if="archivedSearchMatches.length > 0" class="space-y-2">
          <div class="text-xs font-medium text-muted-foreground">
            {{ t('settings.memory.redesign.archivedMatches') }}
          </div>
          <ul class="space-y-2">
            <li v-for="memory in archivedSearchMatches" :key="memory.id">
              <MemoryListRow
                :memory="memory"
                :selected="memory.id === expandedMemory?.id"
                @select="selectMemory(memory)"
                @edit="editMemory(memory)"
                @archive="archive(memory)"
                @restore="restore(memory)"
                @remove="remove(memory)"
              />
              <div
                v-if="isExpanded(memory)"
                :ref="setExpandedPanelEl"
                data-memory-expanded-panel="true"
              >
                <MemoryInlinePanel
                  :agent-id="agentId"
                  :memory="panelMemoryFor(memory)"
                  :mode="expandedMode ?? 'view'"
                  :discard-prompt="panelDiscardPrompt"
                  @close="requestClosePanel"
                  @edit="editMemory(memory)"
                  @saved="handlePanelSaved"
                  @dirty="panelDirty = $event"
                  @discard-pending="discardAndSwitch"
                  @cancel-pending="cancelPendingAction"
                />
              </div>
            </li>
          </ul>
        </section>
      </div>
    </ScrollArea>

    <AlertDialog :open="deleteTarget !== null" @update:open="onDeleteDialogOpen">
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
            @click="confirmRemove"
          >
            {{ t('settings.deepchatAgents.memoryManager.deletePermanent') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'
import { Input } from '@shadcn/components/ui/input'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { useToast } from '@/components/use-toast'
import { createMemoryClient } from '@api/MemoryClient'
import { AGENT_MEMORY_CATEGORIES, type AgentMemoryCategory } from '@shared/types/agent-memory'
import type { MemoryItem, MemorySearchResult } from '@shared/contracts/routes'
import MemoryEmptyState from './MemoryEmptyState.vue'
import MemoryInlinePanel from './MemoryInlinePanel.vue'
import {
  categoryLabelKey,
  importanceDots,
  matchesCategoryFilter,
  formatRelativeTime,
  notifyMemoryActionFailed,
  sourceLabelKey,
  type MemoryCategoryFilter
} from './memoryRedesignUtils'

const props = defineProps<{
  agentId: string
  memoryEnabled: boolean
  refreshToken: number
}>()

defineEmits<{ enable: [] }>()

const { t, locale } = useI18n()
const { toast } = useToast()
const memoryClient = createMemoryClient()

const loading = ref(false)
const memories = ref<MemoryItem[]>([])
const searchQuery = ref('')
const searchResults = ref<MemorySearchResult[]>([])
const searchError = ref<string | null>(null)
const categoryFilter = ref<MemoryCategoryFilter>('all')
const includeArchived = ref(false)
type PanelMode = 'view' | 'edit' | 'create'
type PendingPanelAction =
  | { type: 'expand'; memory: MemoryItem; mode: Exclude<PanelMode, 'create'> }
  | { type: 'create' }
  | { type: 'close' }

const expandedMode = ref<PanelMode | null>(null)
const expandedMemory = ref<MemoryItem | null>(null)
const expandedPanelEl = ref<HTMLElement | null>(null)
const pendingAction = ref<PendingPanelAction | null>(null)
const closePrompt = ref(false)
const panelDirty = ref(false)
const deleteTarget = ref<MemoryItem | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchRequestId = 0
let loadRequestId = 0

const memoryDisabled = computed(() => props.memoryEnabled === false)
// Only block the whole view with a spinner when there's nothing to show yet
// (initial/agent-switch load); background refreshes keep the list mounted.
const initialLoading = computed(() => loading.value && memories.value.length === 0)
const searchActive = computed(() => searchQuery.value.trim().length > 0)
const categoryFilterActive = computed(() => categoryFilter.value !== 'all')
const searchRows = computed<MemoryItem[]>(() => searchResults.value)
const baseRows = computed(() => (searchActive.value ? searchRows.value : memories.value))
const visibleMemories = computed(() =>
  baseRows.value.filter((memory) => {
    if (!includeArchived.value && memory.status === 'archived') return false
    if (searchActive.value && memory.status === 'archived') return false
    return matchesCategoryFilter(memory, categoryFilter.value)
  })
)
const archivedSearchMatches = computed(() => {
  if (!searchActive.value || !includeArchived.value) return []
  const query = searchQuery.value.trim().toLocaleLowerCase()
  return memories.value.filter(
    (memory) =>
      memory.status === 'archived' &&
      memory.content.toLocaleLowerCase().includes(query) &&
      matchesCategoryFilter(memory, categoryFilter.value)
  )
})
const panelDiscardPrompt = computed(() => pendingAction.value !== null || closePrompt.value)
const emptyMessage = computed(() => {
  if (searchActive.value) return t('settings.deepchatAgents.memoryManager.noSearchResults')
  if (categoryFilterActive.value)
    return t('settings.deepchatAgents.memoryManager.noCategoryResults')
  return t('settings.deepchatAgents.memoryManager.emptyMemories')
})

const MemoryListRow = defineComponent({
  name: 'MemoryListRow',
  props: {
    memory: { type: Object as () => MemoryItem, required: true },
    selected: { type: Boolean, default: false }
  },
  emits: ['select', 'edit', 'archive', 'restore', 'remove'],
  setup(rowProps, { emit: rowEmit }) {
    return () =>
      h(
        'div',
        {
          role: 'button',
          tabindex: 0,
          class: [
            'group w-full rounded-lg border px-3 py-2 text-left transition hover:bg-muted/60',
            rowProps.selected ? 'rounded-b-none border-border bg-muted/40' : 'border-border',
            rowProps.memory.status === 'archived' ? 'opacity-65' : ''
          ],
          onClick: () => rowEmit('select'),
          onKeydown: (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              rowEmit('select')
            }
          }
        },
        [
          h('div', { class: 'flex items-start justify-between gap-3' }, [
            h('div', { class: 'min-w-0 flex-1' }, [
              h('p', { class: 'line-clamp-2 wrap-break-word text-sm' }, rowProps.memory.content),
              h(
                'div',
                {
                  class:
                    'mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground'
                },
                [
                  h('span', categoryLabel(rowProps.memory.category)),
                  h('span', '·'),
                  h('span', importanceDots(rowProps.memory.importance)),
                  h('span', '·'),
                  h('span', formatRelativeTime(rowProps.memory.createdAt, locale.value)),
                  h('span', '·'),
                  h('span', t(sourceLabelKey(rowProps.memory)))
                ]
              )
            ]),
            h(
              'div',
              {
                class:
                  'flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100'
              },
              [
                rowProps.memory.status !== 'archived' &&
                rowProps.memory.status !== 'conflicted' &&
                rowProps.memory.conflictState !== 'challenged' &&
                (rowProps.memory.kind === 'episodic' || rowProps.memory.kind === 'semantic')
                  ? h(
                      Button,
                      {
                        variant: 'ghost',
                        size: 'sm',
                        class: 'h-7 px-2 text-xs',
                        'data-testid': 'memory-row-edit',
                        onClick: (event: MouseEvent) => {
                          event.stopPropagation()
                          rowEmit('edit')
                        }
                      },
                      () => [h(Icon, { icon: 'lucide:pencil', class: 'h-3.5 w-3.5' })]
                    )
                  : null,
                h(
                  Button,
                  {
                    variant: 'ghost',
                    size: 'sm',
                    class: 'h-7 px-2 text-xs',
                    'data-testid':
                      rowProps.memory.status === 'archived'
                        ? 'memory-row-restore'
                        : 'memory-row-archive',
                    onClick: (event: MouseEvent) => {
                      event.stopPropagation()
                      rowEmit(rowProps.memory.status === 'archived' ? 'restore' : 'archive')
                    }
                  },
                  () => [
                    h(Icon, {
                      icon:
                        rowProps.memory.status === 'archived'
                          ? 'lucide:archive-restore'
                          : 'lucide:archive',
                      class: 'h-3.5 w-3.5'
                    })
                  ]
                ),
                h(
                  Button,
                  {
                    variant: 'ghost',
                    size: 'sm',
                    class:
                      'h-7 w-7 px-0 text-muted-foreground hover:text-destructive focus-visible:text-destructive',
                    'aria-label': t('settings.deepchatAgents.memoryManager.deletePermanent'),
                    title: t('settings.deepchatAgents.memoryManager.deletePermanent'),
                    'data-testid': 'memory-row-delete',
                    onClick: (event: MouseEvent) => {
                      event.stopPropagation()
                      rowEmit('remove')
                    }
                  },
                  () => h(Icon, { icon: 'lucide:trash-2', class: 'h-3.5 w-3.5' })
                )
              ]
            )
          ])
        ]
      )
  }
})

function categoryLabel(category: AgentMemoryCategory | null | undefined): string {
  return t(categoryLabelKey(category))
}

function notifyFailed(error?: unknown): void {
  notifyMemoryActionFailed(toast, t, error)
}

function clearSearchTimer(): void {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
}

async function load(): Promise<void> {
  const agentId = props.agentId
  if (!agentId) return
  const requestId = ++loadRequestId
  loading.value = true
  try {
    const rows = await memoryClient.list(agentId)
    if (requestId !== loadRequestId || props.agentId !== agentId) return
    memories.value = rows
    if (expandedMemory.value) {
      const refreshed = rows.find((row) => row.id === expandedMemory.value?.id)
      if (refreshed) {
        expandedMemory.value = refreshed
      } else {
        closePanel()
        expandedMemory.value = null
      }
    }
  } catch (error) {
    if (requestId !== loadRequestId || props.agentId !== agentId) return
    notifyFailed(error)
  } finally {
    if (requestId === loadRequestId && props.agentId === agentId) loading.value = false
  }
}

function resetForAgentChange(): void {
  clearSearchTimer()
  searchRequestId += 1
  searchQuery.value = ''
  searchResults.value = []
  searchError.value = null
  categoryFilter.value = 'all'
  includeArchived.value = false
  memories.value = []
  expandedMemory.value = null
  pendingAction.value = null
  closePrompt.value = false
  deleteTarget.value = null
  expandedMode.value = null
  panelDirty.value = false
}

function isCurrentSearch(agentId: string, query: string, requestId: number): boolean {
  return (
    requestId === searchRequestId && props.agentId === agentId && searchQuery.value.trim() === query
  )
}

async function runSearch(agentId: string, query: string, requestId: number): Promise<void> {
  searchError.value = null
  try {
    const results = await memoryClient.search(agentId, query)
    if (isCurrentSearch(agentId, query, requestId)) searchResults.value = results
  } catch (error) {
    if (isCurrentSearch(agentId, query, requestId)) {
      searchResults.value = []
      searchError.value =
        error instanceof Error
          ? error.message
          : t('settings.deepchatAgents.memoryManager.searchFailed')
    }
  }
}

function queueSearch(value: string, delay = 200): void {
  const query = value.trim()
  clearSearchTimer()
  searchRequestId += 1
  const requestId = searchRequestId
  if (!query) {
    searchResults.value = []
    searchError.value = null
    return
  }
  const agentId = props.agentId
  searchTimer = setTimeout(() => void runSearch(agentId, query, requestId), delay)
}

function openCreate(): void {
  if (memoryDisabled.value) return
  if (panelDirty.value && expandedMode.value) {
    pendingAction.value = { type: 'create' }
    closePrompt.value = false
    return
  }
  setCreate()
}

function setCreate(): void {
  expandedMode.value = 'create'
  expandedMemory.value = null
  pendingAction.value = null
  closePrompt.value = false
  panelDirty.value = false
  scrollExpandedPanelIntoView()
}

function selectMemory(memory: MemoryItem): void {
  if (isExpanded(memory)) {
    requestClosePanel()
    return
  }
  requestExpand(memory, 'view')
}

function editMemory(memory: MemoryItem): void {
  requestExpand(memory, 'edit')
}

function requestExpand(memory: MemoryItem, mode: Exclude<PanelMode, 'create'>): void {
  if (panelDirty.value && expandedMode.value) {
    pendingAction.value = { type: 'expand', memory, mode }
    closePrompt.value = false
    return
  }
  setExpanded(memory, mode)
}

function setExpanded(memory: MemoryItem, mode: Exclude<PanelMode, 'create'>): void {
  expandedMemory.value = memory
  expandedMode.value = mode
  pendingAction.value = null
  closePrompt.value = false
  panelDirty.value = false
  scrollExpandedPanelIntoView()
}

function isExpanded(memory: MemoryItem): boolean {
  return expandedMode.value !== 'create' && expandedMemory.value?.id === memory.id
}

function panelMemoryFor(memory: MemoryItem): MemoryItem {
  return expandedMemory.value?.id === memory.id ? expandedMemory.value : memory
}

function upsertMemory(memory: MemoryItem): void {
  const index = memories.value.findIndex((row) => row.id === memory.id)
  if (index >= 0) {
    memories.value.splice(index, 1, memory)
  } else {
    memories.value.unshift(memory)
  }
  const searchIndex = searchResults.value.findIndex((row) => row.id === memory.id)
  if (searchIndex >= 0) {
    searchResults.value.splice(searchIndex, 1, { ...searchResults.value[searchIndex], ...memory })
  }
}

function removeMemory(memoryId: string): void {
  memories.value = memories.value.filter((row) => row.id !== memoryId)
  searchResults.value = searchResults.value.filter((row) => row.id !== memoryId)
  if (expandedMemory.value?.id === memoryId) closePanel()
}

function setPanelSelected(memory: MemoryItem): void {
  upsertMemory(memory)
  setExpanded(memory, 'view')
}

function handlePanelSaved(memory?: MemoryItem): void {
  if (memory) {
    setPanelSelected(memory)
    return
  }
  closePanel()
}

function setExpandedPanelEl(element: unknown): void {
  expandedPanelEl.value = element instanceof HTMLElement ? element : null
}

function scrollExpandedPanelIntoView(): void {
  void nextTick(() => {
    const panel = expandedPanelEl.value
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ block: 'nearest' })
    }
  })
}

function discardAndSwitch(): void {
  const action = pendingAction.value
  pendingAction.value = null
  const shouldClose = closePrompt.value
  closePrompt.value = false
  panelDirty.value = false
  if (action?.type === 'expand') setExpanded(action.memory, action.mode)
  else if (action?.type === 'create') setCreate()
  else if (action?.type === 'close' || shouldClose) closePanel()
}

function cancelPendingAction(): void {
  pendingAction.value = null
  closePrompt.value = false
}

function requestClosePanel(): void {
  if (panelDirty.value && expandedMode.value) {
    pendingAction.value = { type: 'close' }
    closePrompt.value = true
    return
  }
  closePanel()
}

function closePanel(): void {
  expandedMode.value = null
  expandedMemory.value = null
  pendingAction.value = null
  closePrompt.value = false
  panelDirty.value = false
}

async function archive(memory: MemoryItem): Promise<void> {
  const agentId = props.agentId
  try {
    const ok = await memoryClient.archive(agentId, memory.id)
    if (props.agentId !== agentId) return
    if (!ok) {
      notifyFailed()
      return
    }
    upsertMemory({ ...memory, status: 'archived' })
  } catch (error) {
    if (props.agentId !== agentId) return
    notifyFailed(error)
  }
}

async function restore(memory: MemoryItem): Promise<void> {
  const agentId = props.agentId
  try {
    const ok = await memoryClient.restore(agentId, memory.id)
    if (props.agentId !== agentId) return
    if (!ok) {
      notifyFailed()
      return
    }
    upsertMemory({ ...memory, status: 'pending_embedding' })
  } catch (error) {
    if (props.agentId !== agentId) return
    notifyFailed(error)
  }
}

function remove(memory: MemoryItem): void {
  deleteTarget.value = memory
}

function onDeleteDialogOpen(open: boolean): void {
  if (!open) deleteTarget.value = null
}

async function confirmRemove(): Promise<void> {
  const memory = deleteTarget.value
  if (!memory) return
  const agentId = props.agentId
  try {
    const ok = await memoryClient.remove(agentId, memory.id)
    if (props.agentId !== agentId) return
    if (!ok) {
      notifyFailed()
      return
    }
    removeMemory(memory.id)
  } catch (error) {
    if (props.agentId !== agentId) return
    notifyFailed(error)
  } finally {
    if (props.agentId === agentId) deleteTarget.value = null
  }
}

watch(
  () => props.agentId,
  () => {
    resetForAgentChange()
    void load()
  },
  { immediate: true }
)

watch(
  () => props.refreshToken,
  () => {
    void load()
    if (searchActive.value) queueSearch(searchQuery.value, 0)
  }
)

watch(searchQuery, (value) => {
  queueSearch(value)
})

watch(panelDirty, (dirty) => {
  if (!dirty) {
    closePrompt.value = false
    if (pendingAction.value?.type === 'close') pendingAction.value = null
  }
})

watch(
  () => expandedMemory.value?.id ?? null,
  () => {
    closePrompt.value = false
  }
)

onUnmounted(() => {
  clearSearchTimer()
})
</script>
