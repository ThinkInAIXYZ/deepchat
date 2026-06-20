import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { LLM_PROVIDER } from '../../../src/shared/presenter'
import type { OpenAICodexAuthStatus } from '../../../src/shared/contracts/routes'

const buttonStub = defineComponent({
  name: 'Button',
  inheritAttrs: false,
  emits: ['click'],
  template: '<button v-bind="$attrs" type="button" @click="$emit(\'click\')"><slot /></button>'
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

const signedOutStatus: OpenAICodexAuthStatus = {
  state: 'signed-out',
  authenticated: false,
  storage: 'safeStorage'
}

const authenticatedStatus: OpenAICodexAuthStatus = {
  state: 'authenticated',
  authenticated: true,
  storage: 'safeStorage',
  accountId: 'acct...1234',
  accountLabel: 'user@example.com'
}

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'openai-codex',
  name: 'OpenAI Codex',
  apiType: 'openai-codex',
  apiKey: '',
  baseUrl: 'https://chatgpt.com/backend-api/codex',
  enable: true,
  custom: false,
  ...overrides
})

describe('OpenAICodexOAuth', () => {
  async function setup(initialStatus: OpenAICodexAuthStatus = signedOutStatus) {
    vi.resetModules()

    const oauthClient = {
      getOpenAICodexStatus: vi.fn().mockResolvedValue(initialStatus),
      startOpenAICodexBrowserLogin: vi.fn().mockResolvedValue(authenticatedStatus),
      cancelOpenAICodexLogin: vi.fn().mockResolvedValue(signedOutStatus),
      logoutOpenAICodex: vi.fn().mockResolvedValue(signedOutStatus),
      onOpenAICodexStatusChanged: vi.fn(() => vi.fn())
    }
    const modelCheckStore = {
      openDialog: vi.fn()
    }

    vi.doMock('@api/OAuthClient', () => ({
      createOAuthClient: () => oauthClient
    }))
    vi.doMock('@/stores/modelCheck', () => ({
      useModelCheckStore: () => modelCheckStore
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
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

    const OpenAICodexOAuth = (
      await import('../../../src/renderer/settings/components/OpenAICodexOAuth.vue')
    ).default
    const wrapper = mount(OpenAICodexOAuth, {
      props: {
        provider: createProvider()
      }
    })
    await flushPromises()

    return {
      wrapper,
      oauthClient,
      modelCheckStore
    }
  }

  it('starts browser login and emits auth success', async () => {
    const { wrapper, oauthClient } = await setup()

    await wrapper.get('[data-testid="codex-browser-login-button"]').trigger('click')
    await flushPromises()

    expect(oauthClient.startOpenAICodexBrowserLogin).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('auth-success')).toHaveLength(1)
    expect(wrapper.text()).toContain('user@example.com')
  })

  it('renders browser OAuth only without device-code controls', async () => {
    const { wrapper } = await setup()

    expect(wrapper.find('[data-testid="codex-browser-login-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="codex-device-login-button"]').exists()).toBe(false)
  })

  it('logs out authenticated Codex accounts', async () => {
    const { wrapper, oauthClient } = await setup(authenticatedStatus)

    await wrapper.get('[data-testid="codex-logout-button"]').trigger('click')
    await flushPromises()

    expect(oauthClient.logoutOpenAICodex).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('settings.provider.openaiCodexNotConnected')
  })
})
