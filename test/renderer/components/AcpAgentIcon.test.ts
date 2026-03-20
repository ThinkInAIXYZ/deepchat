import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const getAcpRegistryIconMarkup = vi.fn()
const registryIconUrl = 'https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg'
const pendingRegistryIconUrl =
  'https://cdn.agentclientprotocol.com/registry/v1/latest/codex-acp.svg'
const retryRegistryIconUrl = 'https://cdn.agentclientprotocol.com/registry/v1/latest/dimcode.svg'

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: () => ({
    getAcpRegistryIconMarkup
  })
}))

describe('AcpAgentIcon', () => {
  beforeEach(() => {
    getAcpRegistryIconMarkup.mockReset()
  })

  it('renders inline svg markup for registry icons via presenter', async () => {
    getAcpRegistryIconMarkup.mockResolvedValueOnce(
      '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h16v16H0z" /></svg>'
    )

    const AcpAgentIcon = (await import('@/components/icons/AcpAgentIcon.vue')).default
    const wrapper = mount(AcpAgentIcon, {
      props: {
        agentId: 'claude-acp',
        icon: registryIconUrl,
        alt: 'Claude Agent'
      }
    })

    await flushPromises()

    expect(getAcpRegistryIconMarkup).toHaveBeenCalledWith('claude-acp', registryIconUrl)
    expect(wrapper.find('.acp-registry-icon svg').exists()).toBe(true)
  })

  it('does not render the raw registry image while themed svg markup is pending', async () => {
    getAcpRegistryIconMarkup.mockImplementationOnce(
      () => new Promise(() => {}) as Promise<string | null>
    )

    const AcpAgentIcon = (await import('@/components/icons/AcpAgentIcon.vue')).default
    const wrapper = mount(AcpAgentIcon, {
      props: {
        agentId: 'codex-acp',
        icon: pendingRegistryIconUrl,
        alt: 'Codex CLI',
        fallbackText: 'Codex'
      }
    })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('C')
  })

  it('does not memoize empty markup results', async () => {
    getAcpRegistryIconMarkup
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h16v16H0z" /></svg>'
      )

    const AcpAgentIcon = (await import('@/components/icons/AcpAgentIcon.vue')).default
    const firstWrapper = mount(AcpAgentIcon, {
      props: {
        agentId: 'dimcode',
        icon: retryRegistryIconUrl,
        alt: 'DimCode',
        fallbackText: 'DimCode'
      }
    })

    await flushPromises()
    expect(firstWrapper.find('.acp-registry-icon svg').exists()).toBe(false)
    expect(getAcpRegistryIconMarkup).toHaveBeenCalledTimes(1)

    const secondWrapper = mount(AcpAgentIcon, {
      props: {
        agentId: 'dimcode',
        icon: retryRegistryIconUrl,
        alt: 'DimCode',
        fallbackText: 'DimCode'
      }
    })

    await flushPromises()
    expect(getAcpRegistryIconMarkup).toHaveBeenCalledTimes(2)
    expect(secondWrapper.find('.acp-registry-icon svg').exists()).toBe(true)
  })
})
