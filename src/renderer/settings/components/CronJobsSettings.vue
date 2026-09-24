<template>
  <div
    ref="rootRef"
    data-testid="settings-cron-jobs-page"
    class="flex h-full min-h-0 w-full flex-col"
  >
    <div
      v-if="isLoading || !loadAttempted"
      class="flex h-full w-full items-center justify-center text-sm text-muted-foreground"
    >
      {{ t('common.loading') }}
    </div>

    <div v-else-if="loadUnavailable" class="flex h-full w-full items-center justify-center p-6">
      <div
        role="alert"
        class="flex w-full max-w-md flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
      >
        <span class="text-sm text-destructive">{{ t('common.error.operationFailed') }}</span>
        <DcButton size="sm" variant="outline" :disabled="isLoading" @click="loadJobs">
          {{ t('common.retry') }}
        </DcButton>
      </div>
    </div>

    <template v-else>
      <div
        v-if="schedulerTrouble"
        role="alert"
        class="flex flex-wrap items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive"
      >
        <Icon icon="lucide:triangle-alert" class="size-3.5 shrink-0" />
        <span>{{ schedulerTroubleMessage }}</span>
        <DcButton
          variant="link"
          size="sm"
          class="h-auto p-0 text-xs"
          :disabled="restartingScheduler || pageOperationPending"
          @click="restartScheduler"
        >
          {{ t('settings.cronJobs.actions.restart') }}
        </DcButton>
      </div>

      <div class="flex min-h-0 flex-1">
        <aside
          v-if="showListPane"
          class="flex min-h-0 min-w-0 flex-col"
          :class="narrowLayout ? 'w-full' : 'w-[340px] shrink-0 border-r border-border'"
        >
          <div class="flex flex-col gap-3 px-4 py-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h1 class="truncate text-base font-semibold">{{ t('settings.cronJobs.title') }}</h1>
                <p class="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {{ t('settings.cronJobs.description') }}
                </p>
              </div>
              <DcButton
                data-testid="cron-jobs-add"
                size="sm"
                icon="lucide:plus"
                :disabled="pageOperationPending || runtimeActionPending"
                @click="startCreate()"
              >
                {{ t('settings.cronJobs.actions.newJob') }}
              </DcButton>
            </div>

            <div class="rounded-lg border border-border bg-card/30 px-3 py-2">
              <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <DcBadge :variant="schedulerBadgeVariant">
                  {{ t(`settings.cronJobs.status.${schedulerStatus?.state ?? 'stopped'}`) }}
                </DcBadge>
                <span class="text-muted-foreground">
                  {{ t('settings.cronJobs.status.enabled') }} {{ enabledJobCount }}
                </span>
                <span class="min-w-0 truncate text-muted-foreground">
                  · {{ t('settings.cronJobs.nextRunAt') }}
                  {{ formatTimestamp(schedulerStatus?.nextRunAt ?? null) }}
                </span>
                <button
                  type="button"
                  data-testid="cron-jobs-scheduler-details"
                  class="ms-auto shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  :aria-expanded="schedulerDetailsOpen"
                  @click="schedulerDetailsOpen = !schedulerDetailsOpen"
                >
                  {{ t('settings.cronJobs.actions.schedulerDetails') }}
                </button>
              </div>

              <dl
                v-if="schedulerDetailsOpen"
                class="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-border pt-2 text-xs"
              >
                <dt class="text-muted-foreground">{{ t('settings.cronJobs.scheduler.pid') }}</dt>
                <dd class="min-w-0 truncate">
                  {{ schedulerStatus?.pid ?? t('settings.cronJobs.none') }}
                </dd>
                <dt class="text-muted-foreground">
                  {{ t('settings.cronJobs.scheduler.heartbeat') }}
                </dt>
                <dd class="min-w-0 truncate">
                  {{ formatTimestamp(schedulerStatus?.lastHeartbeatAt ?? null) }}
                </dd>
                <dt class="text-muted-foreground">
                  {{ t('settings.cronJobs.scheduler.restartAttempts') }}
                </dt>
                <dd class="min-w-0 truncate">{{ schedulerStatus?.restartAttempts ?? 0 }}</dd>
                <dt class="text-muted-foreground">
                  {{ t('settings.cronJobs.scheduler.updatedAt') }}
                </dt>
                <dd class="min-w-0 truncate">
                  {{ formatTimestamp(schedulerStatus?.updatedAt ?? null) }}
                </dd>
              </dl>
              <div v-if="schedulerDetailsOpen" class="mt-2 flex justify-end">
                <DcButton
                  data-testid="cron-jobs-restart"
                  variant="outline"
                  size="icon-sm"
                  icon="lucide:rotate-cw"
                  :loading="restartingScheduler"
                  :disabled="restartingScheduler || pageOperationPending || runtimeActionPending"
                  :tooltip="t('settings.cronJobs.actions.restart')"
                  @click="restartScheduler"
                />
              </div>
            </div>

            <div
              v-if="remoteDeliveryLoadFailed"
              role="status"
              class="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              <span>
                {{ t('settings.cronJobs.fields.remoteDelivery') }} ·
                {{ t('common.error.requestFailed') }}
              </span>
              <DcButton
                variant="link"
                size="sm"
                class="h-auto p-0 text-xs"
                :disabled="remoteDeliveryLoading || pageOperationPending"
                @click="refreshRemoteDeliveryOptions"
              >
                {{ t('common.retry') }}
              </DcButton>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <CronJobsTaskList
              v-if="jobs.length > 0"
              :jobs="jobs"
              :selected-job-id="selectedJobId"
              :locked-job-id="editorJobId"
              :busy="pageOperationPending || runtimeActionPending"
              :running-job-id="runningId"
              :latest-runs="latestRuns"
              :runs-loading="runsLoadingByJobId"
              :agent-names="agentNames"
              @select="selectJob"
              @toggle="toggleJob"
              @run-now="runJobNow"
              @edit="editJob"
              @delete="requestDeleteJob"
            />
          </div>
        </aside>

        <section v-if="showDetailPane" class="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <template v-if="jobs.length === 0 && mode === 'view'">
            <div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
              <div v-if="narrowLayout" class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h1 class="truncate text-base font-semibold">
                    {{ t('settings.cronJobs.title') }}
                  </h1>
                  <p class="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {{ t('settings.cronJobs.description') }}
                  </p>
                </div>
                <DcButton
                  data-testid="cron-jobs-add-empty"
                  size="sm"
                  icon="lucide:plus"
                  :disabled="pageOperationPending || runtimeActionPending"
                  @click="startCreate()"
                >
                  {{ t('settings.cronJobs.actions.newJob') }}
                </DcButton>
              </div>

              <DcEmpty
                icon="lucide:calendar-clock"
                :title="t('settings.cronJobs.emptyState.title')"
                :description="t('settings.cronJobs.emptyState.description')"
              >
                <template #action>
                  <DcButton
                    data-testid="cron-jobs-create-first"
                    size="sm"
                    icon="lucide:plus"
                    :disabled="pageOperationPending || runtimeActionPending"
                    @click="startCreate()"
                  >
                    {{ t('settings.cronJobs.actions.createFirstTask') }}
                  </DcButton>
                </template>
              </DcEmpty>

              <section class="rounded-lg border border-border bg-card/30 p-4">
                <h2 class="text-sm font-bold text-foreground">
                  {{ t('settings.cronJobs.emptyState.templatesTitle') }}
                </h2>
                <p class="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {{ t('settings.cronJobs.emptyState.templatesDescription') }}
                </p>
                <div class="mt-3 grid gap-3 sm:grid-cols-3">
                  <button
                    v-for="template in CRON_JOB_TEMPLATES"
                    :key="template.id"
                    type="button"
                    :data-testid="`cron-job-template-${template.id}`"
                    class="flex flex-col rounded-lg border border-border bg-background/40 p-3 text-left transition-colors outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring"
                    :disabled="pageOperationPending || runtimeActionPending"
                    @click="startCreate(template)"
                  >
                    <Icon :icon="template.icon" class="size-4 text-muted-foreground" />
                    <span class="mt-2 truncate text-sm font-medium">
                      {{ t(template.nameKey) }}
                    </span>
                    <span class="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                      {{ t(template.promptKey) }}
                    </span>
                    <span class="mt-2 text-[11px] text-muted-foreground">
                      {{ describeSchedule(template.cronExpr) }}
                    </span>
                  </button>
                </div>
              </section>
            </div>
          </template>

          <div
            v-else-if="!selectedJob && mode === 'view'"
            class="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 p-6 text-center"
          >
            <Icon icon="lucide:mouse-pointer-click" class="size-6 text-muted-foreground" />
            <p class="text-sm font-medium">{{ t('settings.cronJobs.detail.placeholderTitle') }}</p>
            <p class="max-w-sm text-xs leading-5 text-muted-foreground">
              {{ t('settings.cronJobs.detail.placeholderDescription') }}
            </p>
          </div>

          <CronJobDetailPanel
            v-else
            v-model:draft="draft"
            :mode="mode"
            :job="selectedJob"
            :dirty="hasDraftChanges"
            :busy="pageOperationPending"
            :saving="isSaving"
            :running-now="runningId !== null && runningId === selectedJobId"
            :narrow="narrowLayout"
            :agents="agents"
            :timezones="timezoneOptions"
            :browser-timezone="browserTimezone()"
            :remote-delivery-options="remoteDeliveryOptions"
            :remote-delivery-loading="remoteDeliveryLoading"
            :remote-delivery-load-failed="remoteDeliveryLoadFailed"
            :preview-runs="previewRuns"
            :preview-loading="previewLoading"
            :preview-error="previewError"
            :runs="selectedJobRuns"
            :runs-loading="selectedJobRunsLoading"
            :runs-error="selectedJobRunsError"
            :latest-run="selectedJobLatestRun"
            :latest-run-deliveries="selectedJobLatestRunDeliveries"
            :latest-run-delivery-error="selectedJobLatestRunDeliveryError"
            @save="saveDraft"
            @cancel="cancelEdit"
            @edit="startEdit"
            @delete="deleteSelectedJob"
            @run-now="runSelectedJobNow"
            @toggle="toggleSelectedJob"
            @back="backToList"
            @retry-remote-options="refreshRemoteDeliveryOptions"
            @reload-runs="reloadSelectedJobRuns"
          />
        </section>
      </div>
    </template>
  </div>

  <Dialog v-model:open="deleteDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('common.delete') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.cronJobs.detail.deleteConfirm', { name: pendingDeleteJob?.name ?? '' }) }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DcButton
          variant="outline"
          :disabled="pageOperationPending"
          @click="deleteDialogOpen = false"
        >
          {{ t('common.cancel') }}
        </DcButton>
        <DcButton variant="destructive" :disabled="pageOperationPending" @click="confirmDeleteJob">
          <Spinner v-if="deleting" class="mr-2 size-4" />
          {{ t('common.delete') }}
        </DcButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { useElementSize } from '@vueuse/core'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'
