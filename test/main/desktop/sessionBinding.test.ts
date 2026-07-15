import { describe, expect, it, vi } from 'vitest'
import { DesktopSessionBinding } from '@/desktop/sessionBinding'

describe('DesktopSessionBinding', () => {
  it('owns independent renderer bindings and clears missing sessions', async () => {
    const projection = {
      getSession: vi.fn(async (sessionId: string) =>
        sessionId === 'available' ? ({ id: sessionId } as never) : null
      ),
      notify: vi.fn()
    }
    const binding = new DesktopSessionBinding(projection)

    await binding.activate(1, 'missing')
    await binding.activate(2, 'available')
    expect(binding.getActiveId(1)).toBe('missing')
    expect(binding.getActiveId(2)).toBe('available')

    await expect(binding.getActive(1)).resolves.toBeNull()
    expect(binding.getActiveId(1)).toBeNull()

    await binding.deactivate(2)
    expect(binding.getActiveId(2)).toBeNull()
    expect(projection.notify).toHaveBeenLastCalledWith({
      sessionIds: [],
      reason: 'deactivated',
      activeSessionId: null,
      webContentsId: 2
    })
  })
})
