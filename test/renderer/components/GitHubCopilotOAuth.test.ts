import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { LLM_PROVIDER } from '../../../src/shared/presenter'

const buttonStub = defineComponent({
  name: 'Button',
  inheritAttrs: false,
  emits: ['click'],
  template: '<button v-bind="$attrs" type="button" @click="$emit(\'click\')"><slot /></button>'
})

const inputStub = defineComponent({
  name: 'Input',
  inheritAttrs: false,
  props: {
    modelValue: {
      type: [String, Number],
      default: ''
    }
  },
  emits: ['update:model-value'],
  template: '<input v-bind="$attrs" :value="modelValue" />'
})

const labelStub = defineComponent({
  name: 'Label',
  inheritAttrs: false,
  template: '<label v-bind="$attrs"><slot /></label>'
})

const iconStub = defineComponent({
  name: 'Icon',
  template: '<i />'
})

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'github-copilot',
  name: 'GitHub Copilot',
  apiType: 'openai-compatible',
  apiKey: '',
  baseUrl: 'https://api.githubcopilot.com',
  enable: true,
  custom: false,
  ...overrides
})

describe('GitHubCopilotOAuth', () => {
  async function setup() {
    vi.resetModules()

    const oauthClient = {
      startGitHubCopilotDeviceFlowLogin: vi.fn().mockResolvedValue(true),
      startGitHubCopilotLogin: vi.fn().mockResolvedValue(true)
    }
    const providerStore = {
      updateProviderConfig: vi.fn().mockResolvedValue(undefined),
      updateProviderApi: vi.fn().mockResolvedValue(undefined)
    }
    const modelCheckStore = {
      openDialog: vi.fn()
    }

    vi.doMock('@api/OAuthClient', () => ({
      createOAuthClient: () => oauthClient
    }))
    vi.doMock('@/stores/providerStore', () => ({
      useProviderStore: () => providerStore
    }))
    vi.doMock('@/stores/modelCheck', () => ({
      useModelCheckStore: () => modelCheckStore
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@shadcn/components/ui/input', () => ({
      Input: inputStub
    }))
    vi.doMock('@shadcn/components/ui/button', () => ({
      Button: buttonStub
    }))
    vi.doMock('@shadcn/components/ui/label', () => ({
      Label: labelStub
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: iconStub
    }))

    const GitHubCopilotOAuth = (
      await import('../../../src/renderer/settings/components/GitHubCopilotOAuth.vue')
    ).default
    const wrapper = mount(GitHubCopilotOAuth, {
      props: {
        provider: createProvider()
      }
    })

    return {
      wrapper,
      oauthClient
    }
  }

  it('starts both GitHub Copilot login flows through OAuthClient', async () => {
    const { wrapper, oauthClient } = await setup()
    const buttons = wrapper.findAll('button')

    await buttons[0].trigger('click')
    await flushPromises()
    await buttons[1].trigger('click')
    await flushPromises()

    expect(oauthClient.startGitHubCopilotDeviceFlowLogin).toHaveBeenCalledWith('github-copilot')
    expect(oauthClient.startGitHubCopilotLogin).toHaveBeenCalledWith('github-copilot')
    expect(wrapper.emitted('auth-success')).toHaveLength(2)
  })
})
