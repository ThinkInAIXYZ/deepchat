import { useI18n } from 'vue-i18n'
import type { CronJob, CronJobRun, CronJobRunStatus } from '@shared/cronJobs'
import { describeCronSchedule, formatScheduleTime, WEEKDAY_VALUES } from './cronJobSchedule'
import type { RemoteDeliveryOption } from './cronJobDelivery'

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export const useCronJobFormat = () => {
  const { t } = useI18n()

  const formatTimestamp = (timestamp: number | null): string =>
    timestamp ? new Date(timestamp).toLocaleString() : t('settings.cronJobs.none')

  const describeSchedule = (cronExpr: string): string => {
    const schedule = describeCronSchedule(cronExpr)
    const time = formatScheduleTime(schedule.hour, schedule.minute)
    switch (schedule.kind) {
      case 'every5Minutes':
        return t('settings.cronJobs.schedule.every5Minutes')
      case 'hourly':
        return t('settings.cronJobs.schedule.hourly', { minute: schedule.minute })
      case 'daily':
        return t('settings.cronJobs.schedule.daily', { time })
      case 'weekdays':
        return t('settings.cronJobs.schedule.weekdays', { time })
      case 'weekly':
        return t('settings.cronJobs.schedule.weekly', {
          weekday: t(`settings.cronJobs.weekdays.${WEEKDAY_KEYS[schedule.weekday] ?? 'mon'}`),
          time
        })
      case 'monthly':
        return t('settings.cronJobs.schedule.monthly', { day: schedule.monthDay, time })
      default:
        return cronExpr.trim() || t('settings.cronJobs.none')
    }
  }

  const describeRunStatus = (status: CronJobRunStatus): string =>
    t(`chat.toolCall.subagents.status.${status === 'failed' ? 'error' : status}`)

  const describeJobStatus = (job: CronJob): string => {
    if (job.status === 'invalid_agent') {
      return t('settings.cronJobs.status.invalidAgentShort')
    }
    return job.enabled
      ? t('settings.cronJobs.status.ready')
      : t('settings.cronJobs.status.jobDisabled')
  }

  const describeRunReason = (run: CronJobRun): string =>
    run.reason === 'manual'
      ? t('settings.cronJobs.runs.reasonManual')
      : t('settings.cronJobs.runs.reasonScheduled')

  const formatRunDuration = (run: CronJobRun): string | null => {
    if (!run.startedAt) {
      return null
    }
    const endAt = run.completedAt ?? run.updatedAt
    const seconds = Math.max(0, Math.round((endAt - run.startedAt) / 1000))
    if (seconds < 60) {
      return t('settings.cronJobs.runs.durationSeconds', { value: seconds })
    }
    return t('settings.cronJobs.runs.durationMinutes', {
      minutes: Math.floor(seconds / 60),
      seconds: seconds % 60
    })
  }

  const describeDeliveryReceipt = (receipt: {
    target: { remoteId: string }
    status: string
    createdAt: number
  }): string => {
    const statusKey =
      receipt.status === 'failed'
        ? 'settings.cronJobs.fields.deliveryFailed'
        : 'settings.cronJobs.fields.deliverySuccess'
    return `${receipt.target.remoteId} ${t(statusKey)} ${formatTimestamp(receipt.createdAt)}`
  }

  const describeRemoteDeliveryOption = (option: RemoteDeliveryOption): string => {
    const threadSuffix = option.binding.threadId ? `:${option.binding.threadId}` : ''
    return `${t(option.titleKey)} / ${t(`settings.remote.bindingKinds.${option.binding.kind}`)} ${
      option.binding.chatId
    }${threadSuffix}`
  }

  const weekdayOptions = WEEKDAY_VALUES.map((value) => ({
    value,
    label: t(`settings.cronJobs.weekdays.${WEEKDAY_KEYS[value]}`)
  }))

  return {
    formatTimestamp,
    describeSchedule,
    describeRunStatus,
    describeJobStatus,
    describeRunReason,
    formatRunDuration,
    describeDeliveryReceipt,
    describeRemoteDeliveryOption,
    weekdayOptions
  }
}