import { DcEmpty } from '@dc-ui/components/empty'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Spinner } from '@shadcn/components/ui/spinner'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { createConfigClient } from '@api/ConfigClient'
import { createCronJobsClient, type CronJobsUpsertInput } from '@api/CronJobsClient'
import { createRemoteControlClient } from '@api/RemoteControlClient'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'
import CronJobDetailPanel from './cronJobs/CronJobDetailPanel.vue'
import CronJobsTaskList from './cronJobs/CronJobsTaskList.vue'
import { type RemoteDeliveryOption } from './cronJobs/cronJobDelivery'
import { CRON_JOB_TEMPLATES, type CronJobTemplate } from './cronJobs/cronJobTemplates'
import { useCronJobFormat } from './cronJobs/useCronJobFormat'
import {
  CRON_JOBS_DEFAULT_CRON_EXPR,
  CRON_JOBS_DEFAULT_DELIVERY,
  CRON_JOBS_DEFAULT_MISFIRE_POLICY,
  CRON_JOBS_DEFAULT_RUNTIME,
  CRON_JOBS_DEFAULT_TIMEZONE,
  type CronJob,
  type CronJobDelivery,
  type CronJobDeliveryReceipt,
  type CronJobRun,
  type CronJobsSchedulerStatus
} from '@shared/cronJobs'
import type { Agent } from '@shared/types/agent-interface'

