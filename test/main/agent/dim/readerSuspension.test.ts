import { expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { dimDatabase } from './fixtures/database'
import { DimSessionRuntime } from '@/agent/dim/sessionRuntime'
import type { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'

it('restores detached readers after a refused snapshot without revoking an in-flight admission', async () => {
  const { data, sqlite } = dimDatabase()
  data.dimSessionBindingsTable.bind('app', 'native')
  const client = Object.assign(new EventEmitter(), {
    call: vi.fn(async (method: string) => {
      if (method === 'deepchat.host.subscribe') return { watchId: 'watch' }
      if (method === 'deepchat.storage.history') return { through: '0', events: [] }
      if (method === 'deepchat.host.input') return { inputId: 'input', sequence: '1' }
      return {}
    })
  })
  const start = vi.fn(async () => client)
  const opened = vi.fn(async () => {})
  const closed = vi.fn(async () => {})
  const failed = vi.fn()
  const runtime = new DimSessionRuntime({
    database: data,
    host: { start, usesNativePlugins: false } as unknown as DimRuntimeSupervisor,
    launch: async () => {
      throw new Error('Existing identity must be reused')
    },
    opened,
    closed,
    projected: () => {},
    failed
  })
  try {
    await runtime.open('app')
    let releaseAdmission!: () => void
    start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseAdmission = () => resolve(client)
        })
    )
    const admission = runtime.submit('app', [{ type: 'text', text: 'keep my scope' }])
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2))
    let waiting!: ReturnType<DimSessionRuntime['open']>
    await expect(
      runtime.withSuspendedReaders(async () => {
        expect(closed).toHaveBeenCalledWith('app')
        waiting = runtime.open('app')
        expect(opened).toHaveBeenCalledOnce()
        throw new Error('Native owner is busy')
      })
    ).rejects.toThrow('Native owner is busy')
    await waiting
    expect(opened).toHaveBeenCalledTimes(2)
    releaseAdmission()
    await expect(admission).resolves.toEqual({ inputId: 'input', sequence: '1' })
    expect(failed).not.toHaveBeenCalled()
    expect(data.dimSessionBindingsTable.get('app')?.dimSessionId).toBe('native')
  } finally {
    await runtime.close('app')
    sqlite.close()
  }
})
