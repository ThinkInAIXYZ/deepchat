import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventBus } from '../../../src/main/eventbus'

describe('EventBus main-process events', () => {
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
  })

  it('emits events to main-process listeners', () => {
    const listener = vi.fn()

    eventBus.on('test:event', listener)
    eventBus.sendToMain('test:event', { message: 'test' })

    expect(listener).toHaveBeenCalledWith({ message: 'test' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('passes multiple arguments through unchanged', () => {
    const listener = vi.fn()

    eventBus.on('test:args', listener)
    eventBus.sendToMain('test:args', 'first', { second: true }, 3)

    expect(listener).toHaveBeenCalledWith('first', { second: true }, 3)
  })
})
