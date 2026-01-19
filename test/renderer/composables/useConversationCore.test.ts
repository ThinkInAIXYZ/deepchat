import { describe, it, expect, vi } from 'vitest'
import { useConversationCore } from '@/composables/chat/useConversationCore'

const forkConversation = vi.hoisted(() => vi.fn().mockResolvedValue('new-id'))

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: (name: string) => {
    if (name === 'sessionPresenter') {
      return { forkConversation }
    }
    return {}
  }
}))

describe('useConversationCore', () => {
  it('forwards forkConversation to presenter', async () => {
    const core = useConversationCore()
    await core.forkConversation('c-1', 'm-1', 'forked')
    expect(forkConversation).toHaveBeenCalledWith('c-1', 'm-1', 'forked', undefined, undefined)
  })
})