type EditorMode = 'view' | 'edit' | 'create'

const NARROW_LAYOUT_BREAKPOINT = 820
const SCHEDULER_STATUS_REFRESH_MS = 5_000
const SCHEDULER_STATUS_FAILURE_THRESHOLD = 2
const PREVIEW_DEBOUNCE_MS = 300
const RUN_HISTORY_LIMIT = 10
const LIST_RUN_LIMIT = 1
const DIRTY_COMPARE_FIELDS = [
  'name',
  'enabled',
  'cronExpr',
  'timezone',
  'agentId',
  'misfirePolicy',
  'maxCatchUpRuns',
  'taskPrompt',
  'taskSystemInstruction',
  'taskOutputMode',
  'modelPolicy',
  'toolPolicy',
  'permissionPolicy',
  'runtime',
  'delivery'
] as const satisfies readonly (keyof CronJob)[]

const { t } = useI18n()
const { formatTimestamp, describeSchedule } = useCronJobFormat()
const client = createCronJobsClient()
const configClient = createConfigClient()
const remoteControlClient = createRemoteControlClient()

const rootRef = ref<HTMLElement | null>(null)
const { width: containerWidth } = useElementSize(rootRef)

const pendingPageOperationId = ref<string | null>(null)
const operationIds = Object.freeze({
  load: 'settings.cronJobs.load',
  save: 'settings.cronJobs.save',
  toggle: 'settings.cronJobs.toggle',
  delete: 'settings.cronJobs.delete'
})
const persistentOperationIds = new Set<string>([
  operationIds.save,
  operationIds.toggle,
  operationIds.delete
])

const jobs = ref<CronJob[]>([])
const agents = ref<Agent[]>([])
const schedulerStatus = ref<CronJobsSchedulerStatus | null>(null)
const schedulerDetailsOpen = ref(false)
const loadAttempted = ref(false)
const hasLoaded = ref(false)
const runningId = ref<string | null>(null)
const restartingScheduler = ref(false)
const selectedJobId = ref<string | null>(null)
const mode = ref<EditorMode>('view')
const draft = ref<CronJob | null>(null)
const baselineDraft = ref<CronJob | null>(null)
const previewRuns = ref<number[]>([])
const previewError = ref<string | null>(null)
const previewLoading = ref(false)
const runsByJobId = ref<Record<string, CronJobRun[]>>({})
const runsLoadingByJobId = ref<Record<string, boolean>>({})
const runsErrorsByJobId = ref<Record<string, boolean>>({})
const deliveriesByRunId = ref<Record<string, CronJobDeliveryReceipt[]>>({})
const deliveryErrorsByRunId = ref<Record<string, boolean>>({})
const remoteDeliveryOptions = ref<RemoteDeliveryOption[]>([])
const remoteDeliveryLoading = ref(false)
const remoteDeliveryLoadFailed = ref(false)
const schedulerStatusStale = ref(false)
const pendingDeleteJobId = ref<string | null>(null)
const autoSelectionApplied = ref(false)

let schedulerStatusTimer: number | null = null
let schedulerStatusGeneration = 0
let schedulerStatusRequestPending = false
let schedulerStatusFailureCount = 0
let previewGeneration = 0
let previewTimer: number | null = null
let disposed = false
let requestGenerationSequence = 0
const persistedJobs = new Map<string, CronJob>()
const runsRequestGenerations = new Map<string, number>()
const deliveryRequestGenerations = new Map<string, number>()

