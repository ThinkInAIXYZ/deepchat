import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseRequestGate } from '@/app/databaseRequestGate'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
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
})
