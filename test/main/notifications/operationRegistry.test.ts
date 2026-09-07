import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationRegistry } from '@shared/notifications'
import { FakeNotificationTime } from '../../helpers/fakeNotificationTime'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OperationRegistry', () => {
  it('tracks one operation through progress and removes it at its terminal state', () => {
    const time = new FakeNotificationTime()
    const registry = new OperationRegistry(time)
    const listener = vi.fn()
    registry.subscribe(listener)

    registry.create('agent-save:agent-a', { process: 'renderer', rendererId: 'settings' })
    time.advanceBy(10)
    registry.start('agent-save:agent-a')
    time.advanceBy(20)
    const progress = registry.reportProgress('agent-save:agent-a', 0.5)
    time.advanceBy(30)
    const settled = registry.succeed('agent-save:agent-a')

    expect(progress).toMatchObject({ status: 'running', progress: 0.5, updatedAt: 30 })
    expect(settled).toMatchObject({ status: 'succeeded', updatedAt: 60 })
    expect(registry.get('agent-save:agent-a')).toBeUndefined()
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual([
      'created',
      'started',
      'progressed',
      'settled'
    ])
  })

  it('rejects invalid progress and duplicate active IDs', () => {
    const time = new FakeNotificationTime()
    const registry = new OperationRegistry(time)
    registry.create('download:model-a', { process: 'main' })

    expect(() => registry.create('download:model-a', { process: 'main' })).toThrow('already exists')
    expect(() => registry.reportProgress('download:model-a', 0.5)).toThrow('cannot report progress')

    registry.start('download:model-a')
    expect(() => registry.reportProgress('download:model-a', 1.1)).toThrow('between 0 and 1')
    registry.reportProgress('download:model-a', 0.8)
    expect(() => registry.reportProgress('download:model-a', 0.7)).toThrow(
      'must not move backwards'
    )
  })

  it('requires work to start before success or failure but permits early cancellation', () => {
    const time = new FakeNotificationTime()
    const registry = new OperationRegistry(time)

    registry.create('save:agent-a', { process: 'renderer', rendererId: ' settings ' })
    expect(registry.get('save:agent-a')?.owner).toEqual({
      process: 'renderer',
      rendererId: 'settings'
    })
    expect(() => registry.succeed('save:agent-a')).toThrow('cannot settle from created')
    expect(() => registry.fail('save:agent-a', 'save.failed')).toThrow('cannot settle from created')
    expect(registry.cancel('save:agent-a').status).toBe('cancelled')
  })

  it('validates semantic failure codes without settling the active operation', () => {
    const time = new FakeNotificationTime()
    const registry = new OperationRegistry(time)
    registry.create('save:agent-a', { process: 'renderer', rendererId: 'settings' })
    registry.start('save:agent-a')

    expect(() => registry.fail('save:agent-a', 'Save failed')).toThrow('stable dotted identifier')
    expect(registry.get('save:agent-a')?.status).toBe('running')
  })

  it('isolates listener failures from operation state transitions', () => {
    const time = new FakeNotificationTime()
    const registry = new OperationRegistry(time)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const healthyListener = vi.fn()
    registry.subscribe(() => {
      throw new Error('listener failed')
    })
    registry.subscribe(healthyListener)

    expect(() => registry.create('save:agent-a', { process: 'main' })).not.toThrow()
    expect(registry.get('save:agent-a')?.status).toBe('created')
    expect(healthyListener).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalled()
  })

  it('preserves event order when a listener performs a nested transition', () => {
    const time = new FakeNotificationTime()
    const registry = new OperationRegistry(time)
    const observed: string[] = []
    registry.subscribe((event) => {
      if (event.type === 'created') registry.start(event.operation.id)
    })
    registry.subscribe((event) => observed.push(event.type))

    registry.create('save:agent-a', { process: 'main' })

    expect(observed).toEqual(['created', 'started'])
  })
})
