import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { LLM_PROVIDER } from '@shared/types/provider'
import type { XaiGrokAuthStatus } from '../../../src/shared/contracts/routes'

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

const signedOutStatus: XaiGrokAuthStatus = {
  state: 'signed-out',
  authenticated: false,
  storage: 'safeStorage'
}

const authenticatedStatus: XaiGrokAuthStatus = {
  state: 'authenticated',
  authenticated: true,
  storage: 'safeStorage',
  accountId: 'acct...1234',
  accountLabel: 'grok@example.com'
}

const pendingDeviceStatus: XaiGrokAuthStatus = {
  state: 'pending-device',
  authenticated: false,
  storage: 'safeStorage',
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://auth.x.ai/device'
}

const provider: LLM_PROVIDER = {
  id: 'grok',
  name: 'Grok',
  apiType: 'grok',
  apiKey: '',
  baseUrl: 'https://api.x.ai/v1',
  enable: true,
  custom: false
}

describe('GrokOAuth', () => {
  async function setup(initialStatus: XaiGrokAuthStatus = signedOutStatus) {
    vi.resetModules()

    const oauthClient = {
      getXaiGrokStatus: vi.fn().mockResolvedValue(initialStatus),
      startXaiGrokDeviceLogin: vi.fn().mockResolvedValue(authenticatedStatus),
      cancelXaiGrokLogin: vi.fn().mockResolvedValue(signedOutStatus),
      logoutXaiGrok: vi.fn().mockResolvedValue(signedOutStatus),
      onXaiGrokStatusChanged: vi.fn(() => vi.fn())
    }
    const browserClient = {
      openExternal: vi.fn().mockResolvedValue(undefined)
    }
    const modelCheckStore = {
      openDialog: vi.fn()
    }

    vi.doMock('@api/OAuthClient', () => ({
      createOAuthClient: () => oauthClient
    }))
    vi.doMock('@api/BrowserClient', () => ({
      createBrowserClient: () => browserClient
    }))
    vi.doMock('@/stores/modelCheck', () => ({
      useModelCheckStore: () => modelCheckStore
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@dc-ui/components/button', () => ({
      DcButton: buttonStub
    }))
    vi.doMock('@shadcn/components/ui/label', () => ({
      Label: labelStub
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: iconStub
    }))

    const GrokOAuth = (await import('../../../src/renderer/settings/components/GrokOAuth.vue'))
      .default
    const wrapper = mount(GrokOAuth, {
      props: { provider }
    })
    await flushPromises()

    return { wrapper, oauthClient, browserClient, modelCheckStore }
  }

  it('starts device login and emits auth success', async () => {
    const { wrapper, oauthClient } = await setup()

    await wrapper.get('[data-testid="grok-device-login-button"]').trigger('click')
    await flushPromises()

    expect(oauthClient.startXaiGrokDeviceLogin).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('auth-success')).toHaveLength(1)
    expect(wrapper.text()).toContain('grok@example.com')
  })

  it('shows the device code and reopens the trusted verification page', async () => {
    const { wrapper, browserClient } = await setup(pendingDeviceStatus)

    expect(wrapper.text()).toContain('ABCD-EFGH')
    await wrapper.get('[data-testid="grok-open-verification-button"]').trigger('click')

    expect(browserClient.openExternal).toHaveBeenCalledWith('https://auth.x.ai/device')
    expect(wrapper.find('[data-testid="grok-cancel-login-button"]').exists()).toBe(true)
  })

  it('opens model checks only for an enabled authenticated provider', async () => {
    const { wrapper, modelCheckStore } = await setup(authenticatedStatus)

    await wrapper.get('[data-testid="grok-test-connection-button"]').trigger('click')

    expect(modelCheckStore.openDialog).toHaveBeenCalledWith('grok')
  })
})