const pageOperationPending = computed(() => pendingPageOperationId.value !== null)
const isLoading = computed(() => pendingPageOperationId.value === operationIds.load)
const isSaving = computed(() => pendingPageOperationId.value === operationIds.save)
const persistentMutationPending = computed(
  () =>
    pendingPageOperationId.value !== null &&
    persistentOperationIds.has(pendingPageOperationId.value)
)
const loadUnavailable = computed(() => !hasLoaded.value && !isLoading.value)
const deleting = computed(() => pendingPageOperationId.value === operationIds.delete)
const runtimeActionPending = computed(() => runningId.value !== null || restartingScheduler.value)
const narrowLayout = computed(
  () => containerWidth.value > 0 && containerWidth.value < NARROW_LAYOUT_BREAKPOINT
)
const selectedJob = computed(() => jobs.value.find((job) => job.id === selectedJobId.value) ?? null)
const editorJobId = computed(() => (mode.value === 'view' ? null : selectedJobId.value))
const hasDraftChanges = computed(() => {
  const current = draft.value
  const baseline = baselineDraft.value
  if (!current || !baseline) {
    return false
  }
  return DIRTY_COMPARE_FIELDS.some(
    (field) => JSON.stringify(current[field]) !== JSON.stringify(baseline[field])
  )
})
const pendingDeleteJob = computed(
  () => jobs.value.find((job) => job.id === pendingDeleteJobId.value) ?? null
)
const deleteDialogOpen = computed({
  get: () => pendingDeleteJobId.value !== null,
  set: (open: boolean) => {
    if (open || pageOperationPending.value) {
      return
    }
    pendingDeleteJobId.value = null
  }
})
const enabledJobCount = computed(() => jobs.value.filter((job) => job.enabled).length)
const enabledAgents = computed(() =>
  agents.value
    .filter((agent) => agent.enabled)
    .sort((left, right) => left.name.localeCompare(right.name))
)
const agentNames = computed(() => {
  const names: Record<string, string> = {}
  for (const agent of agents.value) {
    names[agent.id] = agent.name
  }
  return names
})
const latestRuns = computed(() => {
  const entries: Record<string, CronJobRun | undefined> = {}
  for (const [jobId, runs] of Object.entries(runsByJobId.value)) {
    entries[jobId] = runs[0]
  }
  return entries
})
const selectedJobRuns = computed(() =>
  selectedJobId.value ? (runsByJobId.value[selectedJobId.value] ?? []) : []
)
const selectedJobLatestRun = computed(() => selectedJobRuns.value[0] ?? null)
const selectedJobRunsLoading = computed(() =>
  selectedJobId.value ? runsLoadingByJobId.value[selectedJobId.value] === true : false
)
const selectedJobRunsError = computed(() =>
  selectedJobId.value ? runsErrorsByJobId.value[selectedJobId.value] === true : false
)
const selectedJobLatestRunDeliveries = computed(() =>
  selectedJobLatestRun.value ? (deliveriesByRunId.value[selectedJobLatestRun.value.id] ?? []) : []
)
const selectedJobLatestRunDeliveryError = computed(() =>
  selectedJobLatestRun.value
    ? deliveryErrorsByRunId.value[selectedJobLatestRun.value.id] === true
    : false
)
const showDetailPane = computed(
  () =>
    !narrowLayout.value ||
    mode.value !== 'view' ||
    Boolean(selectedJobId.value) ||
    jobs.value.length === 0
)
const showListPane = computed(
  () =>
    !narrowLayout.value || (mode.value === 'view' && jobs.value.length > 0 && !selectedJobId.value)
)
const schedulerBadgeVariant = computed(() => {
  switch (schedulerStatus.value?.state) {
    case 'running':
      return 'default'
    case 'error':
      return 'destructive'
    case 'idle':
      return 'secondary'
    default:
      return 'outline'
  }
})
const schedulerTrouble = computed(
  () => schedulerStatusStale.value || schedulerStatus.value?.state === 'error'
)
const schedulerTroubleMessage = computed(() =>
  schedulerStatusStale.value
    ? t('settings.cronJobs.scheduler.staleDescription')
    : t('settings.cronJobs.scheduler.errorDescription')
)

const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || CRON_JOBS_DEFAULT_TIMEZONE
  } catch {
    return CRON_JOBS_DEFAULT_TIMEZONE
  }
}

const getSupportedTimezones = (): string[] => {
  try {
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf
    return supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
}

const baseTimezoneOptions = getSupportedTimezones()
const timezoneOptions = computed(() =>
  Array.from(
    new Set([
      CRON_JOBS_DEFAULT_TIMEZONE,
      browserTimezone(),
      ...baseTimezoneOptions,
      ...jobs.value.map((job) => job.timezone).filter(Boolean),
      ...(draft.value ? [draft.value.timezone] : [])
    ])
  ).sort()
)

const sortJobs = (items: CronJob[]) =>
  items
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))

const clonePlainValue = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') {
    return value
  }
  const raw = toRaw(value)
  if (raw instanceof Date) {
    return new Date(raw.getTime()) as T
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => clonePlainValue(item)) as T
  }
  const clone: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(raw)) {
    clone[key] = clonePlainValue(nestedValue)
  }
  return clone as T
}

const cloneJob = (job: CronJob): CronJob => clonePlainValue(job)

const createDefaultDelivery = (): CronJobDelivery => ({
  targets: [],
  suppressSuccessNotification: CRON_JOBS_DEFAULT_DELIVERY.suppressSuccessNotification,
  notifyOnFailure: CRON_JOBS_DEFAULT_DELIVERY.notifyOnFailure
})

const logFailure = (
  scope: string,
  error: unknown,
  context: Readonly<Record<string, unknown>> = {}
) => {
  console.error(`[CronJobsSettings] ${scope}`, { ...context }, error)
}

const failPageOperation = (scope: string, code: string, error: unknown, description?: string) => {
  logFailure(scope, error)
  notifyRenderer({
    kind: 'error',
    code,
    title: t('common.error.operationFailed'),
    description
  })
}

const beginPageOperation = (operationId: string): boolean => {
  if (pageOperationPending.value) {
    return false
  }
  schedulerStatusGeneration += 1
  pendingPageOperationId.value = operationId
  return true
}

const setSchedulerStatus = (status: CronJobsSchedulerStatus) => {
  schedulerStatusGeneration += 1
  schedulerStatusFailureCount = 0
  schedulerStatus.value = status
  schedulerStatusStale.value = false
}

