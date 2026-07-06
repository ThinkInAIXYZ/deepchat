import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('AgentAvatar', () => {
  it('handles lucide icon load failures without throwing from the watcher', async () => {
    const ensureIconAvailable = vi.fn().mockRejectedValue(new Error('load failed'))
    vi.doMock('@/lib/iconLoader', () => ({ ensureIconAvailable }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span data-testid="icon" />'
      }
    }))
    vi.doMock('pinia', () => ({
      createPinia: vi.fn(() => ({})),
      defineStore: vi.fn(() => vi.fn(() => ({}))),
      getActivePinia: vi.fn(() => null),
      storeToRefs: vi.fn((store) => store)
    }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const AgentAvatar = (await import('@/components/icons/AgentAvatar.vue')).default
    const wrapper = mount(AgentAvatar, {
      props: {
        agent: {
          id: 'agent-1',
          name: 'Agent One',
          type: 'deepchat',
          icon: '',
          avatar: {
            kind: 'lucide',
            icon: 'bot',
            lightColor: '#111111',
            darkColor: '#eeeeee'
          }
        }
      }
    })

    await flushPromises()

    expect(ensureIconAvailable).toHaveBeenCalledWith('lucide:bot')
    expect(warnSpy).toHaveBeenCalledWith(
      '[AgentAvatar] Failed to load lucide icon "bot":',
      expect.any(Error)
    )
    expect(wrapper.find('[data-testid="icon"]').exists()).toBe(true)
  })
})
