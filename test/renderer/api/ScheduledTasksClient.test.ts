import { describe, expect, it, vi } from 'vitest'
import type { DeepchatBridge } from '@shared/contracts/bridge'
import { createScheduledTasksClient } from '../../../src/renderer/api/ScheduledTasksClient'

describe('ScheduledTasksClient', () => {
  it('routes scheduler status and run history methods through typed route names', async () => {
    const bridge: DeepchatBridge = {
      invoke: vi.fn(async (routeName: string) => {
        switch (routeName) {
          case 'scheduledTasks.getSchedulerStatus':
          case 'scheduledTasks.reconcileNow':
          case 'scheduledTasks.restartScheduler':
            return {
              status: {
                state: 'stopped',
                enabledTaskCount: 0,
                nextRunAt: null
              }
            }
          case 'scheduledTasks.listRuns':
            return {
              runs: [
                {
                  id: 'run-1',
                  taskId: 'task-1',
                  scheduledAt: 1,
                  queuedAt: 1,
                  startedAt: null,
                  completedAt: null,
                  status: 'queued',
                  reason: 'manual',
                  createdAt: 1,
                  updatedAt: 1
                }
              ]
            }
          default:
            throw new Error(routeName)
        }
      }),
      on: vi.fn(),
      off: vi.fn()
    }
    const client = createScheduledTasksClient(bridge)

    await expect(client.getSchedulerStatus()).resolves.toMatchObject({ state: 'stopped' })
    await expect(client.listRuns('task-1', 1)).resolves.toHaveLength(1)
    await expect(client.reconcileNow()).resolves.toMatchObject({ state: 'stopped' })
    await expect(client.restartScheduler()).resolves.toMatchObject({ state: 'stopped' })

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'scheduledTasks.getSchedulerStatus', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'scheduledTasks.listRuns', {
      taskId: 'task-1',
      limit: 1
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'scheduledTasks.reconcileNow', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'scheduledTasks.restartScheduler', {})
  })
})
