import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { LLM_PROVIDER } from '@shared/types/provider'

const updateVoiceAIConfig = vi.hoisted(() => vi.fn())

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const inputStub = defineComponent({
  name: 'Input',
  inheritAttrs: false,
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  template:
    '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const provider = {
  id: 'voiceai',
  name: 'VoiceAI',
  apiType: 'openai-compatible',
  apiKey: '',
  baseUrl: '',
  enable: true
} as LLM_PROVIDER

async function setup(
  save: (updates: Record<string, unknown>) => Promise<void> = async () => undefined
) {
  vi.resetModules()
  updateVoiceAIConfig.mockReset().mockImplementation(save)
  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => ({
      getVoiceAIConfig: vi.fn().mockResolvedValue({
        audioFormat: 'mp3',
        model: 'initial-model',
        language: 'en',
        temperature: 1,
        topP: 0.8,
        agentId: 'initial-agent'
      }),
      updateVoiceAIConfig
    })
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({ t: (key: string) => key })
  }))
  vi.doMock('@shadcn/components/ui/input', () => ({ Input: inputStub }))
  vi.doMock('@shadcn/components/ui/label', () => ({ Label: passthrough('Label') }))
  vi.doMock('@shadcn/components/ui/separator', () => ({ Separator: passthrough('Separator') }))
  vi.doMock('@shadcn/components/ui/slider', () => ({ Slider: passthrough('Slider') }))
  vi.doMock('@shadcn/components/ui/select', () => ({
    Select: passthrough('Select'),
    SelectContent: passthrough('SelectContent'),
    SelectItem: passthrough('SelectItem'),
    SelectTrigger: passthrough('SelectTrigger'),
    SelectValue: passthrough('SelectValue')
  }))
  vi.doMock('@iconify/vue', () => ({ Icon: passthrough('Icon') }))

  const component = (
    await import('../../../src/renderer/settings/components/VoiceAIProviderConfig.vue')
  ).default
  const wrapper = mount(component, { props: { provider } })
  await flushPromises()
  const { settingsLeaveGuard } =
    await import('../../../src/renderer/settings/services/settingsLeaveGuard')
  return { wrapper, settingsLeaveGuard }
}

describe('VoiceAIProviderConfig', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.useRealTimers()
  })

  it('persists rapid edits to different fields in one bounded update', async () => {
    ;({ wrapper } = await setup())

    await wrapper.get('#voiceai-tts-model').setValue('latest-model')
    await wrapper.get('#voiceai-agent-id').setValue('latest-agent')
    await vi.advanceTimersByTimeAsync(200)

    expect(updateVoiceAIConfig).toHaveBeenCalledTimes(1)
    expect(updateVoiceAIConfig).toHaveBeenCalledWith({
      model: 'latest-model',
      agentId: 'latest-agent'
    })
  })

  it('queues edits made while a save is in flight', async () => {
    let resolveFirst!: () => void
    ;({ wrapper } = await setup(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
    ))

    await wrapper.get('#voiceai-tts-model').setValue('first-model')
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.get('#voiceai-agent-id').setValue('queued-agent')
    await vi.advanceTimersByTimeAsync(200)
    expect(updateVoiceAIConfig).toHaveBeenCalledTimes(1)

    resolveFirst()
    await flushPromises()

    expect(updateVoiceAIConfig).toHaveBeenCalledTimes(2)
    expect(updateVoiceAIConfig).toHaveBeenLastCalledWith({ agentId: 'queued-agent' })
  })

  it('keeps failed values dirty and exposes the translated save error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const setupResult = await setup(async () => {
      throw new Error('secret failure')
    })
    wrapper = setupResult.wrapper

    await wrapper.get('#voiceai-tts-model').setValue('unsaved-model')
    await vi.advanceTimersByTimeAsync(200)

    expect(wrapper.get('[data-testid="voiceai-config-save-error"]').text()).toContain(
      'settings.deepchatAgents.saveFeedback.saveFailed'
    )
    expect(wrapper.text()).not.toContain('secret failure')
    expect(setupResult.settingsLeaveGuard.getSnapshot().risk).toBe('dirty')

    const leave = setupResult.settingsLeaveGuard.requestLeave()
    expect(setupResult.settingsLeaveGuard.discardAndLeave()).toBe(true)
    await expect(leave).resolves.toBe(true)
    expect((wrapper.get('#voiceai-tts-model').element as HTMLInputElement).value).toBe(
      'initial-model'
    )
    consoleError.mockRestore()
  })

  it('flushes pending values immediately when unmounted', async () => {
    ;({ wrapper } = await setup())
    await wrapper.get('#voiceai-agent-id').setValue('leaving-agent')

    wrapper.unmount()
    wrapper = undefined
    await flushPromises()

    expect(updateVoiceAIConfig).toHaveBeenCalledTimes(1)
    expect(updateVoiceAIConfig).toHaveBeenCalledWith({ agentId: 'leaving-agent' })
  })
})
