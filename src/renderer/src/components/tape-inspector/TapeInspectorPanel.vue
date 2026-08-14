<template>
  <div
    class="flex min-h-0 flex-1 flex-col bg-background outline-none"
    data-testid="tape-inspector-panel"
    tabindex="0"
    @keydown="handleKeydown"
  >
    <div class="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
      <div class="relative min-w-[160px] flex-1">
        <Icon
          icon="lucide:search"
          class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          :model-value="store.loadedSearch"
          class="h-7 pl-7 text-xs"
          :placeholder="t('tapeInspector.search.loadedPlaceholder')"
          :aria-label="t('tapeInspector.search.loadedLabel')"
          @update:model-value="store.setLoadedSearch(String($event))"
        />
      </div>

      <DcPopover v-model:open="filterOpen" width-class="w-72" align="end">
        <template #trigger>
          <DcButton
            size="sm"
            variant="outline"
            class="h-7 px-2 text-xs"
            :label="t('tapeInspector.filters.title')"
          >
            <Icon icon="lucide:funnel" class="mr-1.5 size-3.5" />
            {{ t('tapeInspector.filters.title') }}
            <span v-if="activeFilterCount" class="ml-1 text-[10px] text-muted-foreground">
              {{ activeFilterCount }}
            </span>
          </DcButton>
        </template>
        <form class="space-y-3 p-3" @submit.prevent="applyFilters">
          <label class="block space-y-1 text-xs">
            <span class="text-muted-foreground">{{ t('tapeInspector.fields.family') }}</span>
            <select
              v-model="draftFamily"
              class="h-8 w-full rounded-md border border-input bg-background px-2 outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">{{ t('tapeInspector.filters.allFamilies') }}</option>
              <option v-for="family in familyOptions" :key="family" :value="family">
                {{ family }}
              </option>
            </select>
          </label>
          <label class="block space-y-1 text-xs">
            <span class="text-muted-foreground">{{ t('tapeInspector.fields.name') }}</span>
            <Input v-model="draftName" class="h-8 text-xs" />
          </label>
          <label class="block space-y-1 text-xs">
            <span class="text-muted-foreground">{{ t('tapeInspector.fields.status') }}</span>
            <Input v-model="draftStatus" class="h-8 text-xs" />
          </label>
          <label class="block space-y-1 text-xs">
            <span class="text-muted-foreground">{{ t('tapeInspector.fields.messageId') }}</span>
            <Input v-model="draftMessageId" class="h-8 font-mono text-xs" />
          </label>
          <label class="flex items-center gap-2 text-xs">
            <Checkbox v-model:checked="draftErrorsOnly" />
            <span>{{ t('tapeInspector.filters.errorsOnly') }}</span>
          </label>
          <div class="flex justify-end gap-2 border-t pt-3">
            <DcButton
              type="button"
              size="sm"
              variant="ghost"
              class="h-7 text-xs"
              @click="clearFilters"
            >
              {{ t('common.clear') }}
            </DcButton>
            <DcButton type="submit" size="sm" class="h-7 text-xs">
              {{ t('tapeInspector.actions.apply') }}
            </DcButton>
          </div>
        </form>
      </DcPopover>

      <DcButton
        size="sm"
        variant="ghost"
        class="h-7 px-2 text-xs"
        :disabled="!store.canLoadNewer"
        :label="t('tapeInspector.actions.refresh')"
        @click="store.loadNewerPage()"
      >
        <Icon
          :icon="store.loadingNewer ? 'lucide:loader-circle' : 'lucide:refresh-cw'"
          class="mr-1.5 size-3.5"
          :class="{ 'animate-spin': store.loadingNewer }"
        />
        {{ t('tapeInspector.actions.refresh') }}
      </DcButton>
    </div>

    <div
      class="flex shrink-0 items-center justify-between border-b px-2 py-1 text-[10px] text-muted-foreground"
    >
      <span>{{ t('tapeInspector.search.loadedScope') }}</span>
      <span>
        {{
          t('tapeInspector.states.loadedCounts', {
            facts: store.records.length,
            evidence: store.evidence.length
          })
        }}
      </span>
    </div>

    <div v-if="store.loadingInitial" class="flex min-h-0 flex-1 items-center justify-center gap-2">
      <Icon icon="lucide:loader-circle" class="size-4 animate-spin text-muted-foreground" />
      <span class="text-xs text-muted-foreground">{{ t('common.loading') }}</span>
    </div>
    <div
      v-else-if="store.errorCode === 'load_failed' && store.records.length === 0"
      class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <span class="text-xs text-destructive">{{ t('tapeInspector.errors.load_failed') }}</span>
      <DcButton size="sm" variant="outline" class="h-7 text-xs" @click="initialize">
        {{ t('common.retry') }}
      </DcButton>
    </div>
    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          v-if="store.rows.length === 0"
          class="flex min-h-0 flex-1 items-center justify-center p-6 text-center"
        >
          <span class="text-xs text-muted-foreground">{{ t('tapeInspector.states.empty') }}</span>
        </div>
        <div v-else class="min-h-0 flex-1 overflow-x-auto">
          <div class="flex h-full min-w-[860px] flex-col" role="grid">
            <div
              class="grid h-8 shrink-0 grid-cols-[minmax(220px,2fr)_100px_100px_110px_100px_minmax(180px,1fr)] items-center border-b bg-muted/30 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              role="row"
            >
              <div class="px-2" role="columnheader">{{ t('tapeInspector.columns.name') }}</div>
              <div class="px-2" role="columnheader">{{ t('tapeInspector.columns.kind') }}</div>
              <div class="px-2" role="columnheader">{{ t('tapeInspector.columns.status') }}</div>
              <div class="px-2" role="columnheader">{{ t('tapeInspector.columns.start') }}</div>
              <div class="px-2" role="columnheader">{{ t('tapeInspector.columns.duration') }}</div>
              <div class="px-3" role="columnheader">{{ t('tapeInspector.columns.waterfall') }}</div>
            </div>
            <RecycleScroller
              ref="scrollerRef"
              class="min-h-0 flex-1"
              :items="store.rows"
              :item-size="ROW_HEIGHT"
              key-field="key"
              :buffer="ROW_HEIGHT * 12"
              :prerender="16"
            >
              <template #default="{ item }">
                <TapeInspectorRow
                  :row="item"
                  :selected="store.selectedKey === item.key"
                  @select="selectRow"
                  @toggle="store.toggleCollapsed"
                />
              </template>
            </RecycleScroller>
          </div>
        </div>

        <div class="flex h-9 shrink-0 items-center justify-between border-t px-2">
          <DcButton
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs"
            :disabled="!store.hasOlder || store.loadingOlder"
            @click="loadOlder"
          >
            <Icon
              :icon="store.loadingOlder ? 'lucide:loader-circle' : 'lucide:arrow-up-to-line'"
              class="mr-1.5 size-3.5"
              :class="{ 'animate-spin': store.loadingOlder }"
            />
            {{ t('tapeInspector.actions.loadOlder') }}
          </DcButton>
          <DcButton
            v-if="store.hasMoreEvidence"
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs"
            :disabled="store.loadingEvidence"
            @click="store.loadMoreEvidence()"
          >
            {{ t('tapeInspector.actions.loadEvidence') }}
          </DcButton>
        </div>
      </div>

      <TapeInspectorDetailPane
        :row="store.selectedRow"
        :detail="store.selectedDetail"
        :capabilities="store.selectedCapabilities"
        :loading="store.loadingDetail"
        :error-code="detailErrorCode"
        @retry="store.loadSelectedDetail()"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import { Input } from '@shadcn/components/ui/input'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { DcButton } from '@dc-ui/components/button'
