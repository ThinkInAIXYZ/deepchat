import { describe, it, expect, vi } from 'vitest'
import { useAcpRuntimeAdapter } from '@/composables/chat/useAcpRuntimeAdapter'

const setAcpSessionMode = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: () => ({
    setAcpSessionMode
  })
}))

describe('useAcpRuntimeAdapter', () => {
  it('forwards setAcpSessionMode to presenter', async () => {
    const adapter = useAcpRuntimeAdapter()
    await adapter.setAcpSessionMode('c-1', 'default')
    expect(setAcpSessionMode).toHaveBeenCalledWith('c-1', 'default')
  })
})
