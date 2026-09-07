<template>
  <SettingsPageShell
    data-testid="settings-cron-jobs-page"
    sticky-header
    :title="t('settings.cronJobs.title')"
    :eyebrow="t('settings.controlCenter.groups.tools')"
    :description="t('settings.cronJobs.description')"
  >
    <template #actions>
      <DcButton
        variant="outline"
        size="sm"
        :disabled="isLoading || pageOperationPending || runtimeActionPending || hasDirtyJobs"
        @click="restartScheduler"
      >
        <Spinner v-if="restartingScheduler" class="mr-1 h-4 w-4" />
        <Icon v-else icon="lucide:rotate-cw" class="mr-1 h-4 w-4" />
        {{ t('settings.cronJobs.actions.restart') }}
      </DcButton>
      <DcButton
        data-testid="cron-jobs-add"
        size="sm"
        :disabled="isLoading || pageOperationPending || runtimeActionPending || hasDirtyJobs"
        @click="addJob"
      >
        <Icon icon="lucide:plus" class="mr-1 h-4 w-4" />
        {{ t('settings.cronJobs.actions.newJob') }}
      </DcButton>
    </template>

    <div v-if="isLoading || !loadAttempted" class="text-sm text-muted-foreground">
      {{ t('common.loading') }}
    </div>

    <div
      v-else-if="loadUnavailable"
      role="alert"
      class="flex max-w-5xl items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4"
    >
      <span class="text-sm text-destructive">{{ t('common.error.operationFailed') }}</span>
      <DcButton size="sm" variant="outline" :disabled="isLoading" @click="loadJobs">
        {{ t('common.retry') }}
      </DcButton>
    </div>

    <template v-else>
      <section class="grid max-w-5xl gap-3 rounded-lg border bg-card/30 p-4 md:grid-cols-4">
        <div class="min-w-0">
          <div class="text-xs text-muted-foreground">{{ t('settings.cronJobs.status.state') }}</div>
          <div class="mt-1 flex items-center gap-2">
            <DcBadge :variant="schedulerBadgeVariant">
              {{ t(`settings.cronJobs.status.${schedulerStatus?.state ?? 'stopped'}`) }}
            </DcBadge>
            <span class="truncate text-xs text-muted-foreground">
              {{
                schedulerStatus?.pid ? `PID ${schedulerStatus.pid}` : t('settings.cronJobs.none')
              }}
            </span>
          </div>
        </div>
        <div class="min-w-0">
          <div class="text-xs text-muted-foreground">
            {{ t('settings.cronJobs.status.enabled') }}
          </div>
          <div class="mt-1 text-sm font-medium">
            {{ schedulerStatus?.enabledJobCount ?? enabledJobCount }}
          </div>
        </div>
        <div class="min-w-0">
          <div class="text-xs text-muted-foreground">{{ t('settings.cronJobs.nextRunAt') }}</div>
          <div class="mt-1 truncate text-sm font-medium">
            {{ formatTimestamp(schedulerStatus?.nextRunAt ?? null) }}
          </div>
        </div>
        <div class="min-w-0">
          <div class="text-xs text-muted-foreground">
            {{ t('settings.cronJobs.status.heartbeat') }}
          </div>
          <div class="mt-1 truncate text-sm font-medium">
            {{ formatTimestamp(schedulerStatus?.lastHeartbeatAt ?? null) }}
          </div>
        </div>
      </section>
      <div
        v-if="schedulerStatusStale || schedulerStatus?.lastError"
        role="status"
        class="max-w-5xl rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
      >
        {{
          schedulerStatusStale ? t('common.error.requestFailed') : t('common.error.operationFailed')
        }}
      </div>
      <div
        v-if="remoteDeliveryLoadFailed"
        role="status"
        class="flex max-w-5xl items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
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

      <div
        v-if="jobs.length === 0"
        class="flex max-w-5xl flex-col items-center gap-3 rounded-lg border border-dashed bg-card/30 px-6 py-12 text-center"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <Icon icon="lucide:calendar-clock" class="h-5 w-5" />
        </div>
        <div class="text-sm font-medium">{{ t('settings.cronJobs.empty') }}</div>
        <DcButton
          variant="outline"
          size="sm"
          :disabled="pageOperationPending || hasDirtyJobs"
          @click="addJob"
        >
          <Icon icon="lucide:plus" class="mr-1 h-4 w-4" />
          {{ t('settings.cronJobs.actions.newJob') }}
        </DcButton>
      </div>

      <div v-else class="max-w-5xl overflow-hidden rounded-lg border bg-card/30">
        <div v-for="(job, index) in jobs" :key="job.id" class="border-b p-4 last:border-b-0">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary"
            >
              {{ index + 1 }}
            </div>
            <div class="grid min-w-0 flex-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div class="min-w-0 space-y-1.5 md:col-span-2 xl:col-span-1">
                <Label class="text-xs text-muted-foreground">
                  {{ t('settings.cronJobs.fields.name') }}
                </Label>
                <Input
                  :model-value="job.name"
                  :disabled="jobInteractionDisabled(job.id)"
                  class="h-8!"
                  @update:model-value="(value) => updateJobField(job.id, 'name', String(value))"
                  @blur="commitJob(job.id)"
                />
              </div>
              <div class="min-w-0 space-y-1.5">
                <Label class="text-xs text-muted-foreground">
                  {{ t('settings.cronJobs.fields.agent') }}
                </Label>
                <Select
                  :model-value="job.agentId ?? NO_AGENT_ID"
                  :disabled="jobInteractionDisabled(job.id)"
                  @update:model-value="(value) => updateAgentSelection(job.id, String(value))"
                >
                  <SelectTrigger class="h-8! w-full min-w-0">
                    <SelectValue class="min-w-0 truncate" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem :value="NO_AGENT_ID">
                      {{ t('settings.cronJobs.fields.noAgent') }}
                    </SelectItem>
                    <SelectItem v-for="agent in enabledAgents" :key="agent.id" :value="agent.id">
                      {{ agent.name }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="min-w-0 space-y-1.5">
                <Label class="text-xs text-muted-foreground">
                  {{ t('settings.cronJobs.fields.timezone') }}
                </Label>
                <Select
                  :model-value="job.timezone || getBrowserTimezone()"
                  :disabled="jobInteractionDisabled(job.id)"
                  @update:model-value="(value) => updateTimezone(job.id, String(value))"
                >
                  <SelectTrigger class="h-8! w-full min-w-0">
                    <SelectValue class="min-w-0 truncate" />
                  </SelectTrigger>
                  <SelectContent class="max-h-72">
                    <SelectItem
                      v-for="timezone in timezoneOptions"
                      :key="timezone"
                      :value="timezone"
                    >
                      {{ timezone }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1 lg:pt-6">
              <Switch
                :model-value="job.enabled"
                :disabled="jobInteractionDisabled(job.id)"
                :aria-label="job.enabled ? t('common.enabled') : t('common.disabled')"
                @update:model-value="(value) => toggleJob(job.id, value === true)"
              />
              <DcButton
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                :disabled="jobInteractionDisabled(job.id)"
                :title="t('settings.cronJobs.actions.runNow')"
                @click="runJobNow(job.id)"
              >
                <Spinner v-if="runningId === job.id" class="size-4" />
                <Icon v-else icon="lucide:play" class="size-4" />
              </DcButton>
              <DcButton
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                :disabled="jobInteractionDisabled(job.id)"
                :aria-label="t('common.delete')"
                :tooltip="t('common.delete')"
                @click="requestDeleteJob(job.id)"
              >
                <Icon icon="lucide:trash-2" class="h-4 w-4 text-destructive" />
              </DcButton>
            </div>
          </div>

          <div class="mt-3 space-y-1.5 lg:pl-11">
            <Label class="text-xs text-muted-foreground">
              {{ t('settings.cronJobs.fields.cronExpr') }}
            </Label>
            <Input
              :model-value="job.cronExpr"
              :disabled="jobInteractionDisabled(job.id)"
              class="h-8! max-w-xl font-mono text-xs"
              @update:model-value="(value) => updateJobField(job.id, 'cronExpr', String(value))"
              @blur="commitJob(job.id)"
            />
            <div class="flex flex-wrap gap-1.5">
              <DcBadge
                v-for="example in CRON_REFERENCE_EXAMPLES"
                :key="example.cronExpr"
                variant="outline"
                class="gap-1.5 px-1.5 py-0.5 font-normal"
              >
                <code class="font-mono text-[11px]">{{ example.cronExpr }}</code>
                <span class="text-[11px] text-muted-foreground">
                  {{ t(example.labelKey) }}
                </span>
              </DcBadge>
            </div>
          </div>

          <div class="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px] lg:pl-11">
            <div class="space-y-1.5">
              <Label class="text-xs text-muted-foreground">
                {{ t('settings.cronJobs.fields.taskPrompt') }}
              </Label>
              <Textarea
                :model-value="job.taskPrompt"
                :disabled="jobInteractionDisabled(job.id)"
                class="max-h-[13.5rem] min-h-[72px] resize-none overflow-y-auto text-sm"
                @update:model-value="(value) => updateJobField(job.id, 'taskPrompt', String(value))"
                @blur="commitJob(job.id)"
              />
            </div>
            <div class="space-y-1.5">
              <Label class="text-xs text-muted-foreground">
                {{ t('settings.cronJobs.fields.runtimePolicy') }}
              </Label>
              <Select
                :model-value="getRuntimePolicy(job)"
                :disabled="pageOperationPending"
                @update:model-value="(value) => updateRuntimePolicy(job.id, String(value))"
              >
                <SelectTrigger class="h-8! w-full min-w-0">
                  <SelectValue class="min-w-0 truncate" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="follow_agent">
                    {{ t('settings.cronJobs.fields.followAgent') }}
                  </SelectItem>
                  <SelectItem value="snapshot">
                    {{ t('settings.cronJobs.fields.pinCurrent') }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 lg:pl-11">
            <div class="flex items-center gap-2">
              <Icon icon="lucide:send" class="h-4 w-4 text-muted-foreground" />
              <span class="text-xs text-muted-foreground">
                {{ t('settings.cronJobs.fields.delivery') }}
              </span>
            </div>
            <label class="flex items-center gap-2 text-xs">
              <Switch
                :model-value="isRemoteDeliveryEnabled(job)"
                :disabled="
                  jobInteractionDisabled(job.id) ||
                  (!isRemoteDeliveryEnabled(job) && remoteDeliveryOptions.length === 0)
                "
                @update:model-value="(value) => updateRemoteDeliveryEnabled(job.id, value === true)"
              />
              <span>{{ t('settings.cronJobs.fields.remoteDelivery') }}</span>
            </label>
            <Select
              :model-value="getRemoteDeliveryValue(job)"
              :disabled="
                !isRemoteDeliveryEnabled(job) ||
                jobInteractionDisabled(job.id) ||
                remoteDeliveryLoading ||
                remoteDeliveryOptions.length === 0
              "
              @update:model-value="(value) => updateRemoteDeliveryTarget(job.id, String(value))"
            >
              <SelectTrigger class="h-8! w-72 max-w-full min-w-0">
                <SelectValue
                  class="min-w-0 truncate"
                  :placeholder="t('settings.cronJobs.fields.remoteChannel')"
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="option in remoteDeliveryOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ getRemoteDeliveryOptionLabel(option) }}
                </SelectItem>
              </SelectContent>
            </Select>
            <span
              v-if="!remoteDeliveryLoadFailed && remoteDeliveryOptions.length === 0"
              class="text-xs text-muted-foreground"
            >
              {{ t('settings.cronJobs.fields.noRemoteChannels') }}
            </span>
          </div>

          <div
            v-if="job.status === 'invalid_agent'"
            class="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {{ t('settings.cronJobs.status.invalidAgent') }}
          </div>
          <div
            v-if="job.scheduleError || previewErrorsByJobId[job.id]"
            class="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {{ job.scheduleError || previewErrorsByJobId[job.id] }}
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-2 lg:pl-11">
            <Icon icon="lucide:calendar-range" class="h-4 w-4 text-muted-foreground" />
            <DcBadge v-if="previewLoadingByJobId[job.id]" variant="outline">
              {{ t('common.loading') }}
            </DcBadge>
            <template v-else-if="previewRunsByJobId[job.id]?.length">
              <DcBadge
                v-for="runAt in previewRunsByJobId[job.id]"
                :key="runAt"
                variant="outline"
                class="font-normal"
              >
                {{ formatTimestamp(runAt) }}
              </DcBadge>
            </template>
            <span v-else class="text-xs text-muted-foreground">
              {{ t('settings.cronJobs.none') }}
            </span>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-2 lg:pl-11">
            <Icon icon="lucide:history" class="h-4 w-4 text-muted-foreground" />
            <span class="text-xs text-muted-foreground">{{ t('common.history') }}</span>
            <DcBadge v-if="runsLoadingByJobId[job.id]" variant="outline">
              {{ t('common.loading') }}
            </DcBadge>
            <template v-else-if="getLatestRun(job.id)">
              <DcBadge variant="outline" class="font-normal">
                {{
                  formatTimestamp(
                    getLatestRun(job.id)?.startedAt ?? getLatestRun(job.id)?.queuedAt ?? null
                  )
                }}
              </DcBadge>
            </template>
            <span v-else-if="!runsErrorsByJobId[job.id]" class="text-xs text-muted-foreground">
              {{ t('settings.cronJobs.none') }}
            </span>
            <span v-if="runsErrorsByJobId[job.id]" class="text-xs text-destructive">
              {{ t('common.error.requestFailed') }}
            </span>
          </div>

          <div
            v-if="getLatestRunDeliveries(job.id).length > 0 || getLatestRunDeliveryError(job.id)"
            class="mt-2 flex flex-wrap items-center gap-2 lg:pl-11"
          >
            <Icon icon="lucide:send" class="h-4 w-4 text-muted-foreground" />
            <span class="text-xs text-muted-foreground">
              {{ t('settings.cronJobs.fields.delivery') }}
            </span>
            <DcBadge
              v-for="receipt in getLatestRunDeliveries(job.id)"
              :key="receipt.id"
              :variant="receipt.status === 'failed' ? 'destructive' : 'secondary'"
              class="font-normal"
            >
              {{ formatDeliveryReceipt(receipt) }}
            </DcBadge>
            <span v-if="getLatestRunDeliveryError(job.id)" class="text-xs text-destructive">
              {{ t('common.error.requestFailed') }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </SettingsPageShell>

  <Dialog v-model:open="deleteDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('common.delete') }}</DialogTitle>
        <DialogDescription>{{ pendingDeleteJob?.name }}</DialogDescription>
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
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Switch } from '@shadcn/components/ui/switch'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Spinner } from '@shadcn/components/ui/spinner'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { createConfigClient } from '@api/ConfigClient'
import { createCronJobsClient } from '@api/CronJobsClient'
import { createRemoteControlClient } from '@api/RemoteControlClient'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'
import {
  CRON_JOBS_DEFAULT_DELIVERY,
  CRON_JOBS_DEFAULT_CRON_EXPR,
  CRON_JOBS_DEFAULT_MISFIRE_POLICY,
  CRON_JOBS_DEFAULT_TIMEZONE,
  type CronJob,
  type CronJobDelivery,
  type CronJobDeliveryReceipt,
  type CronJobRun,
  type CronJobsSchedulerStatus
} from '@shared/cronJobs'
import type { RemoteBindingSummary, RemoteChannel } from '@shared/types/remote'
import type { Agent } from '@shared/types/agent-interface'

const { t } = useI18n()
const client = createCronJobsClient()
const configClient = createConfigClient()
const remoteControlClient = createRemoteControlClient()
const pendingPageOperationId = ref<string | null>(null)
const operationIds = Object.freeze({
  load: 'settings.cronJobs.load',
  save: 'settings.cronJobs.save',
  add: 'settings.cronJobs.add',
  toggle: 'settings.cronJobs.toggle',
  delete: 'settings.cronJobs.delete'
})
const persistentOperationIds = new Set<string>([
  operationIds.save,
  operationIds.add,
  operationIds.toggle,
  operationIds.delete
])

const jobs = ref<CronJob[]>([])
const agents = ref<Agent[]>([])
const schedulerStatus = ref<CronJobsSchedulerStatus | null>(null)
const loadAttempted = ref(false)
const hasLoaded = ref(false)
const runningId = ref<string | null>(null)
const restartingScheduler = ref(false)
const previewRunsByJobId = ref<Record<string, number[]>>({})
const previewErrorsByJobId = ref<Record<string, string | null>>({})
const previewLoadingByJobId = ref<Record<string, boolean>>({})
const runsByJobId = ref<Record<string, CronJobRun[]>>({})
const runsLoadingByJobId = ref<Record<string, boolean>>({})
const runsErrorsByJobId = ref<Record<string, boolean>>({})
const deliveriesByRunId = ref<Record<string, CronJobDeliveryReceipt[]>>({})
const deliveryErrorsByRunId = ref<Record<string, boolean>>({})
const remoteDeliveryOptions = ref<RemoteDeliveryOption[]>([])
const remoteDeliveryLoading = ref(false)
const remoteDeliveryLoadFailed = ref(false)
const schedulerStatusStale = ref(false)
const dirtyJobIds = ref<Set<string>>(new Set())
const pendingDeleteJobId = ref<string | null>(null)
const NO_AGENT_ID = '__none__'
const SCHEDULER_STATUS_REFRESH_MS = 5_000
const SCHEDULER_STATUS_FAILURE_THRESHOLD = 2
const CRON_REFERENCE_EXAMPLES = [
  { cronExpr: '*/5 * * * *', labelKey: 'settings.cronJobs.presets.every5Minutes' },
  { cronExpr: '0 * * * *', labelKey: 'settings.cronJobs.presets.hourly' },
  { cronExpr: '0 9 * * *', labelKey: 'settings.cronJobs.presets.daily' },
  { cronExpr: '0 9 * * 1-5', labelKey: 'settings.cronJobs.presets.weekdays' }
] as const
let schedulerStatusTimer: number | null = null
let schedulerStatusGeneration = 0
let schedulerStatusRequestPending = false
let schedulerStatusFailureCount = 0
let disposed = false
let requestGenerationSequence = 0
const persistedJobs = new Map<string, CronJob>()
const previewRequestGenerations = new Map<string, number>()
const runsRequestGenerations = new Map<string, number>()
const deliveryRequestGenerations = new Map<string, number>()

type RemoteDeliveryOption = {
  value: string
  channel: RemoteChannel
  titleKey: string
  endpointKey: string
  binding: RemoteBindingSummary
}

const pageOperationPending = computed(() => pendingPageOperationId.value !== null)
const isLoading = computed(() => pendingPageOperationId.value === operationIds.load)
const persistentMutationPending = computed(
  () =>
    pendingPageOperationId.value !== null &&
    persistentOperationIds.has(pendingPageOperationId.value)
)
const loadUnavailable = computed(() => !hasLoaded.value && !isLoading.value)
const deleting = computed(() => pendingPageOperationId.value === operationIds.delete)
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
const hasDirtyJobs = computed(() => dirtyJobIds.value.size > 0)
const runtimeActionPending = computed(() => runningId.value !== null || restartingScheduler.value)
const jobInteractionDisabled = (jobId: string): boolean =>
  pageOperationPending.value ||
  runtimeActionPending.value ||
  (hasDirtyJobs.value && !dirtyJobIds.value.has(jobId))
const enabledJobCount = computed(() => jobs.value.filter((job) => job.enabled).length)
const enabledAgents = computed(() =>
  agents.value
    .filter((agent) => agent.enabled)
    .sort((left, right) => left.name.localeCompare(right.name))
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

const getBrowserTimezone = (): string => {
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
      getBrowserTimezone(),
      ...baseTimezoneOptions,
      ...jobs.value.map((job) => job.timezone).filter(Boolean)
    ])
  ).sort()
)

