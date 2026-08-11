import { describe, expect, it, vi } from 'vitest'
import {
  AgentInvocationAdmission,
  AgentInvocationAdmissionAbortedError,
  AgentInvocationAdmissionClosedError,
  AgentInvocationAdmissionQueueFullError,
  type AgentInvocationAdmissionObservation
} from '@/agent/invocationAdmission'
import { BoundedNumberRing } from '@/lib/boundedNumberRing'

const CORRELATION = {
  kind: 'live_delegation' as const,
  parentSessionId: 'parent_1',
  delegationId: 'delegation_1',
  turnId: 'turn_1'
}

describe('AgentInvocationAdmission', () => {
  it('retains recent diagnostic samples in insertion order after wrap-around', () => {
    const samples = new BoundedNumberRing(3)
    for (const value of [1, 2, 3, 4]) samples.push(value)

    expect(samples.snapshot()).toEqual([2, 3, 4])
  })

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

  it('keeps an active lease retryable when an accounting invariant rejects release', async () => {
    const admission = new AgentInvocationAdmission(1, 1)
    const lease = admission.createLease({ ownerId: 'owner' })
    await lease.resume()
    const accounting = admission as unknown as {
      active: number
      activeByOwner: Map<string, number>
    }

    accounting.active = 0
    expect(() => lease.suspend()).toThrow('permit accounting underflow')
    expect(lease.state).toBe('active')
    accounting.active = 1
    lease.suspend()
    expect(lease.state).toBe('suspended')

    await lease.resume()
    accounting.activeByOwner.delete('owner')
    expect(() => lease.release()).toThrow('owner permit accounting underflow')
    expect(lease.state).toBe('active')
    accounting.activeByOwner.set('owner', 1)
    lease.release()
    expect(lease.state).toBe('released')
    expect(admission.snapshot().active).toBe(0)
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

  it('observes correlated queue wait and active hold intervals with bounded summaries', async () => {
    let now = 0
    const observations: AgentInvocationAdmissionObservation[] = []
    const admission = new AgentInvocationAdmission(1, 10, {
      now: () => now,
      observe: (observation) => observations.push(observation)
    })

    const first = await admission.acquire({ ownerId: 'parent', correlation: CORRELATION })
    now = 5
    const secondPromise = admission.acquire({ ownerId: 'parent', correlation: CORRELATION })
    now = 10
    first.release()
    const second = await secondPromise
    now = 22
    second.release()
    admission.close()
    await admission.flushObservations()

    expect(observations.map(({ type }) => type)).toEqual([
      'granted',
      'queued',
      'released',
      'granted',
      'released',
      'closed'
    ])
    expect(observations[0]).toMatchObject({ acquisitionSeq: 1, waitMs: 0 })
    expect(observations[2]).toMatchObject({
      acquisitionSeq: 1,
      holdMs: 10,
      reason: 'permit_released'
    })
    expect(observations[3]).toMatchObject({ acquisitionSeq: 2, waitMs: 5 })
    expect(observations[4]).toMatchObject({ acquisitionSeq: 2, holdMs: 12 })
    expect(observations[5]).toMatchObject({
      activeHighWater: 1,
      pendingHighWater: 1,
      granted: 2,
      rejected: 0,
      observationsDropped: 0,
      waitMs: { samples: 2, p50: 0, p95: 5, max: 5 },
      holdMs: { samples: 2, p50: 10, p95: 12, max: 12 }
    })
  })

  it('segments lease hold timing across suspension and reacquisition', async () => {
    let now = 0
    const observations: AgentInvocationAdmissionObservation[] = []
    const admission = new AgentInvocationAdmission(1, 10, {
      now: () => now,
      observe: (observation) => observations.push(observation)
    })
    const lease = admission.createLease({ ownerId: 'parent', correlation: CORRELATION })

    await lease.resume()
    now = 4
    lease.suspend()
    now = 6
    await lease.resume()
    now = 10
    lease.release()
    await admission.flushObservations()

    expect(
      observations
        .filter((observation) => observation.type === 'released')
        .map((observation) => ({
          reason: observation.reason,
          holdMs: observation.holdMs,
          acquisitionSeq: observation.acquisitionSeq
        }))
    ).toEqual([
      { reason: 'lease_suspended', holdMs: 4, acquisitionSeq: 1 },
      { reason: 'lease_released', holdMs: 4, acquisitionSeq: 2 }
    ])
  })

  it('contains observation failures and classifies correlated rejections', async () => {
    const observations: AgentInvocationAdmissionObservation[] = []
    const admission = new AgentInvocationAdmission(1, 1, {
      observe: (observation) => {
        observations.push(observation)
        if (observation.type === 'queued') throw new Error('observer failed')
      }
    })
    const active = await admission.acquire({ ownerId: 'active', correlation: CORRELATION })
    const controller = new AbortController()
    const queued = admission.acquire({
      ownerId: 'queued',
      correlation: CORRELATION,
      signal: controller.signal
    })

    await expect(
      admission.acquire({ ownerId: 'overflow', correlation: CORRELATION })
    ).rejects.toBeInstanceOf(AgentInvocationAdmissionQueueFullError)
    controller.abort()
    await expect(queued).rejects.toBeInstanceOf(AgentInvocationAdmissionAbortedError)
    active.release()
    await admission.flushObservations()

    expect(
      observations
        .filter((observation) => observation.type === 'rejected')
        .map((observation) => observation.reason)
    ).toEqual(['queue_full', 'aborted'])
    expect(
      observations.find(
        (observation) => observation.type === 'rejected' && observation.reason === 'queue_full'
      )
    ).toMatchObject({ waitMs: 0 })
    expect(admission.snapshot()).toMatchObject({ active: 0, pending: 0, rejected: 2 })
  })

  it('includes an abandoned queued interval in wait diagnostics', async () => {
    let now = 0
    const admission = new AgentInvocationAdmission(1, 1, { now: () => now })
    const active = await admission.acquire({ ownerId: 'active' })
    const controller = new AbortController()
    now = 5
    const queued = admission.acquire({ ownerId: 'queued', signal: controller.signal })

    now = 105
    controller.abort()
    await expect(queued).rejects.toBeInstanceOf(AgentInvocationAdmissionAbortedError)

    expect(admission.snapshot().waitMs).toEqual({ samples: 2, p50: 0, p95: 100, max: 100 })
    active.release()
  })

  it('does not run hostile correlation accessors or Proxy traps', async () => {
    const observe = vi.fn()
    const admission = new AgentInvocationAdmission(1, 1, { observe })
    let getterCalls = 0
    const correlation = { ...CORRELATION }
    Object.defineProperty(correlation, 'parentSessionId', {
      get() {
        getterCalls += 1
        admission.close('Accessor side effect')
        return 'hostile_parent'
      }
    })

    const permit = await admission.acquire({ ownerId: 'owner', correlation })
    expect(getterCalls).toBe(0)
    expect(admission.snapshot().active).toBe(1)
    permit.release()

    let proxyTrapCalls = 0
    const proxyCorrelation = new Proxy(CORRELATION, {
      getOwnPropertyDescriptor() {
        proxyTrapCalls += 1
        return undefined
      }
    })
    const proxyPermit = await admission.acquire({
      ownerId: 'owner',
      correlation: proxyCorrelation
    })
    expect(proxyTrapCalls).toBe(0)
    proxyPermit.release()
    await admission.flushObservations()

    expect(admission.snapshot().active).toBe(0)
    expect(observe).not.toHaveBeenCalled()
  })

  it.each(['parentSessionId', 'delegationId', 'turnId'] as const)(
    'drops correlation snapshots with an oversized %s',
    async (field) => {
      const observe = vi.fn()
      const admission = new AgentInvocationAdmission(1, 1, { observe })
      const permit = await admission.acquire({
        ownerId: 'owner',
        correlation: { ...CORRELATION, [field]: 'x'.repeat(257) }
      })

      permit.release()
      await admission.flushObservations()

      expect(observe).not.toHaveBeenCalled()
    }
  )

  it('dispatches permits before draining potentially slow observations', async () => {
    const observe = vi.fn()
    const admission = new AgentInvocationAdmission(1, 1, { observe })
    const first = await admission.acquire({ ownerId: 'first', correlation: CORRELATION })
    const queued = admission.acquire({ ownerId: 'second', correlation: CORRELATION })

    first.release()
    const second = await queued

    expect(observe).not.toHaveBeenCalled()
    second.release()
    await admission.flushObservations()
    expect(observe).toHaveBeenCalled()
  })

  it('skips observation queue work while diagnostics output is disabled', async () => {
    let observationsEnabled = false
    let now = 0
    const observe = vi.fn()
    const admission = new AgentInvocationAdmission(1, 1, {
      observe,
      observationsEnabled: () => observationsEnabled,
      now: () => now
    })

    const disabledPermit = await admission.acquire({
      ownerId: 'disabled',
      correlation: CORRELATION
    })
    now = 10
    disabledPermit.release()
    await admission.flushObservations()
    expect(observe).not.toHaveBeenCalled()
    expect(admission.snapshot()).toMatchObject({
      waitMs: { samples: 1, p50: 0, p95: 0, max: 0 },
      holdMs: { samples: 1, p50: 10, p95: 10, max: 10 }
    })

    observationsEnabled = true
    const enabledPermit = await admission.acquire({ ownerId: 'enabled', correlation: CORRELATION })
    enabledPermit.release()
    await admission.flushObservations()
    expect(observe.mock.calls.map(([observation]) => observation.type)).toEqual([
      'granted',
      'released'
    ])
  })

  it('omits intervals with invalid or backward clock endpoints', async () => {
    const measure = async (clockValues: number[]) => {
      const observations: AgentInvocationAdmissionObservation[] = []
      let clockIndex = 0
      const admission = new AgentInvocationAdmission(1, 1, {
        now: () => clockValues[clockIndex++],
        observe: (observation) => observations.push(observation)
      })
      const permit = await admission.acquire({ ownerId: 'owner', correlation: CORRELATION })
      permit.release()
      await admission.flushObservations()
      return { observations, snapshot: admission.snapshot() }
    }

    const invalidStart = await measure([Number.NaN, 100, 110])
    expect(invalidStart.snapshot.waitMs.samples).toBe(0)
    expect(invalidStart.snapshot.holdMs).toEqual({ samples: 1, p50: 10, p95: 10, max: 10 })
    expect(invalidStart.observations[0]).not.toHaveProperty('waitMs')

    const invalidGrant = await measure([100, Number.NaN, 110])
    expect(invalidGrant.snapshot.waitMs.samples).toBe(0)
    expect(invalidGrant.snapshot.holdMs.samples).toBe(0)
    expect(invalidGrant.observations[0]).not.toHaveProperty('waitMs')
    expect(invalidGrant.observations[1]).not.toHaveProperty('holdMs')

    const invalidRelease = await measure([100, 100, Number.NaN])
    expect(invalidRelease.snapshot.waitMs.samples).toBe(1)
    expect(invalidRelease.snapshot.holdMs.samples).toBe(0)
    expect(invalidRelease.observations[0]).toMatchObject({ waitMs: 0 })
    expect(invalidRelease.observations[1]).not.toHaveProperty('holdMs')

    const rollback = await measure([100, 90, 80])
    expect(rollback.snapshot.waitMs.samples).toBe(0)
    expect(rollback.snapshot.holdMs.samples).toBe(0)
    expect(rollback.observations[0]).not.toHaveProperty('waitMs')
    expect(rollback.observations[1]).not.toHaveProperty('holdMs')
  })

  it('reports correlated close rejections once before its terminal summary', async () => {
    const observations: AgentInvocationAdmissionObservation[] = []
    const admission = new AgentInvocationAdmission(1, 2, {
      observe: (observation) => observations.push(observation)
    })
    const active = await admission.acquire({ ownerId: 'active', correlation: CORRELATION })
    const firstQueued = admission.acquire({ ownerId: 'first', correlation: CORRELATION })
    const secondQueued = admission.acquire({ ownerId: 'second', correlation: CORRELATION })

    admission.close()
    await expect(firstQueued).rejects.toBeInstanceOf(AgentInvocationAdmissionClosedError)
    await expect(secondQueued).rejects.toBeInstanceOf(AgentInvocationAdmissionClosedError)
    await admission.flushObservations()

    expect(
      observations
        .filter((observation) => observation.type === 'rejected')
        .map((observation) => observation.reason)
    ).toEqual(['closed', 'closed'])
    expect(observations.at(-1)).toMatchObject({
      type: 'closed',
      active: 1,
      pending: 0,
      rejected: 2
    })

    active.release()
    await admission.flushObservations()
    expect(admission.snapshot()).toMatchObject({ active: 0, pending: 0, rejected: 2 })
  })

  it('bounds pending observations and reports discarded diagnostics', async () => {
    const observations: AgentInvocationAdmissionObservation[] = []
    const admission = new AgentInvocationAdmission(1, 1, {
      observe: (observation) => observations.push(observation)
    })

    for (let iteration = 0; iteration < 300; iteration += 1) {
      const permit = await admission.acquire({ ownerId: 'owner', correlation: CORRELATION })
      permit.release()
    }
    admission.close()
    await admission.flushObservations()

    expect(observations).toHaveLength(512)
    expect(admission.snapshot().observationsDropped).toBe(89)
    expect(admission.snapshot()).toMatchObject({
      waitMs: { samples: 256 },
      holdMs: { samples: 256 }
    })
    expect(observations.at(-1)).toMatchObject({ type: 'closed', observationsDropped: 89 })
  })
})
