<template>
  <SettingsPageShell
    data-testid="settings-cron-jobs-page"
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
      <section class="grid gap-3 rounded-lg border bg-card/30 p-4 md:grid-cols-4">
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
        v-if="jobs.length === 0"
        class="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card/30 px-6 py-12 text-center"
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

      <div v-else class="overflow-hidden rounded-lg border bg-card/30">
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
                  {{ t('settings.cronJobs.fields.cronExpr') }}
                </Label>
                <Input
                  :model-value="job.cronExpr"
                  class="h-8! font-mono text-xs"
                  @update:model-value="(value) => updateJobField(job.id, 'cronExpr', String(value))"
                  @blur="commitJob(job.id)"
                />
              </div>
              <div class="min-w-0 space-y-1.5">
                <Label class="text-xs text-muted-foreground">
                  {{ t('settings.cronJobs.fields.timezone') }}
                </Label>
                <Input
                  :model-value="job.timezone"
                  class="h-8!"
                  @update:model-value="(value) => updateJobField(job.id, 'timezone', String(value))"
                  @blur="commitJob(job.id)"
                />
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
                <Icon
                  :icon="runningId === job.id ? 'lucide:loader-2' : 'lucide:play'"
                  :class="['h-4 w-4', runningId === job.id ? 'animate-spin' : '']"
                />
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

          <div
            v-if="schedulerStatus?.lastError"
            class="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {{ schedulerStatus.lastError }}
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
        </div>
      </div>
    </template>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Switch } from '@shadcn/components/ui/switch'
import { useToast } from '@/components/use-toast'
import { createCronJobsClient } from '@api/CronJobsClient'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import {
  CRON_JOBS_DEFAULT_CRON_EXPR,
  CRON_JOBS_DEFAULT_MISFIRE_POLICY,
  CRON_JOBS_DEFAULT_TIMEZONE,
  type CronJob,
  type CronJobsSchedulerStatus
} from '@shared/cronJobs'

const { t } = useI18n()
const { toast } = useToast()
const client = createCronJobsClient()

const jobs = ref<CronJob[]>([])
const schedulerStatus = ref<CronJobsSchedulerStatus | null>(null)
const isLoading = ref(false)
const isSaving = ref(false)
const runningId = ref<string | null>(null)
const previewRunsByJobId = ref<Record<string, number[]>>({})
const previewErrorsByJobId = ref<Record<string, string | null>>({})
const previewLoadingByJobId = ref<Record<string, boolean>>({})

const enabledJobCount = computed(() => jobs.value.filter((job) => job.enabled).length)

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

const formatTimestamp = (timestamp: number | null): string => {
  if (!timestamp) {
    return t('settings.cronJobs.none')
  }
  return new Date(timestamp).toLocaleString()
}

const sortJobs = (items: CronJob[]) =>
  items
    .slice()
    .sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id))

const applyJob = (job: CronJob) => {
  const existingIndex = jobs.value.findIndex((entry) => entry.id === job.id)
  const next =
    existingIndex >= 0
      ? jobs.value.map((entry) => (entry.id === job.id ? job : entry))
      : [job, ...jobs.value]
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

const loadJobs = async () => {
  isLoading.value = true
  try {
    const response = await client.list()
    jobs.value = sortJobs(response.jobs)
    schedulerStatus.value = response.schedulerStatus
    for (const job of jobs.value) {
      void refreshJobPreview(job)
    }
  } catch (error) {
    handleError('Failed to load jobs', error)
  } finally {
    isLoading.value = false
  }
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

const updateJobField = (id: string, field: 'name' | 'cronExpr' | 'timezone', value: string) => {
  jobs.value = jobs.value.map((job) => (job.id === id ? { ...job, [field]: value } : job))
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
      maxCatchUpRuns: job.maxCatchUpRuns
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
      agentId: null,
      misfirePolicy: CRON_JOBS_DEFAULT_MISFIRE_POLICY,
      maxCatchUpRuns: null
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
    delete nextRuns[id]
    delete nextErrors[id]
    delete nextLoading[id]
    previewRunsByJobId.value = nextRuns
    previewErrorsByJobId.value = nextErrors
    previewLoadingByJobId.value = nextLoading
  } catch (error) {
    handleError('Failed to delete job', error)
  }
}

const runJobNow = async (id: string) => {
  runningId.value = id
  try {
    const response = await client.runNow(id)
    applyJob(response.job)
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
})
</script>
