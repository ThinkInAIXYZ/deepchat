import { afterEach, describe, expect, it, vi } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DefaultModelSettingsSection from '../../../src/renderer/settings/components/common/DefaultModelSettingsSection.vue'
import settings from '../../../src/renderer/src/i18n/en-US/settings.json'

vi.unmock('vue-i18n')

const state = vi.hoisted(() => ({
  defaultModel: 'alpha',
  changed: null as (() => void) | null,
  setSetting: vi.fn()
}))

vi.mock('@api/ConfigClient', () => ({
  createConfigClient: () => ({
    getSetting: async (key: string) =>
      key === 'defaultModel' ? { providerId: 'provider', modelId: state.defaultModel } : null,
    setSetting: state.setSetting
  })
}))
vi.mock('@api/TunnelSyncClient', () => ({
  createTunnelSyncClient: () => ({
    onChanged: (listener: () => void) => {
      state.changed = listener
      return () => {
        state.changed = null
      }
    }
  })
}))
vi.mock('@/stores/modelStore', () => ({
  useModelStore: () => ({
    enabledModels: [
      {
        providerId: 'provider',
        models: [
          { id: 'alpha', name: 'Alpha' },
          { id: 'beta', name: 'Beta' }
        ]
      }
    ]
  })
}))
vi.mock('@/stores/theme', () => ({ useThemeStore: () => ({ isDark: false }) }))

afterEach(() => {
  state.defaultModel = 'alpha'
  state.changed = null
  state.setSetting.mockReset()
})

describe('DefaultModelSettingsSection', () => {
  it('refreshes an open model setting after a device sync event', async () => {
    const wrapper = shallowMount(DefaultModelSettingsSection, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { settings } } })],
        renderStubDefaultSlot: true
      }
    })
    try {
      await flushPromises()
      expect(wrapper.text()).toContain('Alpha')
      state.defaultModel = 'beta'
      state.changed?.()
      await flushPromises()
      expect(wrapper.text()).toContain('Beta')
    } finally {
      wrapper.unmount()
    }
  })
})
