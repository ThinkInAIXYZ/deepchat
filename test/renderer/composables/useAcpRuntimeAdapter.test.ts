import { describe, it, expect, vi } from 'vitest'
import { useAcpRuntimeAdapter } from '@/composables/chat/useAcpRuntimeAdapter'

const setSessionMode = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: () => ({
    setSessionMode
  })
}))

describe('useAcpRuntimeAdapter', () => {
  it('forwards setAcpSessionMode to presenter', async () => {
    const adapter = useAcpRuntimeAdapter()
    await adapter.setAcpSessionMode('c-1', 'default')
    expect(setSessionMode).toHaveBeenCalledWith('c-1', 'default')
  })
})
