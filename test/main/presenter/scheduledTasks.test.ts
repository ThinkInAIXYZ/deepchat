import { describe, expect, it } from 'vitest'
import {
  computeNextFireAt,
  normalizeScheduledTasksConfig,
  shouldBackfillOneShot
} from '../../../src/main/presenter/scheduledTasks/normalize'
import type { ScheduledTask } from '@shared/scheduledTasks'

const baseTask = <T extends ScheduledTask>(overrides: T): T => overrides

describe('computeNextFireAt', () => {
  it('returns the absolute one-shot time when it is still in the future', () => {
    const future = Date.parse('2030-01-01T12:00:00Z')
    const task = baseTask<ScheduledTask>({
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
    const task = baseTask<ScheduledTask>({
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
    const task = baseTask<ScheduledTask>({
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
    const task = baseTask<ScheduledTask>({
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
    const task = baseTask<ScheduledTask>({
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
    const task = baseTask<ScheduledTask>({
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
    const task = baseTask<ScheduledTask>({
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
    const task = baseTask<ScheduledTask>({
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
    const daily = baseTask<ScheduledTask>({
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
    expect(fromUndefined.version).toBe(1)
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
