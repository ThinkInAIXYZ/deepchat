<template>
  <div
    ref="panelRef"
    class="flex min-h-0 flex-1 flex-col bg-background"
    data-testid="tape-inspector-panel"
    :data-layout="panelLayout"
  >
    <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
      <div
        class="relative min-w-0"
        :class="isCompactPanel ? 'order-first basis-full' : 'min-w-[200px] flex-1'"
      >
        <Icon
          icon="lucide:search"
          class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          :model-value="store.loadedSearch"
          class="h-7 px-7 text-xs"
          :placeholder="t('tapeInspector.search.loadedPlaceholder')"
          :aria-label="t('tapeInspector.search.loadedLabel')"
          @update:model-value="store.setLoadedSearch(String($event))"
        />
        <Icon
          v-if="store.loadingSearchFill"
          icon="lucide:loader-circle"
          class="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      </div>

      <DcPopover v-model:open="filterOpen" width-class="w-72" align="end">
        <template #trigger>
          <DcButton
            size="sm"
            variant="outline"
            class="h-7 text-xs"
            :class="isCompactPanel ? 'w-7 px-0' : 'px-2'"
            :label="t('tapeInspector.filters.title')"
          >
            <Icon icon="lucide:funnel" class="size-3.5" :class="{ 'mr-1.5': !isCompactPanel }" />
            <span v-if="!isCompactPanel">{{ t('tapeInspector.filters.title') }}</span>
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
                {{ t(`tapeInspector.families.${family}`) }}
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

      <span
        data-testid="tape-inspector-live-status"
        class="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
        :title="liveStatusLabel"
      >
        <Icon :icon="liveStatusIcon" class="size-3.5" />
        <span v-if="!isCompactPanel">{{ liveStatusLabel }}</span>
      </span>

      <DcButton
        data-testid="tape-inspector-live-toggle"
        size="icon-sm"
        variant="ghost"
        :icon="store.livePaused ? 'lucide:play' : 'lucide:pause'"
        :disabled="!liveConnected || !store.canonicalSort"
        :label="
          store.livePaused ? t('tapeInspector.actions.resume') : t('tapeInspector.actions.pause')
        "
        :tooltip="
          store.livePaused ? t('tapeInspector.actions.resume') : t('tapeInspector.actions.pause')
        "
        @click="toggleLivePaused"
      />

      <DcButton
        size="sm"
        variant="ghost"
        class="h-7 text-xs"
        :class="isCompactPanel ? 'w-7 px-0' : 'px-2'"
        :disabled="!store.canLoadNewer"
        :label="t('tapeInspector.actions.refresh')"
        @click="store.loadNewerPage()"
      >
        <Icon
          :icon="store.loadingNewer ? 'lucide:loader-circle' : 'lucide:refresh-cw'"
          class="size-3.5"
          :class="{ 'mr-1.5': !isCompactPanel, 'animate-spin': store.loadingNewer }"
        />
        <span v-if="!isCompactPanel">{{ t('tapeInspector.actions.refresh') }}</span>
      </DcButton>

      <DcButton
        data-testid="tape-inspector-export"
        size="sm"
        variant="ghost"
        class="h-7 text-xs"
        :class="[isCompactPanel ? 'w-7 px-0' : 'px-2', { 'text-destructive': exportFailed }]"
        :disabled="!store.tapeIncarnationId || store.loadingInitial || exporting"
        :label="t('common.export')"
        :title="exportFailed ? t('common.error.requestFailed') : t('common.export')"
        @click="exportSupportTrace"
      >
        <Icon
          :icon="exporting ? 'lucide:loader-circle' : 'lucide:download'"
          class="size-3.5"
          :class="{ 'mr-1.5': !isCompactPanel, 'animate-spin': exporting }"
        />
        <span v-if="!isCompactPanel">{{ t('common.export') }}</span>
      </DcButton>

      <DcButton
        data-testid="tape-inspector-fullscreen-toggle"
        size="icon-sm"
        variant="ghost"
        :icon="isFullscreen ? 'lucide:minimize-2' : 'lucide:maximize-2'"
        :label="isFullscreen ? t('common.restore') : t('common.maximize')"
        :tooltip="isFullscreen ? t('common.restore') : t('common.maximize')"
        @click="emit('toggleFullscreen')"
      />
    </div>

    <div
      class="flex shrink-0 flex-wrap items-center justify-between gap-x-3 border-b px-2 py-1 text-[10px] text-muted-foreground"
    >
      <span class="min-w-0 truncate">{{ t('tapeInspector.search.loadedScope') }}</span>
      <span class="shrink-0">
        {{
          t('tapeInspector.states.loadedCounts', {
            entries: store.records.length,
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
      <TapeInspectorTimeline
        v-if="store.overviewRows.length > 0"
        :rows="store.overviewRows"
        :selected-key="store.selectedKey"
        :has-unloaded-history="store.hasOlder || store.hasMoreEvidence"
        :mode="store.timelineMode"
        @select="selectOverviewRow"
        @update:mode="store.setTimelineMode"
      />
      <div class="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          ref="ledgerRef"
          class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          :data-layout="ledgerLayout"
        >
          <div
            v-if="store.rows.length === 0"
            class="flex min-h-0 flex-1 items-center justify-center p-6 text-center"
          >
            <span class="text-xs text-muted-foreground">{{ t('tapeInspector.states.empty') }}</span>
          </div>
          <div v-else class="min-h-0 flex-1 overflow-hidden">
            <div
              ref="gridRef"
              class="flex h-full flex-col outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              :style="{ minWidth: `${tableMinWidth}px` }"
              role="grid"
              tabindex="0"
              :aria-label="t('tapeInspector.title')"
              :aria-activedescendant="activeDescendantId"
              :aria-rowcount="store.rows.length + 1"
              @keydown="handleKeydown"
            >
              <div
                class="grid h-8 shrink-0 items-center border-b bg-muted/30 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                :style="{ gridTemplateColumns }"
                role="row"
                aria-rowindex="1"
              >
                <div class="relative flex h-full min-w-0 items-center">
                  <button
                    type="button"
                    class="flex h-full min-w-0 flex-1 items-center gap-1 px-2 text-left hover:text-foreground"
                    role="columnheader"
                    :aria-sort="ariaSort('name')"
                    @click="toggleSort('name')"
                  >
                    <span class="truncate">{{ t('tapeInspector.columns.name') }}</span>
                    <Icon :icon="sortIcon('name')" class="size-3 shrink-0" />
                  </button>
                  <TapeInspectorColumnResizeHandle
                    v-if="ledgerLayout === 'wide'"
                    column="name"
                    :label="t('tapeInspector.columns.name')"
                    :min="columnLimits.name.min"
                    :max="columnLimits.name.max"
                    :value="columnWidths.name"
                    @resize-start="startColumnResize('name', $event)"
                    @resize-move="continueColumnResize"
                    @resize-end="finishColumnResize"
                    @resize-cancel="cancelColumnResize"
                    @resize-by="resizeColumnBy('name', $event)"
                  />
                </div>
                <div
                  v-if="ledgerLayout === 'wide'"
                  class="relative flex h-full min-w-0 items-center"
                >
                  <button
                    type="button"
                    class="flex h-full min-w-0 flex-1 items-center gap-1 px-2 text-left hover:text-foreground"
                    role="columnheader"
                    :aria-sort="ariaSort('kind')"
                    @click="toggleSort('kind')"
                  >
                    <span class="truncate">{{ t('tapeInspector.columns.kind') }}</span>
                    <Icon :icon="sortIcon('kind')" class="size-3 shrink-0" />
                  </button>
                  <TapeInspectorColumnResizeHandle
                    column="kind"
                    :label="t('tapeInspector.columns.kind')"
                    :min="columnLimits.kind.min"
                    :max="columnLimits.kind.max"
                    :value="columnWidths.kind"
                    @resize-start="startColumnResize('kind', $event)"
                    @resize-move="continueColumnResize"
                    @resize-end="finishColumnResize"
                    @resize-cancel="cancelColumnResize"
                    @resize-by="resizeColumnBy('kind', $event)"
                  />
                </div>
                <div
                  v-if="ledgerLayout !== 'compact'"
                  class="relative flex h-full min-w-0 items-center px-2"
                  role="columnheader"
                >
                  <span class="truncate">{{ t('tapeInspector.columns.status') }}</span>
                  <TapeInspectorColumnResizeHandle
                    v-if="ledgerLayout === 'wide'"
                    column="status"
                    :label="t('tapeInspector.columns.status')"
                    :min="columnLimits.status.min"
                    :max="columnLimits.status.max"
                    :value="columnWidths.status"
                    @resize-start="startColumnResize('status', $event)"
                    @resize-move="continueColumnResize"
                    @resize-end="finishColumnResize"
                    @resize-cancel="cancelColumnResize"
                    @resize-by="resizeColumnBy('status', $event)"
                  />
                </div>
                <div
                  v-if="ledgerLayout === 'wide'"
                  class="relative flex h-full min-w-0 items-center"
                >
                  <button
                    type="button"
                    class="flex h-full min-w-0 flex-1 items-center gap-1 px-2 text-left hover:text-foreground"
                    role="columnheader"
                    :aria-sort="ariaSort('createdAt')"
                    @click="toggleSort('createdAt')"
                  >
                    <span class="truncate">{{ t('tapeInspector.columns.start') }}</span>
                    <Icon :icon="sortIcon('createdAt')" class="size-3 shrink-0" />
                  </button>
                  <TapeInspectorColumnResizeHandle
                    column="start"
                    :label="t('tapeInspector.columns.start')"
                    :min="columnLimits.start.min"
                    :max="columnLimits.start.max"
                    :value="columnWidths.start"
                    @resize-start="startColumnResize('start', $event)"
                    @resize-move="continueColumnResize"
                    @resize-end="finishColumnResize"
                    @resize-cancel="cancelColumnResize"
                    @resize-by="resizeColumnBy('start', $event)"
                  />
                </div>
                <div
                  v-if="ledgerLayout !== 'compact'"
                  class="relative flex h-full min-w-0 items-center px-2"
                  role="columnheader"
                >
                  <span class="truncate">{{ t('tapeInspector.columns.duration') }}</span>
                  <TapeInspectorColumnResizeHandle
                    v-if="ledgerLayout === 'wide'"
                    column="duration"
                    :label="t('tapeInspector.columns.duration')"
                    :min="columnLimits.duration.min"
                    :max="columnLimits.duration.max"
                    :value="columnWidths.duration"
                    @resize-start="startColumnResize('duration', $event)"
                    @resize-move="continueColumnResize"
                    @resize-end="finishColumnResize"
                    @resize-cancel="cancelColumnResize"
                    @resize-by="resizeColumnBy('duration', $event)"
                  />
                </div>
              </div>
              <RecycleScroller
                ref="scrollerRef"
                role="rowgroup"
                class="min-h-0 flex-1"
                :items="store.rows"
                :item-size="ROW_HEIGHT"
                key-field="key"
                :buffer="ROW_HEIGHT * 12"
                :prerender="16"
              >
                <template #default="{ item, index }">
                  <TapeInspectorRow
                    :row="item"
                    :selected="store.selectedKey === item.key"
                    :aria-row-index="index + 2"
                    :layout="ledgerLayout"
                    :grid-template-columns="gridTemplateColumns"
                    :table-min-width="tableMinWidth"
                    :message-preview="messagePreviewForRow(item)"
                    :request-activity="requestRowActivityForRow(item)"
                    :can-load-evidence-parents="store.canLoadEvidenceParents"
                    :loading-evidence-parents="store.loadingEvidenceParents"
                    @select="selectRow"
                    @toggle="store.toggleCollapsed"
                    @load-evidence-parents="loadEvidenceParents"
                  />
                </template>
              </RecycleScroller>
            </div>
          </div>

          <div
            v-if="olderLoadNoticeLabel"
            data-testid="tape-inspector-older-load-notice"
            class="shrink-0 border-t px-2 py-1 text-[10px] leading-4"
            :class="
              olderLoadNotice?.kind === 'failed' ? 'text-destructive' : 'text-muted-foreground'
            "
            role="status"
            aria-live="polite"
          >
            {{ olderLoadNoticeLabel }}
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
                :icon="
                  store.loadingOlder
                    ? 'lucide:loader-circle'
                    : store.canonicalSort
                      ? 'lucide:arrow-up-to-line'
                      : 'lucide:list-plus'
                "
                class="mr-1.5 size-3.5"
                :class="{ 'animate-spin': store.loadingOlder }"
              />
              {{
                t(
                  store.canonicalSort
                    ? 'tapeInspector.actions.loadOlder'
                    : 'tapeInspector.actions.loadMore'
                )
              }}
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
          v-if="store.selectedRow && detailOpen"
          :row="store.selectedRow"
          :detail="store.selectedDetail"
          :capabilities="store.selectedCapabilities"
          :loading="store.loadingDetail"
          :error-code="detailErrorCode"
          :placement="detailPlacement"
          :request-observation="requestObservationForRow(store.selectedRow)"
          @close="closeDetail"
          @retry="store.loadSelectedDetail()"
          @open-message-diagnostics="emit('openMessageDiagnostics', $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useDocumentVisibility, useElementSize } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import { Input } from '@shadcn/components/ui/input'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { DcButton } from '@dc-ui/components/button'
import { DcPopover } from '@dc-ui/components/popover'
import type {
  TapeInspectorFactFamily,
  TapeInspectorFactFilters,
  TapeInspectorHeadPulse,
  TapeInspectorSort
} from '@shared/types/tape-inspector'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { useMessageStore } from '@/stores/ui/message'
import type { TapeInspectorOpenRequest } from '@/stores/ui/sidepanel'
import { downloadBlob } from '@/lib/download'
import { createSessionClient } from '../../../api/SessionClient'
import {
  getTapeInspectorRowDomId,
  type TapeInspectorDisplayRow,
  type TapeInspectorMessageDiagnosticsTarget
} from './model'
import {
  tapeInspectorDetailPlacement,
  tapeInspectorLayoutMode,
  type TapeInspectorLayoutMode
} from './layout'
import { useTapeInspectorStore, type TapeInspectorErrorCode } from './store'
import {
  projectTapeInspectorAssistantActivities,
  projectTapeInspectorMessagePreview,
  selectTapeInspectorRequestObservation,
  selectTapeInspectorRequestRowActivity,
  type TapeInspectorRequestActivity,
  type TapeInspectorRequestObservation,
  type TapeInspectorRequestRowActivity,
  type TapeInspectorMessagePreview
} from './messagePreview'
import TapeInspectorColumnResizeHandle from './TapeInspectorColumnResizeHandle.vue'
import TapeInspectorDetailPane from './TapeInspectorDetailPane.vue'
import TapeInspectorRow from './TapeInspectorRow.vue'
import TapeInspectorTimeline from './TapeInspectorTimeline.vue'

interface RecycleScrollerHandle {
  $el: HTMLElement
  scrollToItem: (index: number) => void
  scrollToPosition: (position: number) => void
}

type InspectorColumn = 'name' | 'kind' | 'status' | 'start' | 'duration'

interface ColumnResizeState {
  column: InspectorColumn
  pointerId: number
  startWidth: number
  startX: number
  target: HTMLElement
}

type OlderLoadNotice =
  | { kind: 'loaded'; count: number; reachedStart: boolean }
  | { kind: 'no_match'; reachedStart: boolean }
  | { kind: 'failed' }

const props = withDefaults(
  defineProps<{
    sessionId: string
    openRequest: TapeInspectorOpenRequest | null
    isFullscreen?: boolean
  }>(),
  { isFullscreen: false }
)

const emit = defineEmits<{
  openMessageDiagnostics: [target: TapeInspectorMessageDiagnosticsTarget]
  toggleFullscreen: []
}>()

const ROW_HEIGHT = 48
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
const messageStore = useMessageStore()
const sessionClient = createSessionClient()
const documentVisibility = useDocumentVisibility()
const panelRef = ref<HTMLElement | null>(null)
const ledgerRef = ref<HTMLElement | null>(null)
const gridRef = ref<HTMLElement | null>(null)
const scrollerRef = ref<RecycleScrollerHandle | null>(null)
const filterOpen = ref(false)
const detailOpen = ref(false)
const liveConnected = ref(false)
const followingTail = ref(true)
const draftFamily = ref<TapeInspectorFactFamily | ''>('')
const draftName = ref('')
const draftStatus = ref('')
const draftMessageId = ref('')
const draftErrorsOnly = ref(false)
const exporting = ref(false)
const exportFailed = ref(false)
const olderLoadNotice = ref<OlderLoadNotice | null>(null)
const columnLimits: Record<InspectorColumn, { min: number; max: number }> = {
  name: { min: 180, max: 560 },
  kind: { min: 80, max: 240 },
  status: { min: 80, max: 240 },
  start: { min: 110, max: 240 },
  duration: { min: 90, max: 220 }
}
const columnWidths = reactive<Record<InspectorColumn, number>>({
  name: 280,
  kind: 110,
  status: 110,
  start: 140,
  duration: 110
})
const columnResize = ref<ColumnResizeState | null>(null)
const { width: panelWidth } = useElementSize(panelRef, { width: 960, height: 0 })
const { width: ledgerWidth } = useElementSize(ledgerRef, { width: 960, height: 0 })
const panelLayout = computed<TapeInspectorLayoutMode>(() =>
  tapeInspectorLayoutMode(panelWidth.value)
)
const ledgerLayout = computed<TapeInspectorLayoutMode>(() =>
  tapeInspectorLayoutMode(ledgerWidth.value)
)
const detailPlacement = computed(() => tapeInspectorDetailPlacement(panelWidth.value))
const isCompactPanel = computed(() => panelLayout.value === 'compact')
const gridTemplateColumns = computed(() => {
  if (ledgerLayout.value === 'compact') return 'minmax(0, 1fr)'
  if (ledgerLayout.value === 'medium') return 'minmax(0, 1fr) 96px 96px'
  return (Object.keys(columnWidths) as InspectorColumn[])
    .map((column) => `${columnWidths[column]}px`)
    .join(' ')
})
const tableMinWidth = computed(() => {
  if (ledgerLayout.value !== 'wide') return 0
  return (Object.keys(columnWidths) as InspectorColumn[]).reduce(
    (width, column) => width + columnWidths[column],
    0
  )
})
const activeDescendantId = computed(() =>
  store.rows.some((row) => row.key === store.selectedKey) && store.selectedKey
    ? getTapeInspectorRowDomId(store.selectedKey)
    : undefined
)

function messagePreviewForRow(row: TapeInspectorDisplayRow): TapeInspectorMessagePreview | null {
  if (messageStore.committedSessionId !== props.sessionId) return null
  if (
    row.recordType !== 'fact' ||
    (row.record.name !== 'message/user' && row.record.name !== 'message/assistant')
  ) {
    return null
  }
  const messageId = row.record.messageId
  if (!messageId) return null
  const message = messageStore.messageCache.get(messageId)
  return message?.sessionId === props.sessionId ? projectTapeInspectorMessagePreview(message) : null
}

const requestObservationsByTraceId = computed(() => {
  const observations = new Map<string, TapeInspectorRequestObservation>()
  if (messageStore.committedSessionId !== props.sessionId) return observations

  const sessionMessages = [...messageStore.messageCache.values()]
    .filter((message) => message.sessionId === props.sessionId)
    .sort((left, right) => left.orderSeq - right.orderSeq || left.id.localeCompare(right.id))
  const precedingUserByMessageId = new Map<string, ChatMessageRecord>()
  let precedingUser: ChatMessageRecord | null = null
  for (const message of sessionMessages) {
    if (message.role === 'user') {
      precedingUser = message
    } else if (precedingUser) {
      precedingUserByMessageId.set(message.id, precedingUser)
    }
  }

  const nextTraceCreatedAtByTraceId = new Map<string, number>()
  const evidenceByMessageId = new Map<string, typeof store.evidence>()
  for (const evidence of store.evidence) {
    const messageEvidence = evidenceByMessageId.get(evidence.messageId) ?? []
    messageEvidence.push(evidence)
    evidenceByMessageId.set(evidence.messageId, messageEvidence)
  }
  for (const evidence of evidenceByMessageId.values()) {
    evidence.sort(
      (left, right) => left.createdAt - right.createdAt || left.traceId.localeCompare(right.traceId)
    )
    for (let index = 0; index < evidence.length; index += 1) {
      const previous = evidence[index - 1]
      const current = evidence[index]
      const next = evidence[index + 1]
      if (previous?.createdAt === current.createdAt || next?.createdAt === current.createdAt) {
        nextTraceCreatedAtByTraceId.set(current.traceId, current.createdAt)
      } else if (next && next.createdAt > current.createdAt) {
        nextTraceCreatedAtByTraceId.set(current.traceId, next.createdAt)
      }
    }
  }

  const activitiesByMessageId = new Map<string, TapeInspectorRequestActivity[]>()
  for (const evidence of store.evidence) {
    const message = messageStore.messageCache.get(evidence.messageId)
    if (!message || message.sessionId !== props.sessionId || message.role !== 'assistant') continue
    let activities = activitiesByMessageId.get(message.id)
    if (!activities) {
      activities = projectTapeInspectorAssistantActivities(
        message,
        messageStore.getAssistantMessageBlocks(message)
      )
      activitiesByMessageId.set(message.id, activities)
    }
    const nextTraceCreatedAt = nextTraceCreatedAtByTraceId.get(evidence.traceId)
    observations.set(
      evidence.traceId,
      selectTapeInspectorRequestObservation({
        activities,
        createdAt: evidence.createdAt,
        requestSeq: evidence.requestSeq,
        ...(evidence.logicalRound === undefined ? {} : { logicalRound: evidence.logicalRound }),
        ...(evidence.physicalAttempt === undefined
          ? {}
          : { physicalAttempt: evidence.physicalAttempt }),
        ...(nextTraceCreatedAt === undefined ? {} : { nextTraceCreatedAt }),
        precedingUser: precedingUserByMessageId.get(message.id)
      })
    )
  }
  return observations
})

function requestObservationForRow(
  row: TapeInspectorDisplayRow
): TapeInspectorRequestObservation | null {
  return row.recordType === 'evidence'
    ? (requestObservationsByTraceId.value.get(row.record.traceId) ?? null)
    : null
}

function requestRowActivityForRow(
  row: TapeInspectorDisplayRow
): TapeInspectorRequestRowActivity | null {
  const observation = requestObservationForRow(row)
  return observation ? selectTapeInspectorRequestRowActivity(observation) : null
}

let liveLifecycleGeneration = 0
let liveSubscription: { sessionId: string; subscriptionId: string } | null = null

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
const liveStatusLabel = computed(() =>
  liveConnected.value
    ? t(
        store.livePaused || !store.canonicalSort
          ? 'tapeInspector.states.paused'
          : 'tapeInspector.states.live'
      )
    : t('tapeInspector.states.liveUnavailable')
)
const liveStatusIcon = computed(() =>
  liveConnected.value
    ? store.livePaused || !store.canonicalSort
      ? 'lucide:circle-pause'
      : 'lucide:radio'
    : 'lucide:radio-tower'
)
const olderLoadNoticeLabel = computed(() => {
  const notice = olderLoadNotice.value
  if (!notice) return ''
  if (notice.kind === 'failed') return t('tapeInspector.errors.load_failed')
  if (notice.kind === 'no_match') {
    return t(
      notice.reachedStart
        ? 'tapeInspector.states.pageNoMatchesComplete'
        : 'tapeInspector.states.pageNoMatches'
    )
  }
  return t(
    notice.reachedStart
      ? 'tapeInspector.states.pageLoadedComplete'
      : 'tapeInspector.states.pageLoaded',
    { count: notice.count }
  )
})
const detailErrorCode = computed<TapeInspectorErrorCode>(() => {
  return store.errorCode === 'detail_failed' || store.errorCode === 'record_not_found'
    ? store.errorCode
    : null
})

function matchingRequest(): TapeInspectorOpenRequest | null {
  return props.openRequest?.sessionId === props.sessionId ? props.openRequest : null
}

async function exportSupportTrace(): Promise<void> {
  const tapeIncarnationId = store.tapeIncarnationId
  if (!tapeIncarnationId || exporting.value) return
  const generation = liveLifecycleGeneration
  const sessionId = props.sessionId
  exporting.value = true
  exportFailed.value = false
  try {
    const result = await sessionClient.exportTapeInspectorSupportTrace({
      sessionId,
      expectedTapeIncarnationId: tapeIncarnationId
    })
    if (
      generation !== liveLifecycleGeneration ||
      props.sessionId !== sessionId ||
      store.tapeIncarnationId !== tapeIncarnationId
    ) {
      return
    }
    if (result.status === 'reset') {
      await initialize()
      return
    }
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 64) || 'session'
    const timestamp = new Date(result.trace.exportedAt).toISOString().replace(/[:.]/gu, '-')
    downloadBlob(
      new Blob([`${JSON.stringify(result.trace, null, 2)}\n`], { type: 'application/json' }),
      `tape-inspector-${safeSessionId}-${timestamp}.json`
    )
  } catch (error) {
    if (
      generation === liveLifecycleGeneration &&
      props.sessionId === sessionId &&
      store.tapeIncarnationId === tapeIncarnationId
    ) {
      exportFailed.value = true
      console.error('[TapeInspector] Failed to export support trace', error)
    }
  } finally {
    if (generation === liveLifecycleGeneration && props.sessionId === sessionId) {
      exporting.value = false
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function setColumnWidth(column: InspectorColumn, width: number): void {
  const limits = columnLimits[column]
  columnWidths[column] = clamp(Math.round(width), limits.min, limits.max)
}

function resizeColumnBy(column: InspectorColumn, delta: number): void {
  setColumnWidth(column, columnWidths[column] + delta)
}

function startColumnResize(column: InspectorColumn, event: PointerEvent): void {
  if (event.button !== 0) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  event.preventDefault()
  cancelColumnResize()
  target.setPointerCapture?.(event.pointerId)
  columnResize.value = {
    column,
    pointerId: event.pointerId,
    startWidth: columnWidths[column],
    startX: event.clientX,
    target
  }
}

function continueColumnResize(event: PointerEvent): void {
  const resize = columnResize.value
  if (!resize || resize.pointerId !== event.pointerId) return
  setColumnWidth(resize.column, resize.startWidth + event.clientX - resize.startX)
}

function releasePointerCapture(target: HTMLElement, pointerId: number): void {
  try {
    if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId)
  } catch {
    // Pointer capture can already be released when the browser cancels a gesture.
  }
}

function cancelColumnResize(): void {
  const resize = columnResize.value
  if (!resize) return
  releasePointerCapture(resize.target, resize.pointerId)
  columnResize.value = null
}

function finishColumnResize(event: PointerEvent): void {
  const resize = columnResize.value
  if (!resize || resize.pointerId !== event.pointerId) return
  continueColumnResize(event)
  cancelColumnResize()
}

async function initialize(): Promise<void> {
  const generation = ++liveLifecycleGeneration
  detailOpen.value = false
  olderLoadNotice.value = null
  followingTail.value = true
  exporting.value = false
  exportFailed.value = false
  await releaseLiveSubscription()
  if (generation !== liveLifecycleGeneration) return

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
  detailOpen.value = Boolean(store.selectedKey)
  if (documentVisibility.value === 'visible') store.startEvidenceRefresh()
  syncFilterDrafts()
  await nextTick()
  if (store.selectedKey) scrollToSelected()
  else await followTail()
  await nextTick()
  followingTail.value = isAtTail()
  if (store.selectedKey) await store.loadSelectedDetail()
  if (generation !== liveLifecycleGeneration) return

  const subscriptionId = crypto.randomUUID()
  try {
    const head = await sessionClient.subscribeTapeInspectorHead(props.sessionId, subscriptionId)
    if (generation !== liveLifecycleGeneration || props.sessionId !== store.sessionId) {
      await sessionClient.unsubscribeTapeInspectorHead(subscriptionId)
      return
    }
    liveSubscription = { sessionId: props.sessionId, subscriptionId }
    liveConnected.value = true
    await handleLiveHeadPulse({
      sessionId: props.sessionId,
      tapeIncarnationId: head.tapeIncarnationId,
      maxEntryId: head.maxEntryId
    })
  } catch {
    if (generation === liveLifecycleGeneration) liveConnected.value = false
  }
}

async function releaseLiveSubscription(): Promise<void> {
  const subscription = liveSubscription
  liveSubscription = null
  liveConnected.value = false
  if (!subscription) return
  try {
    await sessionClient.unsubscribeTapeInspectorHead(subscription.subscriptionId)
  } catch {
    // Main also releases subscriptions when the owning renderer is destroyed.
  }
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

type SortableColumn = Exclude<TapeInspectorSort['column'], 'entryId'>

function ariaSort(column: SortableColumn): 'ascending' | 'descending' | 'none' {
  return store.serverSort.column === column
    ? store.serverSort.direction === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none'
}

function sortIcon(column: SortableColumn): string {
  if (store.serverSort.column !== column) return 'lucide:arrow-up-down'
  return store.serverSort.direction === 'asc' ? 'lucide:arrow-up' : 'lucide:arrow-down'
}

function toggleSort(column: SortableColumn): void {
  if (store.serverSort.column === column && store.serverSort.direction === 'desc') {
    void store.applyServerSort({ column: 'entryId', direction: 'asc' })
    return
  }
  void store.applyServerSort({
    column,
    direction:
      store.serverSort.column === column && store.serverSort.direction === 'asc' ? 'desc' : 'asc'
  })
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
  detailOpen.value = true
  gridRef.value?.focus({ preventScroll: true })
  await store.loadSelectedDetail()
}

async function selectOverviewRow(key: string): Promise<void> {
  if (!store.revealOverviewRow(key)) return
  detailOpen.value = true
  await nextTick()
  scrollToSelected()
  gridRef.value?.focus({ preventScroll: true })
  await store.loadSelectedDetail()
}

async function closeDetail(): Promise<void> {
  detailOpen.value = false
  await nextTick()
  gridRef.value?.focus({ preventScroll: true })
}

function scrollToSelected(): void {
  const index = store.rows.findIndex((row) => row.key === store.selectedKey)
  if (index >= 0) scrollerRef.value?.scrollToItem(index)
}

function isAtTail(): boolean {
  const element = scrollerRef.value?.$el
  if (!element) return true
  return element.scrollHeight - element.scrollTop - element.clientHeight <= ROW_HEIGHT * 2
}

function updateTailFollowState(): void {
  followingTail.value = isAtTail()
}

async function followTail(): Promise<void> {
  await nextTick()
  if (store.rows.length > 0) scrollerRef.value?.scrollToItem(store.rows.length - 1)
  followingTail.value = true
}

async function handleLiveHeadPulse(pulse: TapeInspectorHeadPulse): Promise<void> {
  if (pulse.sessionId !== props.sessionId) return
  const wasAtTail = isAtTail()
  followingTail.value = wasAtTail
  const changed = await store.handleLiveHeadPulse(pulse)
  if (changed && wasAtTail && liveConnected.value && !store.livePaused && store.canonicalSort) {
    await followTail()
  }
}

async function toggleLivePaused(): Promise<void> {
  const resuming = store.livePaused
  const wasFollowing = resuming && isAtTail()
  const changed = await store.setLivePaused(!store.livePaused)
  if (resuming && changed && wasFollowing && store.canonicalSort) await followTail()
}

async function loadOlder(): Promise<void> {
  const previousRecordCount = store.records.length
  olderLoadNotice.value = null
  const element = scrollerRef.value?.$el
  const firstVisibleIndex = element ? Math.max(0, Math.floor(element.scrollTop / ROW_HEIGHT)) : 0
  const anchor = store.rows[firstVisibleIndex]
  const offset = element ? element.scrollTop - firstVisibleIndex * ROW_HEIGHT : 0
  store.setPrependScrollAnchor(anchor ? { key: anchor.key, offset } : null)
  try {
    const loaded = await store.loadOlderPage()
    if (!loaded) {
      if (store.errorCode === 'load_failed') olderLoadNotice.value = { kind: 'failed' }
      return
    }
    const loadedCount = Math.max(0, store.records.length - previousRecordCount)
    olderLoadNotice.value =
      loadedCount > 0
        ? { kind: 'loaded', count: loadedCount, reachedStart: !store.hasOlder }
        : { kind: 'no_match', reachedStart: !store.hasOlder }
    if (!anchor) return
    await nextTick()
    const newIndex = store.rows.findIndex((row) => row.key === anchor.key)
    if (newIndex >= 0) scrollerRef.value?.scrollToPosition(newIndex * ROW_HEIGHT + offset)
  } finally {
    store.setPrependScrollAnchor(null)
  }
}

async function loadEvidenceParents(): Promise<void> {
  const previousRecordCount = store.records.length
  olderLoadNotice.value = null
  const element = scrollerRef.value?.$el
  const firstVisibleIndex = element ? Math.max(0, Math.floor(element.scrollTop / ROW_HEIGHT)) : 0
  const anchor = store.rows[firstVisibleIndex]
  const offset = element ? element.scrollTop - firstVisibleIndex * ROW_HEIGHT : 0
  store.setPrependScrollAnchor(anchor ? { key: anchor.key, offset } : null)
  try {
    const loaded = await store.loadEarlierEvidenceEntries()
    if (!loaded) {
      if (store.errorCode === 'load_failed') olderLoadNotice.value = { kind: 'failed' }
      return
    }
    const loadedCount = Math.max(0, store.records.length - previousRecordCount)
    olderLoadNotice.value =
      loadedCount > 0
        ? { kind: 'loaded', count: loadedCount, reachedStart: !store.hasOlder }
        : { kind: 'no_match', reachedStart: !store.hasOlder }
    if (!anchor) return
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
      if (detailOpen.value) void store.loadSelectedDetail()
    }
    return
  }
  if (event.key === 'Enter' && store.selectedRow) {
    const row = store.selectedRow
    if (row.recordType === 'group' || row.recordType === 'evidence_lane') {
      event.preventDefault()
      store.toggleCollapsed(row.key)
      return
    }
    event.preventDefault()
    detailOpen.value = true
    void store.loadSelectedDetail()
  }
}

watch(
  () => props.sessionId,
  () => {
    cancelColumnResize()
  }
)

watch(ledgerLayout, (layout) => {
  if (layout !== 'wide') cancelColumnResize()
})

watch(
  () => [props.sessionId, props.openRequest?.token] as const,
  () => void initialize(),
  { immediate: true }
)

watch(
  () => store.liveEvidenceRevision,
  (revision, previousRevision) => {
    if (
      revision <= previousRevision ||
      !followingTail.value ||
      store.livePaused ||
      !store.canonicalSort
    ) {
      return
    }
    void followTail()
  }
)

watch(documentVisibility, (visibility) => {
  if (visibility === 'visible') {
    if (store.sessionId === props.sessionId) store.startEvidenceRefresh()
    return
  }
  store.stopEvidenceRefresh()
})

watch(
  scrollerRef,
  (scroller, _previousScroller, onCleanup) => {
    const element = scroller?.$el
    if (!element) return
    element.addEventListener('scroll', updateTailFollowState, { passive: true })
    onCleanup(() => element.removeEventListener('scroll', updateTailFollowState))
  },
  { flush: 'post' }
)

const stopHeadListener = sessionClient.onTapeInspectorHeadChanged((pulse) => {
  void handleLiveHeadPulse(pulse)
})

onBeforeUnmount(() => {
  liveLifecycleGeneration += 1
  cancelColumnResize()
  stopHeadListener()
  void releaseLiveSubscription()
  store.clear()
})
</script>
