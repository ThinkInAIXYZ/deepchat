import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { LLM_PROVIDER } from '../../../src/shared/presenter'

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button data-testid="sync-button" @click="$emit(\'click\')"><slot /></button>'
})

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<span><slot /></span>'
  })

const createProvider = (): LLM_PROVIDER =>
  ({
    id: 'modelscope',
    name: 'ModelScope',
    apiType: 'modelscope',
    apiKey: 'modelscope-key',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    enable: true
  }) as LLM_PROVIDER

async function setup() {
  vi.resetModules()

  const providerClient = {
    syncModelScopeMcpServers: vi.fn().mockResolvedValue({
      success: true,
      message: 'ok',
      synced: 1,
      imported: 1,
      skipped: 0,
      errors: []
    })
  }

  vi.doMock('@api/ProviderClient', () => ({
    createProviderClient: () => providerClient
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params?.count !== undefined ? `${key}:${params.count}` : key
    })
  }))
  vi.doMock('@iconify/vue', () => ({
    Icon: passthrough('Icon')
  }))
  vi.doMock('@shadcn/components/ui/button', () => ({
    Button: buttonStub
  }))
  vi.doMock('@shadcn/components/ui/badge', () => ({
    Badge: passthrough('Badge')
  }))

  const ModelScopeMcpSync = (
    await import('../../../src/renderer/settings/components/ModelScopeMcpSync.vue')
  ).default

  const wrapper = mount(ModelScopeMcpSync, {
    props: {
      provider: createProvider()
    }
  })

  return {
    wrapper,
    providerClient
  }
}

describe('ModelScopeMcpSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('syncs ModelScope MCP servers through ProviderClient', async () => {
    const { wrapper, providerClient } = await setup()

    await wrapper.get('[data-testid="sync-button"]').trigger('click')
    await flushPromises()

    expect(providerClient.syncModelScopeMcpServers).toHaveBeenCalledWith('modelscope', {
      page_number: 1,
      page_size: 50
    })
    expect(wrapper.text()).toContain('settings.provider.modelscope.mcpSync.imported:1')
  })
})
