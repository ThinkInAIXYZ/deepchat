<template>
  <section class="flex min-h-0 flex-1 flex-col gap-4">
    <div
      class="flex flex-col gap-3 rounded-lg border border-border p-3 lg:flex-row lg:items-center lg:justify-between"
    >
      <div>
        <h2 class="text-sm font-semibold">{{ t('settings.memory.redesign.diagnosticsTitle') }}</h2>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ t('settings.memory.redesign.diagnosticsDescription') }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          class="h-8 text-xs"
          :disabled="loading"
          @click="refresh"
        >
          <Icon icon="lucide:refresh-cw" class="mr-1.5 h-3.5 w-3.5" />
          {{ t('settings.memory.redesign.refresh') }}
        </Button>
        <Button size="sm" class="h-8 text-xs" :disabled="reindexing" @click="reindex">
          <Icon icon="lucide:rotate-cw" class="mr-1.5 h-3.5 w-3.5" />
          {{
            reindexing
              ? t('settings.deepchatAgents.memoryManager.health.reindexing')
              : t('settings.deepchatAgents.memoryManager.health.reindex')
          }}
        </Button>
      </div>
    </div>

    <MemoryInlineFeedback v-if="feedback" :feedback="feedback" @clear="clearFeedback" />

    <div
      v-if="showReindexFailure"
      role="alert"
      data-testid="reindex-failure-banner"
      class="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="flex min-w-0 gap-2">
        <Icon icon="lucide:triangle-alert" class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p class="text-xs leading-5 text-foreground">
          {{
            t('settings.memory.redesign.reindexIncomplete', {
              reason: reindexFailureReason
            })
          }}
        </p>
      </div>
      <Button
        v-if="canRetryReindex"
        variant="outline"
        size="sm"
        class="h-8 shrink-0 text-xs"
        :disabled="reindexing"
        @click="reindex"
      >
        <Icon icon="lucide:rotate-cw" class="mr-1.5 h-3.5 w-3.5" />
        {{ t('settings.deepchatAgents.memoryManager.health.reindex') }}
      </Button>
    </div>

    <div v-if="loading" class="py-12 text-center text-sm text-muted-foreground">
      {{ t('common.loading') }}
    </div>
    <div v-else class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.6fr)]">
      <div class="space-y-4">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            :label="t('settings.deepchatAgents.memoryManager.health.totalRows')"
            :value="health?.totalRows ?? 0"
          />
          <MetricTile
            :label="t('settings.deepchatAgents.memoryManager.health.pending')"
            :value="health?.embeddings.pending ?? status?.pendingEmbedding ?? 0"
          />
          <MetricTile
            :label="t('settings.deepchatAgents.memoryManager.health.archiveCandidates')"
            :value="health?.lifecycle.archiveCandidates ?? 0"
          />
          <MetricTile
            :label="t('settings.deepchatAgents.memoryManager.health.failed')"
            :value="health?.maintenance.failed ?? 0"
            tone="destructive"
          />
        </div>

        <section class="rounded-lg border border-border p-3">
          <h3 class="text-sm font-semibold">
            {{ t('settings.memory.redesign.pipelineTitle') }}
          </h3>
          <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatusPill
              :label="t('settings.deepchatAgents.memoryManager.health.error')"
              :value="health?.embeddings.error ?? 0"
            />
            <StatusPill
              :label="t('settings.deepchatAgents.memoryManager.health.staleEmbeddings')"
              :value="health?.embeddings.stale ?? 0"
            />
            <StatusPill
              :label="t('settings.deepchatAgents.memoryManager.health.archived')"
              :value="health?.lifecycle.archived ?? status?.archivedMemoryCount ?? 0"
            />
            <StatusPill
              :label="t('settings.deepchatAgents.memoryManager.health.conflicted')"
              :value="health?.conflicts.conflicted ?? status?.conflictCount ?? 0"
            />
          </div>
        </section>

        <section class="rounded-lg border border-border p-3" data-testid="runtime-pipeline">
          <div>
            <h3 class="text-sm font-semibold">
              {{ t('settings.memory.redesign.runtimePipelineTitle') }}
            </h3>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ t('settings.memory.redesign.processWideDescription') }}
            </p>
          </div>
          <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatusPill
              :label="t('settings.memory.redesign.recallP50')"
              :value="recallLatencyP50"
            />
            <StatusPill
              :label="t('settings.memory.redesign.recallP95')"
              :value="recallLatencyP95"
            />
            <StatusPill
              :label="t('settings.memory.redesign.fallbackCount')"
              :value="fallbackCount"
            />
            <StatusPill
              :label="t('settings.memory.redesign.maintenanceFailures')"
              :value="health?.runtime.agent.maintenance.failed ?? 0"
            />
            <StatusPill
              :label="t('settings.memory.redesign.extractionQueueDepth')"
              :value="health?.runtime.process.extractionQueue.depth ?? 0"
            />
            <StatusPill
              :label="t('settings.memory.redesign.extractionQueueAge')"
              :value="extractionQueueAge"
            />
            <StatusPill
              :label="t('settings.memory.redesign.embeddingBacklog')"
              :value="health?.runtime.process.embeddingBacklog.pending ?? 0"
            />
            <StatusPill
              :label="t('settings.memory.redesign.vectorResources')"
              :value="health?.runtime.process.vector.openStores ?? 0"
            />
            <StatusPill
              :label="t('settings.memory.redesign.providerQueued')"
              :value="health?.runtime.process.providerAdmission.queued ?? 0"
            />
            <StatusPill
              class="sm:col-span-2 lg:col-span-3"
              :label="t('settings.memory.redesign.providerPressure')"
              :value="providerEventSummary"
            />
          </div>
          <p class="mt-2 text-[11px] text-muted-foreground">
            {{
              t('settings.memory.redesign.resourceHighWater', {
                stores: health?.runtime.process.vector.openStoresHighWater ?? 0,
                leases: health?.runtime.process.vector.activeLeasesHighWater ?? 0
              })
            }}
          </p>
        </section>

        <section class="rounded-lg border border-border p-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-semibold">
                {{ t('settings.memory.redesign.archiveCandidatesTitle') }}
              </h3>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ t('settings.memory.redesign.archiveCandidatesDescription') }}
              </p>
            </div>
            <Badge variant="secondary" class="text-[10px]">
              {{ archivePreview?.lifecycles.length ?? 0 }}
            </Badge>
          </div>
          <div
            v-if="!archivePreview || archivePreview.lifecycles.length === 0"
            class="py-8 text-center text-xs text-muted-foreground"
          >
            {{ t('settings.deepchatAgents.memoryManager.health.archivePrediction.empty') }}
          </div>
          <ol v-else class="mt-3 space-y-2">
            <li
              v-for="lifecycle in archivePreview.lifecycles"
              :key="lifecycle.memoryId"
              class="rounded-md border border-border px-3 py-2 text-xs"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-medium">{{ shortId(lifecycle.memoryId) }}</span>
                <Badge variant="outline" class="text-[10px]">
                  {{
                    t(`settings.deepchatAgents.memoryManager.lifecycle.tier.${lifecycle.decayTier}`)
                  }}
                </Badge>
              </div>
              <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                <span>
                  {{ t('settings.deepchatAgents.memoryManager.health.archivePrediction.ageDays') }}:
                  {{ formatNumber(lifecycle.forget.ageDays) }}
                </span>
                <span>
                  {{
                    t('settings.deepchatAgents.memoryManager.health.archivePrediction.decayScore')
                  }}: {{ formatNumber(lifecycle.forget.decayScore) }}
                </span>
              </div>
            </li>
          </ol>
        </section>
      </div>

      <aside class="space-y-4">
        <section class="rounded-lg border border-border p-3">
          <h3 class="text-sm font-semibold">
            {{ t('settings.memory.redesign.recentFailuresTitle') }}
          </h3>
          <div
            v-if="!health || health.maintenance.recentFailures.length === 0"
            class="py-6 text-center text-xs text-muted-foreground"
          >
            {{ t('settings.deepchatAgents.memoryManager.health.noRecentFailures') }}
          </div>
          <ol v-else class="mt-3 space-y-2">
            <li
              v-for="failure in health.maintenance.recentFailures"
              :key="`${failure.eventType}:${failure.createdAt}`"
              class="rounded-md border border-border px-3 py-2 text-xs"
            >
              <div class="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" class="text-[10px]">{{ failure.eventType }}</Badge>
                <Badge variant="destructive" class="text-[10px]">{{ failure.status }}</Badge>
                <span class="text-[10px] text-muted-foreground">
                  {{ formatRelativeTime(failure.createdAt, locale) }}
                </span>
              </div>
              <p v-if="failure.reason" class="mt-1 wrap-break-word text-muted-foreground">
                {{ failure.reason }}
              </p>
            </li>
          </ol>
        </section>

        <section class="rounded-lg border border-border p-3">
          <h3 class="text-sm font-semibold">{{ t('settings.memory.redesign.activityTitle') }}</h3>
          <div
            v-if="auditEvents.length === 0"
            class="py-6 text-center text-xs text-muted-foreground"
          >
            {{ t('settings.deepchatAgents.memoryManager.emptyActivity') }}
          </div>
          <ol v-else class="mt-3 space-y-2">
            <li
              v-for="event in auditEvents"
              :key="event.id"
              class="rounded-md border border-border px-3 py-2 text-xs"
            >
              <div class="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" class="text-[10px]">
                  {{ eventLabel(event.eventType) }}
                </Badge>
                <Badge
                  :variant="event.status === 'failed' ? 'destructive' : 'secondary'"
                  class="text-[10px]"
                >
                  {{ event.status }}
                </Badge>
                <span class="text-[10px] text-muted-foreground">
                  {{ formatRelativeTime(event.createdAt, locale) }}
                </span>
              </div>
              <p v-if="event.reason" class="mt-1 wrap-break-word text-muted-foreground">
                {{ event.reason }}
              </p>
            </li>
          </ol>
        </section>

        <section class="rounded-lg border border-destructive/40 p-3">
          <h3 class="text-sm font-semibold text-destructive">
            {{ t('settings.memory.redesign.dangerZoneTitle') }}
          </h3>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ t('settings.memory.redesign.dangerZoneDescription') }}
          </p>
          <Button
            variant="destructive"
            size="sm"
            class="mt-3 h-8 text-xs"
            :disabled="loading || clearing"
            data-testid="memory-clear-all-trigger"
            @click="requestClearAll"
          >
            <Icon icon="lucide:trash-2" class="mr-1.5 h-3.5 w-3.5" />
            {{ t('settings.deepchatAgents.memoryManager.clearAll') }}
          </Button>
        </section>
      </aside>
    </div>

    <AlertDialog :open="clearDialogOpen" @update:open="handleClearDialogOpenChange">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t('settings.deepchatAgents.memoryManager.clearConfirmTitle') }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('settings.deepchatAgents.memoryManager.clearConfirmBody') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <MemoryInlineFeedback
          v-if="clearOperationFeedbackState"
          :feedback="clearOperationFeedbackState"
          @clear="clearClearAllFeedback"
        />
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="memory-clear-all-cancel" :disabled="clearing">
            {{ t('common.cancel') }}
          </AlertDialogCancel>
          <AlertDialogAsyncAction
            data-testid="memory-clear-all-confirm"
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            :disabled="loading || clearing"
            @click="clearAll"
          >
            <Spinner
              v-if="clearing"
              data-testid="memory-clear-all-spinner"
              class="mr-1.5 size-3.5"
            />
            {{ t('settings.deepchatAgents.memoryManager.clearAll') }}
          </AlertDialogAsyncAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import {
  AlertDialog,
  AlertDialogAsyncAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { Spinner } from '@shadcn/components/ui/spinner'
import { createMemoryClient } from '@api/MemoryClient'
import type {
  MemoryArchiveCandidateLifecyclePreview,
  MemoryAuditEvent,
  MemoryHealthDto,
  MemoryStatusDto
} from '@shared/contracts/routes'
import { auditSentenceKey, formatRelativeTime } from './memoryRedesignUtils'
import MemoryInlineFeedback from './MemoryInlineFeedback.vue'
import { useMemoryInlineFeedback } from '../lib/useMemoryInlineFeedback'

const props = defineProps<{
  agentId: string
  status: MemoryStatusDto | null
  refreshToken: number
}>()

const { t, te, locale } = useI18n()
const memoryClient = createMemoryClient()
const panelFeedback = useMemoryInlineFeedback('MemoryDiagnosticsPanel')
const feedback = panelFeedback.feedback
const clearFeedback = panelFeedback.clear
const clearOperationFeedback = useMemoryInlineFeedback('MemoryDiagnosticsPanel.clearAll')
const clearOperationFeedbackState = clearOperationFeedback.feedback
const clearClearAllFeedback = clearOperationFeedback.clear

const loading = ref(false)
const reindexPending = ref(false)
type ClearRequest =
  | { status: 'idle' }
  | { status: 'confirming' }
  | { status: 'pending'; agentId: string }
const clearRequest = shallowRef<ClearRequest>({ status: 'idle' })
const health = ref<MemoryHealthDto | null>(null)
const archivePreview = ref<MemoryArchiveCandidateLifecyclePreview | null>(null)
const auditEvents = ref<MemoryAuditEvent[]>([])
let requestId = 0
// Bumped whenever a new props.status snapshot arrives, so a pending reindex only settles once a
// status object observed *after* it started reports reindexing !== true (never on the stale
// pre-start snapshot, and null/undefined statuses count as "not reindexing").
let statusEpoch = 0
let pendingStartEpoch: number | null = null

const reindexing = computed(() => reindexPending.value || props.status?.reindexing === true)
const clearDialogOpen = computed(() => clearRequest.value.status !== 'idle')
const clearing = computed(() => clearRequest.value.status === 'pending')
const showReindexFailure = computed(
  () =>
    !reindexing.value &&
    props.status?.lastReindex !== undefined &&
    props.status.lastReindex.outcome !== 'completed'
)
const canRetryReindex = computed(() => props.status?.lastReindex?.lastError?.retryable === true)
const reindexFailureReason = computed(() => {
  const error = props.status?.lastReindex?.lastError
  if (!error?.code) return t('settings.memory.redesign.reindexInternalReason')
  if (error.code === 'pending-restart') {
    return t('settings.deepchatAgents.memoryManager.cleanupPendingRestart')
  }
  return t('settings.memory.redesign.reindexInternalReason')
})
const recallDiagnostics = computed(() => health.value?.runtime.agent.retrieval.recall)
const recallLatencyP50 = computed(() => recallDiagnostics.value?.latencyMs.total.p50 ?? '—')
const recallLatencyP95 = computed(() => recallDiagnostics.value?.latencyMs.total.p95 ?? '—')
const fallbackCount = computed(() => {
  const counts = recallDiagnostics.value?.degradationCounts
  if (!counts) return 0
  return Object.values(counts).reduce((total, count) => total + count, 0)
})
const extractionQueueAge = computed(() => {
  const age = health.value?.runtime.process.extractionQueue.oldestQueuedAgeMs
  return age == null ? '—' : Math.round(age)
})
const providerEventSummary = computed(() => {
  const admission = health.value?.runtime.process.providerAdmission
  if (!admission) return '—'
  const decisions = admission.admissionDecisions
  const race = admission.raceEvents
  return t('settings.memory.redesign.providerPressureSummary', {
    rateLimited: decisions.rateLimited,
    capacityRejected: decisions.capacityRejected,
    deadline: race.deadline,
    aborted: race.aborted,
    lateSettled: race.lateSettled
  })
})

const MetricTile = defineComponent({
  name: 'MetricTile',
  props: {
    label: { type: String, required: true },
    value: { type: Number, required: true },
    tone: { type: String as () => 'default' | 'destructive', default: 'default' }
  },
  setup(tileProps) {
    return () =>
      h(
        'div',
        {
          class: [
            'rounded-lg border border-border p-3',
            tileProps.tone === 'destructive' && tileProps.value > 0 ? 'border-destructive/50' : ''
          ]
        },
        [
          h('div', { class: 'text-[11px] text-muted-foreground' }, tileProps.label),
          h('div', { class: 'mt-1 text-xl font-semibold tabular-nums' }, String(tileProps.value))
        ]
      )
  }
})

const StatusPill = defineComponent({
  name: 'StatusPill',
  props: {
    label: { type: String, required: true },
    value: { type: [Number, String], required: true }
  },
  setup(pillProps) {
    return () =>
      h(
        'div',
        { class: 'flex min-w-0 items-center justify-between gap-3 rounded-md bg-muted px-3 py-2' },
        [
          h('span', { class: 'min-w-0 text-xs leading-5 text-muted-foreground' }, pillProps.label),
          h(
            'span',
            { class: 'min-w-0 text-right text-sm font-semibold leading-5 tabular-nums' },
            String(pillProps.value)
          )
        ]
      )
  }
})

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-6)}` : id
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(value >= 10 ? 0 : 2) : String(value)
}

function eventLabel(eventType: string): string {
  const key = auditSentenceKey(eventType)
  return te(key) ? t(key) : eventType
}

async function load(): Promise<void> {
  const agentId = props.agentId
  if (!agentId) return
  const current = ++requestId
  loading.value = true
  try {
    const [nextHealth, nextPreview, nextEvents] = await Promise.all([
      memoryClient.getHealth(agentId),
      memoryClient.getArchiveCandidateLifecyclePreview(agentId),
      memoryClient.listAuditEvents(agentId, { limit: 50 })
    ])
    if (current !== requestId || props.agentId !== agentId) return
    health.value = nextHealth
    archivePreview.value = nextPreview
    auditEvents.value = nextEvents
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

async function reindex(): Promise<void> {
  const agentId = props.agentId
  if (!agentId || reindexing.value) return
  clearFeedback()
  reindexPending.value = true
  try {
    const result = await memoryClient.reindex(agentId)
    if (props.agentId !== agentId) return
    if (result.started) {
      pendingStartEpoch = statusEpoch
    } else {
      reindexPending.value = false
      pendingStartEpoch = null
    }
    await load()
  } catch (error) {
    if (props.agentId !== agentId) return
    panelFeedback.fail(error)
    reindexPending.value = false
    pendingStartEpoch = null
  }
}

function requestClearAll(): void {
  if (!props.agentId || loading.value || clearRequest.value.status !== 'idle') return
  clearClearAllFeedback()
  clearRequest.value = { status: 'confirming' }
}

function handleClearDialogOpenChange(open: boolean): void {
  if (open || clearRequest.value.status !== 'confirming') return
  clearRequest.value = { status: 'idle' }
  clearClearAllFeedback()
}

async function clearAll(): Promise<void> {
  if (loading.value || clearRequest.value.status !== 'confirming') return
  const pendingRequest = { status: 'pending' as const, agentId: props.agentId }
  clearRequest.value = pendingRequest
  clearClearAllFeedback()
  try {
    const result = await memoryClient.clear(pendingRequest.agentId)
    if (props.agentId !== pendingRequest.agentId || clearRequest.value !== pendingRequest) {
      return
    }
    if (result.cleanupPendingRestart) {
      panelFeedback.show(
        'warning',
        t('settings.deepchatAgents.memoryManager.cleanupPendingRestart')
      )
    }
    await load()
    if (props.agentId !== pendingRequest.agentId || clearRequest.value !== pendingRequest) {
      return
    }
    clearRequest.value = { status: 'idle' }
  } catch (error) {
    if (props.agentId === pendingRequest.agentId && clearRequest.value === pendingRequest) {
      clearRequest.value = { status: 'confirming' }
      clearOperationFeedback.fail(error)
    }
  }
}

watch(
  () => [props.agentId, props.refreshToken],
  () => void load(),
  { immediate: true }
)

watch(
  () => props.agentId,
  () => {
    clearFeedback()
    clearClearAllFeedback()
    clearRequest.value = { status: 'idle' }
    reindexPending.value = false
    pendingStartEpoch = null
  }
)

watch(
  () => props.status,
  (status) => {
    statusEpoch += 1
    if (
      pendingStartEpoch != null &&
      statusEpoch > pendingStartEpoch &&
      status?.reindexing !== true
    ) {
      reindexPending.value = false
      pendingStartEpoch = null
    }
  }
)
</script>
