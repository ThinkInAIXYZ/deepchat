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
        <DcButton size="sm" class="h-9" :disabled="memoryDisabled || panelBusy" @click="openCreate">
          <Icon icon="lucide:plus" class="mr-1.5 h-3.5 w-3.5" />
          {{ t('settings.memory.redesign.addMemory') }}
        </DcButton>
      </div>
    </div>

    <DcInlineError v-if="searchError" :error="searchError" />
    <MemoryInlineFeedback v-if="feedback" :feedback="feedback" @clear="clearFeedback" />

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
        @reconcile="refreshLoadedPages"
        @feedback="handlePanelFeedback"
        @busy="panelBusy = $event"
        @dirty="panelDirty = $event"
        @discard-pending="discardAndSwitch"
        @cancel-pending="cancelPendingAction"
      />
    </div>

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
              :pending="panelBusy || pendingIds.has(memory.id)"
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
                @reconcile="refreshLoadedPages"
                @feedback="handlePanelFeedback"
                @busy="panelBusy = $event"
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
                :pending="panelBusy || pendingIds.has(memory.id)"
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
                  @reconcile="refreshLoadedPages"
                  @feedback="handlePanelFeedback"
                  @busy="panelBusy = $event"
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

    <div
      v-if="!initialLoading && nextCursor && (!searchActive || includeArchived)"
      class="flex justify-center pt-1"
    >
      <DcButton
        variant="outline"
        size="sm"
        data-testid="memory-load-more"
        :disabled="loadingMore"
        @click="loadMore"
      >
        {{ loadingMore ? t('common.loading') : t('settings.memory.redesign.loadMore') }}
      </DcButton>
    </div>

    <DcConfirmDialog
      :open="deleteDialogOpen"
      :title="t('settings.deepchatAgents.memoryManager.deleteConfirmTitle')"
      :description="t('settings.deepchatAgents.memoryManager.deleteConfirmBody')"
      :confirm-label="t('settings.deepchatAgents.memoryManager.deletePermanent')"
      :busy="deleteRequest.status === 'pending'"
      :confirm-attrs="{ 'data-testid': 'memory-list-delete-confirm' }"
      :cancel-attrs="{ 'data-testid': 'memory-list-delete-cancel' }"
      busy-data-testid="memory-list-delete-spinner"
      @update:open="onDeleteDialogOpen"
      @confirm="confirmRemove"
    >
      <MemoryInlineFeedback
        v-if="deleteFeedback"
        :feedback="deleteFeedback"
        @clear="clearDeleteFeedback"
      />
    </DcConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch
} from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { DcButton } from '@dc-ui/components/button'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import { Input } from '@shadcn/components/ui/input'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { createMemoryClient } from '@api/MemoryClient'
import { AGENT_MEMORY_CATEGORIES, type AgentMemoryCategory } from '@shared/types/agent-memory'
import type { MemoryItem, MemorySearchResult } from '@shared/contracts/routes'
import {
  shouldReconcileMemoryCommandRejection,
  useMemoryInlineFeedback,
  type MemoryInlineFeedbackState
} from '../lib/useMemoryInlineFeedback'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'
import MemoryEmptyState from './MemoryEmptyState.vue'
import MemoryInlineFeedback from './MemoryInlineFeedback.vue'
import MemoryInlinePanel from './MemoryInlinePanel.vue'
import {
  categoryLabelKey,
  importanceDots,
  matchesCategoryFilter,
  formatRelativeTime,
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
const memoryClient = createMemoryClient()
const panelFeedback = useMemoryInlineFeedback('MemoryListView')
const feedback = panelFeedback.feedback
const clearFeedback = panelFeedback.clear
const deleteOperationFeedback = useMemoryInlineFeedback('MemoryListView.delete')
const deleteFeedback = deleteOperationFeedback.feedback
const clearDeleteFeedback = deleteOperationFeedback.clear

const loading = ref(false)
const loadingMore = ref(false)
const pendingIds = ref<ReadonlySet<string>>(new Set())
const memories = ref<MemoryItem[]>([])
const nextCursor = ref<string | null>(null)
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
type DeleteRequest =
  | { status: 'idle' }
  | { status: 'confirming'; target: MemoryItem }
  | { status: 'pending'; target: MemoryItem; agentId: string }

const expandedMode = ref<PanelMode | null>(null)
const expandedMemory = ref<MemoryItem | null>(null)
const expandedPanelEl = ref<HTMLElement | null>(null)
const pendingAction = ref<PendingPanelAction | null>(null)
const closePrompt = ref(false)
const panelDirty = ref(false)
const panelBusy = ref(false)
// Preserve request identity so stale async completions cannot overwrite a newer state.
const deleteRequest = shallowRef<DeleteRequest>({ status: 'idle' })
let pageGeneration = 0
let loadedPageCount = 0
let searchRequestId = 0

const memoryDisabled = computed(() => props.memoryEnabled === false)
const panelLocked = computed(() => panelBusy.value || panelDirty.value)
const deleteDialogOpen = computed(() => deleteRequest.value.status !== 'idle')
// Only block the whole view with a spinner when there's nothing to show yet
// (initial/agent-switch load); background refreshes keep the list mounted.
const initialLoading = computed(() => loading.value && memories.value.length === 0)
const searchActive = computed(() => searchQuery.value.trim().length > 0)
const categoryFilterActive = computed(() => categoryFilter.value !== 'all')
const baseRows = computed<MemoryItem[]>(() =>
  searchActive.value ? searchResults.value : memories.value
)
const pinnedExpandedMemory = computed(() =>
  panelLocked.value && expandedMode.value !== 'create' ? expandedMemory.value : null
)
const visibleMemories = computed(() => {
  const visible = baseRows.value.filter((memory) => {
    if (!includeArchived.value && memory.status === 'archived') return false
    if (searchActive.value && memory.status === 'archived') return false
    return matchesCategoryFilter(memory, categoryFilter.value)
  })
  const pinned = pinnedExpandedMemory.value
  if (pinned && !visible.some((memory) => memory.id === pinned.id)) visible.push(pinned)
  return visible
})
const archivedSearchMatches = computed(() => {
  if (!searchActive.value || !includeArchived.value) return []
  const query = searchQuery.value.trim().toLocaleLowerCase()
  const pinnedId = pinnedExpandedMemory.value?.id
  return memories.value.filter(
    (memory) =>
      memory.id !== pinnedId &&
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
    selected: { type: Boolean, default: false },
    pending: { type: Boolean, default: false }
  },
  emits: ['select', 'edit', 'archive', 'restore', 'remove'],
  setup(rowProps, { emit: rowEmit }) {
    return () =>
      h(
        'div',
        {
          role: 'button',
          tabindex: rowProps.pending ? -1 : 0,
          'aria-disabled': rowProps.pending ? 'true' : undefined,
          class: [
            'group w-full rounded-lg border px-3 py-2 text-left transition hover:bg-muted/60',
            rowProps.selected ? 'rounded-b-none border-border bg-muted/40' : 'border-border',
            rowProps.memory.status === 'archived' ? 'opacity-65' : '',
            rowProps.pending ? 'pointer-events-none' : ''
          ],
          onClick: () => {
            if (!rowProps.pending) rowEmit('select')
          },
          onKeydown: (event: KeyboardEvent) => {
            if (rowProps.pending) return
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
                      DcButton,
                      {
                        variant: 'ghost',
                        size: 'sm',
                        class: 'h-7 px-2 text-xs',
                        'data-testid': 'memory-row-edit',
                        disabled: rowProps.pending,
                        onClick: (event: MouseEvent) => {
                          event.stopPropagation()
                          rowEmit('edit')
                        }
                      },
                      () => [h(Icon, { icon: 'lucide:pencil', class: 'h-3.5 w-3.5' })]
                    )
                  : null,
                h(
                  DcButton,
                  {
                    variant: 'ghost',
                    size: 'sm',
                    class: 'h-7 px-2 text-xs',
                    'data-testid':
                      rowProps.memory.status === 'archived'
                        ? 'memory-row-restore'
                        : 'memory-row-archive',
                    disabled: rowProps.pending,
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
                  DcButton,
                  {
                    variant: 'ghost',
                    size: 'sm',
                    class:
                      'h-7 w-7 px-0 text-muted-foreground hover:text-destructive focus-visible:text-destructive',
                    'aria-label': t('settings.deepchatAgents.memoryManager.deletePermanent'),
                    title: t('settings.deepchatAgents.memoryManager.deletePermanent'),
                    'data-testid': 'memory-row-delete',
                    disabled: rowProps.pending,
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

function setPending(memoryId: string, pending: boolean): void {
  const next = new Set(pendingIds.value)
  if (pending) next.add(memoryId)
  else next.delete(memoryId)
  pendingIds.value = next
}

function isCurrentSearch(agentId: string, query: string, requestId: number): boolean {
  return (
    requestId === searchRequestId && props.agentId === agentId && searchQuery.value.trim() === query
  )
}

async function runSearch(agentId: string, query: string, requestId: number): Promise<void> {
  // Bail before mutating state or hitting the network when superseded.
  if (requestId !== searchRequestId || props.agentId !== agentId) return
  searchError.value = null
  try {
    const results = await memoryClient.search(agentId, query)
    if (isCurrentSearch(agentId, query, requestId)) {
      searchResults.value = Array.isArray(results) ? results : []
    }
  } catch (error) {
    if (!isCurrentSearch(agentId, query, requestId)) return
    console.error('[MemoryListView] Search failed', error)
    searchResults.value = []
    searchError.value = t('settings.deepchatAgents.memoryManager.searchFailed')
  }
}

// useDebounceFn (VueUse 14) has no cancel(); requestId guards skip stale runs.
const debouncedRunSearch = useDebounceFn((agentId: string, query: string, requestId: number) => {
  if (requestId !== searchRequestId) return
  void runSearch(agentId, query, requestId)
}, 200)

function queueSearch(value: string, options?: { immediate?: boolean }): void {
  const query = value.trim()
  // useDebounceFn (VueUse 14) has no cancel(); bump requestId so any pending
  // debounced runSearch becomes a no-op via isCurrentSearch.
  const requestId = ++searchRequestId
  if (!query) {
    searchResults.value = []
    searchError.value = null
    return
  }
  if (options?.immediate) {
    void runSearch(props.agentId, query, requestId)
    return
  }
  debouncedRunSearch(props.agentId, query, requestId)
}

function mergePageRows(current: MemoryItem[], incoming: MemoryItem[]): MemoryItem[] {
  const seen = new Set<string>()
  const merged: MemoryItem[] = []
  for (const row of [...current, ...incoming]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    merged.push(row)
  }
  return merged
}

async function loadPage(append: boolean, generation: number): Promise<void> {
  const agentId = props.agentId
  if (!agentId) return
  const cursor = append ? (nextCursor.value ?? undefined) : undefined
  if (append && !cursor) return
  if (append) loadingMore.value = true
  else loading.value = true
  try {
    const page = await memoryClient.page(agentId, { cursor })
    if (generation !== pageGeneration || props.agentId !== agentId) return
    const nextRows = append ? mergePageRows(memories.value, page.items) : [...page.items]
    if (
      !append &&
      panelLocked.value &&
      expandedMemory.value &&
      !nextRows.some((row) => row.id === expandedMemory.value?.id)
    ) {
      nextRows.push(expandedMemory.value)
    }
    memories.value = nextRows
    nextCursor.value = page.nextCursor
    if (append) loadedPageCount += 1
    else loadedPageCount = 1
    if (!append && expandedMemory.value) {
      const refreshed = page.items.find((row) => row.id === expandedMemory.value?.id)
      if (refreshed) {
        if (!panelLocked.value) expandedMemory.value = refreshed
      } else if (!panelLocked.value) {
        closePanel()
      }
    }
  } catch (error) {
    if (generation !== pageGeneration || props.agentId !== agentId) return
    panelFeedback.fail(error)
  } finally {
    if (generation === pageGeneration && props.agentId === agentId) {
      if (append) loadingMore.value = false
      else loading.value = false
    }
  }
}

function resetPages(): number {
  pageGeneration += 1
  loading.value = false
  loadingMore.value = false
  memories.value = []
  nextCursor.value = null
  loadedPageCount = 0
  return pageGeneration
}

async function refreshLoadedPages(): Promise<void> {
  const agentId = props.agentId
  if (!agentId) return
  const pagesToLoad = Math.max(1, loadedPageCount)
  const generation = ++pageGeneration
  loading.value = true
  loadingMore.value = false
  let cursor: string | undefined
  let refreshedRows: MemoryItem[] = []
  let refreshedCursor: string | null = null
  let refreshedPageCount = 0
  try {
    for (let pageIndex = 0; pageIndex < pagesToLoad; pageIndex += 1) {
      const page = await memoryClient.page(agentId, { cursor })
      if (generation !== pageGeneration || props.agentId !== agentId) return
      refreshedRows = mergePageRows(refreshedRows, page.items)
      refreshedCursor = page.nextCursor
      refreshedPageCount += 1
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    if (
      panelLocked.value &&
      expandedMemory.value &&
      !refreshedRows.some((row) => row.id === expandedMemory.value?.id)
    ) {
      refreshedRows.push(expandedMemory.value)
    }
    memories.value = refreshedRows
    nextCursor.value = refreshedCursor
    loadedPageCount = refreshedPageCount
    if (expandedMemory.value) {
      const refreshed = refreshedRows.find((row) => row.id === expandedMemory.value?.id)
      if (refreshed && !panelLocked.value) expandedMemory.value = refreshed
      else if (!refreshed && !panelLocked.value) closePanel()
    }
    if (searchActive.value) queueSearch(searchQuery.value, { immediate: true })
  } catch (error) {
    if (generation === pageGeneration && props.agentId === agentId) panelFeedback.fail(error)
  } finally {
    if (generation === pageGeneration && props.agentId === agentId) loading.value = false
  }
}

function loadMore(): void {
  if (loadingMore.value || !nextCursor.value) return
  void loadPage(true, pageGeneration)
}

function resetForAgentChange(): void {
  searchQuery.value = ''
  searchResults.value = []
  searchError.value = null
  // Invalidate any pending debounced search (no cancel API on useDebounceFn).
  searchRequestId += 1
  categoryFilter.value = 'all'
  includeArchived.value = false
  resetPages()
  expandedMemory.value = null
  pendingAction.value = null
  closePrompt.value = false
  deleteRequest.value = { status: 'idle' }
  pendingIds.value = new Set()
  clearFeedback()
  clearDeleteFeedback()
  expandedMode.value = null
  panelDirty.value = false
  panelBusy.value = false
}

function openCreate(): void {
  if (memoryDisabled.value || panelBusy.value) return
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
  if (panelBusy.value) return
  if (isExpanded(memory)) {
    requestClosePanel()
    return
  }
  requestExpand(memory, 'view')
}

function editMemory(memory: MemoryItem): void {
  if (panelBusy.value) return
  requestExpand(memory, 'edit')
}

function requestExpand(memory: MemoryItem, mode: Exclude<PanelMode, 'create'>): void {
  if (panelBusy.value) return
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
  void refreshLoadedPages()
}

function handlePanelFeedback(nextFeedback: MemoryInlineFeedbackState): void {
  panelFeedback.show(nextFeedback.tone, nextFeedback.title, nextFeedback.description)
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
  if (panelBusy.value) return
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
  if (panelBusy.value) return
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
  panelBusy.value = false
}

async function archive(memory: MemoryItem): Promise<void> {
  if (pendingIds.value.has(memory.id)) return
  const agentId = props.agentId
  clearFeedback()
  setPending(memory.id, true)
  let shouldReload = false
  try {
    const result = await memoryClient.archive(agentId, memory.id)
    if (props.agentId !== agentId) return
    if (result.action === 'rejected') {
      panelFeedback.rejectCommand(result.reason)
      shouldReload = shouldReconcileMemoryCommandRejection(result.reason)
      return
    }
    upsertMemory({ ...memory, status: 'archived' })
  } catch (error) {
    if (props.agentId !== agentId) return
    panelFeedback.fail(error)
  } finally {
    if (props.agentId === agentId) {
      setPending(memory.id, false)
      if (shouldReload) void refreshLoadedPages()
    }
  }
}

async function restore(memory: MemoryItem): Promise<void> {
  if (pendingIds.value.has(memory.id)) return
  const agentId = props.agentId
  clearFeedback()
  setPending(memory.id, true)
  let shouldReload = false
  try {
    const result = await memoryClient.restore(agentId, memory.id)
    if (props.agentId !== agentId) return
    if (result.action === 'rejected') {
      panelFeedback.rejectCommand(result.reason)
      shouldReload = shouldReconcileMemoryCommandRejection(result.reason)
      return
    }
    upsertMemory({ ...memory, status: 'pending_embedding' })
  } catch (error) {
    if (props.agentId !== agentId) return
    panelFeedback.fail(error)
  } finally {
    if (props.agentId === agentId) {
      setPending(memory.id, false)
      if (shouldReload) void refreshLoadedPages()
    }
  }
}

function remove(memory: MemoryItem): void {
  if (deleteRequest.value.status !== 'idle' || pendingIds.value.has(memory.id)) return
  clearDeleteFeedback()
  deleteRequest.value = { status: 'confirming', target: memory }
}

function onDeleteDialogOpen(open: boolean): void {
  if (open || deleteRequest.value.status !== 'confirming') return
  deleteRequest.value = { status: 'idle' }
  clearDeleteFeedback()
}

async function confirmRemove(): Promise<void> {
  const request = deleteRequest.value
  if (request.status !== 'confirming' || pendingIds.value.has(request.target.id)) return
  const memory = request.target
  const pendingRequest = {
    status: 'pending' as const,
    target: memory,
    agentId: props.agentId
  }
  clearDeleteFeedback()
  deleteRequest.value = pendingRequest
  setPending(memory.id, true)
  let shouldReload = false
  try {
    const result = await memoryClient.remove(pendingRequest.agentId, memory.id)
    if (props.agentId !== pendingRequest.agentId || deleteRequest.value !== pendingRequest) return
    if (result.action === 'rejected') {
      if (shouldReconcileMemoryCommandRejection(result.reason)) {
        deleteRequest.value = { status: 'idle' }
        panelFeedback.rejectCommand(result.reason)
        shouldReload = true
      } else {
        deleteRequest.value = { status: 'confirming', target: memory }
        deleteOperationFeedback.rejectCommand(result.reason)
      }
      return
    }
    deleteRequest.value = { status: 'idle' }
    removeMemory(memory.id)
  } catch (error) {
    if (props.agentId !== pendingRequest.agentId || deleteRequest.value !== pendingRequest) return
    deleteRequest.value = { status: 'confirming', target: memory }
    deleteOperationFeedback.fail(error)
  } finally {
    if (props.agentId === pendingRequest.agentId) {
      setPending(memory.id, false)
      if (shouldReload) void refreshLoadedPages()
    }
  }
}

watch(
  () => props.agentId,
  () => {
    resetForAgentChange()
    void loadPage(false, pageGeneration)
  },
  { immediate: true }
)

watch(
  () => props.refreshToken,
  () => {
    void refreshLoadedPages()
  }
)

watch(searchQuery, (value) => queueSearch(value))

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

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'memory-list-editor',
  onDiscard: closePanel
})
const stopLeaveRiskSync = watch(
  [panelBusy, panelDirty],
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
