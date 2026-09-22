import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const detail = {
  id: 'knowledge-1',
  description: 'Local docs',
  embedding: {
    providerId: 'openai',
    modelId: 'text-embedding-3-small'
  },
  dimensions: 1536,
  normalized: true,
  fragmentsNumber: 6,
  enabled: true
}

async function setup(leaveAllowed: boolean) {
  vi.resetModules()
  vi.doUnmock('vue-router')
  const { createRouter, createMemoryHistory } = await import('vue-router')
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/knowledge-base',
        name: 'settings-knowledge-base',
        component: { template: '<div />' }
      },
      { path: '/plugins', name: 'settings-plugins', component: { template: '<div />' } }
    ]
  })
  await router.push('/knowledge-base')

  const requestLeave = vi.fn().mockResolvedValue(leaveAllowed)
  vi.doMock('@api/KnowledgeClient', () => ({
    createKnowledgeClient: () => ({
      isSupported: vi.fn().mockResolvedValue(true)
    })
  }))
  vi.doMock('../../../src/renderer/settings/services/settingsLeaveGuard', () => ({
    settingsLeaveGuard: { requestLeave }
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  const BuiltinKnowledgeSettings = defineComponent({
    name: 'BuiltinKnowledgeSettings',
    emits: ['showDetail'],
    setup(_, { emit }) {
      return () =>
        h(
          'button',
          {
            'data-testid': 'show-knowledge-detail',
            onClick: () => emit('showDetail', detail)
          },
          'show'
        )
    }
  })
  const KnowledgeFile = defineComponent({
    name: 'KnowledgeFile',
    template: '<div data-testid="knowledge-file" />'
  })
  const Component = (
    await import('../../../src/renderer/settings/components/KnowledgeBaseSettings.vue')
  ).default
  const wrapper = mount(Component, {
    global: {
      plugins: [router],
      stubs: {
        SettingsPageShell: defineComponent({
          name: 'SettingsPageShell',
          template: '<main><slot /></main>'
        }),
        RagflowKnowledgeSettings: true,
        DifyKnowledgeSettings: true,
        FastGptKnowledgeSettings: true,

        BuiltinKnowledgeSettings,
        KnowledgeFile
      }
    }
  })
  await flushPromises()

  return { wrapper, requestLeave, router }
}

describe('KnowledgeBaseSettings', () => {
  it('opens plugin settings using the settings-window router', async () => {
    const { wrapper, router } = await setup(true)
    await wrapper.get('[data-testid=nowledge-plugin-link]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('settings-plugins')
    wrapper.unmount()
  })
  it('keeps the settings surface mounted when internal navigation is blocked', async () => {
    const { wrapper, requestLeave } = await setup(false)

    await wrapper.get('[data-testid="show-knowledge-detail"]').trigger('click')
    await flushPromises()

    expect(requestLeave).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="knowledge-file"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=nowledge-plugin-link]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('unmounts the settings surface before showing built-in knowledge details', async () => {
    const { wrapper } = await setup(true)

    await wrapper.get('[data-testid="show-knowledge-detail"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="knowledge-file"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=nowledge-plugin-link]').exists()).toBe(false)
    wrapper.unmount()
  })
})
