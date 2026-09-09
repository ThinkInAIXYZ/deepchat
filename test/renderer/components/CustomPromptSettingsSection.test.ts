import { describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import type { Prompt } from '@shared/types/prompt'
import CustomPromptSettingsSection from '../../../src/renderer/settings/components/prompt/CustomPromptSettingsSection.vue'

const promptStore = vi.hoisted(() => ({ loadPrompts: vi.fn(), updatePrompt: vi.fn() }))
vi.mock('@/stores/prompts', () => ({ usePromptsStore: () => promptStore }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer-notifications/rendererNotificationPort', () => ({ notifyRenderer: vi.fn() }))

describe('CustomPromptSettingsSection', () => {
  it.each([undefined, true, false])(
    'renders and toggles stored enabled=%s consistently',
    async (enabled) => {
      const prompt: Prompt = { id: 'legacy', name: 'Legacy', description: '', enabled }
      promptStore.loadPrompts.mockResolvedValue([prompt])
      promptStore.updatePrompt.mockImplementation(async (_id, patch) => [{ ...prompt, ...patch }])
      const wrapper = shallowMount(CustomPromptSettingsSection, { props: { blocked: false } })
      await flushPromises()
      const toggle = wrapper.get('button[aria-pressed]')
      const initiallyEnabled = enabled ?? true
      expect(toggle.attributes('aria-pressed')).toBe(String(initiallyEnabled))
      expect(toggle.text()).toBe(
        initiallyEnabled ? 'promptSetting.active' : 'promptSetting.inactive'
      )
      await toggle.trigger('click')
      await flushPromises()
      expect(promptStore.updatePrompt).toHaveBeenCalledWith(
        'legacy',
        expect.objectContaining({ enabled: !initiallyEnabled })
      )
      expect(toggle.attributes('aria-pressed')).toBe(String(!initiallyEnabled))
      expect(toggle.text()).toBe(
        initiallyEnabled ? 'promptSetting.inactive' : 'promptSetting.active'
      )
    }
  )
})
