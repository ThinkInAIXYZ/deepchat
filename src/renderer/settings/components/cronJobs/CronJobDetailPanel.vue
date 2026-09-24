<template>
  <div class="flex flex-col">
    <header
      class="sticky top-0 z-20 border-b border-border/80 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:px-6"
    >
      <div
        class="mx-auto flex w-full max-w-4xl flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
      >
        <div class="flex min-w-0 items-start gap-2">
          <DcButton
            v-if="narrow"
            variant="ghost"
            size="icon-sm"
            icon="lucide:arrow-left"
            :title="t('settings.cronJobs.actions.backToList')"
            :aria-label="t('settings.cronJobs.actions.backToList')"
            @click="emit('back')"
          />
          <div class="min-w-0">
            <h2 data-testid="cron-job-detail-title" class="truncate text-base font-semibold">
              {{ heading }}
            </h2>
            <div
              class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
            >
              <DcBadge v-if="mode === 'view' && job" :variant="statusBadgeVariant">
                {{ describeJobStatus(job) }}
              </DcBadge>
              <span v-if="dirty" data-testid="cron-job-dirty-hint" class="text-amber-600">
                {{ t('settings.cronJobs.detail.unsaved') }}
              </span>
              <span class="min-w-0 truncate">{{ headingSchedule }}</span>
            </div>
          </div>
        </div>

        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <template v-if="mode === 'view' && job">
            <label class="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                :model-value="job.enabled"
                :disabled="busy || runningNow"
                :aria-label="`${t('common.enabled')}: ${job.name}`"
                @update:model-value="(value) => emit('toggle', value === true)"
              />
              <span>{{ job.enabled ? t('common.enabled') : t('common.disabled') }}</span>
            </label>
            <DcButton
              data-testid="cron-job-run-now"
              variant="outline"
              size="icon-sm"
              icon="lucide:play"
              :loading="runningNow"
              :disabled="busy || runningNow"
              :tooltip="t('settings.cronJobs.actions.runNow')"
              :aria-label="`${t('settings.cronJobs.actions.runNow')}: ${job.name}`"
              @click="emit('runNow')"
            />
            <DcButton
              data-testid="cron-job-edit"
              size="icon-sm"
              icon="lucide:pencil"
              :disabled="busy"
              :tooltip="t('common.edit')"
              :aria-label="`${t('common.edit')}: ${job.name}`"
              @click="emit('edit')"
            />
            <DcButton
              data-testid="cron-job-detail-delete"
              variant="ghost"
              size="icon-sm"
              icon="lucide:trash-2"
              class="text-destructive"
              :disabled="busy"
              :title="t('common.delete')"
              :aria-label="`${t('common.delete')}: ${job.name}`"
              @click="emit('delete')"
            />
          </template>

          <template v-else-if="draft">
            <DcButton
              v-if="mode === 'edit'"
              data-testid="cron-job-editor-delete"
              variant="outline"
              size="icon-sm"
              icon="lucide:trash-2"
              class="text-destructive"
              :disabled="busy"
              :tooltip="t('common.delete')"
              @click="emit('delete')"
            />
            <DcButton
              data-testid="cron-job-editor-cancel"
              variant="outline"
              size="sm"
              :disabled="busy"
              @click="emit('cancel')"
            >
              {{ t('common.cancel') }}
            </DcButton>
            <DcButton
              data-testid="cron-job-editor-save"
              size="sm"
              :loading="saving"
              :disabled="busy || !canSave"
              @click="emit('save')"
            >
              {{ mode === 'create' ? t('settings.cronJobs.actions.create') : t('common.save') }}
            </DcButton>
          </template>
        </div>
      </div>
    </header>

    <div class="px-4 py-4 lg:px-6">
      <div v-if="mode === 'view' && job" class="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <div
          v-if="job.status === 'invalid_agent'"
          role="alert"
          class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {{ t('settings.cronJobs.status.invalidAgent') }}
        </div>
        <div
          v-if="job.scheduleError"
          role="alert"
          class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {{ job.scheduleError }}
        </div>

        <DcSectionCard :title="t('settings.cronJobs.detail.scheduleTitle')">
          <dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div class="min-w-0">
              <dt class="text-xs text-muted-foreground">
                {{ t('settings.cronJobs.fields.cronExpr') }}
              </dt>
              <dd class="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                <span class="font-medium">{{ describeSchedule(job.cronExpr) }}</span>
                <code
                  class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {{ job.cronExpr }}
                </code>
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs text-muted-foreground">
                {{ t('settings.cronJobs.fields.timezone') }}
              </dt>
              <dd class="mt-1 truncate font-medium">{{ job.timezone }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs text-muted-foreground">
                {{ t('settings.cronJobs.nextRunAt') }}
              </dt>
              <dd class="mt-1 truncate font-medium">{{ formatTimestamp(job.nextRunAt) }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs text-muted-foreground">
                {{ t('settings.cronJobs.detail.lastRun') }}
              </dt>
              <dd class="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                <DcBadge
                  v-if="latestRun"
                  :variant="
                    latestRun.status === 'failed' || latestRun.status === 'cancelled'
                      ? 'destructive'
                      : 'outline'
                  "
                  class="font-normal"
                >
                  {{ describeRunStatus(latestRun.status) }}
                </DcBadge>
                <span v-else class="text-muted-foreground">
                  {{ t('settings.cronJobs.detail.neverRun') }}
                </span>
                <span v-if="latestRun" class="truncate text-xs text-muted-foreground">
                  {{ formatTimestamp(latestRun.startedAt ?? latestRun.queuedAt) }}
                </span>
              </dd>
            </div>
          </dl>
        </DcSectionCard>

        <DcSectionCard :title="t('settings.cronJobs.fields.taskPrompt')">
          <p
            class="whitespace-pre-wrap break-words text-sm text-foreground"
            :class="job.taskPrompt ? '' : 'text-muted-foreground'"
          >
            {{ job.taskPrompt || t('settings.cronJobs.detail.promptEmpty') }}
          </p>
          <dl class="mt-4 grid gap-x-6 gap-y-3 border-t border-border pt-3 text-sm sm:grid-cols-2">
            <div class="min-w-0">
              <dt class="text-xs text-muted-foreground">
                {{ t('settings.cronJobs.fields.agent') }}
              </dt>
              <dd class="mt-1 truncate font-medium">{{ agentLabel }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs text-muted-foreground">
                {{ t('settings.cronJobs.fields.runtimePolicy') }}
              </dt>
              <dd class="mt-1 truncate font-medium">
                {{
                  getRuntimePolicy(job) === 'snapshot'
                    ? t('settings.cronJobs.fields.pinCurrent')
                    : t('settings.cronJobs.fields.followAgent')
                }}
              </dd>
            </div>
          </dl>
        </DcSectionCard>

        <DcSectionCard :title="t('settings.cronJobs.fields.delivery')">
          <div v-if="remoteDeliveryTarget" class="space-y-2 text-sm">
            <div class="flex min-w-0 items-center gap-2">
              <Icon icon="lucide:send" class="size-4 shrink-0 text-muted-foreground" />
              <span class="min-w-0 truncate">{{ remoteDeliveryLabel }}</span>
            </div>
            <div
              v-if="latestRunDeliveries.length > 0 || latestRunDeliveryError"
              class="flex flex-wrap items-center gap-2"
            >
              <DcBadge
                v-for="receipt in latestRunDeliveries"
                :key="receipt.id"
                :variant="receipt.status === 'failed' ? 'destructive' : 'secondary'"
                class="font-normal"
              >
                {{ describeDeliveryReceipt(receipt) }}
              </DcBadge>
              <span v-if="latestRunDeliveryError" class="text-xs text-destructive">
                {{ t('common.error.requestFailed') }}
              </span>
            </div>
          </div>
          <p v-else class="text-sm text-muted-foreground">
            {{ t('settings.cronJobs.detail.deliveryDisabled') }}
          </p>
        </DcSectionCard>

        <DcSectionCard>
          <template #header>
            <button
              type="button"
              data-testid="cron-job-history-toggle"
              class="flex items-center gap-2 text-sm font-bold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-expanded="historyOpen"
              @click="toggleHistory"
            >
              <Icon
                :icon="historyOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'"
                class="size-4 text-muted-foreground"
              />
              {{ t('settings.cronJobs.detail.historyTitle') }}
            </button>
          </template>
          <div v-if="historyOpen" class="space-y-3">
            <div v-if="runsLoading" class="text-xs text-muted-foreground">
              {{ t('common.loading') }}
            </div>
            <div v-else-if="runsError" class="flex items-center gap-2 text-xs text-destructive">
              <span>{{ t('common.error.requestFailed') }}</span>
              <DcButton
                variant="link"
                size="sm"
                class="h-auto p-0 text-xs"
                @click="emit('reloadRuns')"
              >
                {{ t('common.retry') }}
              </DcButton>
            </div>
            <p v-else-if="runs.length === 0" class="text-xs text-muted-foreground">
              {{ t('settings.cronJobs.detail.noRuns') }}
            </p>
            <ul v-else class="space-y-2">
              <li
                v-for="run in runs"
                :key="run.id"
                class="rounded-md border border-border bg-card/30 px-3 py-2"
              >
                <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <DcBadge
                    :variant="
                      run.status === 'failed' || run.status === 'cancelled'
                        ? 'destructive'
                        : 'outline'
                    "
                    class="font-normal"
                  >
                    {{ describeRunStatus(run.status) }}
                  </DcBadge>
                  <span class="text-muted-foreground">
                    {{ formatTimestamp(run.startedAt ?? run.queuedAt) }}
                  </span>
                  <span class="text-muted-foreground">· {{ describeRunReason(run) }}</span>
                  <span v-if="formatRunDuration(run)" class="text-muted-foreground">
                    · {{ formatRunDuration(run) }}
                  </span>
                </div>
                <p v-if="run.error" class="mt-1 break-words text-xs text-destructive">
                  {{ run.error }}
                </p>
                <details v-if="run.outputPreview" class="mt-1 text-xs">
                  <summary class="cursor-pointer text-muted-foreground">
                    {{ t('settings.cronJobs.runs.output') }}
                  </summary>
                  <pre class="mt-2 whitespace-pre-wrap break-words">{{ run.outputPreview }}</pre>
                </details>
              </li>
            </ul>
          </div>
        </DcSectionCard>
      </div>

      <form
        v-else-if="draft"
        class="mx-auto flex w-full max-w-4xl flex-col gap-4"
        @submit.prevent="emit('save')"
      >
        <DcSectionCard :title="t('settings.cronJobs.detail.basicsTitle')">
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="space-y-2">
              <span class="text-sm font-medium">{{ t('settings.cronJobs.fields.name') }}</span>
              <Input
                v-model="draftName"
                data-testid="cron-job-name-input"
                :placeholder="t('settings.cronJobs.defaults.name')"
              />
            </label>
            <label class="space-y-2">
              <span class="text-sm font-medium">{{ t('settings.cronJobs.fields.agent') }}</span>
              <Select
                data-testid="cron-job-agent-select"
                :model-value="draft.agentId ?? NO_AGENT_ID"
                @update:model-value="(value) => onAgentChange(String(value))"
              >
                <SelectTrigger
                  :aria-label="t('settings.cronJobs.fields.agent')"
                  class="w-full min-w-0"
                >
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
            </label>
            <label class="space-y-2 sm:col-span-2">
              <span class="text-sm font-medium">{{ t('settings.cronJobs.fields.timezone') }}</span>
              <Select
                data-testid="cron-job-timezone-select"
                :model-value="draft.timezone || browserTimezone"
                @update:model-value="(value) => onTimezoneChange(String(value))"
              >
                <SelectTrigger
                  :aria-label="t('settings.cronJobs.fields.timezone')"
                  class="w-full min-w-0"
                >
                  <SelectValue class="min-w-0 truncate" />
                </SelectTrigger>
                <SelectContent class="max-h-72">
                  <SelectItem v-for="timezone in timezones" :key="timezone" :value="timezone">
                    {{ timezone }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
        </DcSectionCard>

        <DcSectionCard :title="t('settings.cronJobs.fields.schedule')">
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="space-y-2">
              <span class="text-sm font-medium">{{ t('settings.cronJobs.fields.preset') }}</span>
              <Select
                data-testid="cron-job-preset-select"
                :model-value="presetKind"
                @update:model-value="(value) => onPresetChange(String(value))"
              >
                <SelectTrigger
                  :aria-label="t('settings.cronJobs.fields.preset')"
                  class="w-full min-w-0"
                >
                  <SelectValue class="min-w-0 truncate" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="option in presetOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label v-if="showTimeControl" class="space-y-2">
              <span class="text-sm font-medium">{{
                t('settings.cronJobs.fields.scheduleTime')
              }}</span>
              <Input
                data-testid="cron-job-schedule-time"
                type="time"
                :model-value="scheduleTime"
                @update:model-value="(value) => onTimeChange(String(value))"
              />
            </label>
            <label v-if="schedule.kind === 'weekly'" class="space-y-2">
              <span class="text-sm font-medium">
                {{ t('settings.cronJobs.fields.scheduleWeekday') }}
              </span>
              <Select
                :model-value="String(schedule.weekday)"
                @update:model-value="(value) => onWeekdayChange(String(value))"
              >
                <SelectTrigger
                  :aria-label="t('settings.cronJobs.fields.scheduleWeekday')"
                  class="w-full min-w-0"
                >
                  <SelectValue class="min-w-0 truncate" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="weekday in weekdayOptions"
                    :key="weekday.value"
                    :value="String(weekday.value)"
                  >
                    {{ weekday.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label v-if="schedule.kind === 'monthly'" class="space-y-2">
              <span class="text-sm font-medium">
                {{ t('settings.cronJobs.fields.scheduleMonthDay') }}
              </span>
              <Input
                :model-value="String(schedule.monthDay)"
                type="number"
                min="1"
                max="31"
                @update:model-value="(value) => onMonthDayChange(String(value))"
              />
            </label>
            <label v-if="schedule.kind === 'hourly'" class="space-y-2">
              <span class="text-sm font-medium">
                {{ t('settings.cronJobs.fields.scheduleMinute') }}
              </span>
              <Input
                :model-value="String(schedule.minute)"
                type="number"
                min="0"
                max="59"
                @update:model-value="(value) => onMinuteChange(String(value))"
              />
            </label>
            <label class="space-y-2 sm:col-span-2">
              <span class="text-sm font-medium">{{ t('settings.cronJobs.fields.cronExpr') }}</span>
              <Input
                data-testid="cron-job-cron-input"
                :model-value="draft.cronExpr"
                class="font-mono text-xs"
                @update:model-value="(value) => patchDraft({ cronExpr: String(value) })"
              />
            </label>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-2">
            <Icon icon="lucide:calendar-range" class="size-4 shrink-0 text-muted-foreground" />
            <span class="text-xs text-muted-foreground">
              {{ t('settings.cronJobs.nextRunAt') }}
            </span>
            <DcBadge v-if="previewLoading" variant="outline" class="font-normal">
              {{ t('common.loading') }}
            </DcBadge>
            <template v-else-if="previewRuns.length > 0">
              <DcBadge
                v-for="runAt in previewRuns"
                :key="runAt"
                variant="outline"
                class="font-normal"
              >
                {{ formatTimestamp(runAt) }}
              </DcBadge>
            </template>
            <span v-else class="text-xs text-muted-foreground">{{
              t('settings.cronJobs.none')
            }}</span>
          </div>
          <DcInlineError v-if="previewError" :error="previewError" />
        </DcSectionCard>

        <DcSectionCard :title="t('settings.cronJobs.fields.taskPrompt')">
          <Textarea
            v-model="draftPrompt"
            data-testid="cron-job-prompt-input"
            class="min-h-[140px] resize-y text-sm"
            :placeholder="t('settings.cronJobs.detail.promptPlaceholder')"
          />
        </DcSectionCard>

        <DcSectionCard :title="t('settings.cronJobs.fields.runtimePolicy')">
          <Select
            data-testid="cron-job-runtime-select"
            :model-value="getRuntimePolicy(draft)"
            @update:model-value="(value) => onRuntimePolicyChange(String(value))"
          >
            <SelectTrigger
              :aria-label="t('settings.cronJobs.fields.runtimePolicy')"
              class="w-full min-w-0 sm:max-w-xs"
            >
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
        </DcSectionCard>

        <DcSectionCard :title="t('settings.cronJobs.fields.delivery')">
          <div class="space-y-3">
            <DcToggleRow
              id="cron-job-remote-delivery"
              :label="t('settings.cronJobs.fields.remoteDelivery')"
              :model-value="remoteDeliveryEnabled"
              :disabled="
                busy ||
                remoteDeliveryLoading ||
                (!remoteDeliveryEnabled && remoteDeliveryOptions.length === 0)
              "
              @update:model-value="onRemoteDeliveryToggle"
            />
            <Select
              v-if="remoteDeliveryEnabled"
              data-testid="cron-job-remote-channel-select"
              :model-value="remoteDeliveryValue"
              :disabled="busy || remoteDeliveryLoading || remoteDeliveryOptions.length === 0"
              @update:model-value="(value) => onRemoteTargetChange(String(value))"
            >
              <SelectTrigger
                :aria-label="t('settings.cronJobs.fields.remoteChannel')"
                class="w-full min-w-0 sm:max-w-md"
              >
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
                  {{ describeRemoteDeliveryOption(option) }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p
              v-if="
                !remoteDeliveryLoadFailed &&
                !remoteDeliveryLoading &&
                remoteDeliveryOptions.length === 0
              "
              class="text-xs text-muted-foreground"
            >
              {{ t('settings.cronJobs.fields.noRemoteChannels') }}
            </p>
            <div
              v-if="remoteDeliveryLoadFailed"
              class="flex flex-wrap items-center gap-2 text-xs text-destructive"
            >
              <span>{{ t('common.error.requestFailed') }}</span>
              <DcButton
                variant="link"
                size="sm"
                class="h-auto p-0 text-xs"
                :disabled="remoteDeliveryLoading"
                @click="emit('retryRemoteOptions')"
              >
                {{ t('common.retry') }}
              </DcButton>
            </div>
          </div>
        </DcSectionCard>

        <DcSectionCard v-if="mode === 'create'">
          <DcToggleRow
            id="cron-job-create-enabled"
            :label="t('settings.cronJobs.fields.createEnabled')"
            :description="t('settings.cronJobs.fields.createEnabledHint')"
            :model-value="draft.enabled"
            :disabled="busy"
            @update:model-value="(value) => patchDraft({ enabled: value })"
          />
        </DcSectionCard>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { DcSectionCard } from '@dc-ui/components/section-card'
import { DcToggleRow } from '@dc-ui/components/toggle-row'
import { Input } from '@shadcn/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Switch } from '@shadcn/components/ui/switch'
import { Textarea } from '@shadcn/components/ui/textarea'
import type { CronJob, CronJobDeliveryReceipt, CronJobRun } from '@shared/cronJobs'
import type { Agent } from '@shared/types/agent-interface'
import { createRemoteDeliveryTarget, type RemoteDeliveryOption } from './cronJobDelivery'
import {
  buildCronExpr,
  changeScheduleKind,
  describeCronSchedule,
  formatScheduleTime,
  MONTH_DAY_MAX,
  MONTH_DAY_MIN,
  parseScheduleTime,
  type CronScheduleKind
} from './cronJobSchedule'
import { useCronJobFormat } from './useCronJobFormat'

const NO_AGENT_ID = '__none__'

const props = defineProps<{
  mode: 'view' | 'edit' | 'create'
  job: CronJob | null
  dirty: boolean
  busy: boolean
  saving: boolean
  runningNow: boolean
  narrow: boolean
  agents: Agent[]
  timezones: string[]
  browserTimezone: string
  remoteDeliveryOptions: RemoteDeliveryOption[]
  remoteDeliveryLoading: boolean
  remoteDeliveryLoadFailed: boolean
  previewRuns: number[]
  previewLoading: boolean
  previewError: string | null
  runs: CronJobRun[]
  runsLoading: boolean
  runsError: boolean
  latestRun: CronJobRun | null
  latestRunDeliveries: CronJobDeliveryReceipt[]
  latestRunDeliveryError: boolean
}>()

const emit = defineEmits<{
  (e: 'save'): void
  (e: 'cancel'): void
  (e: 'edit'): void
  (e: 'delete'): void
  (e: 'runNow'): void
  (e: 'toggle', enabled: boolean): void
  (e: 'back'): void
  (e: 'retryRemoteOptions'): void
  (e: 'reloadRuns'): void
}>()

const draft = defineModel<CronJob | null>('draft', { required: true })

const { t } = useI18n()
const {
  formatTimestamp,
  describeSchedule,
  describeRunStatus,
  describeJobStatus,
  describeRunReason,
  formatRunDuration,
  describeDeliveryReceipt,
  describeRemoteDeliveryOption,
  weekdayOptions
} = useCronJobFormat()

const historyOpen = ref(false)

const patchDraft = (patch: Partial<CronJob>) => {
  const current = draft.value
  if (!current) {
    return
  }
  draft.value = { ...current, ...patch }
}

const draftName = computed({
  get: () => draft.value?.name ?? '',
  set: (value: string) => patchDraft({ name: value })
})

const draftPrompt = computed({
  get: () => draft.value?.taskPrompt ?? '',
  set: (value: string) => patchDraft({ taskPrompt: value })
})

const enabledAgents = computed(() =>
  props.agents
    .filter((agent) => agent.enabled)
    .sort((left, right) => left.name.localeCompare(right.name))
)

const agentLabel = computed(() => {
  const agentId = props.job?.agentId
  if (!agentId) {
    return t('settings.cronJobs.fields.noAgent')
  }
  return (
    props.agents.find((agent) => agent.id === agentId)?.name ??
    t('settings.cronJobs.fields.noAgent')
  )
})

const heading = computed(() => {
  if (props.mode === 'create') {
    return t('settings.cronJobs.detail.createTitle')
  }
  if (props.mode === 'edit') {
    return t('settings.cronJobs.detail.editTitle')
  }
  return props.job?.name ?? ''
})

const headingSchedule = computed(() => {
  const cronExpr = props.mode === 'view' ? props.job?.cronExpr : draft.value?.cronExpr
  return cronExpr ? describeSchedule(cronExpr) : ''
})

const statusBadgeVariant = computed(() => {
  if (!props.job) {
    return 'outline'
  }
  if (props.job.status === 'invalid_agent') {
    return 'destructive'
  }
  return props.job.enabled ? 'default' : 'outline'
})

const canSave = computed(() => Boolean(draft.value?.name.trim()))

const schedule = computed(() => describeCronSchedule(draft.value?.cronExpr ?? ''))
const scheduleTime = computed(() => formatScheduleTime(schedule.value.hour, schedule.value.minute))
const showTimeControl = computed(() =>
  ['daily', 'weekdays', 'weekly', 'monthly'].includes(schedule.value.kind)
)

const presetOptions = computed(() => [
  { value: 'every5Minutes', label: t('settings.cronJobs.presets.every5Minutes') },
  { value: 'hourly', label: t('settings.cronJobs.presets.hourly') },
  { value: 'daily', label: t('settings.cronJobs.presets.daily') },
  { value: 'weekdays', label: t('settings.cronJobs.presets.weekdays') },
  { value: 'weekly', label: t('settings.cronJobs.presets.weekly') },
  { value: 'monthly', label: t('settings.cronJobs.presets.monthly') },
  { value: 'custom', label: t('settings.cronJobs.presets.custom') }
])

/**
 * The expression the user last chose the `custom` preset for, or null. A cron expression cannot
 * express `custom`: choosing it keeps the current expression, which `describeCronSchedule` then
 * classifies back to its preset kind, so the select would reset itself. Scoping the choice to the
 * expression it was made for drops it again as soon as that expression changes — by typing a new
 * one, or by switching tasks.
 */
const customScheduleExpr = ref<string | null>(null)

const presetKind = computed(() =>
  schedule.value.kind !== 'custom' && customScheduleExpr.value === schedule.value.cronExpr
    ? 'custom'
    : schedule.value.kind
)

const onPresetChange = (value: string) => {
  const kind = value as CronScheduleKind
  const next = changeScheduleKind(schedule.value, kind, schedule.value.cronExpr)
  customScheduleExpr.value = kind === 'custom' ? schedule.value.cronExpr : null
  patchDraft({ cronExpr: next.cronExpr })
}

const onTimeChange = (value: string) => {
  const parsed = parseScheduleTime(value)
  if (!parsed) {
    return
  }
  patchDraft({ cronExpr: buildCronExpr({ ...schedule.value, ...parsed }) })
}

const onWeekdayChange = (value: string) => {
  const weekday = Number.parseInt(value, 10)
  if (Number.isNaN(weekday)) {
    return
  }
  patchDraft({ cronExpr: buildCronExpr({ ...schedule.value, weekday }) })
}

const clampInteger = (value: string, min: number, max: number): number | null => {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    return null
  }
  return Math.min(max, Math.max(min, parsed))
}

const onMonthDayChange = (value: string) => {
  const monthDay = clampInteger(value, MONTH_DAY_MIN, MONTH_DAY_MAX)
  if (monthDay === null) {
    return
  }
  patchDraft({ cronExpr: buildCronExpr({ ...schedule.value, monthDay }) })
}

const onMinuteChange = (value: string) => {
  const minute = clampInteger(value, 0, 59)
  if (minute === null) {
    return
  }
  patchDraft({ cronExpr: buildCronExpr({ ...schedule.value, minute }) })
}

const onAgentChange = (value: string) => {
  patchDraft({ agentId: value === NO_AGENT_ID ? null : value })
}

const onTimezoneChange = (value: string) => {
  patchDraft({ timezone: value })
}

const getRuntimePolicy = (job: CronJob): 'follow_agent' | 'snapshot' =>
  job.modelPolicy === 'pin_current' ||
  job.toolPolicy === 'snapshot' ||
  job.permissionPolicy === 'snapshot'
    ? 'snapshot'
    : 'follow_agent'

const onRuntimePolicyChange = (value: string) => {
  const snapshot = value === 'snapshot'
  patchDraft({
    modelPolicy: snapshot ? 'pin_current' : 'follow_agent',
    toolPolicy: snapshot ? 'snapshot' : 'follow_agent',
    permissionPolicy: snapshot ? 'snapshot' : 'follow_agent'
  })
}

const remoteDeliveryTarget = computed(() => {
  const current = props.mode === 'view' ? props.job : draft.value
  return current?.delivery.targets[0] ?? null
})

const remoteDeliveryEnabled = computed(() => Boolean(remoteDeliveryTarget.value))

const remoteDeliveryValue = computed(() => remoteDeliveryTarget.value?.channelId ?? '')

const remoteDeliveryLabel = computed(() => {
  const target = remoteDeliveryTarget.value
  if (!target) {
    return ''
  }
  const option = props.remoteDeliveryOptions.find((entry) => entry.value === target.channelId)
  return option ? describeRemoteDeliveryOption(option) : target.remoteId
})

const patchDelivery = (targets: CronJob['delivery']['targets']) => {
  const current = draft.value
  if (!current) {
    return
  }
  patchDraft({ delivery: { ...current.delivery, targets } })
}

const onRemoteDeliveryToggle = (enabled: boolean) => {
  if (!enabled) {
    patchDelivery([])
    return
  }
  const option = props.remoteDeliveryOptions[0]
  if (!option) {
    return
  }
  patchDelivery([createRemoteDeliveryTarget(option)])
}

const onRemoteTargetChange = (value: string) => {
  const option = props.remoteDeliveryOptions.find((entry) => entry.value === value)
  if (!option) {
    return
  }
  patchDelivery([createRemoteDeliveryTarget(option)])
}

const toggleHistory = () => {
  historyOpen.value = !historyOpen.value
}

watch(
  () => props.mode,
  () => {
    historyOpen.value = false
  }
)
</script>
