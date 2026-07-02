import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { ScheduledTasksService } from '../../../src/main/presenter/scheduledTasks'
import {
  computeNextFireAt,
  normalizeScheduledTasksConfig,
  shouldBackfillOneShot
} from '../../../src/main/presenter/scheduledTasks/normalize'
import { SCHEDULED_TASKS_VERSION, type ScheduledTask } from '@shared/scheduledTasks'
import { ScheduledTaskLocksTable } from '../../../src/main/presenter/sqlitePresenter/tables/scheduledTaskLocks'
import { ScheduledTaskRunsTable } from '../../../src/main/presenter/sqlitePresenter/tables/scheduledTaskRuns'
import { ScheduledTasksTable } from '../../../src/main/presenter/sqlitePresenter/tables/scheduledTasks'

let sqliteAvailable = false
try {
  const smokeDb = new Database(':memory:')
  smokeDb.close()
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}
const describeIfSqlite = sqliteAvailable ? describe : describe.skip

const baseTask = (
  overrides: Partial<ScheduledTask> & Pick<ScheduledTask, 'trigger' | 'action'>
): ScheduledTask => ({
  id: 'task-1',
  version: SCHEDULED_TASKS_VERSION,
  name: 'task',
  enabled: true,
  timezone: 'UTC',
  nextRunAt: null,
  lastRunId: null,
  createdAt: 0,
  updatedAt: 0,
  lastFiredAt: null,
  ...overrides
})

interface ServiceHarnessOptions {
  createSessionForTask?: ReturnType<typeof vi.fn>
}

const createServiceHarness = (tasks: ScheduledTask[], options: ServiceHarnessOptions = {}) => {
  const db = new Database(':memory:')
  new ScheduledTasksTable(db).createTable()
  new ScheduledTaskRunsTable(db).createTable()
  new ScheduledTaskLocksTable(db).createTable()
  const settings = { version: SCHEDULED_TASKS_VERSION, tasks }
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const sendToWindow = vi.fn()
  const focusMainWindow = vi.fn()
  const createSessionForTask =
    options.createSessionForTask ?? vi.fn().mockResolvedValue({ sessionId: 'session-1' })

  const service = new ScheduledTasksService({
    configPresenter: {
      getScheduledTasksConfig: () => settings,
      setScheduledTasksConfig: () => {
        return settings
      },
      getNotificationsEnabled: () => true
    },
    sqlitePresenter: {
      getDatabase: () => db,
      getDatabasePath: () => ':memory:',
      getDatabasePassword: () => undefined
    },
    notificationPresenter: { showNotification },
    windowPresenter: {
      mainWindow: null,
      sendToWindow,
      focusMainWindow
    },
    sessionCreator: { createSessionForTask }
  })

  return {
    service,
    getSettings: () => service.list(),
    close: () => db.close(),
    showNotification,
    sendToWindow,
    focusMainWindow,
    createSessionForTask
  }
}