const applyPersistedJob = (job: CronJob) => {
  const canonicalJob = cloneJob(job)
  const existingIndex = jobs.value.findIndex((entry) => entry.id === job.id)
  const next =
    existingIndex >= 0
      ? jobs.value.map((entry) => (entry.id === job.id ? canonicalJob : entry))
      : [...jobs.value, canonicalJob]
  jobs.value = sortJobs(next)
  persistedJobs.set(job.id, cloneJob(canonicalJob))
}

const focusEditorNameInput = async () => {
  await nextTick()
  const input = rootRef.value?.querySelector<HTMLInputElement>(
    '[data-testid="cron-job-name-input"]'
  )
  input?.focus()
}

const loadRemoteDeliveryOptions = async (): Promise<RemoteDeliveryOption[] | null> => {
  remoteDeliveryLoading.value = true
  try {
    const descriptors = await remoteControlClient.listRemoteChannels()
    const groups = await Promise.all(
      descriptors
        .filter((descriptor) => descriptor.supportsCronDelivery)
        .map(async (descriptor) => {
          const status = await remoteControlClient.getChannelStatus(descriptor.id)
          if (!status.enabled) {
            return []
          }
          const bindings = await remoteControlClient.getChannelBindings(descriptor.id)
          return bindings.map((binding) => ({
            value: binding.endpointKey,
            channel: descriptor.id,
            titleKey: descriptor.titleKey,
            endpointKey: binding.endpointKey,
            binding
          }))
        })
    )
    return groups
      .flat()
      .sort(
        (left, right) =>
          left.channel.localeCompare(right.channel) ||
          right.binding.updatedAt - left.binding.updatedAt
      )
  } catch (error) {
    logFailure('Failed to load remote delivery options', error)
    remoteDeliveryLoadFailed.value = true
    return null
  } finally {
    remoteDeliveryLoading.value = false
  }
}

const refreshRemoteDeliveryOptions = async () => {
  if (remoteDeliveryLoading.value) {
    return
  }
  const options = await loadRemoteDeliveryOptions()
  if (options !== null) {
    remoteDeliveryOptions.value = options
    remoteDeliveryLoadFailed.value = false
  }
}

const applyAutoSelection = () => {
  if (autoSelectionApplied.value || narrowLayout.value) {
    return
  }
  autoSelectionApplied.value = true
  const firstJob = jobs.value[0]
  if (firstJob) {
    activateJob(firstJob.id)
  }
}

const loadJobs = async () => {
  loadAttempted.value = true
  if (!beginPageOperation(operationIds.load)) {
    return
  }
  try {
    const [response, nextAgents, nextRemoteDeliveryOptions] = await Promise.all([
      client.list(),
      configClient.listAgents(),
      loadRemoteDeliveryOptions()
    ])
    const nextJobs = sortJobs(response.jobs.map(cloneJob))
    jobs.value = nextJobs
    persistedJobs.clear()
    for (const job of nextJobs) {
      persistedJobs.set(job.id, cloneJob(job))
    }
    agents.value = nextAgents
    if (nextRemoteDeliveryOptions !== null) {
      remoteDeliveryOptions.value = nextRemoteDeliveryOptions
      remoteDeliveryLoadFailed.value = false
    }
    setSchedulerStatus(response.schedulerStatus)
    hasLoaded.value = true
    for (const job of jobs.value) {
      void refreshJobRuns(job.id, LIST_RUN_LIMIT)
    }
    applyAutoSelection()
  } catch (error) {
    failPageOperation(
      'Failed to load jobs',
      'settings.cronJobs.loadFailed',
      error,
      t('common.error.requestFailed')
    )
  } finally {
    pendingPageOperationId.value = null
  }
}

const refreshSchedulerStatus = async () => {
  if (disposed || schedulerStatusRequestPending || pageOperationPending.value || !hasLoaded.value) {
    return
  }
  const requestGeneration = ++schedulerStatusGeneration
  schedulerStatusRequestPending = true
  try {
    const previousNextRunAt = schedulerStatus.value?.nextRunAt ?? null
    const nextStatus = await client.getSchedulerStatus()
    if (disposed || requestGeneration !== schedulerStatusGeneration) {
      return
    }
    schedulerStatus.value = nextStatus
    schedulerStatusFailureCount = 0
    schedulerStatusStale.value = false
    if (nextStatus.nextRunAt !== previousNextRunAt) {
      refreshVisibleJobRuns()
    } else {
      for (const job of jobs.value) {
        const status = runsByJobId.value[job.id]?.[0]?.status
        if (status === 'queued' || status === 'running') {
          void refreshJobRuns(job.id, runsLimitFor(job.id), true)
        }
      }
    }
  } catch (error) {
    if (requestGeneration === schedulerStatusGeneration && !disposed) {
      schedulerStatusFailureCount += 1
      if (
        schedulerStatusFailureCount === 1 ||
        schedulerStatusFailureCount === SCHEDULER_STATUS_FAILURE_THRESHOLD
      ) {
        logFailure('Failed to refresh scheduler status', error, {
          consecutiveFailures: schedulerStatusFailureCount
        })
      }
      schedulerStatusStale.value = schedulerStatusFailureCount >= SCHEDULER_STATUS_FAILURE_THRESHOLD
    }
  } finally {
    schedulerStatusRequestPending = false
  }
}

const startSchedulerStatusPolling = () => {
  stopSchedulerStatusPolling()
  schedulerStatusTimer = window.setInterval(() => {
    void refreshSchedulerStatus()
  }, SCHEDULER_STATUS_REFRESH_MS)
}

const stopSchedulerStatusPolling = () => {
  if (!schedulerStatusTimer) {
    return
  }
  window.clearInterval(schedulerStatusTimer)
  schedulerStatusTimer = null
}

const runsLimitFor = (jobId: string): number =>
  jobId === selectedJobId.value ? RUN_HISTORY_LIMIT : LIST_RUN_LIMIT

