/**
 * Pure helpers that map between cron expressions and the preset controls shown in
 * the scheduled-task editor. The editor keeps the cron expression as the single
 * source of truth, so every helper is total and never throws on user input.
 */

export type CronScheduleKind =
  | 'every5Minutes'
  | 'hourly'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly'
  | 'custom'

export interface CronScheduleDescriptor {
  kind: CronScheduleKind
  minute: number
  hour: number
  weekday: number
  monthDay: number
  cronExpr: string
}

export const WEEKDAY_VALUES = [0, 1, 2, 3, 4, 5, 6] as const
export const MONTH_DAY_MIN = 1
export const MONTH_DAY_MAX = 31

const CRON_PART_COUNT = 5

export const DEFAULT_CRON_SCHEDULE: CronScheduleDescriptor = {
  kind: 'daily',
  minute: 0,
  hour: 9,
  weekday: 1,
  monthDay: 1,
  cronExpr: '0 9 * * *'
}

const parseBoundedInteger = (value: string, min: number, max: number): number | null => {
  if (!/^\d{1,2}$/.test(value)) {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  return parsed >= min && parsed <= max ? parsed : null
}

const createDescriptor = (
  kind: CronScheduleKind,
  overrides: Partial<Omit<CronScheduleDescriptor, 'kind' | 'cronExpr'>> = {}
): CronScheduleDescriptor => {
  const descriptor: CronScheduleDescriptor = {
    kind,
    minute: overrides.minute ?? DEFAULT_CRON_SCHEDULE.minute,
    hour: overrides.hour ?? DEFAULT_CRON_SCHEDULE.hour,
    weekday: overrides.weekday ?? DEFAULT_CRON_SCHEDULE.weekday,
    monthDay: overrides.monthDay ?? DEFAULT_CRON_SCHEDULE.monthDay,
    cronExpr: ''
  }
  return { ...descriptor, cronExpr: buildCronExpr(descriptor) }
}

export const buildCronExpr = (descriptor: CronScheduleDescriptor): string => {
  const { minute, hour, weekday, monthDay } = descriptor
  switch (descriptor.kind) {
    case 'every5Minutes':
      return '*/5 * * * *'
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`
    case 'weekly':
      return `${minute} ${hour} * * ${weekday}`
    case 'monthly':
      return `${minute} ${hour} ${monthDay} * *`
    default:
      return descriptor.cronExpr
  }
}

export const describeCronSchedule = (cronExpr: string): CronScheduleDescriptor => {
  const trimmed = cronExpr.trim()
  const custom: CronScheduleDescriptor = {
    ...DEFAULT_CRON_SCHEDULE,
    kind: 'custom',
    cronExpr: trimmed
  }
  const parts = trimmed.split(/\s+/)
  if (parts.length !== CRON_PART_COUNT) {
    return custom
  }

  const [minutePart, hourPart, dayOfMonthPart, monthPart, dayOfWeekPart] = parts
  if (monthPart !== '*') {
    return custom
  }

  if (minutePart === '*/5' && hourPart === '*' && dayOfMonthPart === '*' && dayOfWeekPart === '*') {
    return createDescriptor('every5Minutes')
  }

  const minute = parseBoundedInteger(minutePart, 0, 59)
  if (minute === null) {
    return custom
  }

  if (hourPart === '*' && dayOfMonthPart === '*' && dayOfWeekPart === '*') {
    return createDescriptor('hourly', { minute })
  }

  const hour = parseBoundedInteger(hourPart, 0, 23)
  if (hour === null) {
    return custom
  }

  if (dayOfMonthPart === '*' && dayOfWeekPart === '1-5') {
    return createDescriptor('weekdays', { minute, hour })
  }

  if (dayOfMonthPart === '*' && dayOfWeekPart === '*') {
    return createDescriptor('daily', { minute, hour })
  }

  if (dayOfMonthPart === '*') {
    const weekday = parseBoundedInteger(dayOfWeekPart, 0, 6)
    if (weekday !== null) {
      return createDescriptor('weekly', { minute, hour, weekday })
    }
    return custom
  }

  if (dayOfWeekPart === '*') {
    const monthDay = parseBoundedInteger(dayOfMonthPart, MONTH_DAY_MIN, MONTH_DAY_MAX)
    if (monthDay !== null) {
      return createDescriptor('monthly', { minute, hour, monthDay })
    }
  }

  return custom
}

export const changeScheduleKind = (
  current: CronScheduleDescriptor,
  kind: CronScheduleKind,
  cronExpr: string
): CronScheduleDescriptor =>
  kind === 'custom'
    ? { ...current, kind, cronExpr: cronExpr.trim() }
    : createDescriptor(kind, current)

export const formatScheduleTime = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

export const parseScheduleTime = (value: string): { hour: number; minute: number } | null => {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim())
  if (!match) {
    return null
  }
  const hour = Number.parseInt(match[1], 10)
  const minute = Number.parseInt(match[2], 10)
  if (hour > 23 || minute > 59) {
    return null
  }
  return { hour, minute }
}