describe('computeNextFireAt', () => {
  it('returns the absolute one-shot time when it is still in the future', () => {
    const future = Date.parse('2030-01-01T12:00:00Z')
    const task = baseTask({
      id: '1',
      name: 'once',
      enabled: true,
      trigger: { kind: 'once', firesAt: future },
      action: { kind: 'notify', title: 't', body: 'b' },
      createdAt: 0,
      lastFiredAt: null
    })
    expect(computeNextFireAt(task, future - 1)).toBe(future)
  })

  it('returns null for a one-shot whose firesAt is in the past', () => {
    const past = Date.parse('2020-01-01T00:00:00Z')
    const task = baseTask({
      id: '1',
      name: 'once',
      enabled: true,
      trigger: { kind: 'once', firesAt: past },
      action: { kind: 'notify', title: 't', body: 'b' },
      createdAt: 0,
      lastFiredAt: null
    })
    expect(computeNextFireAt(task, Date.parse('2025-01-01T00:00:00Z'))).toBeNull()
  })

  it('returns null for a one-shot that has already fired', () => {
    const future = Date.parse('2030-01-01T12:00:00Z')
    const task = baseTask({
      id: '1',
      name: 'once',
      enabled: true,
      trigger: { kind: 'once', firesAt: future },
      action: { kind: 'notify', title: 't', body: 'b' },
      createdAt: 0,
      lastFiredAt: future
    })
    expect(computeNextFireAt(task, future - 1)).toBeNull()
  })

  it('rolls daily triggers to the next day when today is already past', () => {
    const task = baseTask({
      id: '1',
      name: 'daily',
      enabled: true,
      trigger: { kind: 'daily', hour: 9, minute: 30 },
      action: { kind: 'notify', title: 't', body: 'b' },
      createdAt: 0,
      lastFiredAt: null
    })

    const reference = new Date()
    reference.setHours(10, 0, 0, 0)
    const expected = new Date(reference)
    expected.setDate(expected.getDate() + 1)
    expected.setHours(9, 30, 0, 0)

    expect(computeNextFireAt(task, reference.getTime())).toBe(expected.getTime())
  })

  it('rolls weekly triggers across the week boundary', () => {
    // Pick a Saturday 16:00 reference; trigger is Tuesday 09:00 → should land
    // on next Tuesday 09:00.
    const reference = new Date('2026-01-03T16:00:00')
    expect(reference.getDay()).toBe(6) // sanity: Saturday
    const task = baseTask({
      id: '1',
      name: 'weekly',
      enabled: true,
      trigger: { kind: 'weekly', dayOfWeek: 2, hour: 9, minute: 0 },
      action: { kind: 'notify', title: 't', body: 'b' },
      createdAt: 0,
      lastFiredAt: null
    })

    const expected = new Date('2026-01-06T09:00:00')
    expect(computeNextFireAt(task, reference.getTime())).toBe(expected.getTime())
  })

  it('rolls weekly triggers forward when the same day has already passed today', () => {
    // Tuesday 15:00 reference; trigger Tuesday 09:00 → next Tuesday.
    const reference = new Date('2026-01-06T15:00:00')
    expect(reference.getDay()).toBe(2)
    const task = baseTask({
      id: '1',
      name: 'weekly',
      enabled: true,
      trigger: { kind: 'weekly', dayOfWeek: 2, hour: 9, minute: 0 },
      action: { kind: 'notify', title: 't', body: 'b' },
      createdAt: 0,
      lastFiredAt: null
    })

    const expected = new Date('2026-01-13T09:00:00')
    expect(computeNextFireAt(task, reference.getTime())).toBe(expected.getTime())
  })
})

describe('shouldBackfillOneShot', () => {
  it('returns true for a one-shot whose firesAt is in the past with no lastFiredAt', () => {
    const task = baseTask({
      id: '1',
      name: 'once',
      enabled: true,
      trigger: { kind: 'once', firesAt: 1 },
      action: { kind: 'notify', title: 't', body: 'b' },
      createdAt: 0,
      lastFiredAt: null
    })
    expect(shouldBackfillOneShot(task, 1000)).toBe(true)
  })

  it('returns false for a one-shot that has already fired', () => {
    const task = baseTask({
      id: '1',
      name: 'once',
      enabled: true,
      trigger: { kind: 'once', firesAt: 1 },
      action: { kind: 'notify', title: 't', body: 'b' },
      createdAt: 0,
      lastFiredAt: 2
    })
    expect(shouldBackfillOneShot(task, 1000)).toBe(false)
  })

  it('returns false for recurring tasks', () => {
    const daily = baseTask({
      id: '1',
      name: 'daily',
      enabled: true,
      trigger: { kind: 'daily', hour: 9, minute: 0 },
      action: { kind: 'notify', title: 't', body: 'b' },
      createdAt: 0,
      lastFiredAt: null
    })
    expect(shouldBackfillOneShot(daily, Date.now())).toBe(false)
  })
})