const refreshVisibleJobRuns = () => {
  for (const job of jobs.value) {
    void refreshJobRuns(job.id, runsLimitFor(job.id), true)
  }
}

const clearRunDeliveryState = (runId: string) => {
  deliveryRequestGenerations.delete(runId)
  if (Object.hasOwn(deliveriesByRunId.value, runId)) {
    const nextDeliveries = { ...deliveriesByRunId.value }
    delete nextDeliveries[runId]
    deliveriesByRunId.value = nextDeliveries
  }
  if (Object.hasOwn(deliveryErrorsByRunId.value, runId)) {
    const nextErrors = { ...deliveryErrorsByRunId.value }
    delete nextErrors[runId]
    deliveryErrorsByRunId.value = nextErrors
  }
}

const refreshRunDeliveries = async (runId: string) => {
  const requestGeneration = ++requestGenerationSequence
  deliveryRequestGenerations.set(runId, requestGeneration)
  try {
    const deliveries = await client.listDeliveries(runId)
    if (disposed || deliveryRequestGenerations.get(runId) !== requestGeneration) {
      return
    }
    deliveriesByRunId.value = {
      ...deliveriesByRunId.value,
      [runId]: deliveries
    }
    deliveryErrorsByRunId.value = {
      ...deliveryErrorsByRunId.value,
      [runId]: false
    }
  } catch (error) {
    if (!disposed && deliveryRequestGenerations.get(runId) === requestGeneration) {
      logFailure('Failed to load deliveries', error, { runId })
      deliveryErrorsByRunId.value = {
        ...deliveryErrorsByRunId.value,
        [runId]: true
      }
    }
  }
}

const replaceJobRuns = (jobId: string, runs: CronJobRun[]) => {
  const previousLatestRunId = runsByJobId.value[jobId]?.[0]?.id
  if (previousLatestRunId && previousLatestRunId !== runs[0]?.id) {
    clearRunDeliveryState(previousLatestRunId)
  }
  runsByJobId.value = {
    ...runsByJobId.value,
    [jobId]: runs
  }
}

const refreshJobRuns = async (jobId: string, limit: number, silent = false) => {
  const requestGeneration = ++requestGenerationSequence
  runsRequestGenerations.set(jobId, requestGeneration)
  if (!silent) {
    runsLoadingByJobId.value = {
      ...runsLoadingByJobId.value,
      [jobId]: true
    }
  }
  try {
    const runs = await client.listRuns(jobId, limit)
    if (disposed || runsRequestGenerations.get(jobId) !== requestGeneration) {
      return
    }
    replaceJobRuns(jobId, runs)
    runsErrorsByJobId.value = {
      ...runsErrorsByJobId.value,
      [jobId]: false
    }
    if (runs[0]) {
      void refreshRunDeliveries(runs[0].id)
    }
  } catch (error) {
    if (!disposed && runsRequestGenerations.get(jobId) === requestGeneration) {
      logFailure('Failed to load runs', error, { jobId })
      runsErrorsByJobId.value = {
        ...runsErrorsByJobId.value,
        [jobId]: true
      }
    }
  } finally {
    if (!silent && !disposed && runsRequestGenerations.get(jobId) === requestGeneration) {
      runsLoadingByJobId.value = {
        ...runsLoadingByJobId.value,
        [jobId]: false
      }
    }
  }
}

const reloadSelectedJobRuns = () => {
  if (!selectedJobId.value) {
    return
  }
  void refreshJobRuns(selectedJobId.value, RUN_HISTORY_LIMIT)
}

const refreshDraftPreview = async () => {
  const current = draft.value
  if (!current) {
    return
  }
  const requestGeneration = ++previewGeneration
  previewLoading.value = true
  try {
    const response = await client.previewSchedule({
      cronExpr: current.cronExpr || CRON_JOBS_DEFAULT_CRON_EXPR,
      timezone: current.timezone || browserTimezone(),
      count: 5
    })
    if (disposed || requestGeneration !== previewGeneration) {
      return
    }
    previewRuns.value = response.runs
    previewError.value = response.error
  } catch (error) {
    if (!disposed && requestGeneration === previewGeneration) {
      logFailure('Failed to preview schedule', error, { jobId: current.id })
      previewError.value = t('common.error.requestFailed')
    }
  } finally {
    if (!disposed && requestGeneration === previewGeneration) {
      previewLoading.value = false
    }
  }
}

const scheduleDraftPreview = () => {
  if (previewTimer !== null) {
    window.clearTimeout(previewTimer)
  }
  if (!draft.value) {
    previewRuns.value = []
    previewError.value = null
    previewLoading.value = false
    return
  }
  previewTimer = window.setTimeout(() => {
    previewTimer = null
    void refreshDraftPreview()
  }, PREVIEW_DEBOUNCE_MS)
}

const resetPreviewState = () => {
  if (previewTimer !== null) {
    window.clearTimeout(previewTimer)
    previewTimer = null
  }
  previewGeneration += 1
  previewRuns.value = []
  previewError.value = null
  previewLoading.value = false
}

const closeEditor = () => {
  mode.value = 'view'
  draft.value = null
  baselineDraft.value = null
  resetPreviewState()
}

const activateJob = (jobId: string) => {
  selectedJobId.value = jobId
  closeEditor()
  void refreshJobRuns(jobId, RUN_HISTORY_LIMIT)
}

const selectJob = async (jobId: string) => {
  if (jobId === selectedJobId.value) {
    if (mode.value !== 'view' && (await settingsLeaveGuard.requestLeave())) {
      discardDraft()
    }
    return
  }
  if (mode.value !== 'view' && !(await settingsLeaveGuard.requestLeave())) {
    return
  }
  activateJob(jobId)
}

