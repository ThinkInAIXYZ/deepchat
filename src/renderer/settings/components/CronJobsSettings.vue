<template>
  <SettingsPageShell
    data-testid="settings-cron-jobs-page"
    sticky-header
    :title="t('settings.cronJobs.title')"
    :eyebrow="t('settings.controlCenter.groups.tools')"
    :description="t('settings.cronJobs.description')"
  >
    <template #actions>
      <Badge v-if="isSaving" variant="outline">{{ t('common.saving') }}</Badge>
      <Button variant="outline" size="sm" :disabled="isLoading" @click="restartScheduler">
        <Icon icon="lucide:rotate-cw" class="mr-1 h-4 w-4" />
        {{ t('settings.cronJobs.actions.restart') }}
      </Button>
      <Button data-testid="cron-jobs-add" size="sm" :disabled="isLoading" @click="addJob">
        <Icon icon="lucide:plus" class="mr-1 h-4 w-4" />
        {{ t('settings.cronJobs.actions.newJob') }}
      </Button>
    </template>

    <div v-if="isLoading" class="text-sm text-muted-foreground">
      {{ t('common.loading') }}
    </div>

    <template v-else>
      <section class="grid max-w-5xl gap-3 rounded-lg border bg-card/30 p-4 md:grid-cols-4">
        <div class="min-w-0">
          <div class="text-xs text-muted-foreground">{{ t('settings.cronJobs.status.state') }}</div>
          <div class="mt-1 flex items-center gap-2">
            <Badge :variant="schedulerBadgeVariant">
              {{ t(`settings.cronJobs.status.${schedulerStatus?.state ?? 'stopped'}`) }}
            </Badge>
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
        v-if="schedulerStatus?.lastError"
        class="max-w-5xl rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
      >
        {{ schedulerStatus.lastError }}
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
        <Button variant="outline" size="sm" @click="addJob">
          <Icon icon="lucide:plus" class="mr-1 h-4 w-4" />
          {{ t('settings.cronJobs.actions.newJob') }}
        </Button>
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
                :aria-label="job.enabled ? t('common.enabled') : t('common.disabled')"
                @update:model-value="(value) => toggleJob(job.id, value === true)"
              />
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                :disabled="runningId === job.id"
                :title="t('settings.cronJobs.actions.runNow')"
                @click="runJobNow(job.id)"
              >
                <Spinner v-if="runningId === job.id" class="size-4" />
                <Icon v-else icon="lucide:play" class="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                :aria-label="t('common.delete')"
                :title="t('common.delete')"
                @click="deleteJob(job.id)"
              >
                <Icon icon="lucide:trash-2" class="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>

          <div class="mt-3 space-y-1.5 lg:pl-11">
            <Label class="text-xs text-muted-foreground">
              {{ t('settings.cronJobs.fields.cronExpr') }}
            </Label>
            <Input
              :model-value="job.cronExpr"
              class="h-8! max-w-xl font-mono text-xs"
              @update:model-value="(value) => updateJobField(job.id, 'cronExpr', String(value))"
              @blur="commitJob(job.id)"
            />
            <div class="flex flex-wrap gap-1.5">
              <Badge
                v-for="example in CRON_REFERENCE_EXAMPLES"
                :key="example.cronExpr"
                variant="outline"
                class="gap-1.5 px-1.5 py-0.5 font-normal"
              >
                <code class="font-mono text-[11px]">{{ example.cronExpr }}</code>
                <span class="text-[11px] text-muted-foreground">
                  {{ t(example.labelKey) }}
                </span>
              </Badge>
            </div>
          </div>

          <div class="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px] lg:pl-11">
            <div class="space-y-1.5">
              <Label class="text-xs text-muted-foreground">
                {{ t('settings.cronJobs.fields.taskPrompt') }}
              </Label>
              <Textarea
                :model-value="job.taskPrompt"
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
                :disabled="!isRemoteDeliveryEnabled(job) && remoteDeliveryOptions.length === 0"
                @update:model-value="(value) => updateRemoteDeliveryEnabled(job.id, value === true)"
              />
              <span>{{ t('settings.cronJobs.fields.remoteDelivery') }}</span>
            </label>
            <Select
              :model-value="getRemoteDeliveryValue(job)"
              :disabled="
                !isRemoteDeliveryEnabled(job) ||
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
            <span v-if="remoteDeliveryOptions.length === 0" class="text-xs text-muted-foreground">
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
            <Badge v-if="previewLoadingByJobId[job.id]" variant="outline">
              {{ t('common.loading') }}
            </Badge>
            <template v-else-if="previewRunsByJobId[job.id]?.length">
              <Badge
                v-for="runAt in previewRunsByJobId[job.id]"
                :key="runAt"
                variant="outline"
                class="font-normal"
              >
                {{ formatTimestamp(runAt) }}
              </Badge>
            </template>
            <span v-else class="text-xs text-muted-foreground">
              {{ t('settings.cronJobs.none') }}
            </span>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-2 lg:pl-11">
            <Icon icon="lucide:history" class="h-4 w-4 text-muted-foreground" />
            <span class="text-xs text-muted-foreground">{{ t('common.history') }}</span>
            <Badge v-if="runsLoadingByJobId[job.id]" variant="outline">
              {{ t('common.loading') }}
            </Badge>
            <template v-else-if="getLatestRun(job.id)">
              <Badge variant="outline" class="font-normal">
                {{
                  formatTimestamp(
                    getLatestRun(job.id)?.startedAt ?? getLatestRun(job.id)?.queuedAt ?? null
                  )
                }}
              </Badge>
            </template>
            <span v-else class="text-xs text-muted-foreground">
              {{ t('settings.cronJobs.none') }}
            </span>
          </div>

          <div
            v-if="getLatestRunDeliveries(job.id).length > 0"
            class="mt-2 flex flex-wrap items-center gap-2 lg:pl-11"
          >
            <Icon icon="lucide:send" class="h-4 w-4 text-muted-foreground" />
            <span class="text-xs text-muted-foreground">
              {{ t('settings.cronJobs.fields.delivery') }}
            </span>
            <Badge
              v-for="receipt in getLatestRunDeliveries(job.id)"
              :key="receipt.id"
              :variant="receipt.status === 'failed' ? 'destructive' : 'secondary'"
              class="font-normal"
              :title="receipt.error ?? undefined"
            >
              {{ formatDeliveryReceipt(receipt) }}
            </Badge>
          </div>
        </div>
      </div>
    </template>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
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
import { useToast } from '@/components/use-toast'
import { createConfigClient } from '@api/ConfigClient'
import { createCronJobsClient } from '@api/CronJobsClient'
import { createRemoteControlClient } from '@api/RemoteControlClient'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
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
import type { RemoteBindingSummary, RemoteChannel } from '@shared/presenter'
import type { Agent } from '@shared/types/agent-interface'