describe('normalizeScheduledTasksConfig', () => {
  it('returns defaults when input is undefined or malformed', () => {
    const fromUndefined = normalizeScheduledTasksConfig(undefined, 1000)
    expect(fromUndefined.version).toBe(SCHEDULED_TASKS_VERSION)
    expect(fromUndefined.tasks).toEqual([])

    const fromGarbage = normalizeScheduledTasksConfig('not an object', 1000)
    expect(fromGarbage.tasks).toEqual([])
  })

  it('drops tasks with invalid triggers but keeps the valid ones', () => {
    const result = normalizeScheduledTasksConfig(
      {
        version: 1,
        tasks: [
          {
            id: 't1',
            name: 'ok',
            enabled: true,
            trigger: { kind: 'daily', hour: 8, minute: 0 },
            action: { kind: 'notify', title: 'hi', body: 'there' },
            createdAt: 100,
            lastFiredAt: null
          },
          {
            id: 't2',
            name: 'bad-trigger',
            enabled: true,
            trigger: { kind: 'daily', hour: 99, minute: 0 },
            action: { kind: 'notify', title: 'x', body: 'y' },
            createdAt: 100,
            lastFiredAt: null
          },
          {
            id: 't3',
            name: 'bad-action',
            enabled: true,
            trigger: { kind: 'daily', hour: 9, minute: 0 },
            action: { kind: 'prompt', title: 'p', message: 'm' },
            createdAt: 100,
            lastFiredAt: null
          }
        ]
      },
      1000
    )

    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0]?.id).toBe('t1')
  })

  it('deduplicates task ids deterministically', () => {
    const result = normalizeScheduledTasksConfig(
      {
        tasks: [
          {
            id: 'same',
            name: 'first',
            enabled: true,
            trigger: { kind: 'daily', hour: 8, minute: 0 },
            action: { kind: 'notify', title: 'hi', body: 'there' },
            createdAt: 100,
            lastFiredAt: null
          },
          {
            id: 'same',
            name: 'second',
            enabled: true,
            trigger: { kind: 'daily', hour: 9, minute: 0 },
            action: { kind: 'notify', title: 'hi', body: 'there' },
            createdAt: 100,
            lastFiredAt: null
          },
          {
            id: 'same-2',
            name: 'third',
            enabled: true,
            trigger: { kind: 'daily', hour: 10, minute: 0 },
            action: { kind: 'notify', title: 'hi', body: 'there' },
            createdAt: 100,
            lastFiredAt: null
          }
        ]
      },
      1000
    )

    expect(result.tasks.map((task) => task.id)).toEqual(['same', 'same-2', 'same-2-2'])
  })

  it('fills missing optional fields and generates an id when absent', () => {
    const result = normalizeScheduledTasksConfig(
      {
        tasks: [
          {
            name: '   ',
            enabled: 'yes',
            trigger: { kind: 'weekly', dayOfWeek: 1, hour: 9, minute: 0 },
            action: { kind: 'notify', title: 'hi', body: 'there' }
          }
        ]
      },
      4242
    )

    expect(result.tasks).toHaveLength(1)
    const task = result.tasks[0]
    expect(task?.id.length).toBeGreaterThan(0)
    expect(task?.name).toMatch(/^Task /)
    expect(task?.enabled).toBe(false)
    expect(task?.createdAt).toBe(4242)
    expect(task?.lastFiredAt).toBeNull()
  })
})

describeIfSqlite('ScheduledTasksService', () => {
  it('fires notification tasks immediately and disables one-shot tasks after firing', async () => {
    const task = baseTask({
      id: 'once-notify',
      name: 'once notify',
      enabled: true,
      trigger: { kind: 'once', firesAt: Date.now() + 60_000 },
      action: { kind: 'notify', title: 'Reminder', body: 'Stand up' },
      createdAt: 1,
      lastFiredAt: null
    })
    const harness = createServiceHarness([task])

    const result = await harness.service.fireNow(task.id)

    expect(harness.showNotification).toHaveBeenCalledWith({
      id: 'scheduled:once-notify',
      title: 'Reminder',
      body: 'Stand up'
    })
    expect(result.task.enabled).toBe(false)
    expect(result.task.lastFiredAt).toEqual(expect.any(Number))
    expect(harness.getSettings().tasks[0]?.enabled).toBe(false)
  })

  it('auto-sends prompt tasks through the wired session creator', async () => {
    const task = baseTask({
      id: 'daily-prompt',
      name: 'daily prompt',
      enabled: true,
      trigger: { kind: 'daily', hour: 9, minute: 0 },
      action: {
        kind: 'prompt',
        title: 'Daily plan',
        message: 'Create my plan',
        autoSend: true,
        agentId: 'deepchat',
        providerId: 'provider-1',
        modelId: 'model-1',
        systemPrompt: 'Be concise'
      },
      createdAt: 1,
      lastFiredAt: null
    })
    const harness = createServiceHarness([task])

    const result = await harness.service.fireNow(task.id)

    expect(harness.createSessionForTask).toHaveBeenCalledWith({
      agentId: 'deepchat',
      message: 'Create my plan',
      providerId: 'provider-1',
      modelId: 'model-1',
      systemPrompt: 'Be concise'
    })
    expect(harness.sendToWindow).not.toHaveBeenCalled()
    expect(harness.showNotification).toHaveBeenCalledWith({
      id: 'scheduled:daily-prompt',
      title: 'Daily plan',
      body: 'Create my plan'
    })
    expect(result.task.enabled).toBe(true)
    expect(result.task.lastFiredAt).toEqual(expect.any(Number))
  })
})
