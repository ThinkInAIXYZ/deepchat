import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/stores/providerStore', () => ({
  useProviderStore: () => ({
    providers: []
  })
}))

vi.mock('@/stores/ui/agent', () => ({
  useAgentStore: () => ({
    agents: []
  })
}))

describe('ModelIcon', () => {
  it('resolves dimcode-acp to the DimCode icon', async () => {
    const ModelIcon = (await import('@/components/icons/ModelIcon.vue')).default
    const dimcodeIcon = (await import('@/assets/llm-icons/dimcode.svg?url')).default
    const wrapper = mount(ModelIcon, {
      props: {
        modelId: 'dimcode-acp'
      }
    })

    const image = wrapper.get('img')

    expect(image.attributes('alt')).toBe('dimcode')
    expect(image.attributes('src')).toBe(dimcodeIcon)
  })
})