const { t } = useI18n()
const { toast } = useToast()
const client = createCronJobsClient()
const configClient = createConfigClient()
const remoteControlClient = createRemoteControlClient()

const jobs = ref<CronJob[]>([])
const agents = ref<Agent[]>([])
const schedulerStatus = ref<CronJobsSchedulerStatus | null>(null)
const isLoading = ref(false)
const isSaving = ref(false)
const runningId = ref<string | null>(null)
const previewRunsByJobId = ref<Record<string, number[]>>({})
const previewErrorsByJobId = ref<Record<string, string | null>>({})
const previewLoadingByJobId = ref<Record<string, boolean>>({})
const runsByJobId = ref<Record<string, CronJobRun[]>>({})
const runsLoadingByJobId = ref<Record<string, boolean>>({})
const deliveriesByRunId = ref<Record<string, CronJobDeliveryReceipt[]>>({})
const remoteDeliveryOptions = ref<RemoteDeliveryOption[]>([])
const remoteDeliveryLoading = ref(false)
const NO_AGENT_ID = '__none__'
const SCHEDULER_STATUS_REFRESH_MS = 5_000
const CRON_REFERENCE_EXAMPLES = [
  { cronExpr: '*/5 * * * *', labelKey: 'settings.cronJobs.presets.every5Minutes' },
  { cronExpr: '0 * * * *', labelKey: 'settings.cronJobs.presets.hourly' },
  { cronExpr: '0 9 * * *', labelKey: 'settings.cronJobs.presets.daily' },
  { cronExpr: '0 9 * * 1-5', labelKey: 'settings.cronJobs.presets.weekdays' }
] as const
let schedulerStatusTimer: number | null = null

type RemoteDeliveryOption = {
  value: string
  channel: RemoteChannel
  titleKey: string
  endpointKey: string
  binding: RemoteBindingSummary
}

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