const formatTimestamp = (timestamp: number | null): string => {
  if (!timestamp) {
    return t('settings.cronJobs.none')
  }
  return new Date(timestamp).toLocaleString()
}

const getLatestRun = (jobId: string): CronJobRun | null => runsByJobId.value[jobId]?.[0] ?? null

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

const replaceLatestRun = (jobId: string, run: CronJobRun | null) => {
  const previousRunId = getLatestRun(jobId)?.id
  if (previousRunId && previousRunId !== run?.id) {
    clearRunDeliveryState(previousRunId)
  }
  runsByJobId.value = {
    ...runsByJobId.value,
    [jobId]: run ? [run] : []
  }
}

const getLatestRunDeliveries = (jobId: string): CronJobDeliveryReceipt[] => {
  const run = getLatestRun(jobId)
  return run ? (deliveriesByRunId.value[run.id] ?? []) : []
}

const getLatestRunDeliveryError = (jobId: string): boolean => {
  const run = getLatestRun(jobId)
  return run ? deliveryErrorsByRunId.value[run.id] === true : false
}

const formatDeliveryReceipt = (receipt: CronJobDeliveryReceipt): string => {
  const statusKey =
    receipt.status === 'failed'
      ? 'settings.cronJobs.fields.deliveryFailed'
      : 'settings.cronJobs.fields.deliverySuccess'
  return `${receipt.target.remoteId} ${t(statusKey)} ${formatTimestamp(receipt.createdAt)}`
}

