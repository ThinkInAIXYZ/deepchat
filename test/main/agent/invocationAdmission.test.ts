import { describe, expect, it, vi } from 'vitest'
import {
  AgentInvocationAdmission,
  AgentInvocationAdmissionAbortedError,
  AgentInvocationAdmissionClosedError,
  AgentInvocationAdmissionQueueFullError
} from '@/agent/invocationAdmission'

describe('AgentInvocationAdmission', () => {
  it('reserves process-wide headroom beyond one workflow owner', () => {
    expect(new AgentInvocationAdmission().snapshot()).toMatchObject({
      capacity: 6,
      active: 0,
      pending: 0
    })
  })

  it('reports invalid acquire options through the promised rejection contract', async () => {
    const admission = new AgentInvocationAdmission()
    let acquirePromise!: Promise<unknown>

    expect(() => {
      acquirePromise = admission.acquire({ ownerId: '   ' })
    }).not.toThrow()
    await expect(acquirePromise).rejects.toThrow('ownerId must contain 1 to 256 characters')
  })

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

  it('enforces owner limits while allowing other owners to use global headroom', async () => {
    const admission = new AgentInvocationAdmission(3, 10)
    const first = await admission.acquire({ ownerId: 'workflow-a', maxActiveForOwner: 2 })
    const second = await admission.acquire({ ownerId: 'workflow-a', maxActiveForOwner: 2 })
    const queued = admission.acquire({ ownerId: 'workflow-a', maxActiveForOwner: 2 })
    const other = await admission.acquire({
      ownerId: 'orchestrator-b',
      maxActiveForOwner: 5
    })

    expect(admission.snapshot()).toMatchObject({
      capacity: 3,
      active: 3,
      pending: 1,
      pendingOwners: 1
    })

    other.release()
    await Promise.resolve()
    expect(admission.snapshot()).toMatchObject({ active: 2, pending: 1 })

    first.release()
    const queuedPermit = await queued
    expect(admission.snapshot()).toMatchObject({ active: 2, pending: 0 })

    second.release()
    queuedPermit.release()
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

  it('suspends and fairly reacquires a state-aware lease', async () => {
    const admission = new AgentInvocationAdmission(1, 10)
    const lease = admission.createLease({ ownerId: 'child-a' })

    expect(lease.state).toBe('suspended')
    await lease.resume()
    expect(lease.state).toBe('active')
    expect(admission.snapshot()).toMatchObject({ active: 1, pending: 0 })

    const other = admission.acquire({ ownerId: 'child-b' })
    lease.suspend()
    const otherPermit = await other
    expect(lease.state).toBe('suspended')
    expect(admission.snapshot()).toMatchObject({ active: 1, pending: 0 })

    const resumed = lease.resume()
    expect(admission.snapshot()).toMatchObject({ active: 1, pending: 1 })
    otherPermit.release()
    await resumed
    expect(lease.state).toBe('active')
    expect(admission.snapshot()).toMatchObject({ active: 1, pending: 0 })

    lease.release()
    lease.release()
    expect(lease.state).toBe('released')
    expect(admission.snapshot()).toMatchObject({ active: 0, pending: 0 })
  })

  it('cancels a queued lease when it is suspended or its owner is aborted', async () => {
    const admission = new AgentInvocationAdmission(1, 10)
    const active = await admission.acquire({ ownerId: 'active' })
    const suspendedLease = admission.createLease({ ownerId: 'suspended' })
    const suspendedResume = suspendedLease.resume()

    suspendedLease.suspend()
    const retriedResume = suspendedLease.resume()
    await expect(suspendedResume).rejects.toBeInstanceOf(AgentInvocationAdmissionAbortedError)
    expect(admission.snapshot()).toMatchObject({ active: 1, pending: 1 })

    active.release()
    await retriedResume
    expect(suspendedLease.state).toBe('active')
    suspendedLease.suspend()

    const controller = new AbortController()
    const abortedLease = admission.createLease({ ownerId: 'aborted', signal: controller.signal })
    const abortedResume = abortedLease.resume()
    controller.abort()
    await expect(abortedResume).rejects.toBeInstanceOf(AgentInvocationAdmissionAbortedError)
    expect(abortedLease.state).toBe('suspended')
    abortedLease.release()

    expect(admission.snapshot()).toMatchObject({ active: 0, pending: 0 })
  })
})
