import { expect, it, vi } from 'vitest'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'

function host() {
  return new DimRuntimeSupervisor({
    runtimeRoot: '/unused',
    profileRoot: '/unused',
    nodeExecutable: '/unused'
  })
}

it('refuses all new callers before admission while a profile rollback requires recovery', async () => {
  const owner = host()
  owner.requireProfileRecovery(new Error('Native rollback requires recovery'))
  await expect(owner.start()).rejects.toMatchObject({ outcome: 'not-sent' })
  await expect(owner.openConnection()).rejects.toMatchObject({ outcome: 'not-sent' })
})

it('serializes cold profile operations until the preceding storage callback settles', async () => {
  const owner = host()
  const stop = vi.spyOn(owner, 'stop').mockResolvedValue()
  let release!: () => void
  const firstWork = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const secondWork = vi.fn(async () => 'next')
  const first = owner.withStopped(firstWork)
  await vi.waitFor(() => expect(firstWork).toHaveBeenCalledOnce())
  const second = owner.withStopped(secondWork)
  await Promise.resolve()
  expect(stop).toHaveBeenCalledOnce()
  expect(secondWork).not.toHaveBeenCalled()
  release()
  await first
  await expect(second).resolves.toBe('next')
  expect(stop).toHaveBeenCalledTimes(2)
})

it('rejects waiting starts without admission when profile maintenance fails, then permits recovery', async () => {
  const owner = host()
  vi.spyOn(owner, 'stop').mockResolvedValue()
  let waiting!: Promise<unknown>
  let rejection!: Promise<void>
  await expect(
    owner.withStopped(async () => {
      waiting = owner.start()
      rejection = expect(waiting).rejects.toMatchObject({
        outcome: 'not-sent',
        message: 'Native storage maintenance failed; retry after recovery'
      })
      throw new Error('Profile restore failed')
    })
  ).rejects.toThrow('Profile restore failed')
  await rejection
  await expect(owner.withStopped(async () => 'recovered')).resolves.toBe('recovered')
})

it('does not expose files to the callback unless native shutdown completed successfully', async () => {
  const owner = host()
  vi.spyOn(owner, 'stop').mockRejectedValue(new Error('dim did not complete graceful shutdown'))
  const work = vi.fn(async () => {})
  const stopped = expect(owner.withStopped(work)).rejects.toThrow('graceful shutdown')
  const waiting = expect(owner.start()).rejects.toMatchObject({ outcome: 'not-sent' })
  await Promise.all([stopped, waiting])
  expect(work).not.toHaveBeenCalled()
})
