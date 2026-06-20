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

  it('resolves novita to the novita.ai icon', async () => {
    const ModelIcon = (await import('@/components/icons/ModelIcon.vue')).default
    const novitaAiIcon = (await import('@/assets/llm-icons/novitaai.svg?url')).default
    const wrapper = mount(ModelIcon, {
      props: {
        modelId: 'novita'
      }
    })

    const image = wrapper.get('img')

    expect(image.attributes('alt')).toBe('novita')
    expect(image.attributes('src')).toBe(novitaAiIcon)
  })

  it('resolves mistral to the Mistral icon', async () => {
    const ModelIcon = (await import('@/components/icons/ModelIcon.vue')).default
    const mistralIcon = (await import('@/assets/llm-icons/mistral-color.svg?url')).default
    const wrapper = mount(ModelIcon, {
      props: {
        modelId: 'mistral'
      }
    })

    const image = wrapper.get('img')

    expect(image.attributes('alt')).toBe('mistral')
    expect(image.attributes('src')).toBe(mistralIcon)
  })

  it('resolves kimi-for-coding to the Kimi color icon', async () => {
    const ModelIcon = (await import('@/components/icons/ModelIcon.vue')).default
    const kimiIcon = (await import('@/assets/llm-icons/kimi-color.svg?url')).default
    const wrapper = mount(ModelIcon, {
      props: {
        modelId: 'kimi-for-coding'
      }
    })

    const image = wrapper.get('img')

    expect(image.attributes('alt')).toBe('kimi-for-coding')
    expect(image.attributes('src')).toBe(kimiIcon)
  })

  it('resolves the basic API-key provider icons', async () => {
    const ModelIcon = (await import('@/components/icons/ModelIcon.vue')).default
    const nvidiaIcon = (await import('@/assets/llm-icons/nvidia-color.svg?url')).default
    const huggingFaceIcon = (await import('@/assets/llm-icons/huggingface-color.svg?url')).default
    const alibabaIcon = (await import('@/assets/llm-icons/alibabacloud-color.svg?url')).default

    const nvidia = mount(ModelIcon, {
      props: {
        modelId: 'nvidia'
      }
    })
    const huggingface = mount(ModelIcon, {
      props: {
        modelId: 'huggingface'
      }
    })
    const alibabaTokenPlan = mount(ModelIcon, {
      props: {
        modelId: 'alibaba-token-plan'
      }
    })

    expect(nvidia.get('img').attributes('src')).toBe(nvidiaIcon)
    expect(huggingface.get('img').attributes('src')).toBe(huggingFaceIcon)
    expect(alibabaTokenPlan.get('img').attributes('src')).toBe(alibabaIcon)
  })
})
