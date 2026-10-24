import { randomUUID } from 'node:crypto'
import { load } from '@arcships/rutis/testing'
import { describe, expect, it } from 'vitest'
import type { AgentInvocationAdmissionSnapshot } from '@/agent/invocationAdmission'
import plugin from '../../../src/harness/plugins/admission'

interface AdmissionService {
  acquire(id: string, options: { ownerId: string }, signal: AbortSignal): Promise<string>
  release(id: string, reason: string, enabled: boolean): Promise<boolean>
  snapshot(): Promise<{ admission: AgentInvocationAdmissionSnapshot }>
}

describe('Harness admission plugin lifecycle', () => {
  it('closes pending work and releases old permits before applying a new generation', async () => {
    // The SDK test kit treats signals as object references; harness:check covers their wire encoding.
    const row = await load(plugin, { config: { capacity: 1, maxPending: 4 }, strict: false })
    try {
      const old = row.service<AdmissionService>('harnessAdmission')
      const permit = await old.acquire(
        randomUUID(),
        { ownerId: 'active' },
        new AbortController().signal
      )
      const queued = expect(
        old.acquire(randomUUID(), { ownerId: 'queued' }, new AbortController().signal)
      ).rejects.toMatchObject({ name: 'AgentInvocationAdmissionAbortedError' })
      expect((await old.snapshot()).admission.pending).toBe(1)

      await row.update({ capacity: 2, maxPending: 4 })
      await queued

      expect((await old.snapshot()).admission).toMatchObject({
        closed: true,
        active: 0,
        pending: 0
      })
      expect(await old.release(permit, 'permit_released', false)).toBe(false)
      expect(
        (await row.service<AdmissionService>('harnessAdmission').snapshot()).admission
      ).toMatchObject({
        capacity: 2,
        closed: false,
        active: 0,
        pending: 0
      })
    } finally {
      await row.unload()
    }
  })

  it('rejects missing or already cancelled call signals without acquiring a permit', async () => {
    const row = await load(plugin, { config: { capacity: 1, maxPending: 0 }, strict: false })
    try {
      const service = row.service<AdmissionService>('harnessAdmission')
      await expect(
        service.acquire(randomUUID(), { ownerId: 'invalid' }, undefined as unknown as AbortSignal)
      ).rejects.toThrow('Admission requires an AbortSignal')
      await expect(
        service.acquire(randomUUID(), { ownerId: 'cancelled' }, AbortSignal.abort())
      ).rejects.toMatchObject({
        name: 'AgentInvocationAdmissionAbortedError'
      })
      expect((await service.snapshot()).admission).toMatchObject({ active: 0, pending: 0 })
    } finally {
      await row.unload()
    }
  })
})
