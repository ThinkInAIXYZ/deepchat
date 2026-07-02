import type { ScheduledTask } from '@shared/scheduledTasks'

const buildWallClockToday = (
  reference: number,
  hour: number,
  minute: number,
  dayOffset = 0
): number => {
  const date = new Date(reference)
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

export function computeNextRunAt(input: {
  task: ScheduledTask
  referenceTime: number
  afterRun?: boolean
  misfirePolicy?: 'skip' | 'run_once'
}): number | null {
  const { task, referenceTime, afterRun = false, misfirePolicy = 'run_once' } = input

  if (!task.enabled) {
    return null
  }

  const trigger = task.trigger
  switch (trigger.kind) {
    case 'once':
      if (afterRun || task.lastFiredAt) {
        return null
      }
      if (trigger.firesAt > referenceTime) {
        return trigger.firesAt
      }
      return misfirePolicy === 'run_once' ? referenceTime : null
    case 'daily': {
      let candidate = buildWallClockToday(referenceTime, trigger.hour, trigger.minute, 0)
      if (candidate <= referenceTime) {
        candidate = buildWallClockToday(referenceTime, trigger.hour, trigger.minute, 1)
      }
      return candidate
    }
    case 'weekly': {
      const reference = new Date(referenceTime)
      const currentDay = reference.getDay()
      let dayOffset = (trigger.dayOfWeek - currentDay + 7) % 7
      let candidate = buildWallClockToday(referenceTime, trigger.hour, trigger.minute, dayOffset)
      if (candidate <= referenceTime) {
        dayOffset += 7
        candidate = buildWallClockToday(referenceTime, trigger.hour, trigger.minute, dayOffset)
      }
      return candidate
    }
  }
}