import { DcPopover } from '@dc-ui/components/popover'
import type {
  TapeInspectorFactFamily,
  TapeInspectorFactFilters
} from '@shared/types/tape-inspector'
import type { TapeInspectorOpenRequest } from '@/stores/ui/sidepanel'
import { useTapeInspectorStore, type TapeInspectorErrorCode } from './store'
import TapeInspectorDetailPane from './TapeInspectorDetailPane.vue'
import TapeInspectorRow from './TapeInspectorRow.vue'

interface RecycleScrollerHandle {
  $el: HTMLElement
  scrollToItem: (index: number) => void
  scrollToPosition: (position: number) => void
}

const props = defineProps<{
  sessionId: string
  openRequest: TapeInspectorOpenRequest | null
}>()

const ROW_HEIGHT = 36
const familyOptions: TapeInspectorFactFamily[] = [
  'context',
  'journal',
  'contract',
  'view',
  'attempt',
  'anchor',
  'message',
  'lineage',
  'tool',
  'other'
]

const { t } = useI18n()
const store = useTapeInspectorStore()
const scrollerRef = ref<RecycleScrollerHandle | null>(null)
const filterOpen = ref(false)
const draftFamily = ref<TapeInspectorFactFamily | ''>('')
const draftName = ref('')
const draftStatus = ref('')
const draftMessageId = ref('')
const draftErrorsOnly = ref(false)

