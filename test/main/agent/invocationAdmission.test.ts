import { describe, expect, it, vi } from 'vitest'
import {
  AgentInvocationAdmission,
  AgentInvocationAdmissionAbortedError,
  AgentInvocationAdmissionClosedError,
  AgentInvocationAdmissionQueueFullError
} from '@/agent/invocationAdmission'

describe('AgentInvocationAdmission', () => {
  it('enforces capacity and schedules queued owners round-robin', async () => {
    const admission = new AgentInvocationAdmission(1, 10)
    const first = await admission.acquire({ ownerId: 'owner-a' })
    const order: string[] = []
    const queued = [
      admission.run({ ownerId: 'owner-a' }, async () => {
        order.push('a1')
      }),
      admission.run({ ownerId: 'owner-a' }, async () => {
        order.push('a2')
      }),
      admission.run({ ownerId: 'owner-b' }, async () => {
        order.push('b1')
      }),
      admission.run({ ownerId: 'owner-b' }, async () => {
        order.push('b2')
      })
    ]

    expect(admission.snapshot()).toMatchObject({
      active: 1,
      pending: 4,
      pendingOwners: 2
    })
    first.release()
    await Promise.all(queued)

    expect(order).toEqual(['a1', 'b1', 'a2', 'b2'])
    expect(admission.snapshot()).toMatchObject({ active: 0, pending: 0 })
  })

  it('removes an aborted waiter without consuming the next permit', async () => {
    const admission = new AgentInvocationAdmission(1, 10)
    const first = await admission.acquire({ ownerId: 'active' })
    const controller = new AbortController()
    const aborted = admission.acquire({
      ownerId: 'cancelled',
      signal: controller.signal
    })
    const next = admission.acquire({ ownerId: 'next' })

    controller.abort()
    await expect(aborted).rejects.toBeInstanceOf(AgentInvocationAdmissionAbortedError)
    expect(admission.snapshot().pending).toBe(1)

    first.release()
    const nextPermit = await next
    expect(admission.snapshot()).toMatchObject({ active: 1, pending: 0 })
    nextPermit.release()
  })

  it('bounds queued work and rejects new work after close', async () => {
    const admission = new AgentInvocationAdmission(1, 1)
    const active = await admission.acquire({ ownerId: 'active' })
    const queued = admission.acquire({ ownerId: 'queued' })

    await expect(admission.acquire({ ownerId: 'overflow' })).rejects.toBeInstanceOf(
      AgentInvocationAdmissionQueueFullError
    )
    const queuedRejection = expect(queued).rejects.toBeInstanceOf(
      AgentInvocationAdmissionClosedError
    )
    admission.close('Application is shutting down.')
    await queuedRejection
    await expect(admission.acquire({ ownerId: 'late' })).rejects.toThrow(
      'Application is shutting down.'
    )

    active.release()
    active.release()
    expect(admission.snapshot()).toMatchObject({
      active: 0,
      pending: 0,
      closed: true
    })
  })

  it('does not enter a task if its signal aborts before the resolved permit is observed', async () => {
    const admission = new AgentInvocationAdmission(1, 1)
    const controller = new AbortController()
    const task = vi.fn(async () => undefined)

    const execution = admission.run(
      {
        ownerId: 'owner',
        signal: controller.signal
      },
      task
    )
    controller.abort()

    await expect(execution).rejects.toBeInstanceOf(AgentInvocationAdmissionAbortedError)
    expect(task).not.toHaveBeenCalled()
    expect(admission.snapshot().active).toBe(0)
  })
})
