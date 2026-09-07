import { CronExpressionParser } from 'cron-parser'
import type {
  CronJobMisfirePolicy,
  CronSchedulePreset,
  CronSchedulePreview,
  CronScheduleValidation
} from '@shared/cronJobs'

export interface CronJobSchedule {
  cronExpr: string
  timezone: string
  misfirePolicy?: CronJobMisfirePolicy
  maxCatchUpRuns?: number | null
}

export interface DueRunReconciliation {
  scheduledAts: number[]
  nextRunAt: number | null
  error: string | null
}

const DEFAULT_PREVIEW_COUNT = 5
const MAX_PREVIEW_COUNT = 10
const DEFAULT_DUE_GRACE_MS = 60_000

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const parseTime = (time: string): { hour: number; minute: number } => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!match) {
    throw new Error(`Invalid time: ${time}`)
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid time: ${time}`)
  }

  return { hour, minute }
}

export class CronExpressionService {
  validate(cronExpr: string, timezone: string, from = Date.now()): CronScheduleValidation {
    try {
      return {
        valid: true,
        error: null,
        nextRunAt: this.computeNextRunAt({ cronExpr, timezone }, from)
      }
    } catch (error) {
      return {
        valid: false,
        error: toErrorMessage(error),
        nextRunAt: null
      }
    }
  }

  preview(
    cronExpr: string,
    timezone: string,
    count = DEFAULT_PREVIEW_COUNT,
    from = Date.now()
  ): CronSchedulePreview {
    try {
      const safeCount = Math.min(Math.max(Math.trunc(count), 1), MAX_PREVIEW_COUNT)
      const interval = CronExpressionParser.parse(cronExpr, {
        currentDate: from,
        tz: timezone
      })
      return {
        runs: interval.take(safeCount).map((date) => date.getTime()),
        error: null
      }
    } catch (error) {
      return {
        runs: [],
        error: toErrorMessage(error)
      }
    }
  }

  computeNextRunAt(schedule: Pick<CronJobSchedule, 'cronExpr' | 'timezone'>, from = Date.now()) {
    const interval = CronExpressionParser.parse(schedule.cronExpr, {
      currentDate: from,
      tz: schedule.timezone
    })
    return interval.next().getTime()
  }

  reconcileDueRun(
    schedule: CronJobSchedule,
    scheduledAt: number,
    now = Date.now(),
    dueGraceMs = DEFAULT_DUE_GRACE_MS
  ): DueRunReconciliation {
    try {
      const scheduledAts =
        schedule.misfirePolicy === 'run_once'
          ? this.computeCatchUpRuns(schedule, scheduledAt, now)
          : now - scheduledAt <= dueGraceMs
            ? [scheduledAt]
            : []

      return {
        scheduledAts,
        nextRunAt: this.computeNextRunAt(schedule, now),
        error: null
      }
    } catch (error) {
      return {
        scheduledAts: [],
        nextRunAt: null,
        error: toErrorMessage(error)
      }
    }
  }

  presetToCron(preset: CronSchedulePreset): string {
    switch (preset.type) {
      case 'every_n_minutes':
        if (!Number.isInteger(preset.n) || preset.n < 1 || preset.n > 59) {
          throw new Error(`Invalid minute interval: ${preset.n}`)
        }
        return `*/${preset.n} * * * *`
      case 'hourly':
        if (!Number.isInteger(preset.minute) || preset.minute < 0 || preset.minute > 59) {
          throw new Error(`Invalid minute: ${preset.minute}`)
        }
        return `${preset.minute} * * * *`
      case 'daily': {
        const { hour, minute } = parseTime(preset.time)
        return `${minute} ${hour} * * *`
      }
      case 'weekdays': {
        const { hour, minute } = parseTime(preset.time)
        return `${minute} ${hour} * * 1-5`
      }
      case 'weekly': {
        const { hour, minute } = parseTime(preset.time)
        const days = [...new Set(preset.days)].sort((left, right) => left - right)
        if (days.length === 0 || days.some((day) => !Number.isInteger(day) || day < 0 || day > 7)) {
          throw new Error('Invalid weekly days')
        }
        return `${minute} ${hour} * * ${days.join(',')}`
      }
      case 'monthly': {
        const { hour, minute } = parseTime(preset.time)
        const day = preset.day === 'last' ? 'L' : preset.day
        if (typeof day === 'number' && (!Number.isInteger(day) || day < 1 || day > 31)) {
          throw new Error(`Invalid monthly day: ${day}`)
        }
        return `${minute} ${hour} ${day} * *`
      }
      case 'custom':
        return preset.cronExpr
    }
  }

  private computeCatchUpRuns(
    schedule: CronJobSchedule,
    scheduledAt: number,
    now: number
  ): number[] {
    const maxCatchUpRuns = schedule.maxCatchUpRuns ?? 1
    const safeLimit = Math.min(Math.max(Math.trunc(maxCatchUpRuns), 1), MAX_PREVIEW_COUNT)
    const interval = CronExpressionParser.parse(schedule.cronExpr, {
      currentDate: Math.max(0, scheduledAt - 1_000),
      tz: schedule.timezone
    })
    const scheduledAts: number[] = []

    for (const date of interval.take(safeLimit)) {
      const timestamp = date.getTime()
      if (timestamp > now) {
        break
      }
      scheduledAts.push(timestamp)
    }

    return scheduledAts
  }
}