const startCreate = async (template?: CronJobTemplate) => {
  if (pageOperationPending.value || runtimeActionPending.value) {
    return
  }
  if (mode.value !== 'view' && !(await settingsLeaveGuard.requestLeave())) {
    return
  }
  const nextDraft: CronJob = {
    id: '',
    name: template ? t(template.nameKey) : t('settings.cronJobs.defaults.name'),
    description: null,
    enabled: false,
    status: 'disabled',
    cronExpr: template?.cronExpr ?? CRON_JOBS_DEFAULT_CRON_EXPR,
    timezone: browserTimezone(),
    agentId: enabledAgents.value[0]?.id ?? null,
    nextRunAt: null,
    misfirePolicy: CRON_JOBS_DEFAULT_MISFIRE_POLICY,
    maxCatchUpRuns: null,
    scheduleError: null,
    taskPrompt: template ? t(template.promptKey) : '',
    taskSystemInstruction: null,
    taskOutputMode: 'final_message',
    modelPolicy: 'follow_agent',
    toolPolicy: 'follow_agent',
    permissionPolicy: 'follow_agent',
    runtime: { ...CRON_JOBS_DEFAULT_RUNTIME },
    agentSnapshot: null,
    delivery: createDefaultDelivery(),
    createdAt: 0,
    updatedAt: 0
  }
  draft.value = nextDraft
  baselineDraft.value = cloneJob(nextDraft)
  mode.value = 'create'
  resetPreviewState()
  scheduleDraftPreview()
  await focusEditorNameInput()
}

const startEdit = async (jobId?: string) => {
  const target = jobId ? (jobs.value.find((job) => job.id === jobId) ?? null) : selectedJob.value
  if (!target || pageOperationPending.value || runtimeActionPending.value) {
    return
  }
  if (mode.value !== 'view' && !(await settingsLeaveGuard.requestLeave())) {
    return
  }
  if (target.id !== selectedJobId.value) {
    selectedJobId.value = target.id
    void refreshJobRuns(target.id, RUN_HISTORY_LIMIT)
  }
  draft.value = cloneJob(target)
  baselineDraft.value = cloneJob(target)
  mode.value = 'edit'
  resetPreviewState()
  scheduleDraftPreview()
  await focusEditorNameInput()
}

const discardDraft = () => {
  if (mode.value === 'create') {
    closeEditor()
    return
  }
  if (mode.value !== 'edit') {
    return
  }
  const persisted = selectedJobId.value ? persistedJobs.get(selectedJobId.value) : undefined
  if (!persisted) {
    closeEditor()
    return
  }
  const restored = cloneJob(persisted)
  draft.value = restored
  baselineDraft.value = cloneJob(restored)
  resetPreviewState()
  scheduleDraftPreview()
}

const cancelEdit = async () => {
  if (mode.value === 'view') {
    return
  }
  if (!(await settingsLeaveGuard.requestLeave())) {
    return
  }
  closeEditor()
}

const backToList = async () => {
  if (mode.value !== 'view' && !(await settingsLeaveGuard.requestLeave())) {
    return
  }
  discardDraft()
  selectedJobId.value = null
  mode.value = 'view'
}

const buildUpsertPayload = (job: CronJob): CronJobsUpsertInput => ({
  ...(job.id ? { id: job.id } : {}),
  name: job.name.trim() || t('settings.cronJobs.defaults.name'),
  enabled: job.enabled,
  cronExpr: job.cronExpr || CRON_JOBS_DEFAULT_CRON_EXPR,
  timezone: job.timezone || browserTimezone(),
  agentId: job.agentId,
  misfirePolicy: job.misfirePolicy,
  maxCatchUpRuns: job.maxCatchUpRuns,
  taskPrompt: job.taskPrompt,
  taskSystemInstruction: job.taskSystemInstruction,
  taskOutputMode: job.taskOutputMode,
  modelPolicy: job.modelPolicy,
  toolPolicy: job.toolPolicy,
  permissionPolicy: job.permissionPolicy,
  runtime: job.runtime,
  delivery: job.delivery
})

const saveDraft = async () => {
  const current = draft.value
  if (!current || !current.name.trim() || pageOperationPending.value) {
    return
  }
  if (!beginPageOperation(operationIds.save)) {
    return
  }
  const isCreate = mode.value === 'create'
  try {
    const response = await client.upsert(buildUpsertPayload(current))
    applyPersistedJob(response.job)
    setSchedulerStatus(response.schedulerStatus)
    selectedJobId.value = response.job.id
    closeEditor()
    void refreshJobRuns(response.job.id, RUN_HISTORY_LIMIT)
    notifyRenderer({
      kind: 'success',
      code: isCreate ? 'settings.cronJobs.created' : 'settings.cronJobs.saved',
      title: isCreate ? t('settings.cronJobs.created') : t('common.saved')
    })
  } catch (error) {
    failPageOperation(
      isCreate ? 'Failed to create job' : 'Failed to save job',
      'settings.cronJobs.saveFailed',
      error
    )
  } finally {
    pendingPageOperationId.value = null
  }
}

const toggleJob = async (jobId: string, enabled: boolean) => {
  if (pageOperationPending.value || runtimeActionPending.value) {
    return
  }
  if (mode.value !== 'view' && selectedJobId.value === jobId) {
    return
  }
  if (!beginPageOperation(operationIds.toggle)) {
    return
  }
  try {
    const response = await client.toggle(jobId, enabled)
    applyPersistedJob(response.job)
    setSchedulerStatus(response.schedulerStatus)
  } catch (error) {
    failPageOperation('Failed to toggle job', 'settings.cronJobs.toggleFailed', error)
  } finally {
    pendingPageOperationId.value = null
  }
}