const getLatestRunDeliveries = (jobId: string): CronJobDeliveryReceipt[] => {
  const run = getLatestRun(jobId)
  return run ? (deliveriesByRunId.value[run.id] ?? []) : []
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

const applyJob = (job: CronJob) => {
  const existingIndex = jobs.value.findIndex((entry) => entry.id === job.id)
  const next =
    existingIndex >= 0
      ? jobs.value.map((entry) => (entry.id === job.id ? job : entry))
      : [...jobs.value, job]
  jobs.value = sortJobs(next)
  void refreshJobPreview(job)
}

const handleError = (scope: string, error: unknown) => {
  console.error(`[CronJobs] ${scope}:`, error)
  toast({
    title: t('common.error.operationFailed'),
    description: error instanceof Error ? error.message : String(error),
    variant: 'destructive'
  })
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
    console.error('[CronJobs] Failed to load remote delivery options:', error)
    return null
  } finally {
    remoteDeliveryLoading.value = false
  }
}

const loadJobs = async () => {
  isLoading.value = true
  try {
    const [response, nextAgents, nextRemoteDeliveryOptions] = await Promise.all([
      client.list(),
      configClient.listAgents(),
      loadRemoteDeliveryOptions()
    ])
    jobs.value = sortJobs(response.jobs)
    agents.value = nextAgents
    if (nextRemoteDeliveryOptions !== null) {
      remoteDeliveryOptions.value = nextRemoteDeliveryOptions
    }
    schedulerStatus.value = response.schedulerStatus
    for (const job of jobs.value) {
      void refreshJobPreview(job)
      void refreshJobRuns(job.id)
    }
  } catch (error) {
    handleError('Failed to load jobs', error)
  } finally {
    isLoading.value = false
  }
}

const refreshSchedulerStatus = async () => {
  try {
    const previousNextRunAt = schedulerStatus.value?.nextRunAt ?? null
    const nextStatus = await client.getSchedulerStatus()
    schedulerStatus.value = nextStatus
    if (nextStatus.nextRunAt !== previousNextRunAt) {
      refreshVisibleJobRuns()
    }
  } catch (error) {
    console.error('[CronJobs] Failed to refresh scheduler status:', error)
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
    previewRunsByJobId.value = {
      ...previewRunsByJobId.value,
      [job.id]: response.runs
    }
    previewErrorsByJobId.value = {
      ...previewErrorsByJobId.value,
      [job.id]: response.error
    }
  } catch (error) {
    console.error('[CronJobs] Failed to preview schedule:', error)
    previewRunsByJobId.value = {
      ...previewRunsByJobId.value,
      [job.id]: []
    }
    previewErrorsByJobId.value = {
      ...previewErrorsByJobId.value,
      [job.id]: error instanceof Error ? error.message : String(error)
    }
  } finally {
    previewLoadingByJobId.value = {
      ...previewLoadingByJobId.value,
      [job.id]: false
    }
  }
}

const refreshVisibleJobRuns = () => {
  for (const job of jobs.value) {
    void refreshJobRuns(job.id, true)
  }
}

const refreshJobRuns = async (jobId: string, silent = false) => {
  if (!silent) {
    runsLoadingByJobId.value = {
      ...runsLoadingByJobId.value,
      [jobId]: true
    }
  }
  try {
    const runs = await client.listRuns(jobId, 1)
    runsByJobId.value = {
      ...runsByJobId.value,
      [jobId]: runs
    }
    if (runs[0]) {
      void refreshRunDeliveries(runs[0].id)
    }
  } catch (error) {
    console.error('[CronJobs] Failed to load runs:', error)
    runsByJobId.value = {
      ...runsByJobId.value,
      [jobId]: []
    }
  } finally {
    if (!silent) {
      runsLoadingByJobId.value = {
        ...runsLoadingByJobId.value,
        [jobId]: false
      }
    }
  }
}

const refreshRunDeliveries = async (runId: string) => {
  try {
    const deliveries = await client.listDeliveries(runId)
    deliveriesByRunId.value = {
      ...deliveriesByRunId.value,
      [runId]: deliveries
    }
  } catch (error) {
    console.error('[CronJobs] Failed to load deliveries:', error)
    deliveriesByRunId.value = {
      ...deliveriesByRunId.value,
      [runId]: []
    }
  }
}

const updateJobField = (
  id: string,
  field: 'name' | 'cronExpr' | 'timezone' | 'taskPrompt',
  value: string
) => {
  jobs.value = jobs.value.map((job) => (job.id === id ? { ...job, [field]: value } : job))
}

const updateAgentSelection = (id: string, agentId: string) => {
  jobs.value = jobs.value.map((job) =>
    job.id === id ? { ...job, agentId: agentId === NO_AGENT_ID ? null : agentId } : job
  )
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
  void commitJob(id)
}

const getRemoteDeliveryTarget = (job: CronJob) => job.delivery.targets[0] ?? null

