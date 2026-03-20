import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const getAcpRegistryIconMarkup = vi.fn()

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: () => ({
    getAcpRegistryIconMarkup
  })
}))

describe('AcpAgentIcon', () => {
  it('renders inline svg markup for registry icons via presenter', async () => {
    getAcpRegistryIconMarkup.mockResolvedValueOnce(
      '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h16v16H0z" /></svg>'
    )

    const AcpAgentIcon = (await import('@/components/icons/AcpAgentIcon.vue')).default
    const wrapper = mount(AcpAgentIcon, {
      props: {
        icon: 'https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg',
        alt: 'Claude Agent'
      }
    })

    await flushPromises()

    expect(getAcpRegistryIconMarkup).toHaveBeenCalledWith(
      'https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg'
    )
    expect(wrapper.find('.acp-registry-icon svg').exists()).toBe(true)
  })
})
