<template>
  <div class="flex flex-col gap-4">
    <section v-for="group in groups" :key="group.key" class="space-y-2">
      <div class="flex items-center justify-between gap-2 px-1">
        <span class="text-xs font-medium text-muted-foreground">{{ t(group.titleKey) }}</span>
        <span class="text-xs text-muted-foreground">{{ group.jobs.length }}</span>
      </div>
      <ul class="space-y-2">
        <li v-for="job in group.jobs" :key="job.id" :data-job-id="job.id">
          <div
            data-testid="cron-job-row"
            class="rounded-lg border transition-colors"
            :class="
              job.id === selectedJobId
                ? 'border-primary/60 bg-accent/40'
                : 'border-border bg-card/30 hover:bg-accent/20'
            "
          >
            <div class="flex items-start gap-2 p-3">
              <button
                type="button"
                data-testid="cron-job-select"
                class="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-current="job.id === selectedJobId ? 'true' : undefined"
                @click="emit('select', job.id)"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <span class="min-w-0 truncate text-sm font-medium">{{ job.name }}</span>
                  <Icon
                    v-if="job.status === 'invalid_agent'"
                    icon="lucide:triangle-alert"
                    class="size-3.5 shrink-0 text-destructive"
                  />
                </div>
                <div class="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon icon="lucide:calendar-clock" class="size-3.5 shrink-0" />
                  <span class="min-w-0 truncate">{{ describeSchedule(job.cronExpr) }}</span>
                </div>
                <div class="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon icon="lucide:timer" class="size-3.5 shrink-0" />
                  <span class="min-w-0 truncate">
                    {{ t('settings.cronJobs.nextRunAt') }} {{ formatTimestamp(job.nextRunAt) }}
                  </span>
                </div>
                <div class="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <DcBadge
                    data-testid="cron-job-last-run"
                    :variant="lastRunBadgeVariant(job.id)"
                    class="font-normal"
                  >
                    {{ lastRunLabel(job.id) }}
                  </DcBadge>
                  <span v-if="lastRunTimestamp(job.id)" class="text-xs text-muted-foreground">
                    {{ formatTimestamp(lastRunTimestamp(job.id)) }}
                  </span>
                  <span
                    v-if="agentLabel(job)"
                    class="min-w-0 truncate text-xs text-muted-foreground"
                  >
                    · {{ agentLabel(job) }}
                  </span>
                </div>
              </button>

              <div class="flex shrink-0 flex-col items-end gap-1.5">
                <Switch
                  :model-value="job.enabled"
                  :disabled="rowActionDisabled(job)"
                  :aria-label="`${t('common.enabled')}: ${job.name}`"
                  @update:model-value="(value) => emit('toggle', job.id, value === true)"
                />
                <div class="flex items-center gap-0.5">
                  <DcButton
                    variant="ghost"
                    size="icon-sm"
                    icon="lucide:play"
                    :loading="runningJobId === job.id"
                    :disabled="rowActionDisabled(job)"
                    :title="t('settings.cronJobs.actions.runNow')"
                    :aria-label="`${t('settings.cronJobs.actions.runNow')}: ${job.name}`"
                    @click="emit('runNow', job.id)"
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <DcButton
                        variant="ghost"
                        size="icon-sm"
                        icon="lucide:ellipsis"
                        data-testid="cron-job-more"
                        :disabled="rowActionDisabled(job)"
                        :title="t('common.more')"
                        :aria-label="`${t('common.more')}: ${job.name}`"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-40">
                      <DcDropdownActionItem
                        icon="lucide:pencil"
                        :label="t('common.edit')"
                        @select="emit('edit', job.id)"
                      />
                      <DcDropdownActionItem
                        icon="lucide:trash-2"
                        :label="t('common.delete')"
                        danger
                        @select="emit('delete', job.id)"
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'
import { DcDropdownActionItem } from '@dc-ui/components/dropdown-action-item'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { Switch } from '@shadcn/components/ui/switch'
import type { CronJob, CronJobRun } from '@shared/cronJobs'
import { useCronJobFormat } from './useCronJobFormat'

const props = defineProps<{
  jobs: CronJob[]
  selectedJobId: string | null
  lockedJobId: string | null
  busy: boolean
  runningJobId: string | null
  latestRuns: Record<string, CronJobRun | undefined>
  runsLoading: Record<string, boolean>
  agentNames: Record<string, string>
}>()

const emit = defineEmits<{
  (e: 'select', jobId: string): void
  (e: 'toggle', jobId: string, enabled: boolean): void
  (e: 'runNow', jobId: string): void
  (e: 'edit', jobId: string): void
  (e: 'delete', jobId: string): void
}>()

const { t } = useI18n()
const { formatTimestamp, describeSchedule, describeRunStatus } = useCronJobFormat()

const groups = computed(() =>
  [
    {
      key: 'enabled',
      titleKey: 'settings.cronJobs.list.enabledGroup',
      jobs: props.jobs.filter((job) => job.enabled)
    },
    {
      key: 'disabled',
      titleKey: 'settings.cronJobs.list.disabledGroup',
      jobs: props.jobs.filter((job) => !job.enabled)
    }
  ].filter((group) => group.jobs.length > 0)
)

const rowActionDisabled = (job: CronJob): boolean =>
  props.busy || props.lockedJobId === job.id || props.runningJobId === job.id

const agentLabel = (job: CronJob): string | null => {
  if (!job.agentId) {
    return null
  }
  return props.agentNames[job.agentId] ?? t('settings.cronJobs.fields.noAgent')
}

const lastRunLabel = (jobId: string): string => {
  if (props.runsLoading[jobId] && !props.latestRuns[jobId]) {
    return t('common.loading')
  }
  const run = props.latestRuns[jobId]
  return run ? describeRunStatus(run.status) : t('settings.cronJobs.detail.neverRun')
}

const lastRunBadgeVariant = (jobId: string): 'default' | 'destructive' | 'outline' => {
  const run = props.latestRuns[jobId]
  if (!run) {
    return 'outline'
  }
  if (run.status === 'failed' || run.status === 'cancelled') {
    return 'destructive'
  }
  return run.status === 'completed' ? 'default' : 'outline'
}

const lastRunTimestamp = (jobId: string): number | null => {
  const run = props.latestRuns[jobId]
  return run?.startedAt ?? run?.queuedAt ?? null
}
</script>