const activeFilterCount = computed(() => {
  const filters = store.serverFilters
  return [
    Boolean(filters.families?.length),
    Boolean(filters.name),
    Boolean(filters.factStatus),
    Boolean(filters.messageId),
    filters.errorsOnly === true
  ].filter(Boolean).length
})
const detailErrorCode = computed<TapeInspectorErrorCode>(() => {
  return store.errorCode === 'detail_failed' || store.errorCode === 'record_not_found'
    ? store.errorCode
    : null
})

function matchingRequest(): TapeInspectorOpenRequest | null {
  return props.openRequest?.sessionId === props.sessionId ? props.openRequest : null
}

async function initialize(): Promise<void> {
  const request = matchingRequest()
  const loaded = await store.initialize(props.sessionId, {
    preselection: request?.messageId
      ? {
          messageId: request.messageId,
          ...(request.requestSeq === undefined ? {} : { requestSeq: request.requestSeq })
        }
      : null
  })
  if (!loaded) return
  syncFilterDrafts()
  await nextTick()
  scrollToSelected()
  if (store.selectedKey) await store.loadSelectedDetail()
}

function syncFilterDrafts(): void {
  const filters = store.serverFilters
  draftFamily.value = filters.families?.[0] ?? ''
  draftName.value = filters.name ?? ''
  draftStatus.value = filters.factStatus ?? ''
  draftMessageId.value = filters.messageId ?? ''
  draftErrorsOnly.value = filters.errorsOnly === true
}

function filtersFromDrafts(): TapeInspectorFactFilters {
  const name = draftName.value.trim()
  const status = draftStatus.value.trim()
  const messageId = draftMessageId.value.trim()
  return {
    ...(draftFamily.value ? { families: [draftFamily.value] } : {}),
    ...(name ? { name } : {}),
    ...(status ? { factStatus: status } : {}),
    ...(messageId ? { messageId } : {}),
    ...(draftErrorsOnly.value ? { errorsOnly: true } : {})
  }
}

async function applyFilters(): Promise<void> {
  filterOpen.value = false
  await store.applyServerFilters(filtersFromDrafts())
}

async function clearFilters(): Promise<void> {
  draftFamily.value = ''
  draftName.value = ''
  draftStatus.value = ''
  draftMessageId.value = ''
  draftErrorsOnly.value = false
  filterOpen.value = false
  await store.applyServerFilters({})
}

async function selectRow(key: string): Promise<void> {
  store.selectRow(key)
  await store.loadSelectedDetail()
}

function scrollToSelected(): void {
  const index = store.rows.findIndex((row) => row.key === store.selectedKey)
  if (index >= 0) scrollerRef.value?.scrollToItem(index)
}

async function loadOlder(): Promise<void> {
  const element = scrollerRef.value?.$el
  const firstVisibleIndex = element ? Math.max(0, Math.floor(element.scrollTop / ROW_HEIGHT)) : 0
  const anchor = store.rows[firstVisibleIndex]
  const offset = element ? element.scrollTop - firstVisibleIndex * ROW_HEIGHT : 0
  store.setPrependScrollAnchor(anchor ? { key: anchor.key, offset } : null)
  try {
    const loaded = await store.loadOlderPage()
    if (!loaded || !anchor) return
    await nextTick()
    const newIndex = store.rows.findIndex((row) => row.key === anchor.key)
    if (newIndex >= 0) scrollerRef.value?.scrollToPosition(newIndex * ROW_HEIGHT + offset)
  } finally {
    store.setPrependScrollAnchor(null)
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (
    event.target instanceof HTMLElement &&
    event.target.closest(
      'a, button, input, select, textarea, [contenteditable="true"], [role="button"], [role="checkbox"], [role="combobox"], [role="switch"]'
    )
  ) {
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const key = store.moveSelection(event.key === 'ArrowDown' ? 1 : -1)
    if (key) {
      scrollToSelected()
      void store.loadSelectedDetail()
    }
    return
  }
  if (event.key === 'Enter' && store.selectedRow) {
    const row = store.selectedRow
    if (row.recordType === 'group' || row.recordType === 'evidence_lane') {
      event.preventDefault()
      store.toggleCollapsed(row.key)
    }
  }
}

watch(
  () => [props.sessionId, props.openRequest?.token] as const,
  () => void initialize(),
  { immediate: true }
)

onBeforeUnmount(() => store.clear())
</script>