const getRemoteDeliveryOptionLabel = (option: RemoteDeliveryOption): string => {
  const threadSuffix = option.binding.threadId ? `:${option.binding.threadId}` : ''
  return `${t(option.titleKey)} / ${t(`settings.remote.bindingKinds.${option.binding.kind}`)} ${
    option.binding.chatId
  }${threadSuffix}`
}

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

const cloneDelivery = (job: CronJob): CronJobDelivery => ({
  ...createDefaultDelivery(),
  ...job.delivery,
  targets: [...job.delivery.targets]
})

const setDirty = (jobId: string, dirty: boolean) => {
  const next = new Set(dirtyJobIds.value)
  if (dirty) {
    next.add(jobId)
  } else {
    next.delete(jobId)
  }
  dirtyJobIds.value = next
}

const markJobDirty = (jobId: string) => {
  setDirty(jobId, true)
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
  setDirty(job.id, false)
  void refreshJobPreview(canonicalJob)
}

const logFailure = (
  scope: string,
  error: unknown,
  context: Readonly<Record<string, unknown>> = {}
) => {
  console.error(
    `[CronJobsSettings] ${scope}`,
    {
      ...context
    },
    error
  )
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
    dirtyJobIds.value = new Set()
    agents.value = nextAgents
    if (nextRemoteDeliveryOptions !== null) {
      remoteDeliveryOptions.value = nextRemoteDeliveryOptions
      remoteDeliveryLoadFailed.value = false
    }
    setSchedulerStatus(response.schedulerStatus)
    hasLoaded.value = true
    for (const job of jobs.value) {
      void refreshJobPreview(job)
      void refreshJobRuns(job.id)
    }
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

const refreshJobPreview = async (job: CronJob) => {
  const requestGeneration = ++requestGenerationSequence
  previewRequestGenerations.set(job.id, requestGeneration)
  previewLoadingByJobId.value = {
    ...previewLoadingByJobId.value,
    [job.id]: true
  }
  try {
    const response = await client.previewSchedule({
      cronExpr: job.cronExpr || CRON_JOBS_DEFAULT_CRON_EXPR,
      timezone: job.timezone || getBrowserTimezone(),
      count: 5
    })
    if (disposed || previewRequestGenerations.get(job.id) !== requestGeneration) {
      return
    }
    previewRunsByJobId.value = {
      ...previewRunsByJobId.value,
      [job.id]: response.runs
    }
    previewErrorsByJobId.value = {
      ...previewErrorsByJobId.value,
      [job.id]: response.error
    }
  } catch (error) {
    if (!disposed && previewRequestGenerations.get(job.id) === requestGeneration) {
      logFailure('Failed to preview schedule', error, { jobId: job.id })
      previewErrorsByJobId.value = {
        ...previewErrorsByJobId.value,
        [job.id]: t('common.error.requestFailed')
      }
    }
  } finally {
    if (!disposed && previewRequestGenerations.get(job.id) === requestGeneration) {
      previewLoadingByJobId.value = {
        ...previewLoadingByJobId.value,
        [job.id]: false
      }
    }
  }
}

const refreshVisibleJobRuns = () => {
  for (const job of jobs.value) {
    void refreshJobRuns(job.id, true)
  }
}

const refreshJobRuns = async (jobId: string, silent = false) => {
  const requestGeneration = ++requestGenerationSequence
  runsRequestGenerations.set(jobId, requestGeneration)
  if (!silent) {
    runsLoadingByJobId.value = {
      ...runsLoadingByJobId.value,
      [jobId]: true
    }
  }
  try {
    const runs = await client.listRuns(jobId, 1)
    if (disposed || runsRequestGenerations.get(jobId) !== requestGeneration) {
      return
    }
    replaceLatestRun(jobId, runs[0] ?? null)
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

const updateJobField = (
  id: string,
  field: 'name' | 'cronExpr' | 'timezone' | 'taskPrompt',
  value: string
) => {
  if (jobInteractionDisabled(id)) {
    return
  }
  const job = jobs.value.find((entry) => entry.id === id)
  if (!job || job[field] === value) {
    return
  }
  jobs.value = jobs.value.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry))
  markJobDirty(id)
}

const updateAgentSelection = (id: string, agentId: string) => {
  const nextAgentId = agentId === NO_AGENT_ID ? null : agentId
  const job = jobs.value.find((entry) => entry.id === id)
  if (!job || job.agentId === nextAgentId || jobInteractionDisabled(id)) {
    return
  }
  jobs.value = jobs.value.map((entry) =>
    entry.id === id ? { ...entry, agentId: nextAgentId } : entry
  )
  markJobDirty(id)
  void commitJob(id)
}

const updateTimezone = (id: string, timezone: string) => {
  updateJobField(id, 'timezone', timezone)
  void commitJob(id)
}

const getRuntimePolicy = (job: CronJob): 'follow_agent' | 'snapshot' =>
  job.modelPolicy === 'pin_current' ||
  job.toolPolicy === 'snapshot' ||
  job.permissionPolicy === 'snapshot'
    ? 'snapshot'
    : 'follow_agent'

const updateRuntimePolicy = (id: string, policy: string) => {
  const job = jobs.value.find((entry) => entry.id === id)
  const nextPolicy = policy === 'snapshot' ? 'snapshot' : 'follow_agent'
  if (!job || getRuntimePolicy(job) === nextPolicy || jobInteractionDisabled(id)) {
    return
  }
  jobs.value = jobs.value.map((job) =>
    job.id === id
      ? {
          ...job,
          modelPolicy: policy === 'snapshot' ? 'pin_current' : 'follow_agent',
          toolPolicy: policy === 'snapshot' ? 'snapshot' : 'follow_agent',
          permissionPolicy: policy === 'snapshot' ? 'snapshot' : 'follow_agent'
        }
      : job
  )
  markJobDirty(id)
  void commitJob(id)
}

const getRemoteDeliveryTarget = (job: CronJob) => job.delivery.targets[0] ?? null

const isRemoteDeliveryEnabled = (job: CronJob): boolean => Boolean(getRemoteDeliveryTarget(job))

const getRemoteDeliveryValue = (job: CronJob): string =>
  getRemoteDeliveryTarget(job)?.channelId ?? ''

const updateDelivery = (id: string, updater: (delivery: CronJobDelivery) => CronJobDelivery) => {
  if (jobInteractionDisabled(id)) {
    return
  }
  jobs.value = jobs.value.map((job) =>
    job.id === id ? { ...job, delivery: updater(cloneDelivery(job)) } : job
  )
  markJobDirty(id)
  void commitJob(id)
}

const createRemoteDeliveryTarget = (option: RemoteDeliveryOption) => ({
  type: 'remote' as const,
  remoteId: option.channel,
  channelId: option.endpointKey,
  mode: 'summary' as const
})

const updateRemoteDeliveryEnabled = (id: string, enabled: boolean) => {
  const job = jobs.value.find((entry) => entry.id === id)
  if (!job || isRemoteDeliveryEnabled(job) === enabled) {
    return
  }
  const option = remoteDeliveryOptions.value[0]
  if (enabled && !option) {
    return
  }
  updateDelivery(id, (delivery) => ({
    ...delivery,
    targets: enabled && option ? [createRemoteDeliveryTarget(option)] : []
  }))
}

const updateRemoteDeliveryTarget = (id: string, value: string) => {
  const job = jobs.value.find((entry) => entry.id === id)
  if (!job || getRemoteDeliveryValue(job) === value) {
    return
  }
  const option = remoteDeliveryOptions.value.find((entry) => entry.value === value)
  if (!option) {
    return
  }
  updateDelivery(id, (delivery) => ({
    ...delivery,
    targets: [createRemoteDeliveryTarget(option)]
  }))
}

const commitJob = async (id: string): Promise<boolean> => {
  const job = jobs.value.find((entry) => entry.id === id)
  if (!job || pageOperationPending.value) {
    return false
  }
  if (!dirtyJobIds.value.has(id)) {
    return true
  }

  const draft = cloneJob(job)
  if (!beginPageOperation(operationIds.save)) {
    return false
  }
  void refreshJobPreview(draft)

  try {
    const response = await client.upsert({
      id: draft.id,
      name: draft.name || t('settings.cronJobs.defaults.name'),
      enabled: draft.enabled,
      cronExpr: draft.cronExpr || CRON_JOBS_DEFAULT_CRON_EXPR,
      timezone: draft.timezone || getBrowserTimezone(),
      agentId: draft.agentId,
      misfirePolicy: draft.misfirePolicy,
      maxCatchUpRuns: draft.maxCatchUpRuns,
      taskPrompt: draft.taskPrompt,
      taskSystemInstruction: draft.taskSystemInstruction,
      taskOutputMode: draft.taskOutputMode,
      modelPolicy: draft.modelPolicy,
      toolPolicy: draft.toolPolicy,
      permissionPolicy: draft.permissionPolicy,
      runtime: draft.runtime,
      delivery: draft.delivery
    })
    applyPersistedJob(response.job)
    setSchedulerStatus(response.schedulerStatus)
    notifyRenderer({
      kind: 'success',
      code: 'settings.cronJobs.saved',
      title: t('common.saved')
    })
    return true
  } catch (error) {
    failPageOperation('Failed to save job', 'settings.cronJobs.saveFailed', error)
    return false
  } finally {
    pendingPageOperationId.value = null
  }
}

const addJob = async () => {
  if (hasDirtyJobs.value) {
    return
  }
  if (!beginPageOperation(operationIds.add)) {
    return
  }
  try {
    const response = await client.upsert({
      name: t('settings.cronJobs.defaults.name'),
      enabled: false,
      cronExpr: CRON_JOBS_DEFAULT_CRON_EXPR,
      timezone: getBrowserTimezone(),
      agentId: enabledAgents.value[0]?.id ?? null,
      misfirePolicy: CRON_JOBS_DEFAULT_MISFIRE_POLICY,
      maxCatchUpRuns: null,
      taskPrompt: '',
      taskSystemInstruction: null,
      taskOutputMode: 'final_message',
      modelPolicy: 'follow_agent',
      toolPolicy: 'follow_agent',
      permissionPolicy: 'follow_agent',
      delivery: createDefaultDelivery()
    })
    applyPersistedJob(response.job)
    setSchedulerStatus(response.schedulerStatus)
  } catch (error) {
    failPageOperation('Failed to add job', 'settings.cronJobs.addFailed', error)
  } finally {
    pendingPageOperationId.value = null
  }
}

const toggleJob = async (id: string, enabled: boolean) => {
  if (jobInteractionDisabled(id)) {
    return
  }
  if (dirtyJobIds.value.has(id) && !(await commitJob(id))) {
    return
  }
  if (!beginPageOperation(operationIds.toggle)) {
    return
  }
  try {
    const response = await client.toggle(id, enabled)
    applyPersistedJob(response.job)
    setSchedulerStatus(response.schedulerStatus)
  } catch (error) {
    failPageOperation('Failed to toggle job', 'settings.cronJobs.toggleFailed', error)
  } finally {
    pendingPageOperationId.value = null
  }
}

const requestDeleteJob = (id: string) => {
  if (jobInteractionDisabled(id) || !jobs.value.some((job) => job.id === id)) {
    return
  }
  pendingDeleteJobId.value = id
}

const removeJobState = (id: string) => {
  jobs.value = jobs.value.filter((job) => job.id !== id)
  persistedJobs.delete(id)
  setDirty(id, false)
  previewRequestGenerations.delete(id)
  runsRequestGenerations.delete(id)

  const nextPreviewRuns = { ...previewRunsByJobId.value }
  const nextPreviewErrors = { ...previewErrorsByJobId.value }
  const nextPreviewLoading = { ...previewLoadingByJobId.value }
  const nextJobRuns = { ...runsByJobId.value }
  const nextRunsLoading = { ...runsLoadingByJobId.value }
  const nextRunsErrors = { ...runsErrorsByJobId.value }
  const nextDeliveries = { ...deliveriesByRunId.value }
  const nextDeliveryErrors = { ...deliveryErrorsByRunId.value }
  for (const run of runsByJobId.value[id] ?? []) {
    deliveryRequestGenerations.delete(run.id)
    delete nextDeliveries[run.id]
    delete nextDeliveryErrors[run.id]
  }
  delete nextPreviewRuns[id]
  delete nextPreviewErrors[id]
  delete nextPreviewLoading[id]
  delete nextJobRuns[id]
  delete nextRunsLoading[id]
  delete nextRunsErrors[id]
  previewRunsByJobId.value = nextPreviewRuns
  previewErrorsByJobId.value = nextPreviewErrors
  previewLoadingByJobId.value = nextPreviewLoading
  runsByJobId.value = nextJobRuns
  runsLoadingByJobId.value = nextRunsLoading
  runsErrorsByJobId.value = nextRunsErrors
  deliveriesByRunId.value = nextDeliveries
  deliveryErrorsByRunId.value = nextDeliveryErrors
}

const confirmDeleteJob = async () => {
  const id = pendingDeleteJobId.value
  if (!id || !beginPageOperation(operationIds.delete)) {
    return
  }
  try {
    setSchedulerStatus(await client.remove(id))
    removeJobState(id)
    pendingDeleteJobId.value = null
  } catch (error) {
    failPageOperation('Failed to delete job', 'settings.cronJobs.deleteFailed', error)
  } finally {
    pendingPageOperationId.value = null
  }
}

const runJobNow = async (id: string) => {
  if (jobInteractionDisabled(id)) {
    return
  }
  if (dirtyJobIds.value.has(id) && !(await commitJob(id))) {
    return
  }
  runsRequestGenerations.set(id, ++requestGenerationSequence)
  runningId.value = id
  try {
    const response = await client.runNow(id)
    applyPersistedJob(response.job)
    runsRequestGenerations.set(id, ++requestGenerationSequence)
    replaceLatestRun(id, response.run)
    runsErrorsByJobId.value = {
      ...runsErrorsByJobId.value,
      [id]: false
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
    if (runningId.value === id) {
      runningId.value = null
    }
  }
}

const restartScheduler = async () => {
  if (hasDirtyJobs.value || runtimeActionPending.value || pageOperationPending.value) {
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

const discardDirtyJobs = () => {
  const dirtyIds = Array.from(dirtyJobIds.value)
  if (dirtyIds.length === 0) {
    return
  }
  const restoredJobs = jobs.value
    .map((job) => {
      if (!dirtyJobIds.value.has(job.id)) {
        return job
      }
      const persisted = persistedJobs.get(job.id)
      return persisted ? cloneJob(persisted) : job
    })
    .filter((job) => persistedJobs.has(job.id))
  jobs.value = sortJobs(restoredJobs)
  dirtyJobIds.value = new Set()
  for (const id of dirtyIds) {
    const restored = persistedJobs.get(id)
    if (restored) {
      void refreshJobPreview(restored)
    }
  }
}

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'settings-cron-jobs',
  onDiscard: discardDirtyJobs
})
const stopLeaveRiskSync = watch(
  [persistentMutationPending, hasDirtyJobs],
  ([busy, dirty]) => {
    leaveGuardLease.setRisk(busy ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

onMounted(() => {
  void loadJobs()
  startSchedulerStatusPolling()
})

onBeforeUnmount(() => {
  disposed = true
  schedulerStatusGeneration += 1
  stopSchedulerStatusPolling()
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>
