import { describe, expect, it, vi } from 'vitest'
import {
  normalizeAdmissionOwnerId,
  normalizeAdmissionOwnerLimit,
  snapshotAdmissionCorrelation
} from '@shared/harness/admission'
import { RutisAgentInvocationAdmission } from '@/harness/admission'

const correlation = {
  kind: 'live_delegation' as const,
  parentSessionId: 'parent',
  delegationId: 'delegation',
  turnId: 'turn'
}

describe('invocation admission client boundary', () => {
  it('validates owner limits and rejects invalid acquisition through its Promise', async () => {
    const request = vi.fn()
    const admission = RutisAgentInvocationAdmission.create({
      runtime: { identity: undefined, request }
    })
    expect(normalizeAdmissionOwnerId(' \ufeffowner\ufeff ')).toBe('owner')
    expect(normalizeAdmissionOwnerLimit(20, 6)).toBe(6)
    expect(() => normalizeAdmissionOwnerId('😀'.repeat(129))).toThrow(/256 characters/)
    for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        admission.acquire({ ownerId: 'owner', maxActiveForOwner: limit })
      ).rejects.toThrow(/positive safe integer/)
    }
    let acquisition!: Promise<unknown>
    expect(() => {
      acquisition = admission.acquire({ ownerId: '   ' })
    }).not.toThrow()
    await expect(acquisition).rejects.toThrow(/ownerId must contain/)
    expect(request).not.toHaveBeenCalled()
  })

  it('snapshots bounded correlations without evaluating accessors or Proxy traps', () => {
    const getter = vi.fn(() => 'hostile')
    const hostile = Object.defineProperty({ ...correlation }, 'parentSessionId', { get: getter })
    const trap = vi.fn()
    expect(snapshotAdmissionCorrelation(hostile)).toBeUndefined()
    expect(
      snapshotAdmissionCorrelation(new Proxy(correlation, { getOwnPropertyDescriptor: trap }))
    ).toBeUndefined()
    expect(getter).not.toHaveBeenCalled()
    expect(trap).not.toHaveBeenCalled()
    for (const key of ['parentSessionId', 'delegationId', 'turnId']) {
      expect(
        snapshotAdmissionCorrelation({ ...correlation, [key]: 'x'.repeat(257) })
      ).toBeUndefined()
    }
    const snapshot = snapshotAdmissionCorrelation(correlation)
    expect(snapshot).toEqual(correlation)
    expect(snapshot).not.toBe(correlation)
  })

  it('releases a known acquisition once when cancellation precedes a late grant', async () => {
    const grant = Promise.withResolvers<unknown>()
    const request = vi.fn((method: string, _args: unknown[]) =>
      method === 'acquire' ? grant.promise : Promise.resolve(true)
    )
    const admission = RutisAgentInvocationAdmission.create({
      runtime: { identity: undefined, request }
    })
    const controller = new AbortController()
    const acquisition = admission.acquire({ ownerId: 'owner', signal: controller.signal })
    const acquisitionId = request.mock.calls[0][1][0]
    controller.abort()
    grant.resolve(acquisitionId)
    await expect(acquisition).rejects.toMatchObject({
      name: 'AgentInvocationAdmissionAbortedError'
    })
    await admission.flushObservations()
    expect(request.mock.calls.filter(([method]) => method === 'release')).toEqual([
      ['release', [acquisitionId, 'permit_released', false]]
    ])
  })
})
