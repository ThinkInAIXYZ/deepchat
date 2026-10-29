import { describe, expect, it, vi } from 'vitest'
import { DesktopSessionBinding } from '@/desktop/sessionBinding'
import type { SessionWithState } from '@shared/types/agent-interface'

describe('DesktopSessionBinding', () => {
  it('owns independent renderer bindings and clears missing sessions', async () => {
    const projection = {
      getSession: vi.fn(async (sessionId: string) =>
        sessionId === 'available' ? ({ id: sessionId } as never) : null
      ),
      notify: vi.fn()
    }
    const callbacks = new Map<number, () => void>()
    const disposed = vi.fn()
    const binding = new DesktopSessionBinding(projection, (id, listener) => {
      callbacks.set(id, listener)
      return () => {
        callbacks.delete(id)
        disposed(id)
      }
    })

    await binding.activate(1, 'missing')
    await binding.activate(2, 'available')
    binding.bind(3, 'available')
    expect(binding.getActiveId(1)).toBe('missing')
    expect(binding.getActiveId(2)).toBe('available')
    expect(binding.getWebContentsIdsForSession('available')).toEqual([2, 3])

    await expect(binding.getActive(1)).resolves.toBeNull()
    expect(binding.getActiveId(1)).toBeNull()
    expect(disposed).toHaveBeenCalledWith(1)

    await binding.deactivate(2)
    expect(binding.getActiveId(2)).toBeNull()
    expect(binding.getWebContentsIdsForSession('available')).toEqual([3])
    expect(projection.notify).toHaveBeenLastCalledWith({
      sessionIds: [],
      reason: 'deactivated',
      activeSessionId: null,
      webContentsId: 2
    })
    callbacks.get(3)!()
    expect(binding.getWebContentsIdsForSession('available')).toEqual([])
    expect(callbacks.size).toBe(0)
    expect(disposed).toHaveBeenCalledTimes(3)
  })

  it('preserves a new binding when an old missing-session lookup finishes', async () => {
    const missing = Promise.withResolvers<SessionWithState | null>()
    const dispose = vi.fn()
    const binding = new DesktopSessionBinding(
      { getSession: () => missing.promise, notify() {} },
      () => dispose
    )
    binding.bind(1, 'old')
    const reading = binding.getActive(1)
    binding.bind(1, 'new')
    missing.resolve(null)
    await expect(reading).resolves.toBeNull()
    expect(binding.getActiveId(1)).toBe('new')
    expect(dispose).not.toHaveBeenCalled()
    binding.unbind(1)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not activate a renderer destroyed during native registration', async () => {
    const dispose = vi.fn()
    const notify = vi.fn()
    const binding = new DesktopSessionBinding(
      { getSession: async () => null, notify },
      (_id, listener) => {
        listener()
        return dispose
      }
    )
    await binding.activate(1, 'session')
    expect(binding.getActiveId(1)).toBeNull()
    expect(notify).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