const requestDeleteJob = (jobId: string) => {
  if (pageOperationPending.value || runtimeActionPending.value) {
    return
  }
  if (!jobs.value.some((job) => job.id === jobId)) {
    return
  }
  pendingDeleteJobId.value = jobId
}

const removeJobState = (jobId: string) => {
  jobs.value = jobs.value.filter((job) => job.id !== jobId)
  persistedJobs.delete(jobId)
  runsRequestGenerations.delete(jobId)
  for (const run of runsByJobId.value[jobId] ?? []) {
    clearRunDeliveryState(run.id)
  }

  const nextRuns = { ...runsByJobId.value }
  const nextRunsLoading = { ...runsLoadingByJobId.value }
  const nextRunsErrors = { ...runsErrorsByJobId.value }
  delete nextRuns[jobId]
  delete nextRunsLoading[jobId]
  delete nextRunsErrors[jobId]
  runsByJobId.value = nextRuns
  runsLoadingByJobId.value = nextRunsLoading
  runsErrorsByJobId.value = nextRunsErrors
}

const clearEditorState = () => {
  selectedJobId.value = null
  closeEditor()
}

const confirmDeleteJob = async () => {
  const jobId = pendingDeleteJobId.value
  if (!jobId || !beginPageOperation(operationIds.delete)) {
    return
  }
  try {
    setSchedulerStatus(await client.remove(jobId))
    removeJobState(jobId)
    if (selectedJobId.value === jobId) {
      clearEditorState()
    }
    pendingDeleteJobId.value = null
  } catch (error) {
    failPageOperation('Failed to delete job', 'settings.cronJobs.deleteFailed', error)
  } finally {
    pendingPageOperationId.value = null
  }
}

const runJobNow = async (jobId: string) => {
  if (pageOperationPending.value || runtimeActionPending.value) {
    return
  }
  if (mode.value !== 'view' && selectedJobId.value === jobId) {
    return
  }
  const opener = document.activeElement as HTMLElement | null
  runsRequestGenerations.set(jobId, ++requestGenerationSequence)
  runningId.value = jobId
  try {
    const response = await client.runNow(jobId)
    applyPersistedJob(response.job)
    runsRequestGenerations.set(jobId, ++requestGenerationSequence)
    replaceJobRuns(
      jobId,
      [
        response.run,
        ...(runsByJobId.value[jobId] ?? []).filter((run) => run.id !== response.run.id)
      ].slice(0, RUN_HISTORY_LIMIT)
    )
    runsErrorsByJobId.value = {
      ...runsErrorsByJobId.value,
      [jobId]: false
    }
    void refreshRunDeliveries(response.run.id)
    setSchedulerStatus(response.schedulerStatus)
    if (response.run.status === 'failed' || response.run.status === 'cancelled') {
      notifyRenderer({
        kind: 'error',
        code: 'settings.cronJobs.runFailed',
        title: t('common.error.operationFailed')
      })
      return
    }
    notifyRenderer({
      kind: 'success',
      code:
        response.run.status === 'completed'
          ? 'settings.cronJobs.runCompleted'
          : 'settings.cronJobs.runStarted',
      title:
        response.run.status === 'completed'
          ? t('settings.cronJobs.runNowSuccess')
          : t('settings.cronJobs.actions.runNow'),
      description: response.job.name
    })
  } catch (error) {
    logFailure('Failed to run job', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.cronJobs.runFailed',
      title: t('common.error.operationFailed')
    })
  } finally {
    if (runningId.value === jobId) {
      runningId.value = null
    }
    await nextTick()
    if (
      opener?.isConnected &&
      (document.activeElement === document.body || document.activeElement === opener)
    ) {
      opener.focus({ preventScroll: true })
    }
  }
}

const editJob = (jobId: string) => {
  void startEdit(jobId)
}

const deleteSelectedJob = () => {
  if (selectedJobId.value) {
    requestDeleteJob(selectedJobId.value)
  }
}

const runSelectedJobNow = () => {
  if (selectedJobId.value) {
    void runJobNow(selectedJobId.value)
  }
}

const toggleSelectedJob = (enabled: boolean) => {
  if (selectedJobId.value) {
    void toggleJob(selectedJobId.value, enabled)
  }
}

const restartScheduler = async () => {
  if (runtimeActionPending.value || pageOperationPending.value) {
    return
  }
  restartingScheduler.value = true
  try {
    setSchedulerStatus(await client.restartScheduler())
  } catch (error) {
    logFailure('Failed to restart scheduler', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.cronJobs.restartFailed',
      title: t('common.error.operationFailed')
    })
  } finally {
    restartingScheduler.value = false
  }
}

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'settings-cron-jobs',
  onDiscard: discardDraft
})
const stopLeaveRiskSync = watch(
  [persistentMutationPending, hasDraftChanges],
  ([busy, dirty]) => {
    leaveGuardLease.setRisk(busy ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)
const stopDraftPreviewSync = watch(
  () => (draft.value ? `${draft.value.cronExpr}@${draft.value.timezone}` : null),
  () => scheduleDraftPreview()
)

onMounted(() => {
  void loadJobs()
  startSchedulerStatusPolling()
})

onBeforeUnmount(() => {
  disposed = true
  schedulerStatusGeneration += 1
  previewGeneration += 1
  if (previewTimer !== null) {
    window.clearTimeout(previewTimer)
    previewTimer = null
  }
  stopSchedulerStatusPolling()
  stopLeaveRiskSync()
  stopDraftPreviewSync()
  leaveGuardLease.release()
})
</script>
