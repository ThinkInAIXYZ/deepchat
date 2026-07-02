import { describe, expect, it } from 'vitest'
import {
  SCHEDULED_TASKS_VERSION,
  type ScheduledTask,
  createDefaultScheduledTaskContext,
  createDefaultScheduledTaskDelivery,
  createDefaultScheduledTaskExecution
} from '@shared/scheduledTasks'
import { computeNextRunAt } from '@/presenter/scheduledTasks/schedulerCore/computeNextRunAt'

const task = (overrides: Partial<ScheduledTask>): ScheduledTask => ({
  id: 'task-1',
  version: SCHEDULED_TASKS_VERSION,
  name: 'Task',
  enabled: true,
  trigger: { kind: 'daily', hour: 9, minute: 0 },
  action: { kind: 'notify', title: 'Title', body: 'Body' },
  context: createDefaultScheduledTaskContext(),
  execution: createDefaultScheduledTaskExecution(),
  delivery: createDefaultScheduledTaskDelivery(),
  timezone: 'UTC',
  nextRunAt: null,
  lastRunId: null,
  lastFiredAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

describe('computeNextRunAt', () => {
  it('returns null for disabled tasks', () => {
    expect(computeNextRunAt({ task: task({ enabled: false }), referenceTime: 1000 })).toBeNull()
  })

  it('runs a missed one-shot once by default', () => {
    expect(
      computeNextRunAt({
        task: task({ trigger: { kind: 'once', firesAt: 1000 } }),
        referenceTime: 2000
      })
    ).toBe(2000)
  })

  it('skips a missed one-shot when asked', () => {
    expect(
      computeNextRunAt({
        task: task({ trigger: { kind: 'once', firesAt: 1000 } }),
        referenceTime: 2000,
        misfirePolicy: 'skip'
      })
    ).toBeNull()
  })

  it('rolls daily tasks to the next local slot', () => {
    const reference = new Date('2026-01-01T10:00:00')
    const expected = new Date('2026-01-02T09:00:00')

    expect(
      computeNextRunAt({
        task: task({ trigger: { kind: 'daily', hour: 9, minute: 0 } }),
        referenceTime: reference.getTime()
      })
    ).toBe(expected.getTime())
  })
})
