import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseRequestGate } from '@/app/databaseRequestGate'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

afterEach(() => vi.useRealTimers())

describe('database request ownership', () => {
  it('drains an admitted request while rejecting new ordinary work', async () => {
    const gate = new DatabaseRequestGate(() => undefined)
    const result = deferred<string>()
    const request = gate.runRequest('providers.add', () => result.promise)
    gate.beginMaintenance()
    let drained = false
    const drain = gate.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    for (const method of [
      'config.setCustomPrompts',
      'mcp.getServers',
      'models.invoke',
      'ocr.extractUpload',
      'future.write'
    ]) {
      const action = vi.fn(async () => undefined)
      await expect(gate.runRequest(method, action)).rejects.toThrow('maintenance is maintenance')
      expect(action).not.toHaveBeenCalled()
    }
    result.resolve('committed')
    expect(await request).toBe('committed')
    await drain
    gate.resume()
    expect(await gate.runRequest('providers.add', async () => 'next')).toBe('next')
  })

  it('releases failed requests without hiding the original error', async () => {
    const gate = new DatabaseRequestGate(() => undefined)
    const error = new Error('owner failure')
    await expect(
      gate.runRequest('config.setCustomPrompts', async () => {
        throw error
      })
    ).rejects.toBe(error)
    gate.beginMaintenance()
    await gate.drain()
    gate.resume()
  })

  it('does not include the maintenance command or native presentation in its own drain', async () => {
    const gate = new DatabaseRequestGate(() => undefined)
    await expect(
      gate.runRequest('databaseSecurity.enable', async () => {
        gate.beginMaintenance()
        const native = deferred<void>()
        const presentation = gate.runRequest('window.getCurrentState', () => native.promise)
        await gate.drain()
        await expect(
          gate.runRequest('databaseSecurity.repairSchema', async () => undefined)
        ).rejects.toThrow('maintenance is maintenance')
        expect(await gate.runRequest('approvals.resolve', async () => 'resolved')).toBe('resolved')
        native.resolve()
        await presentation
        gate.resume()
        return 'acknowledged'
      })
    ).resolves.toBe('acknowledged')
  })

  it('bounds drain waiting and includes an old pending request in a later attempt', async () => {
    vi.useFakeTimers()
    const gate = new DatabaseRequestGate(() => undefined)
    const result = deferred<void>()
    const request = gate.runRequest('providers.add', () => result.promise)
    gate.beginMaintenance()
    const timeout = expect(gate.drain()).rejects.toThrow('30000ms')
    await vi.advanceTimersByTimeAsync(30_000)
    await timeout
    expect(vi.getTimerCount()).toBe(0)
    gate.resume()
    gate.beginMaintenance()
    let drained = false
    const next = gate.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    result.resolve()
    await request
    await next
    expect(vi.getTimerCount()).toBe(0)
    gate.resume()
  })

  it('keeps failed maintenance closed and still honors the application lifecycle', async () => {
    let active = true
    const gate = new DatabaseRequestGate(() => {
      if (!active) throw new Error('Application stopped')
    })
    gate.beginMaintenance()
    gate.fail()
    await expect(gate.runRequest('providers.add', async () => undefined)).rejects.toThrow(
      'maintenance is failed'
    )
    expect(await gate.runRequest('databaseSecurity.getStatus', async () => 'failed')).toBe('failed')
    expect(() => gate.resume()).toThrow('cannot resume')
    active = false
    await expect(gate.runRequest('window.getCurrentState', async () => undefined)).rejects.toThrow(
      'Application stopped'
    )
  })

  it('drains requests and actual maintenance completion during shutdown', async () => {
    const gate = new DatabaseRequestGate(() => undefined)
    const normal = deferred<void>()
    const owner = deferred<void>()
    const request = gate.runRequest('providers.add', () => normal.promise)
    const maintenance = gate.runMaintenance(() => owner.promise)
    await Promise.resolve()
    gate.beginShutdown()
    let drained = false
    const drain = gate.drainForShutdown().then(() => {
      drained = true
    })
    for (const method of ['providers.add', 'window.getCurrentState', 'device.restartApp']) {
      await expect(gate.runRequest(method, async () => undefined)).rejects.toThrow('stopping')
    }
    normal.resolve()
    await request
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(drained).toBe(false)
    const error = new Error('interrupted maintenance')
    const rejected = expect(maintenance).rejects.toBe(error)
    owner.reject(error)
    await rejected
    await drain
    expect(gate.state).toBe('stopping')
  })

  it.each(['device.restartApp', 'device.resetDataByType'])(
    'does not wait for the %s request that owns shutdown',
    async (method) => {
      const gate = new DatabaseRequestGate(() => undefined)
      await gate.runRequest(method, async () => {
        gate.beginShutdown()
        await gate.drainForShutdown()
      })
    }
  )

  it('includes lifecycle authorization before its shutdown dispatch', async () => {
    const gate = new DatabaseRequestGate(() => undefined)
    const release = deferred<void>()
    const authorization = gate.runAuthorization('device.resetDataByType', () => release.promise)
    gate.beginShutdown()
    let drained = false
    const drain = gate.drainForShutdown().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    release.resolve()
    await authorization
    await drain
  })

  it('bounds shutdown waiting without losing an unfinished maintenance owner', async () => {
    vi.useFakeTimers()
    const gate = new DatabaseRequestGate(() => undefined)
    const release = deferred<void>()
    const maintenance = gate.runMaintenance(() => release.promise)
    gate.beginShutdown()
    const timeout = expect(gate.drainForShutdown()).rejects.toThrow('30000ms')
    await vi.advanceTimersByTimeAsync(30_000)
    await timeout
    expect(vi.getTimerCount()).toBe(0)
    let drained = false
    const retry = gate.drainForShutdown().then(() => {
      drained = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(drained).toBe(false)
    release.resolve()
    await maintenance
    await retry
    expect(vi.getTimerCount()).toBe(0)
    expect(() => gate.resume()).toThrow('cannot resume')
  })

  it('retains exclusive maintenance ownership after ordinary admission resumes', async () => {
    const gate = new DatabaseRequestGate(() => undefined)
    const entered = deferred<void>()
    const release = deferred<void>()
    const maintenance = gate.runMaintenance(async () => {
      gate.resume()
      entered.resolve()
      await release.promise
    })
    await entered.promise
    await expect(gate.runMaintenance(async () => undefined)).rejects.toThrow('still completing')
    expect(await gate.runRequest('providers.add', async () => 'ready')).toBe('ready')
    release.resolve()
    await maintenance
    await gate.runMaintenance(async () => gate.resume())
  })
})