const isRemoteDeliveryEnabled = (job: CronJob): boolean => Boolean(getRemoteDeliveryTarget(job))

const getRemoteDeliveryValue = (job: CronJob): string =>
  getRemoteDeliveryTarget(job)?.channelId ?? ''

const updateDelivery = (id: string, updater: (delivery: CronJobDelivery) => CronJobDelivery) => {
  jobs.value = jobs.value.map((job) =>
    job.id === id ? { ...job, delivery: updater(cloneDelivery(job)) } : job
  )
  void commitJob(id)
}

const createRemoteDeliveryTarget = (option: RemoteDeliveryOption) => ({
  type: 'remote' as const,
  remoteId: option.channel,
  channelId: option.endpointKey,
  mode: 'summary' as const
})

const updateRemoteDeliveryEnabled = (id: string, enabled: boolean) => {
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
  const option = remoteDeliveryOptions.value.find((entry) => entry.value === value)
  if (!option) {
    return
  }
  updateDelivery(id, (delivery) => ({
    ...delivery,
    targets: [createRemoteDeliveryTarget(option)]
  }))
}

const commitJob = async (id: string) => {
  const job = jobs.value.find((entry) => entry.id === id)
  if (!job) {
    return
  }

  isSaving.value = true
  try {
    const response = await client.upsert({
      id: job.id,
      name: job.name || t('settings.cronJobs.defaults.name'),
      enabled: job.enabled,
      cronExpr: job.cronExpr || CRON_JOBS_DEFAULT_CRON_EXPR,
      timezone: job.timezone || getBrowserTimezone(),
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
    applyJob(response.job)
    schedulerStatus.value = response.schedulerStatus
  } catch (error) {
    handleError('Failed to save job', error)
  } finally {
    isSaving.value = false
  }
}

const addJob = async () => {
  isSaving.value = true
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
    applyJob(response.job)
    schedulerStatus.value = response.schedulerStatus
  } catch (error) {
    handleError('Failed to add job', error)
  } finally {
    isSaving.value = false
  }
}

const toggleJob = async (id: string, enabled: boolean) => {
  try {
    const response = await client.toggle(id, enabled)
    applyJob(response.job)
    schedulerStatus.value = response.schedulerStatus
  } catch (error) {
    handleError('Failed to toggle job', error)
  }
}

const deleteJob = async (id: string) => {
  try {
    schedulerStatus.value = await client.remove(id)
    jobs.value = jobs.value.filter((job) => job.id !== id)
    const nextRuns = { ...previewRunsByJobId.value }
    const nextErrors = { ...previewErrorsByJobId.value }
    const nextLoading = { ...previewLoadingByJobId.value }
    const nextJobRuns = { ...runsByJobId.value }
    const nextRunsLoading = { ...runsLoadingByJobId.value }
    const nextDeliveries = { ...deliveriesByRunId.value }
    for (const run of runsByJobId.value[id] ?? []) {
      delete nextDeliveries[run.id]
    }
    delete nextRuns[id]
    delete nextErrors[id]
    delete nextLoading[id]
    delete nextJobRuns[id]
    delete nextRunsLoading[id]
    previewRunsByJobId.value = nextRuns
    previewErrorsByJobId.value = nextErrors
    previewLoadingByJobId.value = nextLoading
    runsByJobId.value = nextJobRuns
    runsLoadingByJobId.value = nextRunsLoading
    deliveriesByRunId.value = nextDeliveries
  } catch (error) {
    handleError('Failed to delete job', error)
  }
}

const runJobNow = async (id: string) => {
  runningId.value = id
  try {
    const response = await client.runNow(id)
    applyJob(response.job)
    runsByJobId.value = {
      ...runsByJobId.value,
      [id]: [
        response.run,
        ...(runsByJobId.value[id] ?? []).filter((run) => run.id !== response.run.id)
      ].slice(0, 1)
    }
    void refreshRunDeliveries(response.run.id)
    schedulerStatus.value = response.schedulerStatus
    toast({
      title: t('settings.cronJobs.runNowSuccess'),
      description: response.job.name
    })
  } catch (error) {
    handleError('Failed to run job', error)
  } finally {
    runningId.value = null
  }
}

const restartScheduler = async () => {
  try {
    schedulerStatus.value = await client.restartScheduler()
  } catch (error) {
    handleError('Failed to restart scheduler', error)
  }
}

onMounted(() => {
  void loadJobs()
  startSchedulerStatusPolling()
})

onBeforeUnmount(() => {
  stopSchedulerStatusPolling()
})
</script>
